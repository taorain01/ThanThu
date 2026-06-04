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

function getAdminClient() {
  if (adminClient) return adminClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Backend chua cau hinh SUPABASE_URL/SUPABASE_SERVICE_KEY.');
  }
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
  if (Array.isArray(rawTeams[team.id])) return rawTeams[team.id];
  const legacyKey = TEAM_KEYS[index];
  if (legacyKey && legacyKey !== team.id && Array.isArray(rawTeams[legacyKey])) return rawTeams[legacyKey];
  return null;
}

function getLegacyTeamMembers(session, team, index) {
  const direct = parseJsonList(session[team.id]);
  if (direct.length) return direct;
  const legacyKey = TEAM_KEYS[index];
  if (legacyKey && legacyKey !== team.id) {
    const fallback = parseJsonList(session[legacyKey]);
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
      return sum + (Array.isArray(list) ? list.length : 0);
    }, 0);
    if (count > dynamicTotal) {
      dynamic = candidate;
      dynamicTotal = count;
    }
  }

  const legacyTotal = layout.reduce((sum, team, index) => {
    return sum + getLegacyTeamMembers(session, team, index).length;
  }, 0);
  const preferLegacy = legacyTotal > 0 && dynamicTotal === 0;
  const teams = {};
  layout.forEach((team, index) => {
    const fromDynamic = !preferLegacy ? getDynamicTeamMembers(dynamic, team, index) : null;
    teams[team.id] = (fromDynamic || getLegacyTeamMembers(session, team, index)).map((player) => ({
      ...player,
      team: team.id
    }));
  });

  return {
    layout,
    teams,
    waitingList: parseJsonList(session.waiting_list).map((player) => ({ ...player, team: 'waiting_list' }))
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
    mirror[legacyKey] = (roster.teams[team.id] || []).map((player) => ({ ...player, team: legacyKey }));
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
    joinedAt: Date.now()
  };
}

function buildUpdatePayload(session, userRow, discordId, fallbackName, join) {
  const roster = getRosterState(session);

  if (join) {
    if (!rosterContains(roster, discordId)) {
      const player = buildPlayer(userRow, discordId, fallbackName);
      const targetTeam = session.locked === true
        ? null
        : roster.layout.find((team) => (roster.teams[team.id] || []).length < Number(team.capacity || 0));
      if (targetTeam) {
        roster.teams[targetTeam.id].push({ ...player, team: targetTeam.id });
      } else {
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
    editor_action: join ? 'self_join_api' : 'self_leave_api',
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
    return send(res, 200, { ok: true, route: 'bc-self-registration', method: 'POST' });
  }
  if (req.method !== 'POST') {
    return send(res, 405, { error: 'Method not allowed' });
  }

  try {
    const admin = getAdminClient();
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1] || '';
    if (!token) return send(res, 401, { error: 'Chua dang nhap.' });

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
      .select('discord_id,discord_name,game_username,sub_role,weapon_role,combat_role,position,lang_gia_member')
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

    const payload = buildUpdatePayload(session, userRow, discordId, fallbackName, join);
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
