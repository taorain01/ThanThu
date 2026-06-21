const { createClient } = require('@supabase/supabase-js');

const DEFAULT_GUILD_ID = '450633680000385036';
const LEAGUE_TIME = '19:30';
const MAX_ACTIVE_MEMBERS = 30;
const LINEUP_EDITOR_DISCORD_IDS = new Set(['403644798667325440', '395151484179841024']);
const TEAM_KEYS = ['team_attack1', 'team_attack2', 'team_defense', 'team_forest'];
const LEGACY_LEADER_KEYS = ['team1', 'team2', 'team3', 'team4'];
const DEFAULT_LAYOUT = [
  { id: 'team_attack1', name: 'TEAM CONG 1', icon: 'ATK', capacity: 10, order: 1 },
  { id: 'team_attack2', name: 'TEAM CONG 2', icon: 'ATK', capacity: 10, order: 2 },
  { id: 'team_defense', name: 'TEAM THU', icon: 'DEF', capacity: 5, order: 3 },
  { id: 'team_forest', name: 'TEAM RUNG', icon: 'JNG', capacity: 5, order: 4 }
];
const DAY_NUM = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DAY_LABELS = {
  mon: 'Thứ 2',
  tue: 'Thứ 3',
  wed: 'Thứ 4',
  thu: 'Thứ 5',
  fri: 'Thứ 6',
  sat: 'Thứ 7',
  sun: 'Chủ nhật'
};

let adminClient = null;

function getSupabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_SERVICE_KEY
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.SUPABASE_SECRET_KEY
      || ''
  };
}

function getAdminClient() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throwHttp(500, 'Backend chưa cấu hình Supabase service key.');
  if (!adminClient) {
    adminClient = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
  return adminClient;
}

function getBotToken() {
  return process.env.DISCORD_BOT_TOKEN || process.env.token || process.env.TOKEN || '';
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function throwHttp(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
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

function parseJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch (_) {
    return fallback;
  }
}

function normalizeBcTime(value, fallback = LEAGUE_TIME) {
  const raw = String(value || fallback || LEAGUE_TIME).trim().toLowerCase();
  const match = raw.match(/^(\d{1,2})(?:[:h](\d{0,2}))?$/);
  if (!match) return fallback;
  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2] || '0')));
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeAccessRole(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isElevatedRole(position) {
  return ['bc', 'pbc', 'kc', 'ql', 'quan ly', 'ky cuu'].includes(normalizeAccessRole(position));
}

function isLeftPosition(position) {
  return ['khong co', 'left', 'out'].includes(normalizeAccessRole(position));
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

function normalizeTeamId(value, fallback) {
  return String(value || fallback || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 40) || fallback;
}

function getTeamLayout(session) {
  const rawLayout = parseJson(session.team_layout, []);
  const teamSizes = parseJson(session.team_sizes, {});
  const teamNames = parseJson(session.team_names, {});
  const source = Array.isArray(rawLayout) && rawLayout.length
    ? rawLayout
    : DEFAULT_LAYOUT.map((team) => {
      const sizeKey = team.id === 'team_attack1' ? 'attack1'
        : team.id === 'team_attack2' ? 'attack2'
        : team.id === 'team_defense' ? 'defense'
        : 'forest';
      return {
        ...team,
        name: teamNames[sizeKey] || team.name,
        capacity: Number(teamSizes[sizeKey] ?? team.capacity) || team.capacity
      };
    });

  const seen = new Set();
  return source.slice(0, 8).map((team, index) => {
    let id = normalizeTeamId(team?.id, TEAM_KEYS[index] || `team_custom_${index + 1}`);
    while (seen.has(id)) id = `${id}_${index + 1}`;
    seen.add(id);
    return {
      id,
      name: String(team?.name || DEFAULT_LAYOUT[index]?.name || `TEAM ${index + 1}`).trim().slice(0, 32),
      icon: String(team?.icon || DEFAULT_LAYOUT[index]?.icon || '').trim().slice(0, 8),
      capacity: Math.max(0, Math.min(MAX_ACTIVE_MEMBERS, Number(team?.capacity ?? DEFAULT_LAYOUT[index]?.capacity ?? 0) || 0)),
      order: Number.isFinite(Number(team?.order)) ? Number(team.order) : index + 1
    };
  }).sort((a, b) => a.order - b.order).map((team, index) => ({ ...team, order: index + 1 }));
}

function normalizeRosterMembers(players, teamId) {
  return (Array.isArray(players) ? players : []).map((player) => ({
    ...player,
    id: String(player?.id || player?.discord_id || '').trim(),
    team: teamId
  }));
}

function getDynamicTeamMembers(rawTeams, team, index) {
  if (!rawTeams || typeof rawTeams !== 'object' || !team) return null;
  if (Array.isArray(rawTeams[team.id])) return normalizeRosterMembers(rawTeams[team.id], team.id);
  const legacyKey = TEAM_KEYS[index];
  if (legacyKey && legacyKey !== team.id && Array.isArray(rawTeams[legacyKey])) {
    return normalizeRosterMembers(rawTeams[legacyKey], team.id);
  }
  return null;
}

function getLegacyTeamMembers(session, team, index) {
  const direct = normalizeRosterMembers(parseJson(session[team.id], []), team.id);
  if (direct.length) return direct;
  const legacyKey = TEAM_KEYS[index];
  if (legacyKey && legacyKey !== team.id) {
    const fallback = normalizeRosterMembers(parseJson(session[legacyKey], []), team.id);
    if (fallback.length) return fallback;
  }
  return direct;
}

function getRosterState(session) {
  const layout = getTeamLayout(session);
  const rawTeams = [parseJson(session.teams, null), parseJson(session.teams_json, null)]
    .filter((value) => value && typeof value === 'object' && !Array.isArray(value));
  let dynamic = null;
  let dynamicTotal = -1;
  for (const candidate of rawTeams) {
    const count = layout.reduce((sum, team, index) => {
      const list = getDynamicTeamMembers(candidate, team, index);
      return sum + (Array.isArray(list) ? list.length : 0);
    }, 0);
    if (count > dynamicTotal) {
      dynamic = candidate;
      dynamicTotal = count;
    }
  }

  const legacyTotal = layout.reduce((sum, team, index) => sum + getLegacyTeamMembers(session, team, index).length, 0);
  const preferLegacy = legacyTotal > 0 && dynamicTotal <= 0;
  const teams = {};
  layout.forEach((team, index) => {
    const fromDynamic = !preferLegacy ? getDynamicTeamMembers(dynamic, team, index) : null;
    teams[team.id] = fromDynamic || getLegacyTeamMembers(session, team, index);
  });
  return { layout, teams };
}

function isLeaderEntry(player) {
  return ['isLeader', 'ld', 'isTeamLeader'].some((key) => {
    const value = player && player[key];
    return value === true || value === 1 || String(value).toLowerCase() === 'true';
  });
}

function isTacticalBotLikeId(id) {
  return /^(bot_|slotbot_|slot_tmp_|idx_slot_tmp_|svc_slot_tmp_)/.test(String(id || ''));
}

function isDiscordSnowflake(id) {
  return /^\d{15,25}$/.test(String(id || '').trim());
}

function getMemberName(player) {
  return String(player?.gn || player?.game_username || player?.name || player?.username || player?.discord_name || '').trim();
}

function getTeamLeaderIds(session, roster, team, index) {
  const leaderIds = parseJson(session.leader_ids, {});
  const teamMembers = roster.teams[team.id] || [];
  const teamMemberIds = new Set(teamMembers.map((member) => String(member.id || '')).filter(Boolean));
  const candidates = [];
  const legacyKey = LEGACY_LEADER_KEYS[index];
  const explicit = leaderIds?.teams?.[team.id] || (legacyKey ? leaderIds?.[legacyKey] : null);
  if (explicit) candidates.push(String(explicit));
  teamMembers.filter(isLeaderEntry).forEach((member) => candidates.push(String(member.id || '')));
  return [...new Set(candidates.filter((id) => id && teamMemberIds.has(id)))];
}

function buildReminderData(session) {
  const roster = getRosterState(session);
  const activeTeams = roster.layout.filter((team) => Number(team.capacity) > 0);
  const errors = [];
  const activeMembers = [];
  const seen = new Map();
  const leaderByTeam = {};

  const totalCapacity = activeTeams.reduce((sum, team) => sum + (Number(team.capacity) || 0), 0);
  if (totalCapacity !== MAX_ACTIVE_MEMBERS) {
    errors.push(`Tổng slot active phải đúng ${MAX_ACTIVE_MEMBERS}, hiện tại ${totalCapacity}.`);
  }

  activeTeams.forEach((team, index) => {
    const members = roster.teams[team.id] || [];
    if (members.length > team.capacity) {
      errors.push(`${team.name} vượt slot: ${members.length}/${team.capacity}.`);
    }

    const leaders = getTeamLeaderIds(session, roster, team, index);
    if (leaders.length !== 1) {
      errors.push(`${team.name} phải có đúng 1 leader, hiện tại ${leaders.length}.`);
    } else {
      leaderByTeam[team.id] = leaders[0];
    }

    members.forEach((member) => {
      const id = String(member.id || '').trim();
      if (!id) {
        errors.push(`${team.name} có thành viên thiếu Discord ID.`);
        return;
      }
      if (isTacticalBotLikeId(id)) {
        errors.push(`${team.name} còn slot bot/placeholder (${id}).`);
        return;
      }
      if (!isDiscordSnowflake(id)) {
        errors.push(`${team.name} có Discord ID không hợp lệ (${id}).`);
        return;
      }
      if (seen.has(id)) {
        errors.push(`${getMemberName(member) || id} bị trùng ở ${seen.get(id)} và ${team.name}.`);
        return;
      }
      seen.set(id, team.name);
      activeMembers.push({ ...member, id, teamId: team.id, teamName: team.name });
    });
  });

  if (activeMembers.length !== MAX_ACTIVE_MEMBERS) {
    errors.push(`Cần đúng ${MAX_ACTIVE_MEMBERS} member active để tag nhắc nhở, hiện tại ${activeMembers.length}.`);
  }

  if (normalizeBcTime(session.time || LEAGUE_TIME) !== LEAGUE_TIME) {
    errors.push('Chỉ gửi tag nhắc nhở cho trận League lúc 19h30.');
  }

  if (errors.length) {
    throwHttp(400, `Không thể gửi tag nhắc nhở:\n- ${errors.join('\n- ')}`);
  }

  return { roster, activeTeams, activeMembers, leaderByTeam };
}

function getNextDayDate(day) {
  if (!Object.prototype.hasOwnProperty.call(DAY_NUM, day)) return new Date();
  const now = new Date();
  const vnOffset = 7 * 60;
  const localOffset = now.getTimezoneOffset();
  const vnNow = new Date(now.getTime() + (vnOffset + localOffset) * 60 * 1000);
  const currentDay = vnNow.getDay();
  const targetDay = DAY_NUM[day];
  let daysUntilTarget = (targetDay - currentDay + 7) % 7;
  if (daysUntilTarget === 0 && vnNow.getHours() >= 23) daysUntilTarget = 7;
  const targetDate = new Date(vnNow);
  targetDate.setDate(vnNow.getDate() + daysUntilTarget);
  return targetDate;
}

function formatDateVi(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function buildDiscordPayload(session, reminderData, actorName) {
  const time = normalizeBcTime(session.time || LEAGUE_TIME);
  const timeLabel = time.replace(':', 'h');
  const dayLabel = DAY_LABELS[session.day] || session.day || 'Không rõ ngày';
  const dateLabel = formatDateVi(getNextDayDate(session.day));
  const userIds = reminderData.activeMembers.map((member) => member.id);
  const fields = reminderData.activeTeams.map((team) => {
    const leaderId = reminderData.leaderByTeam[team.id];
    const members = reminderData.roster.teams[team.id] || [];
    const value = members.map((member, index) => {
      const name = getMemberName(member);
      return `${index + 1}. <@${member.id}>${name ? ` - ${name}` : ''}`;
    }).join('\n') || 'Chưa có thành viên.';
    return {
      name: `${team.icon || ''} ${team.name || team.id} - do <@${leaderId}> chỉ huy`.trim(),
      value: value.slice(0, 1024),
      inline: false
    };
  });

  fields.push({
    name: 'VoiceChat',
    value: 'Khi vào VoiceChat, hãy tăng âm lượng Leader của team mình và giảm âm lượng Leader của các team còn lại để tránh nhiễu thông tin, bớt ồn.',
    inline: false
  });

  return {
    content: userIds.map((id) => `<@${id}>`).join(' '),
    embeds: [{
      color: 0x22C55E,
      title: `Nhắc đăng ký League - ${dayLabel}, ${timeLabel} (ngày ${dateLabel})`,
      description: 'Bạn đã được sắp vào đội hình League bên dưới. Vui lòng vào ingame, mở League và bấm đăng ký đúng trận.',
      fields,
      footer: { text: `Gửi bởi ${String(actorName || 'Leader').slice(0, 80)} • ${userIds.length}/${MAX_ACTIVE_MEMBERS} thành viên` },
      timestamp: new Date().toISOString()
    }],
    allowed_mentions: {
      parse: [],
      users: userIds
    }
  };
}

function getSessionLeaderIds(session) {
  const leaderIds = parseJson(session.leader_ids, {});
  const roster = getRosterState(session);
  const ids = [
    session.leader_id,
    leaderIds.creator_id,
    leaderIds.commander,
    leaderIds.team1,
    leaderIds.team2,
    leaderIds.team3,
    leaderIds.team4,
    ...Object.values(leaderIds.teams || {})
  ].filter(Boolean).map(String);

  roster.layout.forEach((team, index) => {
    getTeamLeaderIds(session, roster, team, index).forEach((id) => ids.push(String(id)));
  });

  return new Set(ids.filter(Boolean));
}

function hasReminderPermission(discordId, userRow, session) {
  if (LINEUP_EDITOR_DISCORD_IDS.has(discordId)) return true;
  if (isElevatedRole(userRow?.position)) return true;
  return getSessionLeaderIds(session).has(String(discordId));
}

async function fetchSession(admin, guildId, sessionId) {
  const { data, error } = await admin
    .from('bc_sessions')
    .select('*')
    .eq('guild_id', guildId)
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throwHttp(404, 'Không tìm thấy phiên Bang Chiến đang chọn.');
  if (data.status && data.status !== 'active') {
    throwHttp(400, 'Phiên Bang Chiến này không còn active.');
  }
  return data;
}

async function sendDiscordMessage(channelId, payload) {
  const token = getBotToken();
  if (!token) throwHttp(500, 'Backend chưa cấu hình Discord bot token.');
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.message || `Discord API lỗi HTTP ${response.status}`;
    throwHttp(response.status >= 400 && response.status < 500 ? 400 : 502, `Không gửi được Discord message: ${message}`);
  }
  return body;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return send(res, 204, {});
  }
  if (req.method === 'GET') {
    return send(res, 200, { ok: true, route: 'bc-league-reminder', method: 'POST' });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  try {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1] || '';
    if (!token) return send(res, 401, { error: 'Chưa đăng nhập.' });

    const admin = getAdminClient();
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData?.user) return send(res, 401, { error: 'Phiên đăng nhập không hợp lệ.' });

    const body = parseBody(req);
    const guildId = String(body.guild_id || DEFAULT_GUILD_ID);
    const sessionId = String(body.session_id || '');
    if (guildId !== DEFAULT_GUILD_ID) return send(res, 403, { error: 'Guild không hợp lệ.' });
    if (!sessionId) return send(res, 400, { error: 'Thiếu session_id.' });

    const discordId = getDiscordIdFromUser(authData.user);
    if (!discordId) return send(res, 401, { error: 'Không tìm thấy Discord ID.' });

    const { data: userRow, error: userError } = await admin
      .from('bc_users')
      .select('discord_id,discord_name,game_username,position,lang_gia_member')
      .eq('guild_id', guildId)
      .eq('discord_id', discordId)
      .maybeSingle();
    if (userError) throw userError;
    if (!userRow || userRow.lang_gia_member !== true || isLeftPosition(userRow.position)) {
      return send(res, 403, { error: 'Tài khoản không phải thành viên Lang Gia đang hoạt động.' });
    }

    const session = await fetchSession(admin, guildId, sessionId);
    if (!hasReminderPermission(discordId, userRow, session)) {
      return send(res, 403, { error: 'Bạn không có quyền gửi tag nhắc nhở cho phiên này.' });
    }
    const reminderData = buildReminderData(session);

    const channelId = String(session.channel_id || process.env.BC_REMINDER_CHANNEL_ID || '').trim();
    if (!channelId) {
      return send(res, 500, { error: 'Chưa cấu hình channel gửi reminder. Hãy sync channel_id hoặc đặt BC_REMINDER_CHANNEL_ID.' });
    }

    const actorName = userRow.game_username || userRow.discord_name || authData.user.user_metadata?.name || discordId;
    const discordPayload = buildDiscordPayload(session, reminderData, actorName);
    const discordMessage = await sendDiscordMessage(channelId, discordPayload);

    await admin.from('bc_logs').insert({
      guild_id: guildId,
      action: 'league_reminder',
      details: {
        session_id: sessionId,
        day: session.day || null,
        time: normalizeBcTime(session.time || LEAGUE_TIME),
        channel_id: channelId,
        message_id: discordMessage?.id || null,
        tagged_count: reminderData.activeMembers.length,
        actor_id: discordId,
        actor_name: actorName,
        sent_at: new Date().toISOString()
      },
      performed_by: discordId,
      source: 'web'
    }).catch(() => null);

    return send(res, 200, {
      ok: true,
      channel_id: channelId,
      message_id: discordMessage?.id || null,
      tagged_count: reminderData.activeMembers.length
    });
  } catch (error) {
    const status = Number(error.statusCode || error.status || 500);
    return send(res, status >= 400 && status < 600 ? status : 500, {
      error: error.message || 'Không gửi được tag nhắc nhở.'
    });
  }
};
