const { createClient } = require('@supabase/supabase-js');

const DEFAULT_GUILD_ID = '450633680000385036';

// Allowlist quản trị voice: đọc từ env VOICE_ADMIN_DISCORD_IDS (phân tách bằng dấu phẩy),
// fallback về danh sách editor đội hình để không khoá cứng khi chưa cấu hình env.
function getAdminAllowlist() {
  const raw = String(process.env.VOICE_ADMIN_DISCORD_IDS || '').trim();
  const ids = raw
    ? raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
    : ['403644798667325440', '395151484179841024'];
  return new Set(ids);
}

const VALID_MODES = new Set(['bridge', 'broadcast']);
const VALID_PRIORITIES = new Set(['mix', 'priority']);
const VALID_ACTIONS = new Set(['saveConfig', 'rejoin', 'leave']);
const MAX_PAYLOAD_CHARS = 60000;

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

function toStringArray(value) {
  let arr = value;
  if (typeof value === 'string') {
    try { arr = JSON.parse(value); } catch (_) { arr = []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

function assertReasonablePayload(payload) {
  const size = JSON.stringify(payload || {}).length;
  if (size > MAX_PAYLOAD_CHARS) {
    const error = new Error('Payload cau hinh qua lon.');
    error.statusCode = 413;
    throw error;
  }
}

// Chỉ nhận các field hợp lệ, validate luật (broadcast phải có đích) — Requirement 5.6, 9.6.
function sanitizeConfig(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const error = new Error('Payload cau hinh khong hop le.');
    error.statusCode = 400;
    throw error;
  }
  assertReasonablePayload(payload);

  const clean = {};

  if (payload.voice_channel_id !== undefined) {
    clean.voice_channel_id = String(payload.voice_channel_id || '').trim() || null;
  }

  if (payload.mode !== undefined) {
    const mode = String(payload.mode || '').trim().toLowerCase();
    if (!VALID_MODES.has(mode)) {
      const error = new Error('Che do relay khong hop le (chi bridge/broadcast).');
      error.statusCode = 400;
      throw error;
    }
    clean.mode = mode;
  }

  if (payload.speaker_priority !== undefined) {
    const pr = String(payload.speaker_priority || '').trim().toLowerCase();
    if (!VALID_PRIORITIES.has(pr)) {
      const error = new Error('Luat uu tien khong hop le (chi mix/priority).');
      error.statusCode = 400;
      throw error;
    }
    clean.speaker_priority = pr;
  }

  if (payload.caller_role_ids !== undefined) clean.caller_role_ids = toStringArray(payload.caller_role_ids);
  if (payload.blocked_role_ids !== undefined) clean.blocked_role_ids = toStringArray(payload.blocked_role_ids);
  if (payload.relay_targets !== undefined) clean.relay_targets = toStringArray(payload.relay_targets);
  if (payload.priority_role_ids !== undefined) clean.priority_role_ids = toStringArray(payload.priority_role_ids);

  if (payload.relay_enabled !== undefined) clean.relay_enabled = payload.relay_enabled === true;
  if (payload.auto_join !== undefined) clean.auto_join = payload.auto_join === true;

  if (payload.command_prefix !== undefined) {
    clean.command_prefix = String(payload.command_prefix || '').trim().slice(0, 16) || null;
  }

  // Luật R9.6: broadcast phải có ít nhất 1 đích.
  const effectiveMode = clean.mode;
  const effectiveTargets = clean.relay_targets;
  if (effectiveMode === 'broadcast' && Array.isArray(effectiveTargets) && effectiveTargets.length === 0) {
    const error = new Error('Che do broadcast phai chon it nhat 1 kenh/bot dich.');
    error.statusCode = 400;
    throw error;
  }

  if (Object.keys(clean).length === 0) {
    const error = new Error('Khong co du lieu cau hinh de luu.');
    error.statusCode = 400;
    throw error;
  }

  clean.updated_at = new Date().toISOString();
  return clean;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return send(res, 204, {});
  }
  if (req.method === 'GET') {
    return send(res, 200, { ok: true, route: 'voice-config', method: 'POST' });
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
    if (!getAdminAllowlist().has(discordId)) {
      return send(res, 403, { error: 'Tai khoan nay khong co quyen cau hinh Voice Bot.' });
    }

    const body = parseBody(req);
    const action = String(body.action || 'saveConfig');
    if (!VALID_ACTIONS.has(action)) return send(res, 400, { error: 'Action khong hop le.' });

    const guildId = String(body.guild_id || DEFAULT_GUILD_ID);
    if (guildId !== DEFAULT_GUILD_ID) return send(res, 403, { error: 'Guild khong hop le.' });

    const botId = Number(body.bot_id);
    if (![1, 2].includes(botId)) return send(res, 400, { error: 'bot_id phai la 1 hoac 2.' });

    let row = { guild_id: guildId, bot_id: botId };

    if (action === 'saveConfig') {
      const clean = sanitizeConfig(body.payload);
      row = { ...row, ...clean };
    } else {
      // rejoin | leave -> ghi pending_action de bot doc va thuc thi (Requirement 5.9)
      row.pending_action = action;
      row.updated_at = new Date().toISOString();
    }

    const { data, error } = await admin
      .from('voice_relay_config')
      .upsert(row, { onConflict: 'guild_id,bot_id' })
      .select('*')
      .maybeSingle();
    if (error) throw error;

    await admin.from('bc_logs').insert({
      guild_id: guildId,
      action: 'voice_config',
      details: {
        category: 'voice_relay',
        summary: `Voice config ${action} bot ${botId}`,
        actor_id: discordId,
        actor_name: authData.user.user_metadata?.name || authData.user.user_metadata?.full_name || discordId,
        bot_id: botId,
        action,
        edited_at: new Date().toISOString()
      },
      performed_by: discordId,
      source: 'web'
    }).catch(() => null);

    return send(res, 200, { ok: true, config: data });
  } catch (error) {
    const status = Number(error.statusCode || error.status || 500);
    return send(res, status >= 400 && status < 600 ? status : 500, {
      error: error.message || 'Khong luu duoc cau hinh voice.'
    });
  }
};

// Export các hàm thuần để unit test (không ảnh hưởng handler mặc định của Vercel).
module.exports.sanitizeConfig = sanitizeConfig;
module.exports.toStringArray = toStringArray;
module.exports.getAdminAllowlist = getAdminAllowlist;
