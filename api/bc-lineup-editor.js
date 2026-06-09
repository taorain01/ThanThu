const { createClient } = require('@supabase/supabase-js');

const DEFAULT_GUILD_ID = '450633680000385036';
const LINEUP_EDITOR_DISCORD_IDS = new Set(['403644798667325440', '395151484179841024']);
const JSON_ARRAY_FIELDS = new Set(['team_attack1', 'team_attack2', 'team_defense', 'team_forest', 'waiting_list']);
const JSON_OBJECT_FIELDS = new Set(['team_sizes', 'team_names', 'leader_ids', 'teams_json', 'teams']);
const PASSTHROUGH_FIELDS = new Set(['team_layout', 'locked']);
const MAX_PAYLOAD_CHARS = 250000;

let adminClient = null;

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SECRET_KEY
    || '';
  return { url, key };
}

function getAdminClient() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    throw new Error('Backend chua cau hinh Supabase service key.');
  }
  if (!adminClient) {
    adminClient = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
  return adminClient;
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return {};
  }
}

function getDiscordIdFromUser(user) {
  return String(
    user?.user_metadata?.provider_id ||
    user?.user_metadata?.sub ||
    user?.identities?.find((identity) => identity.provider === 'discord')?.identity_data?.provider_id ||
    user?.identities?.find((identity) => identity.provider === 'discord')?.id ||
    ''
  ).trim();
}

function normalizeAccessRole(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isLeftPosition(position) {
  return ['khong co', 'left', 'out'].includes(normalizeAccessRole(position));
}

function parseJsonValue(value, fallback) {
  if (typeof value !== 'string') return value ?? fallback;
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch (_) {
    return fallback;
  }
}

function assertReasonablePayload(payload) {
  const size = JSON.stringify(payload || {}).length;
  if (size > MAX_PAYLOAD_CHARS) {
    const error = new Error('Payload doi hinh qua lon.');
    error.statusCode = 413;
    throw error;
  }
}

function sanitizePayload(payload, actorId, actorName) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const error = new Error('Payload doi hinh khong hop le.');
    error.statusCode = 400;
    throw error;
  }

  assertReasonablePayload(payload);
  const clean = {};

  for (const [field, value] of Object.entries(payload)) {
    if (JSON_ARRAY_FIELDS.has(field)) {
      const parsed = parseJsonValue(value, []);
      if (!Array.isArray(parsed)) continue;
      clean[field] = JSON.stringify(parsed);
      continue;
    }

    if (JSON_OBJECT_FIELDS.has(field)) {
      const parsed = parseJsonValue(value, {});
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      clean[field] = field === 'teams' ? parsed : JSON.stringify(parsed);
      continue;
    }

    if (field === 'team_layout') {
      const parsed = parseJsonValue(value, []);
      if (Array.isArray(parsed)) clean.team_layout = parsed;
      continue;
    }

    if (field === 'locked') {
      clean.locked = value === true;
    }
  }

  if (!Object.keys(clean).some((field) => JSON_ARRAY_FIELDS.has(field) || field === 'teams_json')) {
    const error = new Error('Payload khong co du lieu doi hinh de luu.');
    error.statusCode = 400;
    throw error;
  }

  const leaderIds = parseJsonValue(clean.leader_ids, {});
  clean.leader_ids = JSON.stringify({
    ...leaderIds,
    editor_id: actorId,
    editor_name: actorName || 'Lineup editor',
    editor_action: leaderIds.editor_action || 'lineup_editor_api',
    edited_at: Date.now()
  });
  clean.updated_at = new Date().toISOString();
  return clean;
}

function errorMentionsField(error, field) {
  const message = String(error?.message || '');
  return new RegExp(`(^|[^a-z0-9_])${field}([^a-z0-9_]|$)`, 'i').test(message);
}

async function updateSession(admin, guildId, sessionId, payload) {
  const updatePayload = { ...payload };
  let lastResult = null;

  for (let attempt = 0; attempt < 6; attempt++) {
    lastResult = await admin
      .from('bc_sessions')
      .update(updatePayload)
      .eq('guild_id', guildId)
      .eq('id', sessionId)
      .select('*')
      .maybeSingle();
    if (!lastResult.error) return lastResult;

    let removed = false;
    for (const field of ['locked', 'team_names', 'team_sizes', 'teams_json', 'teams', 'team_layout', 'leader_ids']) {
      if (Object.prototype.hasOwnProperty.call(updatePayload, field) && errorMentionsField(lastResult.error, field)) {
        delete updatePayload[field];
        removed = true;
      }
    }
    if (!removed) return lastResult;
  }

  return lastResult;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return send(res, 204, {});
  }
  if (req.method === 'GET') {
    return send(res, 200, { ok: true, route: 'bc-lineup-editor', method: 'POST' });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  try {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1] || '';
    if (!token) return send(res, 401, { error: 'Chua dang nhap.' });

    const admin = getAdminClient();
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData?.user) return send(res, 401, { error: 'Phien dang nhap khong hop le.' });

    const discordId = getDiscordIdFromUser(authData.user);
    if (!discordId) return send(res, 401, { error: 'Khong tim thay Discord ID.' });
    if (!LINEUP_EDITOR_DISCORD_IDS.has(discordId)) {
      return send(res, 403, { error: 'Tai khoan nay khong co quyen chinh doi hinh web.' });
    }

    const body = parseBody(req);
    const guildId = String(body.guild_id || DEFAULT_GUILD_ID);
    const sessionId = String(body.session_id || '');
    if (guildId !== DEFAULT_GUILD_ID) return send(res, 403, { error: 'Guild khong hop le.' });
    if (!sessionId) return send(res, 400, { error: 'Thieu session_id.' });

    const { data: userRow, error: userError } = await admin
      .from('bc_users')
      .select('discord_id,discord_name,game_username,position,lang_gia_member')
      .eq('guild_id', guildId)
      .eq('discord_id', discordId)
      .maybeSingle();
    if (userError) throw userError;
    if (!userRow || userRow.lang_gia_member !== true || isLeftPosition(userRow.position)) {
      return send(res, 403, { error: 'Tai khoan khong phai thanh vien Lang Gia dang hoat dong.' });
    }

    const cleanPayload = sanitizePayload(
      body.payload,
      discordId,
      userRow.game_username || userRow.discord_name || authData.user.user_metadata?.name || discordId
    );
    const result = await updateSession(admin, guildId, sessionId, cleanPayload);
    if (result.error) throw result.error;
    if (!result.data) return send(res, 500, { error: 'Supabase khong tra ve session sau khi cap nhat.' });

    await admin.from('bc_logs').insert({
      guild_id: guildId,
      action: 'roster_sync',
      details: {
        category: 'member_roster',
        summary: 'Lineup editor web sync',
        actor_id: discordId,
        actor_name: userRow.game_username || userRow.discord_name || discordId,
        session_id: sessionId,
        changes: [],
        edited_at: new Date().toISOString()
      },
      performed_by: discordId,
      source: 'web'
    }).catch(() => null);

    return send(res, 200, { ok: true, session: result.data });
  } catch (error) {
    const status = Number(error.statusCode || error.status || 500);
    return send(res, status >= 400 && status < 600 ? status : 500, {
      error: error.message || 'Khong luu duoc doi hinh.'
    });
  }
};
