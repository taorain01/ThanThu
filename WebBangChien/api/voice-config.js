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
const VALID_CREATE_POSITIONS = new Set(['above', 'below']);
const VALID_ACTIONS = new Set(['saveConfig', 'saveAllConfigs', 'rejoin', 'leave', 'quickSetup', 'globalStop']);
const VALID_BOT_IDS = [1, 2, 3];
const MAX_PAYLOAD_CHARS = 60000;
const OPTIONAL_CONFIG_COLUMNS = new Set([
  'caller_user_ids',
  'muted_user_ids',
  'jitter_buffer_ms',
  'speaker_release_ms',
  'auto_create_channel',
  'created_channel_name',
  'create_position',
  'create_anchor_channel_id',
  'anchor_original_name'
]);

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

function missingVoiceConfigColumn(error) {
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
  if (!/voice_relay_config/i.test(text) || !/schema cache/i.test(text)) return null;

  const match = text.match(/'([^']+)'\s+column\s+of\s+'voice_relay_config'/i)
    || text.match(/column\s+'([^']+)'/i);
  const column = match?.[1] || '';
  return OPTIONAL_CONFIG_COLUMNS.has(column) ? column : null;
}

function rowHasColumn(row, column) {
  return row && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, column);
}

function payloadHasColumn(payload, column) {
  return Array.isArray(payload)
    ? payload.some((row) => rowHasColumn(row, column))
    : rowHasColumn(payload, column);
}

function omitColumn(row, column) {
  if (!row || typeof row !== 'object') return row;
  const next = { ...row };
  delete next[column];
  return next;
}

async function upsertVoiceRelayConfig(admin, payload, options = {}) {
  const { select = '*', maybeSingle = false } = options;
  let currentPayload = payload;
  const omittedColumns = [];

  while (true) {
    let query = admin
      .from('voice_relay_config')
      .upsert(currentPayload, { onConflict: 'guild_id,bot_id' });
    if (select) query = query.select(select);

    const result = maybeSingle ? await query.maybeSingle() : await query;
    if (!result.error) return { data: result.data, omittedColumns };

    const column = missingVoiceConfigColumn(result.error);
    if (!column || omittedColumns.includes(column) || !payloadHasColumn(currentPayload, column)) {
      throw result.error;
    }

    currentPayload = Array.isArray(currentPayload)
      ? currentPayload.map((row) => omitColumn(row, column))
      : omitColumn(currentPayload, column);
    omittedColumns.push(column);
  }
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

function isKcPosition(position) {
  const normalized = normalizeAccessRole(position);
  return normalized === 'kc' || normalized === 'ky cuu';
}

async function canAccessVoiceConfig(admin, guildId, discordId) {
  if (getAdminAllowlist().has(discordId)) return true;

  const { data, error } = await admin
    .from('bc_users')
    .select('discord_id,position,lang_gia_member,left_at')
    .eq('guild_id', guildId)
    .eq('discord_id', discordId)
    .eq('lang_gia_member', true)
    .is('left_at', null)
    .limit(1);
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : null;
  return Boolean(row && isKcPosition(row.position));
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
  if (payload.caller_user_ids !== undefined) clean.caller_user_ids = toStringArray(payload.caller_user_ids);
  if (payload.muted_user_ids !== undefined) clean.muted_user_ids = toStringArray(payload.muted_user_ids);
  if (payload.relay_targets !== undefined) clean.relay_targets = toStringArray(payload.relay_targets);
  if (payload.priority_role_ids !== undefined) clean.priority_role_ids = toStringArray(payload.priority_role_ids);

  if (payload.relay_enabled !== undefined) clean.relay_enabled = payload.relay_enabled === true;
  if (payload.auto_join !== undefined) clean.auto_join = payload.auto_join === true;

  // Độ trễ chống giật (jitter buffer) khi phát audio, đơn vị ms. Kẹp trong khoảng an toàn 60..2000.
  if (payload.jitter_buffer_ms !== undefined) {
    const n = Number.parseInt(payload.jitter_buffer_ms, 10);
    const value = Number.isFinite(n) ? n : 400;
    clean.jitter_buffer_ms = Math.min(2000, Math.max(60, value));
  }

  // "Nhường người nói": thời gian im (ms) trước khi nhả mic cho người khác. Kẹp 100..3000.
  if (payload.speaker_release_ms !== undefined) {
    const n = Number.parseInt(payload.speaker_release_ms, 10);
    const value = Number.isFinite(n) ? n : 500;
    clean.speaker_release_ms = Math.min(3000, Math.max(100, value));
  }

  if (payload.command_prefix !== undefined) {
    clean.command_prefix = String(payload.command_prefix || '').trim().slice(0, 16) || null;
  }

  // --- Tự tạo kênh voice ---
  if (payload.auto_create_channel !== undefined) clean.auto_create_channel = payload.auto_create_channel === true;
  if (payload.created_channel_name !== undefined) {
    clean.created_channel_name = String(payload.created_channel_name || '').trim().slice(0, 100) || null;
  }
  if (payload.create_position !== undefined) {
    const pos = String(payload.create_position || '').trim().toLowerCase();
    if (!VALID_CREATE_POSITIONS.has(pos)) {
      const error = new Error('Vi tri tao kenh khong hop le (chi above/below).');
      error.statusCode = 400;
      throw error;
    }
    clean.create_position = pos;
  }
  if (payload.create_anchor_channel_id !== undefined) {
    clean.create_anchor_channel_id = String(payload.create_anchor_channel_id || '').trim() || null;
  }

  // Luật R9.6: broadcast phải có ít nhất 1 đích.
  const effectiveMode = clean.mode;
  const effectiveTargets = clean.relay_targets;
  if (effectiveMode === 'broadcast' && Array.isArray(effectiveTargets) && effectiveTargets.length === 0) {
    const error = new Error('Che do broadcast phai chon it nhat 1 kenh/bot dich.');
    error.statusCode = 400;
    throw error;
  }

  // Bật tự tạo kênh thì phải có tên kênh và kênh mốc.
  if (clean.auto_create_channel === true) {
    if (!clean.created_channel_name) {
      const error = new Error('Bat tu tao kenh thi phai dat ten kenh.');
      error.statusCode = 400;
      throw error;
    }
    if (!clean.create_anchor_channel_id) {
      const error = new Error('Chon kenh moc (tren/duoi) de dat vi tri kenh se tao.');
      error.statusCode = 400;
      throw error;
    }
  }

  if (Object.keys(clean).length === 0) {
    const error = new Error('Khong co du lieu cau hinh de luu.');
    error.statusCode = 400;
    throw error;
  }

  clean.updated_at = new Date().toISOString();
  return clean;
}

function buildSaveAllRows(guildId, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const error = new Error('Payload cau hinh khong hop le.');
    error.statusCode = 400;
    throw error;
  }
  assertReasonablePayload(payload);

  const source = payload.configs;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    const error = new Error('Payload saveAllConfigs phai co configs cho 3 bot.');
    error.statusCode = 400;
    throw error;
  }

  const now = new Date().toISOString();
  return VALID_BOT_IDS.map((botId) => {
    const draft = source[String(botId)];
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
      const error = new Error(`Thieu cau hinh Bot ${botId}.`);
      error.statusCode = 400;
      throw error;
    }

    return {
      guild_id: guildId,
      bot_id: botId,
      ...sanitizeConfig(draft),
      updated_at: now
    };
  });
}

function relayTargetsFor(botId) {
  return VALID_BOT_IDS.filter((id) => id !== botId).map(String);
}

function buildQuickSetupRows(guildId, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const error = new Error('Payload quick setup khong hop le.');
    error.statusCode = 400;
    throw error;
  }
  assertReasonablePayload(payload);

  const setupMode = String(payload.setup_mode || 'auto').trim().toLowerCase() === 'manual' ? 'manual' : 'auto';
  const callerRoleIds = toStringArray(payload.caller_role_ids);
  const callerUserIds = toStringArray(payload.caller_user_ids);
  const now = new Date().toISOString();

  if (setupMode === 'manual') {
    const manualChannelIds = payload.manual_channel_ids || {};
    const channelIds = VALID_BOT_IDS.map((botId) => String(manualChannelIds[botId] || manualChannelIds[String(botId)] || '').trim());
    if (channelIds.some((id) => !id)) {
      const error = new Error('Chon thu cong phai du 3 kenh voice cho 3 bot.');
      error.statusCode = 400;
      throw error;
    }
    if (new Set(channelIds).size !== channelIds.length) {
      const error = new Error('Moi bot phai dung mot kenh voice khac nhau.');
      error.statusCode = 400;
      throw error;
    }

    return {
      setupMode,
      rows: VALID_BOT_IDS.map((botId, index) => ({
        guild_id: guildId,
        bot_id: botId,
        voice_channel_id: channelIds[index],
        mode: 'bridge',
        relay_targets: relayTargetsFor(botId),
        caller_role_ids: callerRoleIds,
        caller_user_ids: callerUserIds,
        relay_enabled: true,
        auto_join: true,
        pending_action: 'rejoin',
        updated_at: now
      }))
    };
  }

  const anchorId = String(payload.bang_chien_channel_id || payload.voice_channel_id || '').trim();
  if (!anchorId) {
    const error = new Error('Quick setup can voice_channel_id cua phong BANG CHIEN.');
    error.statusCode = 400;
    throw error;
  }

  return {
    setupMode,
    rows: VALID_BOT_IDS.map((botId) => ({
      guild_id: guildId,
      bot_id: botId,
      voice_channel_id: botId === 1 ? anchorId : null,
      mode: 'bridge',
      relay_targets: relayTargetsFor(botId),
      caller_role_ids: callerRoleIds,
      caller_user_ids: callerUserIds,
      relay_enabled: true,
      auto_join: true,
      pending_action: botId === 1 ? 'quickSetup' : null,
      updated_at: now
    }))
  };
}

function buildGlobalStopRows(guildId, payload) {
  const mode = String(payload?.mode || 'leave') === 'delete' ? 'delete' : 'leave';
  const pendingAction = mode === 'delete' ? 'stopDelete' : 'stopLeave';
  const now = new Date().toISOString();
  const rows = VALID_BOT_IDS.map((botId) => ({
    guild_id: guildId,
    bot_id: botId,
    relay_enabled: false,
    auto_join: false,
    pending_action: pendingAction,
    updated_at: now
  }));
  return { mode, rows };
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

    const body = parseBody(req);
    const action = String(body.action || 'saveConfig');
    if (!VALID_ACTIONS.has(action)) return send(res, 400, { error: 'Action khong hop le.' });

    const guildId = String(body.guild_id || DEFAULT_GUILD_ID);
    if (guildId !== DEFAULT_GUILD_ID) return send(res, 403, { error: 'Guild khong hop le.' });
    if (!(await canAccessVoiceConfig(admin, guildId, discordId))) {
      return send(res, 403, { error: 'Tai khoan nay can role Ky Cuu hoac quyen quan tri Voice Bot.' });
    }

    if (action === 'quickSetup') {
      const result = await handleQuickSetup(admin, guildId, body.payload || {});
      return send(res, 200, { ok: true, ...result });
    }

    if (action === 'globalStop') {
      const result = await handleGlobalStop(admin, guildId, body.payload || {});
      return send(res, 200, { ok: true, ...result });
    }

    if (action === 'saveAllConfigs') {
      const result = await handleSaveAllConfigs(admin, guildId, body.payload || {}, {
        discordId,
        actorName: authData.user.user_metadata?.name || authData.user.user_metadata?.full_name || discordId
      });
      return send(res, 200, { ok: true, ...result });
    }

    const botId = Number(body.bot_id);
    if (!VALID_BOT_IDS.includes(botId)) return send(res, 400, { error: 'bot_id phai la 1, 2 hoac 3.' });

    let row = { guild_id: guildId, bot_id: botId };

    if (action === 'saveConfig') {
      const clean = sanitizeConfig(body.payload);
      row = { ...row, ...clean };
    } else {
      // rejoin | leave -> ghi pending_action để bot đọc và thực thi.
      // Đồng bộ auto_join để nút "Rời kênh" không bị bot tự vào lại ngay sau đó.
      row.pending_action = action;
      row.auto_join = action === 'rejoin';
      row.updated_at = new Date().toISOString();
    }

    const { data, omittedColumns } = await upsertVoiceRelayConfig(admin, row, { maybeSingle: true });

    try {
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
      });
    } catch (_) {
      // Ghi log lỗi không được làm hỏng thao tác lưu cấu hình.
    }

    const response = { ok: true, config: data };
    if (omittedColumns.length) response.omitted_columns = omittedColumns;
    return send(res, 200, response);
  } catch (error) {
    const status = Number(error.statusCode || error.status || 500);
    return send(res, status >= 400 && status < 600 ? status : 500, {
      error: error.message || 'Khong luu duoc cau hinh voice.'
    });
  }
};

async function handleSaveAllConfigs(admin, guildId, payload, actor = {}) {
  const rows = buildSaveAllRows(guildId, payload);
  const { data, omittedColumns } = await upsertVoiceRelayConfig(admin, rows);

  try {
    await admin.from('bc_logs').insert({
      guild_id: guildId,
      action: 'voice_config',
      details: {
        category: 'voice_relay',
        summary: 'Voice config saveAllConfigs 3 bot',
        actor_id: actor.discordId,
        actor_name: actor.actorName || actor.discordId,
        bot_ids: VALID_BOT_IDS,
        action: 'saveAllConfigs',
        edited_at: new Date().toISOString()
      },
      performed_by: actor.discordId,
      source: 'web'
    });
  } catch (_) {
    // Ghi log lỗi không được làm hỏng thao tác lưu cấu hình.
  }

  const result = { action: 'saveAllConfigs', configs: Array.isArray(data) ? data : [] };
  if (omittedColumns.length) result.omitted_columns = omittedColumns;
  return result;
}

async function handleQuickSetup(admin, guildId, payload) {
  const { setupMode, rows } = buildQuickSetupRows(guildId, payload);
  const now = new Date().toISOString();

  await upsertVoiceRelayConfig(admin, rows, { select: null });

  await admin.from('voice_relay_master').upsert({
    guild_id: guildId,
    enabled: true,
    stop_mode: null,
    updated_at: now
  }, { onConflict: 'guild_id' });

  return { action: 'quickSetup', setup_mode: setupMode, bot_ids: VALID_BOT_IDS };
}

async function handleGlobalStop(admin, guildId, payload) {
  const { mode, rows } = buildGlobalStopRows(guildId, payload);
  const now = new Date().toISOString();

  await upsertVoiceRelayConfig(admin, rows, { select: null });

  await admin.from('voice_relay_master').upsert({
    guild_id: guildId,
    enabled: false,
    stop_mode: mode,
    updated_at: now
  }, { onConflict: 'guild_id' });

  return { action: 'globalStop', mode };
}

// Export các hàm thuần để unit test (không ảnh hưởng handler mặc định của Vercel).
module.exports.sanitizeConfig = sanitizeConfig;
module.exports.toStringArray = toStringArray;
module.exports.getAdminAllowlist = getAdminAllowlist;
module.exports.normalizeAccessRole = normalizeAccessRole;
module.exports.isKcPosition = isKcPosition;
module.exports.canAccessVoiceConfig = canAccessVoiceConfig;
module.exports.buildSaveAllRows = buildSaveAllRows;
module.exports.buildQuickSetupRows = buildQuickSetupRows;
module.exports.buildGlobalStopRows = buildGlobalStopRows;
module.exports.missingVoiceConfigColumn = missingVoiceConfigColumn;
module.exports.upsertVoiceRelayConfig = upsertVoiceRelayConfig;
module.exports.handleSaveAllConfigs = handleSaveAllConfigs;
module.exports.handleQuickSetup = handleQuickSetup;
module.exports.handleGlobalStop = handleGlobalStop;
