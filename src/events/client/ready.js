const { ActivityType, EmbedBuilder } = require("discord.js");
const thongbao = require('../../commands/thongbao/thongbao');
const { scheduleWeeklyReminders } = require('../../utils/yentiecReminder');
const { DISPLAY_ROLE_NAME, OLD_DISPLAY_ROLE_NAMES } = require('../../commands/quanly/subrole/addrole');
const db = require('../../database/db');
const supaSync = require('../../utils/supabaseSync');
const memberRosterSync = require('../../utils/memberRosterSync');
const { DAY_CONFIG, LEAGUE_TIME, normalizeBcTime, isLeagueSession } = require('../../utils/bangchienState');
const bangchienRoster = require('../../utils/bangchienRoster');
const { ensureTrackedMemberFromDiscord, syncStoredPositionForMember } = require('../../utils/discordPositionSync');
const { ALLOWED_GUILD_ID, isAllowedGuildId } = require('../../config/guildAccess');
// Legacy state for deleting old roster-summary notification embeds when still tracked in memory.
const _notifDebounceMap = new Map();
const _sessionSummaryStateMap = new Map();
const _webOpenNoticeBuffer = new Map();
const WEB_OPEN_NOTICE_DEBOUNCE_MS = 5000;

function resolvePrimaryGuild(client) {
  return client.guilds.cache.get(ALLOWED_GUILD_ID) || null;
}

function queueWebOpenNotice(client, guild, channelId, entry) {
  if (!client || !guild?.id || !channelId || !entry?.day) return;

  const bufferKey = `${guild.id}:${channelId}`;
  let buffer = _webOpenNoticeBuffer.get(bufferKey);
  if (!buffer) {
    buffer = { client, guild, channelId, entries: [], timer: null };
    _webOpenNoticeBuffer.set(bufferKey, buffer);
  }

  buffer.client = client;
  buffer.guild = guild;
  buffer.channelId = channelId;
  buffer.entries.push(entry);

  if (buffer.timer) clearTimeout(buffer.timer);
  buffer.timer = setTimeout(() => {
    flushWebOpenNotice(bufferKey).catch((error) => {
      console.error('[Supabase] Không gửi được thông báo mở BC tổng hợp:', error.message);
    });
  }, WEB_OPEN_NOTICE_DEBOUNCE_MS);
}

async function flushWebOpenNotice(bufferKey) {
  const buffer = _webOpenNoticeBuffer.get(bufferKey);
  if (!buffer || buffer.entries.length === 0) return;
  _webOpenNoticeBuffer.delete(bufferKey);

  const channel = await buffer.client.channels.fetch(buffer.channelId).catch(() => null);
  if (!channel) return;

  const grouped = new Map();
  for (const entry of buffer.entries) {
    if (!grouped.has(entry.day)) grouped.set(entry.day, []);
    grouped.get(entry.day).push(entry);
  }

  const embed = new EmbedBuilder()
    .setColor(0x87CEEB)
    .setTitle('💀 BANG CHIẾN ĐÃ MỞ!')
    .setDescription('Các phiên mới đã được tạo từ web. Dùng `?bc` hoặc web để đăng ký.')
    .setTimestamp();

  for (const [day, entries] of grouped) {
    const label = DAY_CONFIG[day]?.name || day;
    const lines = entries
      .sort((a, b) => String(a.time).localeCompare(String(b.time)))
      .map((item) => {
        const note = item.note ? ` _${item.note}_` : (isLeagueSession(item.time) ? ' `LEAGUE`' : '');
        return `• **${item.time}**${note}`;
      });
    embed.addFields({ name: `📅 ${label}`, value: lines.join('\n'), inline: false });
  }

  await channel.send({ embeds: [embed] });
  console.log(`[Supabase] Đã gửi 1 thông báo mở BC tổng hợp (${buffer.entries.length} session)`);
}



async function refreshUserPositionsFromDiscord(client) {
  const guild = resolvePrimaryGuild(client);
  if (!guild) return;

  const allUsers = db.getAllUsers();
  const activeMembers = allUsers.filter((user) => !user.left_at && !String(user.discord_id || '').startsWith('pending_'));
  let changedCount = 0;

  for (const user of activeMembers) {
    const member = guild.members.cache.get(user.discord_id);
    if (!member) continue;

    try {
      const result = await syncStoredPositionForMember(member, guild.id);
      if (result.changed) {
        changedCount++;
        console.log(`[ready] Synced position ${member.user.tag}: ${result.from} -> ${result.position}`);
      }
    } catch (error) {
      console.error(`[ready] Position sync failed for ${user.discord_id}:`, error.message);
    }
  }

  if (changedCount > 0) {
    console.log(`[ready] Đã cập nhật ${changedCount} position từ role Discord`);
  }
}

async function seedKcMembersIntoBotData(client) {
  const guild = resolvePrimaryGuild(client);
  if (!guild) return;

  try {
    await guild.members.fetch();
  } catch (error) {
    console.error('[ready] KC seed fetch members failed:', error.message);
  }

  let seededCount = 0;
  for (const [, member] of guild.members.cache) {
    const normalizedRoles = member.roles.cache.map((role) =>
      String(role.name || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
    );
    if (!normalizedRoles.includes('ky cuu')) continue;

    const existingUser = db.getUserByDiscordId(member.id);
    if (!existingUser || existingUser.left_at) {
      const ensuredUser = await ensureTrackedMemberFromDiscord(member, 'kc', guild.id);
      if (ensuredUser) seededCount++;
      continue;
    }

    const result = await syncStoredPositionForMember(member, guild.id);
    if (result?.changed) seededCount++;
  }

  if (seededCount > 0) {
    console.log(`[ready] Seeded/synced ${seededCount} KC members into bot data`);
  }
}

/**
 * Migrate old display roles to new star symbol name
 */
async function migrateDisplayRoles(client) {
  let migratedCount = 0;

  for (const [, guild] of client.guilds.cache) {
    if (!isAllowedGuildId(guild.id)) continue;

    try {
      // Find all roles with old names
      const oldRoles = guild.roles.cache.filter(r =>
        OLD_DISPLAY_ROLE_NAMES.includes(r.name) || r.name.trim() === ''
      );

      for (const [, role] of oldRoles) {
        try {
          // Check if role has icon (display roles typically have icons)
          if (role.icon || role.unicodeEmoji) {
            await role.setName(DISPLAY_ROLE_NAME, 'Migration: Đổi tên display role sang ⭐');
            migratedCount++;
            console.log(`[migrateDisplayRoles] Migrated role in ${guild.name}`);
          }
        } catch (e) {
          console.error(`[migrateDisplayRoles] Error migrating role in ${guild.name}:`, e.message);
        }
      }
    } catch (e) {
      console.error(`[migrateDisplayRoles] Error processing guild ${guild.name}:`, e.message);
    }
  }

  if (migratedCount > 0) console.log(`[migrateDisplayRoles] Migrated ${migratedCount} roles.`);
}

// Danh sách status random
const statusList = [
  { name: 'Đang chill ở Lang Gia Các', type: ActivityType.Watching },
  { name: 'Đang chơi Where Winds Meet', type: ActivityType.Playing },
  { name: 'Đang thưởng trà ở Tuý Hoa Lâu', type: ActivityType.Watching },
  { name: 'Đang bịp ở Cửu Lưu Môn', type: ActivityType.Playing },
  { name: 'Đang chill ở Lang Gia', type: ActivityType.Watching },
  { name: 'Đang luyện kiếm ở Lang Gia', type: ActivityType.Playing },
  { name: 'Đang ngắm cảnh ở Lang Gia', type: ActivityType.Watching },
];

// Hàm lấy status ngẫu nhiên
function getRandomStatus() {
  return statusList[Math.floor(Math.random() * statusList.length)];
}

/**
 * Auto-cleanup session BC hết hạn + re-schedule timer auto-end cho session còn hạn
 * Chạy khi bot khởi động để đảm bảo setTimeout không bị mất sau restart
 */
async function cleanupAndRescheduleBc(client) {
  const { autoCleanupExpiredSessions, scheduleBangchienAutoEndsForGuild } = require('../../utils/bangchienState');

  console.log('[ready] Bắt đầu cleanup + re-schedule BC...');

  for (const [, guild] of client.guilds.cache) {
    if (!isAllowedGuildId(guild.id)) continue;

    const guildId = guild.id;

    // 1. Cleanup session hết hạn
    const cleaned = await autoCleanupExpiredSessions(client, guildId);
    if (cleaned > 0) {
      console.log(`[ready] Đã cleanup ${cleaned} session BC hết hạn (guild ${guild.name})`);
    }

    const scheduled = scheduleBangchienAutoEndsForGuild(client, guildId);
    if (scheduled > 0) console.log(`[ready] Đã re-schedule ${scheduled} auto-end timer theo ngày cho ${guild.name}`);
  }

  console.log('[ready] Cleanup + re-schedule BC hoàn tất!');
}


function applyLeaderFlagsToTeam(team = [], leaderId = null) {
  return (Array.isArray(team) ? team : []).map((member) => {
    const isTeamLeader = !!leaderId && member?.id === leaderId;
    return {
      ...member,
      isTeamLeader,
      ld: isTeamLeader
    };
  });
}

async function refreshStoredListbcDetailMessage(guild, sessionOrDay) {
  const { listbcDetailMessages, getListbcDetailKey } = require('../../utils/bangchienState');
  const db = require('../../database/db');
  const session = typeof sessionOrDay === 'object' && sessionOrDay
    ? sessionOrDay
    : db.getActiveBangchienByDay(guild.id, sessionOrDay);
  const day = session?.day || (typeof sessionOrDay === 'string' ? sessionOrDay : null);
  const listbcKey = getListbcDetailKey(guild.id, session, day, session?.time);
  const storedData = listbcDetailMessages.get(listbcKey);
  if (!storedData?.message) return;

  const freshSession = session?.party_key
    ? db.getActiveBangchien(session.party_key)
    : db.getActiveBangchienByDay(guild.id, day);
  if (!freshSession) return;

  const listbcCommand = require('../../commands/bangchien/listbangchien');
  let newEmbed = null;
  let newComponents = [];

  const fakeMessage = {
    guild,
    channel: storedData.message.channel,
    reply: async (options) => {
      newEmbed = options.embeds?.[0] || null;
      newComponents = options.components || [];
    }
  };

  await listbcCommand.showDetailedSession(fakeMessage, freshSession, true, freshSession.day || day, true);
  if (newEmbed) {
    await storedData.message.edit({ embeds: [newEmbed], components: newComponents });
  }
}

async function refreshLiveBangchienMessage(client, guild, session) {
  if (!session?.party_key) return;
  const { bangchienNotifications } = require('../../utils/bangchienState');
  const { createBangchienEmbed, createBangchienButtons } = require('../../commands/bangchien/bangchien');
  const notifData = bangchienNotifications.get(session.party_key);
  if (!notifData) return;

  let liveMessage = notifData.message || null;
  if (!liveMessage) {
    const channelId = notifData.channelId || session.channel_id;
    const messageId = notifData.messageId || session.message_id;
    if (!channelId || !messageId) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    liveMessage = await channel.messages.fetch(messageId).catch(() => null);
    if (!liveMessage) return;
    notifData.message = liveMessage;
    notifData.messageId = liveMessage.id;
  }

  const newEmbed = createBangchienEmbed(session.party_key, session.leader_name, guild);
  const newButtons = createBangchienButtons(session.party_key, session.day);
  await liveMessage.edit({ embeds: [newEmbed], components: [newButtons] });
}

function normalizeEmbedSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isRosterSummaryMessage(message, botUserId = null) {
  if (botUserId && message.author?.id && message.author.id !== botUserId) return false;
  return (message.embeds || []).some((embed) => {
    const title = normalizeEmbedSearchText(embed?.title);
    return title.includes('cap nhat doi hinh');
  });
}

async function deleteRosterSummaryMessagesInChannel(client, channel, limit = 50) {
  if (!channel?.messages?.fetch) return 0;

  const messages = await channel.messages.fetch({ limit }).catch(() => null);
  if (!messages) return 0;

  let deleted = 0;
  for (const [, message] of messages) {
    if (!isRosterSummaryMessage(message, client.user?.id)) continue;
    try {
      await message.delete();
      deleted++;
    } catch (e) { }
  }
  return deleted;
}

async function resolveStoredSummaryMessage(channel, summaryState) {
  if (!summaryState?.messageId) return null;
  if (summaryState.message) return summaryState.message;
  const fetched = await channel.messages.fetch(summaryState.messageId).catch(() => null);
  if (fetched) summaryState.message = fetched;
  return fetched;
}

async function clearSessionSummaryState(client, summaryKey, fallbackChannelId = null) {
  const pending = _notifDebounceMap.get(summaryKey);
  if (pending?.timer) clearTimeout(pending.timer);
  _notifDebounceMap.delete(summaryKey);

  const summaryState = _sessionSummaryStateMap.get(summaryKey);
  const channelId = summaryState?.channelId || fallbackChannelId;
  if (channelId) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel) {
      const storedMessage = await resolveStoredSummaryMessage(channel, summaryState || {});
      if (storedMessage) {
        try { await storedMessage.delete(); } catch (e) { }
      }
      await deleteRosterSummaryMessagesInChannel(client, channel);
    }
  }

  _sessionSummaryStateMap.delete(summaryKey);
}

async function clearRosterSummaryEmbedsForGuild(client, guild) {
  if (!guild?.id) return;

  const channelIds = new Set();
  const configuredChannelId = db.getConfig ? db.getConfig(`bc_channel_${guild.id}`) : null;
  if (configuredChannelId) channelIds.add(configuredChannelId);

  const sessions = db.getActiveBangchienByGuild ? db.getActiveBangchienByGuild(guild.id) : [];
  for (const session of sessions) {
    if (session?.channel_id) channelIds.add(session.channel_id);
  }

  let deletedTotal = 0;
  for (const channelId of channelIds) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) continue;
    deletedTotal += await deleteRosterSummaryMessagesInChannel(client, channel);
  }

  if (deletedTotal > 0) {
    console.log(`[ready] Deleted ${deletedTotal} old BC roster summary embed(s) in ${guild.name}`);
  }
}

async function clearRosterSummaryEmbedsForAllGuilds(client) {
  for (const [, guild] of client.guilds.cache) {
    if (!isAllowedGuildId(guild.id)) continue;
    await clearRosterSummaryEmbedsForGuild(client, guild);
  }
}

const TACTICS_DAY_LABELS = {
  mon: 'Thứ 2',
  tue: 'Thứ 3',
  wed: 'Thứ 4',
  thu: 'Thứ 5',
  fri: 'Thứ 6',
  sat: 'Thứ 7',
  sun: 'Chủ Nhật'
};

function normalizeTacticsStrategyName(value) {
  return String(value || '').trim().slice(0, 60);
}

async function resolveTacticsActorName(guild, savedBy, fallbackName = 'Leader') {
  const raw = String(savedBy || '').trim();
  if (!raw) return fallbackName;
  if (/^\d{6,}$/.test(raw)) {
    const member = await guild.members.fetch(raw).catch(() => null);
    return member?.displayName || member?.user?.username || fallbackName;
  }
  return raw;
}

/**
 * Boot-pull: Tạo sessions trong SQLite từ Supabase khi bot start với SQLite trống
 * Giải quyết vấn đề hosting bot có SQLite khác với bot cục bộ
 */
async function pullMissingSessionsFromSupabase(supabaseClient, db, guild) {
  if (!supabaseClient || !db || !guild) return;
  try {
    const { data: remoteSessions } = await supabaseClient
      .from('bc_sessions').select('*')
      .eq('guild_id', guild.id).eq('status', 'active');
    if (!remoteSessions || remoteSessions.length === 0) return;

    const { createPartyKey, bangchienNotifications, bangchienRegistrations, bangchienChannels, normalizeBcTime, LEAGUE_TIME } = require('../../utils/bangchienState');
    const bcChannelId = db.getConfig ? db.getConfig(`bc_channel_${guild.id}`) : null;
    let pulledCount = 0;

    for (const remoteSession of remoteSessions) {
      if (!remoteSession.day) continue;
      const remoteTime = normalizeBcTime(remoteSession.time || LEAGUE_TIME);
      const existing = db.getActiveBangchienByDayTime
        ? db.getActiveBangchienByDayTime(guild.id, remoteSession.day, remoteTime)
        : (db.getActiveBangchienByDay ? db.getActiveBangchienByDay(guild.id, remoteSession.day) : null);
      if (existing) {
        if (remoteSession.id && !existing.supabase_session_id) {
          db.db.prepare('UPDATE bangchien_active SET supabase_session_id=? WHERE party_key=?').run(remoteSession.id, existing.party_key);
        }
        continue; // Đã có trong SQLite, bỏ qua
      }

      if (!bcChannelId) {
        console.warn(`[Supabase] ⚠️ Boot-pull ${remoteSession.day}: chưa set kênh BC (dùng ?setbc trên hosting bot)`);
        continue;
      }

      const leaderIds = (() => {
        try { return typeof remoteSession.leader_ids === 'string' ? JSON.parse(remoteSession.leader_ids || '{}') : (remoteSession.leader_ids || {}); } catch(e) { return {}; }
      })();
      const partyKey = createPartyKey(guild.id, remoteSession.day, leaderIds.creator_id || 'web', remoteTime);

      // Tạo session trong SQLite
      try {
        db.createActiveBangchien({
          guildId: guild.id,
          partyKey,
          leaderId: leaderIds.creator_id || leaderIds.commander || 'web',
          leaderName: leaderIds.creator_name || 'Web',
          channelId: bcChannelId,
          messageId: null,
          day: remoteSession.day,
          time: remoteTime,
          note: remoteSession.note || null,
          supabaseSessionId: remoteSession.id || null,
          team_layout: remoteSession.team_layout || null,
          teams: remoteSession.teams || remoteSession.teams_json || null,
          team_attack1: remoteSession.team_attack1 || [],
          team_attack2: remoteSession.team_attack2 || [],
          team_defense: remoteSession.team_defense || [],
          team_forest: remoteSession.team_forest || [],
          waiting_list: remoteSession.waiting_list || []
        });

        // Ghi leader mirror; roster dynamic da duoc serialize trong createActiveBangchien.
        db.db.prepare(`
          UPDATE bangchien_active
          SET team1_leader_id=?, team2_leader_id=?, team3_leader_id=?, team4_leader_id=?
          WHERE party_key=?
        `).run(
          leaderIds.team1 || null,
          leaderIds.team2 || null,
          leaderIds.team3 || null,
          leaderIds.team4 || null,
          partyKey
        );

        // Khởi tạo memory state từ roster động để không mất team custom.
        bangchienRegistrations.set(partyKey, bangchienRoster.getAllRosterMembers(remoteSession));
        bangchienNotifications.set(partyKey, {
          intervalId: null, channelId: bcChannelId,
          leaderId: leaderIds.creator_id || 'web',
          leaderName: leaderIds.creator_name || 'Web',
          messageId: null, message: null,
          startTime: Date.now(), day: remoteSession.day, time: remoteTime
        });
        bangchienChannels.set(guild.id, bcChannelId);
        pulledCount++;
        console.log(`[Supabase] ✅ Boot-pull: tạo SQLite session ${remoteSession.day} từ Supabase`);
      } catch (createErr) {
        console.error(`[Supabase] ❌ Boot-pull lỗi tạo session ${remoteSession.day}:`, createErr.message);
      }
    }

    if (pulledCount > 0) console.log(`[Supabase] ✅ Boot-pull hoàn tất: ${pulledCount} session kéo từ Supabase vào SQLite`);
  } catch (err) {
    console.error('[Supabase] ❌ Boot-pull error:', err.message);
  }
}

async function sendTacticsSaveNotice(client, guild, historyEntry) {
  if (!historyEntry?.day) return;
  const meta = historyEntry?.markers?._history_meta || {};
  if (meta.action !== 'save') return;

  const session = historyEntry.session_id && db.getActiveBangchienBySupabaseId
    ? db.getActiveBangchienBySupabaseId(guild.id, historyEntry.session_id)
    : db.getActiveBangchienByDay(guild.id, historyEntry.day);
  if (!session?.channel_id) return;

  const channel = await client.channels.fetch(session.channel_id).catch(() => null);
  if (!channel) return;

  const actorName = await resolveTacticsActorName(
    guild,
    meta.actor_id || historyEntry.saved_by,
    meta.actor_name || 'Leader'
  );
  const strategyName = normalizeTacticsStrategyName(meta.strategy_name || historyEntry?.markers?.strategy_name);
  const dayLabel = TACTICS_DAY_LABELS[historyEntry.day] || historyEntry.day;
  const sessionLabel = `${dayLabel} ${session.time || '19:30'}`;
  const content = strategyName
    ? `${actorName} đã lưu chiến thuật "${strategyName}" cho ${sessionLabel}.`
    : `${actorName} đã lưu chiến thuật cho ${sessionLabel}.`;

  await channel.send({ content });
}

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`Bot ${client.user.tag} đã online!`);

    // Migrate old display roles sang tên mới
    await migrateDisplayRoles(client);

    await seedKcMembersIntoBotData(client);


    // ♦ Đồng bộ lại position từ role Discord thật -> SQLite/Supabase
    await refreshUserPositionsFromDiscord(client);

    // ♦ Auto-cleanup session BC hết hạn + re-schedule timer
    await cleanupAndRescheduleBc(client);
    await clearRosterSummaryEmbedsForAllGuilds(client);

    // ♦ Khởi tạo Supabase sync cho Web Bang Chiến
    const supaOk = supaSync.initSupabase();
    if (supaOk) {
      const guild = resolvePrimaryGuild(client);
      if (guild) {
        supaSync.listenForTacticsHistoryChanges(guild.id, async (historyEntry) => {
          try {
            await sendTacticsSaveNotice(client, guild, historyEntry);
          } catch (error) {
            console.error('[Supabase] Khong gui duoc thong bao luu chien thuat:', error.message);
          }
        });
        // Chỉ sync sessions cho guild chính
        await supaSync.syncAllActiveSessions(db, guild.id, guild);
        console.log('[Supabase] Đã sync sessions khi start cho guild ' + guild.id);

        // Boot-pull: kéo sessions từ Supabase vào SQLite (cho hosting bot với SQLite trống)
        const supabaseClient = supaSync.getSupabaseClient();
        await pullMissingSessionsFromSupabase(supabaseClient, db, guild);
        await clearRosterSummaryEmbedsForGuild(client, guild);

        try {
          const { ensureWeekendDefaultSessions, refreshOverviewEmbed, scheduleBangchienAutoEndsForGuild } = require('../../utils/bangchienState');
          const createdDefaults = await ensureWeekendDefaultSessions(guild);
          if (createdDefaults.length > 0) {
            console.log(`[Supabase] Created ${createdDefaults.length} default weekend BC sessions`);
            await refreshOverviewEmbed(client, guild.id);
          }
          scheduleBangchienAutoEndsForGuild(client, guild.id);
        } catch (defaultSessionErr) {
          console.error('[Supabase] Loi tao default weekend sessions:', defaultSessionErr.message);
        }

        // Member roster bootstrap: Supabase is the source of truth after first seed.
        try {
          await guild.members.fetch().catch(() => null);
          await memberRosterSync.bootstrapRoster(guild);
          memberRosterSync.listenForRosterChanges(guild);
        } catch (userSyncErr) {
          console.error('[Supabase] Lỗi bootstrap member roster:', userSyncErr.message);
        }

        // Recurring signup is temporarily disabled; keep existing data untouched.

        // Sync exp_levels lên Supabase (cho tab Level trên web profile)
        try {
          const expDb = require('../../database/exp');
          await supaSync.syncExpLevels(expDb);
        } catch (expSyncErr) {
          console.error('[Supabase] Lỗi sync exp_levels:', expSyncErr.message);
        }

        // ♦ Báo cáo dung lượng Supabase
        try {
          const storageReport = await supaSync.getSupabaseStorageReport();
          if (storageReport) {
            console.log('');
            console.log('╔══════════════════════════════════════════════╗');
            console.log('║        📊 SUPABASE STORAGE REPORT           ║');
            console.log('╠══════════════════════════════════════════════╣');
            for (const t of storageReport.tables) {
              const name = t.table.padEnd(22);
              const rows = String(t.rows).padStart(6);
              const kb = String(t.estimatedKB + ' KB').padStart(10);
              const note = t.note ? ` (${t.note})` : '';
              console.log(`║  ${name} ${rows} rows ${kb}${note}`);
            }
            console.log('╠══════════════════════════════════════════════╣');
            console.log(`║  TỔNG: ${String(storageReport.totalRows).padStart(6)} rows ~ ${storageReport.totalEstimatedMB} MB`);
            console.log(`║  Free tier limit: 500 MB`);
            const usagePercent = Math.round(storageReport.totalEstimatedMB / 500 * 100 * 100) / 100;
            console.log(`║  Đã dùng: ~${usagePercent}%`);
            console.log('╚══════════════════════════════════════════════╝');
            console.log('');
          }
        } catch (reportErr) {
          console.error('[Supabase] Lỗi lấy storage report:', reportErr.message);
        }

        // Lắng nghe thay đổi từ web → sync ngược về SQLite + xoá role
        // Hỗ trợ INSERT (tạo mới), UPDATE (thay đổi danh sách) và DELETE (xóa session)
        supaSync.listenForWebChanges(guild.id, async (newData) => {
          // CASE: INSERT session từ web
          if (newData._inserted) {
            try {
              const { bangchienNotifications, bangchienRegistrations, bangchienChannels, DAY_CONFIG, createPartyKey, refreshOverviewEmbed, scheduleBangchienAutoEnd, normalizeBcTime, LEAGUE_TIME } = require('../../utils/bangchienState');
              const day = newData.day;
              const time = normalizeBcTime(newData.time || LEAGUE_TIME);
              const dayConfig = DAY_CONFIG[day];
              if (!dayConfig) { console.log(`[Supabase] ⚠️ Ngày không hợp lệ: ${day}`); return; }

              // Kiểm tra đã có session cho ngày này chưa
              const existing = db.getActiveBangchienByDayTime
                ? db.getActiveBangchienByDayTime(guild.id, day, time)
                : db.getActiveBangchienByDay(guild.id, day);
              if (existing) {
                if (newData.id && !existing.supabase_session_id) {
                  db.db.prepare('UPDATE bangchien_active SET supabase_session_id=? WHERE party_key=?').run(newData.id, existing.party_key);
                }
                console.log(`[Supabase] Session ${day} ${time} da ton tai trong SQLite, bo qua INSERT`);
                return;
              }

              // Lấy kênh BC đã set bằng ?setbc
              const bcChannelId = db.getConfig(`bc_channel_${guild.id}`);
              if (!bcChannelId) {
                console.log(`[Supabase] ⚠️ Chưa set kênh BC (?setbc). Không thể tạo session từ web.`);
                return;
              }

              // Tạo party key
              const partyKey = createPartyKey(guild.id, day, 'web', time);

              // Parse creator name từ leader_ids
              const leaderIds = typeof newData.leader_ids === 'string' ? JSON.parse(newData.leader_ids || '{}') : (newData.leader_ids || {});
              const creatorName = leaderIds.creator_name || 'Web';
              const creatorId = leaderIds.creator_id || 'web';

              // Tạo session trong SQLite
              db.createActiveBangchien({
                guildId: guild.id,
                partyKey,
                leaderId: creatorId,
                leaderName: creatorName,
                channelId: bcChannelId,
                messageId: null,
                day: day,
                time,
                note: newData.note || null,
                supabaseSessionId: newData.id || null,
                team_layout: newData.team_layout || null,
                teams: newData.teams || newData.teams_json || null,
                team_attack1: newData.team_attack1 || [],
                team_attack2: newData.team_attack2 || [],
                team_defense: newData.team_defense || [],
                team_forest: newData.team_forest || [],
                waiting_list: newData.waiting_list || []
              });
              // Khởi tạo trong memory
              bangchienRegistrations.set(partyKey, bangchienRoster.getAllRosterMembers(newData));
              bangchienNotifications.set(partyKey, {
                intervalId: null,
                channelId: bcChannelId,
                leaderId: creatorId,
                leaderName: creatorName,
                messageId: null,
                message: null,
                startTime: Date.now(),
                day: day,
                time
              });
              bangchienChannels.set(guild.id, bcChannelId);

              // Recurring signup is temporarily disabled; keep existing data untouched.

              queueWebOpenNotice(client, guild, bcChannelId, {
                day,
                time,
                note: newData.note || null,
                creatorName
              });

              await refreshOverviewEmbed(client, guild.id, bcChannelId);
              scheduleBangchienAutoEnd(client, guild.id, day, bcChannelId);

              // Cập nhật lịch tuần
              try {
                const { refreshScheduleEmbed } = require('../../commands/thongbao/thongbaoguild');
                await refreshScheduleEmbed(client, guild.id, null, 'resend');
              } catch (e) { }

              console.log(`[Supabase] ✅ Web INSERT → tạo SQLite session ${day} ${time}, queue thông báo tổng hợp`);
            } catch (err) {
              console.error('[Supabase] ❌ Xử lý web INSERT lỗi:', err.message);
            }
            return;
          }

          // CASE: DELETE session từ web
          if (newData._deleted) {
            try {
              const { bangchienNotifications, bangchienRegistrations, bangchienChannels, getGuildBangchienKeys, getSessionIdentityKey, LEAGUE_TIME } = require('../../utils/bangchienState');
              const sessions = db.getActiveBangchienByGuild(guild.id);

              // Tìm session(s) cần xóa
              let sessionsToDelete = [];
              if (newData._deleted_unknown && newData.remainingKeys) {
                const remainingSet = new Set(newData.remainingKeys);
                sessionsToDelete = sessions.filter(s => !remainingSet.has(getSessionIdentityKey(s)));
                console.log(`[Supabase] x️ Fallback DELETE: tìm ${sessionsToDelete.length} session cần xóa`);
              } else if (newData.day) {
                const targetTime = normalizeBcTime(newData.time || LEAGUE_TIME);
                const found = sessions.find(s => s.day === newData.day && normalizeBcTime(s.time || LEAGUE_TIME) === targetTime);
                if (found) sessionsToDelete = [found];
                console.log(`[Supabase] Web da xoa BC session ${newData.day} ${targetTime}`);
              }

              for (const localSession of sessionsToDelete) {
                const partyKey = localSession.party_key;
                const summaryKey = localSession.party_key || localSession.day || 'x';

                const participants = bangchienRoster.getActiveRosterMembers(localSession);
                const bcRole = guild.roles.cache.find(r => r.name === 'bc');
                if (bcRole && participants.length > 0) {
                  for (const p of participants) {
                    try {
                      const member = await guild.members.fetch(p.id).catch(() => null);
                      if (member && member.roles.cache.has(bcRole.id)) {
                        await member.roles.remove(bcRole);
                        console.log(`[Supabase] x Đã xoá role BC cho ${member.user.username} (web delete)`);
                      }
                    } catch (e) { }
                  }
                }

                const notifData = bangchienNotifications.get(partyKey);
                if (notifData) {
                  if (notifData.intervalId) clearInterval(notifData.intervalId);
                  try { if (notifData.message) await notifData.message.delete(); } catch (e) { }
                }
                bangchienNotifications.delete(partyKey);
                bangchienRegistrations.delete(partyKey);
                await clearSessionSummaryState(
                  client,
                  summaryKey,
                  localSession.channel_id || notifData?.channelId || null
                );

                db.deleteActiveBangchien(partyKey);
                console.log(`[Supabase] S& Đã xóa SQLite session ${localSession.day} (web delete)`);
              }

              const remaining = getGuildBangchienKeys(guild.id);
              if (remaining.length === 0) bangchienChannels.delete(guild.id);

              const { refreshOverviewEmbed } = require('../../utils/bangchienState');
              await refreshOverviewEmbed(client, guild.id);
            } catch (err) {
              console.error('[Supabase] R Xử lý web DELETE li:', err.message);
            }
            return;
          }

          // CASE: UPDATE session từ web
          console.log(`[Supabase] Sync nguoc BC session update (${newData.day} ${normalizeBcTime(newData.time || LEAGUE_TIME)})`);
          try {
            const sessions = db.getActiveBangchienByGuild(guild.id);
            const targetTime = normalizeBcTime(newData.time || LEAGUE_TIME);
            const localSession = sessions.find(s =>
              (newData.id && s.supabase_session_id === newData.id) ||
              (s.day === newData.day && normalizeBcTime(s.time || LEAGUE_TIME) === targetTime)
            );
            if (!localSession) return;

            const parseTeam = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : (v || []); } catch(e) { return []; } };
            const leaderIds = (() => {
              try {
                return typeof newData.leader_ids === 'string' ? JSON.parse(newData.leader_ids || '{}') : (newData.leader_ids || {});
              } catch (e) {
                return {};
              }
            })();
            const nextSizes = (() => {
              try {
                return typeof newData.team_sizes === 'string' ? JSON.parse(newData.team_sizes || '{}') : (newData.team_sizes || {});
              } catch (e) {
                return {};
              }
            })();
            const supaTeams = {
              team_attack1: applyLeaderFlagsToTeam(parseTeam(newData.team_attack1), leaderIds.team1),
              team_attack2: applyLeaderFlagsToTeam(parseTeam(newData.team_attack2), leaderIds.team2),
              team_defense: applyLeaderFlagsToTeam(parseTeam(newData.team_defense), leaderIds.team3),
              team_forest: applyLeaderFlagsToTeam(parseTeam(newData.team_forest), leaderIds.team4),
              waiting_list: parseTeam(newData.waiting_list).map((member) => ({ ...member, isTeamLeader: false, ld: false }))
            };
            const dynamicRoster = bangchienRoster.normalizeRoster(newData);
            const dynamicLeaderIds = leaderIds.teams || {};
            for (const team of dynamicRoster.layout) {
              const legacyLeaderKey = { team_attack1: 'team1', team_attack2: 'team2', team_defense: 'team3', team_forest: 'team4' }[team.id];
              const teamLeaderId = dynamicLeaderIds[team.id] || (legacyLeaderKey ? leaderIds[legacyLeaderKey] : null);
              dynamicRoster.teams[team.id] = applyLeaderFlagsToTeam(dynamicRoster.teams[team.id] || [], teamLeaderId);
            }
            dynamicRoster.waitingList = (dynamicRoster.waitingList || []).map((member) => ({ ...member, isTeamLeader: false, ld: false }));
            const dynamicStorage = bangchienRoster.serializeRosterForStorage(dynamicRoster);

            const nextSizeTotal = Number(nextSizes.attack1 ?? 0) + Number(nextSizes.attack2 ?? 0) + Number(nextSizes.defense ?? 0) + Number(nextSizes.forest ?? 0);
            if ((leaderIds.editor_action || 'sync') === 'resize' && nextSizeTotal === 30) {
              if (nextSizes.attack1 !== undefined) db.setTeamSize('attack1', nextSizes.attack1);
              if (nextSizes.attack2 !== undefined) db.setTeamSize('attack2', nextSizes.attack2);
              if (nextSizes.defense !== undefined) db.setTeamSize('defense', nextSizes.defense);
              if (nextSizes.forest !== undefined) db.setTeamSize('forest', nextSizes.forest);

              // Sync team_names ngược về SQLite để embed Discord hiện đúng tên custom
              const nextNames = (() => {
                try {
                  return typeof newData.team_names === 'string'
                    ? JSON.parse(newData.team_names || '{}')
                    : (newData.team_names || {});
                } catch (e) { return {}; }
              })();
              if (Object.keys(nextNames).length > 0 && db.setTeamNames) {
                db.setTeamNames(nextNames);
                console.log(`[Supabase] ✅ Đã sync team_names về SQLite:`, nextNames);
              }
            }

            const localAllIds = new Set([
              ...bangchienRoster.getAllRosterMembers(localSession)
            ].map(p => p.id));
            const supaAllIds = new Set([
              ...bangchienRoster.getAllRosterMembers({ ...newData, teams: dynamicStorage.teams_json, team_layout: dynamicStorage.team_layout })
            ].map(p => p.id));

            const removedIds = [...localAllIds].filter(id => !supaAllIds.has(id));
            const addedIds = [...supaAllIds].filter(id => !localAllIds.has(id));

            const updateStmt = db.db.prepare(`
              UPDATE bangchien_active
              SET team_attack1=?, team_attack2=?, team_defense=?, team_forest=?, waiting_list=?,
                  team1_leader_id=?, team2_leader_id=?, team3_leader_id=?, team4_leader_id=?,
                  commander_id=?, note=?, time=?, team_layout=?, teams_json=?, updated_at=CURRENT_TIMESTAMP
              WHERE party_key=?
            `);
            updateStmt.run(
              JSON.stringify(dynamicStorage.team_attack1 || supaTeams.team_attack1),
              JSON.stringify(dynamicStorage.team_attack2 || supaTeams.team_attack2),
              JSON.stringify(dynamicStorage.team_defense || supaTeams.team_defense),
              JSON.stringify(dynamicStorage.team_forest || supaTeams.team_forest),
              JSON.stringify(dynamicStorage.waiting_list || supaTeams.waiting_list),
              leaderIds.team1 || null,
              leaderIds.team2 || null,
              leaderIds.team3 || null,
              leaderIds.team4 || null,
              leaderIds.commander || localSession.commander_id || null,
              newData.note || '',
              targetTime,
              dynamicStorage.team_layout,
              dynamicStorage.teams_json,
              localSession.party_key
            );
            console.log(`[Supabase] S& Đã sync ngược SQLite cho BC ${newData.day}`);

            if (addedIds.length > 0) {
              const bcRole = guild.roles.cache.find(r => r.name === 'bc');
              if (bcRole) {
                for (const userId of addedIds) {
                  try {
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (member && !member.roles.cache.has(bcRole.id)) {
                      await member.roles.add(bcRole);
                      console.log(`[Supabase] ✅ Gán role BC cho ${member.user.username} (web join)`);
                    }
                  } catch (e) { }
                }
              }
            }

            if (removedIds.length > 0) {
              const bcRole = guild.roles.cache.find(r => r.name === 'bc');
              if (bcRole) {
                for (const userId of removedIds) {
                  try {
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (member && member.roles.cache.has(bcRole.id)) {
                      await member.roles.remove(bcRole);
                      console.log(`[Supabase] ❌ Đã xoá role BC cho ${member.user.username} (web cancel)`);
                    }
                  } catch (e) { }
                }
              }
            }


            const { refreshOverviewEmbed } = require('../../utils/bangchienState');
            await refreshOverviewEmbed(client, guild.id);
            const freshSession = db.getActiveBangchien(localSession.party_key);
            if (freshSession) {
              await refreshLiveBangchienMessage(client, guild, freshSession).catch((e) => {
                console.error('[Supabase] Khong refresh duoc embed BC:', e.message);
              });
              await refreshStoredListbcDetailMessage(guild, freshSession).catch((e) => {
                console.error('[Supabase] Khong refresh duoc listbc detail:', e.message);
              });
              await clearSessionSummaryState(
                client,
                freshSession.party_key || freshSession.day || 'x',
                freshSession.channel_id || null
              ).catch((e) => {
                console.error('[Supabase] Khong xoa duoc embed thong bao doi hinh:', e.message);
              });
            }

          } catch (syncBackErr) {
            console.error('[Supabase] ❌ Sync ngược lỗi:', syncBackErr.message);
          }
        });

        // Recurring signup realtime is disabled while the feature is paused.
      }
    }

    // Khởi tạo notifications từ file
    thongbao.initializeNotifications(client);

    // Khởi tạo YenTiec Time Change Reminder
    // Tự động lấy channel ID từ YenTiec notification đã lưu
    const { weeklyNotifications } = require('../../utils/notificationState');
    let yentiecChannelId = null;
    for (const [id, notif] of weeklyNotifications) {
      if (notif.missionType === 'YenTiec' && notif.channelId) {
        yentiecChannelId = notif.channelId;
        break;
      }
    }

    if (yentiecChannelId) {
      scheduleWeeklyReminders(client, yentiecChannelId);
    } else {
      console.log('[yentiecReminder] No YenTiec notification found, skipping');
    }

    // Set status ban đầu (random)
    client.user.setPresence({
      activities: [getRandomStatus()],
      status: 'online',
    });

    // Random status moi 30 giây
    setInterval(() => {
      client.user.setPresence({
        activities: [getRandomStatus()],
        status: 'online',
      });
    }, 30 * 1000); // 30 giây
  }
};
