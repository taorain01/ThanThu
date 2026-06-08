const { createClient } = require('@supabase/supabase-js');

const DEFAULT_GUILD_ID = '450633680000385036';
const TEAM_KEYS = ['team_attack1', 'team_attack2', 'team_defense', 'team_forest'];
const DEFAULT_LAYOUT = [
  { id: 'team_attack1', name: 'TEAM CONG 1', icon: 'ATK', capacity: 10, order: 1 },
  { id: 'team_attack2', name: 'TEAM CONG 2', icon: 'ATK', capacity: 10, order: 2 },
  { id: 'team_defense', name: 'TEAM THU', icon: 'DEF', capacity: 5, order: 3 },
  { id: 'team_forest', name: 'TEAM RUNG', icon: 'JNG', capacity: 5, order: 4 }
];

let adminClient = null;

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SECRET_KEY
    || '';
  return { url, key };
}

function getEnvHealth() {
  const { url, key } = getSupabaseConfig();
  return {
    supabaseUrl: Boolean(url),
    supabaseSecret: Boolean(key)
  };
}

function getAdminClient() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    throw new Error('Backend chua cau hinh SUPABASE_URL va SUPABASE_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY.');
  }
  if (adminClient) return adminClient;
  adminClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
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
  } catch (error) {
    return {};
  }
}

function parseJsonList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function parseJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

function normalizeWebWeaponRoles(value) {
  const source = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? parseJsonList(value) : []);
  const seen = new Set();
  return source
    .map((item) => String(item || '').trim())
    .filter((item) => item && !seen.has(item) && seen.add(item))
    .slice(0, 2);
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

const BLOCKED_ROSTER_NAMES = new Set(['web', 'user', 'unknown', 'player']);

function normalizeRosterName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getRosterDisplayName(player) {
  return String(player?.gn || player?.game_username || player?.name || player?.username || '').trim();
}

function isRosterPlayerAllowed(player) {
  if (!player || typeof player !== 'object') return false;
  const id = String(player.id || '').trim();
  const displayName = getRosterDisplayName(player);
  if (!id || !displayName) return false;
  return !BLOCKED_ROSTER_NAMES.has(normalizeRosterName(displayName));
}

function sanitizeRosterPlayers(players, teamKey = '') {
  return (Array.isArray(players) ? players : [])
    .filter(isRosterPlayerAllowed)
    .map((player) => ({ ...player, team: teamKey || player.team }));
}

function countRosterPlayers(players) {
  return (Array.isArray(players) ? players : []).filter(isRosterPlayerAllowed).length;
}

function normalizeTeamId(value, fallback) {
  return String(value || fallback || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 40) || fallback;
}

function getTeamLayout(session) {
  const rawLayout = parseJsonList(session.team_layout);
  const teamSizes = parseJsonObject(session.team_sizes);
  const teamNames = parseJsonObject(session.team_names);
  const source = rawLayout.length ? rawLayout : DEFAULT_LAYOUT.map((team) => {
    const sizeKey = team.id === 'team_attack1' ? 'attack1'
      : team.id === 'team_attack2' ? 'attack2'
      : team.id === 'team_defense' ? 'defense'
      : 'forest';
    return {
      ...team,
      name: teamNames[sizeKey] || team.name,
      capacity: Number(teamSizes[sizeKey] || team.capacity) || team.capacity
    };
  });

  const seen = new Set();
  return source.slice(0, 8).map((team, index) => {
    let id = normalizeTeamId(team.id, TEAM_KEYS[index] || `team_custom_${index + 1}`);
    while (seen.has(id)) id = `${id}_${index + 1}`;
    seen.add(id);
    return {
      id,
      name: String(team.name || DEFAULT_LAYOUT[index]?.name || `TEAM ${index + 1}`).slice(0, 32),
      icon: String(team.icon || DEFAULT_LAYOUT[index]?.icon || '').slice(0, 8),
      capacity: Math.max(1, Math.min(30, Number(team.capacity || 1) || 1)),
      order: Number.isFinite(Number(team.order)) ? Number(team.order) : index + 1
    };
  }).sort((a, b) => a.order - b.order).map((team, index) => ({ ...team, order: index + 1 }));
}

function getDynamicTeamMembers(rawTeams, team, index) {
  if (!rawTeams || typeof rawTeams !== 'object' || !team) return null;
  if (Array.isArray(rawTeams[team.id])) return sanitizeRosterPlayers(rawTeams[team.id], team.id);
  const legacyKey = TEAM_KEYS[index];
  if (legacyKey && legacyKey !== team.id && Array.isArray(rawTeams[legacyKey])) {
    return sanitizeRosterPlayers(rawTeams[legacyKey], team.id);
  }
  return null;
}

function getLegacyTeamMembers(session, team, index) {
  const direct = sanitizeRosterPlayers(parseJsonList(session[team.id]), team.id);
  if (direct.length) return direct;
  const legacyKey = TEAM_KEYS[index];
  if (legacyKey && legacyKey !== team.id) {
    const fallback = sanitizeRosterPlayers(parseJsonList(session[legacyKey]), team.id);
    if (fallback.length) return fallback;
  }
  return direct;
}

function getRosterState(session) {
  const layout = getTeamLayout(session);
  const candidates = [
    parseJsonObject(session.teams, null),
    parseJsonObject(session.teams_json, null)
  ].filter(Boolean);

  let dynamic = null;
  let dynamicTotal = 0;
  for (const candidate of candidates) {
    const count = layout.reduce((sum, team, index) => {
      const list = getDynamicTeamMembers(candidate, team, index);
      return sum + countRosterPlayers(list);
    }, 0);
    if (count > dynamicTotal) {
      dynamic = candidate;
      dynamicTotal = count;
    }
  }

  const legacyTotal = layout.reduce((sum, team, index) => {
    return sum + countRosterPlayers(getLegacyTeamMembers(session, team, index));
  }, 0);
  const preferLegacy = legacyTotal > 0 && dynamicTotal === 0;
  const teams = {};
  layout.forEach((team, index) => {
    const fromDynamic = !preferLegacy ? getDynamicTeamMembers(dynamic, team, index) : null;
    teams[team.id] = sanitizeRosterPlayers(fromDynamic || getLegacyTeamMembers(session, team, index), team.id);
  });

  return {
    layout,
    teams,
    waitingList: sanitizeRosterPlayers(parseJsonList(session.waiting_list), 'waiting_list')
  };
}

function buildLegacyMirror(roster) {
  const mirror = {};
  const teamSizes = {};
  const teamNames = {};
  roster.layout.slice(0, TEAM_KEYS.length).forEach((team, index) => {
    const legacyKey = TEAM_KEYS[index];
    const sizeKey = legacyKey === 'team_attack1' ? 'attack1'
      : legacyKey === 'team_attack2' ? 'attack2'
      : legacyKey === 'team_defense' ? 'defense'
      : 'forest';
    mirror[legacyKey] = sanitizeRosterPlayers(roster.teams[team.id] || [], legacyKey);
    teamSizes[sizeKey] = team.capacity;
    teamNames[sizeKey] = team.name;
  });
  TEAM_KEYS.forEach((key) => { mirror[key] = mirror[key] || []; });
  return { ...mirror, team_sizes: teamSizes, team_names: teamNames };
}

function rosterContains(roster, discordId) {
  return [
    ...Object.values(roster.teams || {}),
    roster.waitingList || []
  ].some((players) => players.some((player) => String(player.id) === String(discordId)));
}

function isLeaderEntry(player) {
  return ['isLeader', 'ld', 'isTeamLeader'].some((key) => {
    const value = player && player[key];
    return value === true || value === 1 || String(value).toLowerCase() === 'true';
  });
}

function buildPlayer(userRow, discordId, fallbackName) {
  const gameName = userRow.game_username || '';
  const discordName = userRow.discord_name || fallbackName || discordId;
  return {
    id: discordId,
    name: gameName || discordName,
    username: discordName,
    gn: gameName,
    sub: userRow.weapon_role || userRow.sub_role || '',
    role: userRow.combat_role || 'DPS',
    web_weapon_roles: normalizeWebWeaponRoles(userRow.web_weapon_roles),
    joinedAt: Date.now()
  };
}

function getActiveSlotLayout(roster) {
  const layout = [];
  (roster.layout || []).forEach((team) => {
    Array.from({ length: Math.max(0, Number(team.capacity) || 0) }).forEach(() => layout.push(team.id));
  });
  return layout;
}

function getFlatActiveRoster(roster) {
  return (roster.layout || []).flatMap((team) => {
    return (roster.teams[team.id] || []).map((player) => ({ ...player, team: team.id }));
  });
}

function rebuildRosterFromFlat(layout, flatRoster, waitingList = []) {
  let cursor = 0;
  const teams = {};
  layout.forEach((team) => {
    const count = Math.max(0, Number(team.capacity) || 0);
    teams[team.id] = sanitizeRosterPlayers(flatRoster.slice(cursor, cursor + count), team.id);
    cursor += count;
  });
  return {
    layout,
    teams,
    waitingList: sanitizeRosterPlayers(waitingList || [], 'waiting_list')
  };
}

function isTacticalBotLikeId(id) {
  return typeof id === 'string' && /^(bot_|slotbot_|slot_tmp_|idx_slot_tmp_|svc_slot_tmp_)/.test(id);
}

function findReservedSlotIndexFromPayload(payload, playerId) {
  const template = Array.isArray(payload?.slot_template) ? payload.slot_template : [];
  const matchesPlayer = (id) => id && !isTacticalBotLikeId(String(id)) && String(id) === String(playerId);
  const byReserved = template.find((entry) => matchesPlayer(entry?.reserved_for));
  if (byReserved) return Number(byReserved.slot_index);
  const byCurrent = template.find((entry) => matchesPlayer(entry?.tactical_id || entry?.player_id || entry?.id));
  return byCurrent ? Number(byCurrent.slot_index) : -1;
}

function parseTacticsPayload(markers) {
  if (!markers) return null;
  if (typeof markers === 'string') {
    try {
      const parsed = JSON.parse(markers);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      return null;
    }
  }
  return markers && typeof markers === 'object' ? markers : null;
}

function isSessionScopedTacticsError(error) {
  const message = String(error?.message || error?.details || '');
  return /session_id|schema cache|Could not find|column .* does not exist/i.test(message);
}

async function fetchSessionTacticsPayload(admin, guildId, session) {
  if (!admin || !session) return null;

  if (session.id) {
    const scoped = await admin
      .from('bc_tactics')
      .select('markers,day,session_id,updated_at')
      .eq('guild_id', guildId)
      .eq('session_id', session.id)
      .maybeSingle();
    if (!scoped.error) return parseTacticsPayload(scoped.data?.markers);
    if (!isSessionScopedTacticsError(scoped.error)) {
      console.warn('[bc-self-registration] load session tactics failed:', scoped.error.message || scoped.error);
      return null;
    }
  }

  if (!session.day) return null;
  const fallback = await admin
    .from('bc_tactics')
    .select('markers,day,updated_at')
    .eq('guild_id', guildId)
    .eq('day', session.day)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (fallback.error) {
    console.warn('[bc-self-registration] load day tactics failed:', fallback.error.message || fallback.error);
    return null;
  }
  const row = Array.isArray(fallback.data) ? fallback.data[0] : fallback.data;
  return parseTacticsPayload(row?.markers);
}

function buildUpdatePayload(session, userRow, discordId, fallbackName, join, tacticsPayload = null) {
  const roster = getRosterState(session);

  if (join) {
    if (!rosterContains(roster, discordId)) {
      const player = buildPlayer(userRow, discordId, fallbackName);
      if (!isRosterPlayerAllowed(player)) {
        const error = new Error('Tai khoan chua co ten game/Discord hop le.');
        error.statusCode = 400;
        throw error;
      }
      const reservedSlotIndex = findReservedSlotIndexFromPayload(tacticsPayload, discordId);
      if (Number.isFinite(reservedSlotIndex) && reservedSlotIndex >= 0) {
        const flatActive = getFlatActiveRoster(roster);
        const waiting = (roster.waitingList || []).filter((item) => String(item.id) !== String(discordId));
        const maxActive = getActiveSlotLayout(roster).length || 30;
        const insertAt = Math.min(Math.max(0, reservedSlotIndex), flatActive.length);
        flatActive.splice(insertAt, 0, player);
        if (flatActive.length > maxActive) {
          const displaced = flatActive.pop();
          if (displaced?.id && String(displaced.id) !== String(discordId)) waiting.unshift(displaced);
        }
        const nextRoster = rebuildRosterFromFlat(roster.layout, flatActive, waiting);
        roster.teams = nextRoster.teams;
        roster.waitingList = nextRoster.waitingList;
      } else {
        // Tat ca dang ky moi -> vao du bi (waiting_list)
        // Leader se sap xep thu cong vao team
        roster.waitingList.push({ ...player, team: 'waiting_list' });
      }
    }
  } else {
    for (const players of [...Object.values(roster.teams || {}), roster.waitingList || []]) {
      const me = players.find((player) => String(player.id) === String(discordId));
      if (me && isLeaderEntry(me)) {
        const error = new Error('Truong nhom khong the huy dang ky.');
        error.statusCode = 403;
        throw error;
      }
    }
    roster.layout.forEach((team) => {
      roster.teams[team.id] = (roster.teams[team.id] || []).filter((player) => String(player.id) !== String(discordId));
    });
    roster.waitingList = (roster.waitingList || []).filter((player) => String(player.id) !== String(discordId));
  }

  const mirror = buildLegacyMirror(roster);
  const leaderIds = {
    ...parseJsonObject(session.leader_ids),
    editor_id: discordId,
    editor_name: userRow.game_username || userRow.discord_name || fallbackName || discordId,
    editor_action: join
      ? (findReservedSlotIndexFromPayload(tacticsPayload, discordId) >= 0 ? 'self_join_reclaim_api' : 'self_join_api')
      : 'self_leave_api',
    edited_at: Date.now()
  };

  return {
    team_attack1: JSON.stringify(mirror.team_attack1 || []),
    team_attack2: JSON.stringify(mirror.team_attack2 || []),
    team_defense: JSON.stringify(mirror.team_defense || []),
    team_forest: JSON.stringify(mirror.team_forest || []),
    waiting_list: JSON.stringify(roster.waitingList || []),
    team_layout: roster.layout,
    teams_json: JSON.stringify(roster.teams || {}),
    team_sizes: JSON.stringify(mirror.team_sizes || {}),
    team_names: JSON.stringify(mirror.team_names || {}),
    leader_ids: JSON.stringify(leaderIds),
    updated_at: new Date().toISOString()
  };
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

function errorMentionsField(error, field) {
  const message = String(error?.message || '');
  return new RegExp(`(^|[^a-z0-9_])${field}([^a-z0-9_]|$)`, 'i').test(message);
}

async function updateSessionWithRosterPayload(admin, guildId, sessionId, payload) {
  const updatePayload = { ...payload };
  let lastResult = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    lastResult = await admin
      .from('bc_sessions')
      .update(updatePayload)
      .eq('guild_id', guildId)
      .eq('id', sessionId)
      .select('*')
      .maybeSingle();
    if (!lastResult.error) return lastResult;

    let removed = false;
    for (const field of ['team_names', 'team_sizes', 'teams_json', 'team_layout']) {
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
    const url = new URL(req.url || '/', 'https://langgiawar.local');
    if (url.searchParams.get('health') === '1') {
      return send(res, 200, { ok: true, route: 'bc-self-registration', env: getEnvHealth() });
    }
    return send(res, 200, { ok: true, route: 'bc-self-registration', method: 'POST' });
  }
  if (req.method !== 'POST') {
    return send(res, 405, { error: 'Method not allowed' });
  }

  try {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1] || '';
    if (!token) return send(res, 401, { error: 'Chua dang nhap.' });
    const admin = getAdminClient();

    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData?.user) {
      return send(res, 401, { error: 'Phien dang nhap khong hop le.' });
    }

    const body = parseBody(req);
    const guildId = String(body.guild_id || DEFAULT_GUILD_ID);
    const sessionId = String(body.session_id || '');
    const join = body.join === true;
    if (guildId !== DEFAULT_GUILD_ID) return send(res, 403, { error: 'Guild khong hop le.' });
    if (!sessionId) return send(res, 400, { error: 'Thieu session_id.' });

    const discordId = getDiscordIdFromUser(authData.user);
    const fallbackName = authData.user.user_metadata?.full_name || authData.user.user_metadata?.name || '';
    if (!discordId) return send(res, 401, { error: 'Khong tim thay Discord ID.' });

    const { data: userRow, error: userError } = await admin
      .from('bc_users')
      .select('discord_id,discord_name,game_username,sub_role,weapon_role,combat_role,web_weapon_roles,position,lang_gia_member')
      .eq('guild_id', guildId)
      .eq('discord_id', discordId)
      .maybeSingle();
    if (userError) throw userError;
    if (!userRow || userRow.lang_gia_member !== true || isLeftPosition(userRow.position)) {
      return send(res, 403, { error: 'Tai khoan khong phai thanh vien Lang Gia dang hoat dong.' });
    }

    const { data: session, error: sessionError } = await admin
      .from('bc_sessions')
      .select('*')
      .eq('guild_id', guildId)
      .eq('id', sessionId)
      .eq('status', 'active')
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return send(res, 404, { error: 'Khong tim thay phien Bang Chien dang mo.' });

    const tacticsPayload = join ? await fetchSessionTacticsPayload(admin, guildId, session) : null;
    const payload = buildUpdatePayload(session, userRow, discordId, fallbackName, join, tacticsPayload);
    const result = await updateSessionWithRosterPayload(admin, guildId, sessionId, payload);
    if (result.error) throw result.error;
    if (!result.data) return send(res, 500, { error: 'Supabase khong tra ve session sau khi cap nhat.' });

    return send(res, 200, { ok: true, session: result.data });
  } catch (error) {
    const status = Number(error.statusCode || error.status || 500);
    return send(res, status >= 400 && status < 600 ? status : 500, {
      error: error.message || 'Khong cap nhat duoc dang ky Bang Chien.'
    });
  }
};
