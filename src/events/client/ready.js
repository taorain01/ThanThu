const { ActivityType, EmbedBuilder } = require("discord.js");
const thongbao = require('../../commands/thongbao/thongbao');
const { scheduleWeeklyReminders } = require('../../utils/yentiecReminder');
const { DISPLAY_ROLE_NAME, OLD_DISPLAY_ROLE_NAMES } = require('../../commands/quanly/subrole/addrole');
const db = require('../../database/db');
const supaSync = require('../../utils/supabaseSync');
const { ensureTrackedMemberFromDiscord, syncStoredPositionForMember } = require('../../utils/discordPositionSync');

// Constants for member check
const LEAVE_NOTIFICATION_CHANNEL = '1465959064575152263';

function resolvePrimaryGuild(client) {
  const preferredGuildId = process.env.guildId || process.env.GUILD_ID || '1239836342456942643';
  return client.guilds.cache.get(preferredGuildId) || client.guilds.cache.first() || null;
}

/**
 * Check if active members in database are still in Discord guild
 * If not, mark them as left and send notification
 */
async function checkMemberPresence(client) {
  console.log('[checkMemberPresence] Äang kiá»ƒm tra thÃ nh viÃªn...');

  // Get all users and filter active ones (left_at is null and not pending)
  const allUsers = db.getAllUsers();
  const activeMembers = allUsers.filter(u => !u.left_at && !u.discord_id.startsWith('pending_'));

  console.log(`[checkMemberPresence] TÃ¬m tháº¥y ${activeMembers.length} thÃ nh viÃªn active trong database`);

  let leftCount = 0;
  const leftMembers = [];

  // Get the first guild (assuming bot is in one main guild)
  const guild = resolvePrimaryGuild(client);
  if (!guild) {
    console.log('[checkMemberPresence] KhÃ´ng tÃ¬m tháº¥y guild nÃ o');
    return;
  }

  // Fetch all guild members to ensure cache is updated
  try {
    await guild.members.fetch();
  } catch (e) {
    console.error('[checkMemberPresence] Lá»—i fetch members:', e.message);
  }

  for (const userData of activeMembers) {
    try {
      // Check if member exists in guild
      const member = guild.members.cache.get(userData.discord_id);

      if (!member) {
        // Member not in guild anymore - mark as left
        const result = db.markUserAsLeft(userData.discord_id);

        if (result.success) {
          leftCount++;
          leftMembers.push(userData);

          // Clear display preference
          db.clearUserDisplay(userData.discord_id);

          console.log(`[checkMemberPresence] ÄÃ¡nh dáº¥u rá»i: ${userData.game_username || userData.discord_name}`);
        }
      }
    } catch (e) {
      // Member doesn't exist
    }
  }

  console.log(`[checkMemberPresence] HoÃ n táº¥t! ${leftCount} thÃ nh viÃªn Ä‘Ã£ rá»i Discord`);

  // Send batch notification if any members left
  if (leftMembers.length > 0) {
    try {
      const channel = await client.channels.fetch(LEAVE_NOTIFICATION_CHANNEL);
      if (channel) {


        // Create member list
        const memberList = leftMembers.map((u, i) =>
          `**${i + 1}.** ${u.game_username || 'N/A'} (${u.discord_name}) - UID: ${u.game_uid || 'N/A'}`
        ).join('\n');

        const embed = new EmbedBuilder()
          .setColor(0xFF4444)
          .setTitle('âš ï¸ PhÃ¡t hiá»‡n thÃ nh viÃªn Ä‘Ã£ rá»i Discord')
          .setDescription(`Sau khi kiá»ƒm tra, bot phÃ¡t hiá»‡n **${leftMembers.length}** thÃ nh viÃªn trong guild list khÃ´ng cÃ²n trong Discord.\n\nðŸ’¡ **CÃ³ thá»ƒ há» Ä‘Ã£ rá»i guild.** Vui lÃ²ng kiá»ƒm tra vÃ  kick trong game náº¿u cáº§n.\n\n${memberList}`)
          .setFooter({ text: 'ðŸ”„ ÄÃ£ tá»± Ä‘á»™ng Ä‘Ã¡nh dáº¥u "Rá»i guild" vÃ  reset thÃ´ng tin' })
          .setTimestamp();

        await channel.send({
          embeds: [embed]
        });

      }
    } catch (e) {
      console.error('[checkMemberPresence] Lá»—i gá»­i thÃ´ng bÃ¡o:', e.message);
    }
  }
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
    console.log(`[ready] ÄÃ£ cáº­p nháº­t ${changedCount} position tá»« role Discord`);
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
  console.log('[migrateDisplayRoles] Starting migration...');
  let migratedCount = 0;

  for (const [, guild] of client.guilds.cache) {
    try {
      // Find all roles with old names
      const oldRoles = guild.roles.cache.filter(r =>
        OLD_DISPLAY_ROLE_NAMES.includes(r.name) || r.name.trim() === ''
      );

      for (const [, role] of oldRoles) {
        try {
          // Check if role has icon (display roles typically have icons)
          if (role.icon || role.unicodeEmoji) {
            await role.setName(DISPLAY_ROLE_NAME, 'Migration: Äá»•i tÃªn display role sang âœ¦');
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

  console.log(`[migrateDisplayRoles] Completed! Migrated ${migratedCount} roles.`);
}

// Danh sÃ¡ch status random
const statusList = [
  { name: 'Äang chill á»Ÿ Lang Gia CÃ¡c', type: ActivityType.Watching },
  { name: 'Äang chÆ¡i Where Winds Meet', type: ActivityType.Playing },
  { name: 'Äang thÆ°á»Ÿng trÃ  á»Ÿ TuÃ½ Hoa LÃ¢u', type: ActivityType.Watching },
  { name: 'Äang bá»‹p á»Ÿ Cá»­u LÆ°u MÃ´n', type: ActivityType.Playing },
  { name: 'Äang chill á»Ÿ Lang Gia', type: ActivityType.Watching },
  { name: 'Äang luyá»‡n kiáº¿m á»Ÿ Lang Gia', type: ActivityType.Playing },
  { name: 'Äang ngáº¯m cáº£nh á»Ÿ Lang Gia', type: ActivityType.Watching },
];

// HÃ m láº¥y status ngáº«u nhiÃªn
function getRandomStatus() {
  return statusList[Math.floor(Math.random() * statusList.length)];
}

/**
 * Auto-cleanup session BC háº¿t háº¡n + re-schedule timer auto-end cho session cÃ²n háº¡n
 * Cháº¡y khi bot khá»Ÿi Ä‘á»™ng Ä‘á»ƒ Ä‘áº£m báº£o setTimeout khÃ´ng bá»‹ máº¥t sau restart
 */
async function cleanupAndRescheduleBc(client) {
  const { autoCleanupExpiredSessions, isSessionExpired, DAY_CONFIG,
    bangchienNotifications, bangchienRegistrations, bangchienChannels
  } = require('../../utils/bangchienState');

  console.log('[ready] Báº¯t Ä‘áº§u cleanup + re-schedule BC...');

  for (const [, guild] of client.guilds.cache) {
    const guildId = guild.id;

    // 1. Cleanup session háº¿t háº¡n
    const cleaned = await autoCleanupExpiredSessions(client, guildId);
    if (cleaned > 0) {
      console.log(`[ready] ÄÃ£ cleanup ${cleaned} session BC háº¿t háº¡n (guild ${guild.name})`);
    }

    // 2. Re-schedule timer cho session cÃ²n háº¡n
    const activeSessions = db.getActiveBangchienByGuild(guildId);
    for (const session of activeSessions) {
      if (isSessionExpired(session)) continue; // Ä‘Ã£ cleanup á»Ÿ trÃªn

      const day = session.day;
      if (!day) continue;

      // TÃ­nh thá»i gian Ä‘áº¿n 23:00 VN ngÃ y BC
      const vnOffset = 7 * 60;
      const localOffset = new Date().getTimezoneOffset();
      const now = new Date();
      const vnNow = new Date(now.getTime() + (localOffset + vnOffset) * 60 * 1000);

      const targetDayOfWeek = day === 'sat' ? 6 : 0;
      const todayDayOfWeek = vnNow.getDay();

      let daysUntilTarget = targetDayOfWeek - todayDayOfWeek;
      if (daysUntilTarget < 0) daysUntilTarget += 7;

      const cleanupDate = new Date(vnNow);
      cleanupDate.setDate(cleanupDate.getDate() + daysUntilTarget);
      cleanupDate.setHours(23, 0, 0, 0);

      const cleanupUTC = new Date(cleanupDate.getTime() - (localOffset + vnOffset) * 60 * 1000);
      const msUntilCleanup = cleanupUTC.getTime() - Date.now();

      if (msUntilCleanup > 0 && msUntilCleanup < 7 * 24 * 60 * 60 * 1000) {
        const partyKey = session.party_key;
        const channelId = session.channel_id;

        setTimeout(async () => {
          try {
            // Gá»i láº¡i autoCleanupExpiredSessions (vÃ¬ lÃºc nÃ y session Ä‘Ã£ háº¿t háº¡n)
            await autoCleanupExpiredSessions(client, guildId);

            // Gá»­i thÃ´ng bÃ¡o
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (channel) {
              const { EmbedBuilder } = require('discord.js');
              const dayName = DAY_CONFIG[day]?.name || day;
              const embed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle(`âœ… BANG CHIáº¾N ${dayName.toUpperCase()} ÄÃƒ Tá»° Äá»˜NG Káº¾T THÃšC!`)
                .setDescription(`â° ÄÃ£ 23:00 - Bang Chiáº¿n **${dayName}** tá»± Ä‘á»™ng káº¿t thÃºc.`)
                .setTimestamp();
              await channel.send({ embeds: [embed] });
            }
          } catch (e) {
            console.error('[ready] Lá»—i re-scheduled auto-end:', e.message);
          }
        }, msUntilCleanup);

        const hoursUntil = Math.floor(msUntilCleanup / (60 * 60 * 1000));
        const minutesUntil = Math.floor((msUntilCleanup % (60 * 60 * 1000)) / (60 * 1000));
        console.log(`[ready] Re-schedule auto-end BC ${day} sau ${hoursUntil}h${minutesUntil}m (party: ${partyKey})`);
      }
    }
  }

  console.log('[ready] Cleanup + re-schedule BC hoÃ n táº¥t!');
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

async function refreshStoredListbcDetailMessage(guild, day) {
  const { listbcDetailMessages } = require('../../utils/bangchienState');
  const db = require('../../database/db');
  const listbcKey = `${guild.id}_${day}`;
  const storedData = listbcDetailMessages.get(listbcKey);
  if (!storedData?.message) return;

  const freshSession = db.getActiveBangchienByDay(guild.id, day);
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

  await listbcCommand.showDetailedSession(fakeMessage, freshSession, true, day, true);
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

const TEAM_LABELS_SHORT = {
  team_attack1: 'team cÃ´ng 1',
  team_attack2: 'team cÃ´ng 2',
  team_defense: 'team thá»§',
  team_forest: 'team rá»«ng',
  waiting_list: 'hÃ ng chá»'
};

function parseSessionTeamForDiff(value) {
  try {
    return Array.isArray(value) ? value : JSON.parse(value || '[]');
  } catch (e) {
    return [];
  }
}

function parseLeaderIdsForDiff(value) {
  try {
    return typeof value === 'string' ? JSON.parse(value || '{}') : (value || {});
  } catch (e) {
    return {};
  }
}

function parseTeamSizesForDiff(value) {
  try {
    return typeof value === 'string' ? JSON.parse(value || '{}') : (value || {});
  } catch (e) {
    return {};
  }
}

function getRosterDisplayName(member) {
  return member?.gn || member?.game_username || member?.name || member?.username || member?.discord_name || member?.id || 'thÃ nh viÃªn';
}

function buildSessionChangeSummaries(localSession, newData) {
  const actorMeta = parseLeaderIdsForDiff(newData.leader_ids);
  const actorName = actorMeta.editor_name || localSession.leader_name || 'Ai Ä‘Ã³';
  const editorAction = actorMeta.editor_action || 'sync';
  const oldTeams = {
    team_attack1: parseSessionTeamForDiff(localSession.team_attack1),
    team_attack2: parseSessionTeamForDiff(localSession.team_attack2),
    team_defense: parseSessionTeamForDiff(localSession.team_defense),
    team_forest: parseSessionTeamForDiff(localSession.team_forest),
    waiting_list: parseSessionTeamForDiff(localSession.waiting_list)
  };
  const newTeams = {
    team_attack1: parseSessionTeamForDiff(newData.team_attack1),
    team_attack2: parseSessionTeamForDiff(newData.team_attack2),
    team_defense: parseSessionTeamForDiff(newData.team_defense),
    team_forest: parseSessionTeamForDiff(newData.team_forest),
    waiting_list: parseSessionTeamForDiff(newData.waiting_list)
  };
  const oldLeaderIds = {
    team1: localSession.team1_leader_id || null,
    team2: localSession.team2_leader_id || null,
    team3: localSession.team3_leader_id || null,
    team4: localSession.team4_leader_id || null
  };
  const newLeaderIds = {
    team1: actorMeta.team1 || null,
    team2: actorMeta.team2 || null,
    team3: actorMeta.team3 || null,
    team4: actorMeta.team4 || null
  };
  const oldSizes = db.getAllTeamSizes ? db.getAllTeamSizes() : {
    attack1: 10,
    attack2: 10,
    defense: 5,
    forest: 5
  };
  const newSizes = parseTeamSizesForDiff(newData.team_sizes);
  const leaderTeamKeys = {
    team1: 'team_attack1',
    team2: 'team_attack2',
    team3: 'team_defense',
    team4: 'team_forest'
  };

  const leaderMessages = [];
  for (const [leaderKey, teamKey] of Object.entries(leaderTeamKeys)) {
    const beforeId = oldLeaderIds[leaderKey] || null;
    const afterId = newLeaderIds[leaderKey] || null;
    if (beforeId === afterId) continue;
    const target = newTeams[teamKey].find((member) => member.id === afterId);
    if (afterId && target) {
      leaderMessages.push(`${actorName} Ä‘Ã£ Ä‘áº·t ${getRosterDisplayName(target)} lÃ m leader ${TEAM_LABELS_SHORT[teamKey]}.`);
    }
  }

  const sizeMessages = [];
  const sizeKeys = {
    attack1: 'CÃ´ng 1',
    attack2: 'CÃ´ng 2',
    defense: 'Thá»§',
    forest: 'Rá»«ng'
  };
  const hasValidResizeTotal = [newSizes.attack1, newSizes.attack2, newSizes.defense, newSizes.forest]
    .every((value) => Number.isFinite(Number(value)))
    && (Number(newSizes.attack1) + Number(newSizes.attack2) + Number(newSizes.defense) + Number(newSizes.forest) === 30);
  const changedSizes = (editorAction === 'resize' && hasValidResizeTotal)
    ? Object.entries(sizeKeys)
      .filter(([key]) => newSizes[key] !== undefined && newSizes[key] !== oldSizes[key])
      .map(([key, label]) => `${label} ${oldSizes[key]}→${newSizes[key]}`)
    : [];
  if (changedSizes.length) {
    sizeMessages.push(`${actorName} Ä‘Ã£ Ä‘á»•i size Ä‘á»™i hÃ¬nh: ${changedSizes.join(', ')}.`);
  }
  const oldMap = new Map();
  const newMap = new Map();
  Object.entries(oldTeams).forEach(([teamKey, members]) => members.forEach((member) => oldMap.set(member.id, { teamKey, member })));
  Object.entries(newTeams).forEach(([teamKey, members]) => members.forEach((member) => newMap.set(member.id, { teamKey, member })));

  const moveMessages = [];
  for (const [memberId, nextInfo] of newMap.entries()) {
    const prevInfo = oldMap.get(memberId);
    if (!prevInfo) {
      moveMessages.push(`${actorName} Ä‘Ã£ thÃªm ${getRosterDisplayName(nextInfo.member)} vÃ o ${TEAM_LABELS_SHORT[nextInfo.teamKey]}.`);
      continue;
    }
    if (prevInfo.teamKey === nextInfo.teamKey) continue;
    const memberName = getRosterDisplayName(nextInfo.member);
    if (nextInfo.teamKey === 'waiting_list') {
      moveMessages.push(`${actorName} Ä‘Ã£ Ä‘Æ°a ${memberName} vá» hÃ ng chá».`);
    } else if (prevInfo.teamKey === 'waiting_list') {
      moveMessages.push(`${actorName} Ä‘Ã£ Ä‘Æ°a ${memberName} vÃ o ${TEAM_LABELS_SHORT[nextInfo.teamKey]}.`);
    } else {
      moveMessages.push(`${actorName} Ä‘Ã£ di chuyá»ƒn ${memberName} sang ${TEAM_LABELS_SHORT[nextInfo.teamKey]}.`);
    }
  }

  const uniqueMessages = [...new Set([...leaderMessages, ...sizeMessages, ...moveMessages])];
  return uniqueMessages.slice(0, 4);
}

async function sendSessionChangeSummaries(client, guild, session, summaries = []) {
  if (!session?.channel_id || !summaries.length) return;
  const channel = await client.channels.fetch(session.channel_id).catch(() => null);
  if (!channel) return;

  const visible = summaries.slice(0, 2);
  const remaining = summaries.length - visible.length;
  const content = remaining > 0
    ? `${visible.join('\n')}\n...vÃ  ${remaining} thay Ä‘á»•i khÃ¡c.`
    : visible.join('\n');
  await channel.send({ content });
}

const TACTICS_DAY_LABELS = {
  mon: 'Thu 2',
  tue: 'Thu 3',
  wed: 'Thu 4',
  thu: 'Thu 5',
  fri: 'Thu 6',
  sat: 'Thu 7',
  sun: 'Chu Nhat'
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

async function sendTacticsSaveNotice(client, guild, historyEntry) {
  if (!historyEntry?.day) return;
  const meta = historyEntry?.markers?._history_meta || {};
  if (meta.action !== 'save') return;

  const session = db.getActiveBangchienByDay(guild.id, historyEntry.day);
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
    ? `${actorName} da luu chien thuat "${strategyName}" cho ${sessionLabel}.`
    : `${actorName} da luu chien thuat cho ${sessionLabel}.`;

  await channel.send({ content });
}

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`Bot ${client.user.tag} Ä‘Ã£ online!`);

    // Migrate old display roles sang tÃªn má»›i (âœ¦)
    await migrateDisplayRoles(client);

    // âœ… Kiá»ƒm tra thÃ nh viÃªn cÃ²n trong Discord khÃ´ng
    await checkMemberPresence(client);
    await seedKcMembersIntoBotData(client);

    // âœ… Äá»“ng bá»™ láº¡i position tá»« role Discord tháº­t -> SQLite/Supabase
    await refreshUserPositionsFromDiscord(client);

    // âœ… Auto-cleanup session BC háº¿t háº¡n + re-schedule timer
    await cleanupAndRescheduleBc(client);

    // âœ… Khá»Ÿi táº¡o Supabase sync cho Web Bang Chiáº¿n
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
        await supaSync.syncAllActiveSessions(db, guild.id, guild);
        console.log('[Supabase] ÄÃ£ sync sessions khi start');

        // Sync táº¥t cáº£ users lÃªn Supabase bc_users
        try {
          const allUsers = db.getAllUsers ? db.getAllUsers() : [];
          if (allUsers.length > 0) {
            await supaSync.syncUsers(allUsers, guild.id);
            console.log(`[Supabase] ÄÃ£ sync ${allUsers.length} users khi start`);
          }
        } catch (userSyncErr) {
          console.error('[Supabase] Lá»—i sync users:', userSyncErr.message);
        }

        // Láº¯ng nghe thay Ä‘á»•i tá»« web â†’ sync ngÆ°á»£c vá» SQLite + xoÃ¡ role
        // Há»— trá»£ INSERT (táº¡o má»›i), UPDATE (thay Ä‘á»•i danh sÃ¡ch) vÃ  DELETE (xÃ³a session)
        supaSync.listenForWebChanges(guild.id, async (newData) => {
          // â•â•â• CASE: INSERT session tá»« web â•â•â•
          if (newData._inserted) {
            try {
              const { bangchienNotifications, bangchienRegistrations, bangchienChannels, DAY_CONFIG, createPartyKey, refreshOverviewEmbed } = require('../../utils/bangchienState');
              const day = newData.day;
              const dayConfig = DAY_CONFIG[day];
              if (!dayConfig) { console.log(`[Supabase] âš ï¸ NgÃ y khÃ´ng há»£p lá»‡: ${day}`); return; }

              // Kiá»ƒm tra Ä‘Ã£ cÃ³ session cho ngÃ y nÃ y chÆ°a
              const existing = db.getActiveBangchienByDay(guild.id, day);
              if (existing) { console.log(`[Supabase] âš ï¸ Session ${day} Ä‘Ã£ tá»“n táº¡i trong SQLite, bá» qua INSERT`); return; }

              // Láº¥y kÃªnh BC Ä‘Ã£ set báº±ng ?setbc
              const bcChannelId = db.getConfig(`bc_channel_${guild.id}`);
              if (!bcChannelId) {
                console.log(`[Supabase] âš ï¸ ChÆ°a set kÃªnh BC (?setbc). KhÃ´ng thá»ƒ táº¡o session tá»« web.`);
                return;
              }

              // Táº¡o party key
              const partyKey = createPartyKey(guild.id, day, 'web');

              // Parse creator name tá»« leader_ids
              const leaderIds = typeof newData.leader_ids === 'string' ? JSON.parse(newData.leader_ids || '{}') : (newData.leader_ids || {});
              const creatorName = leaderIds.creator_name || 'Web';
              const creatorId = leaderIds.creator_id || 'web';

              // Táº¡o session trong SQLite
              db.createActiveBangchien({
                guildId: guild.id,
                partyKey,
                leaderId: creatorId,
                leaderName: creatorName,
                channelId: bcChannelId,
                messageId: null,
                day: day,
                time: newData.time || '19:30',
                note: newData.note || null
              });

              // Khá»Ÿi táº¡o trong memory
              bangchienRegistrations.set(partyKey, []);
              bangchienNotifications.set(partyKey, {
                intervalId: null,
                channelId: bcChannelId,
                leaderId: creatorId,
                leaderName: creatorName,
                messageId: null,
                message: null,
                startTime: Date.now(),
                day: day
              });
              bangchienChannels.set(guild.id, bcChannelId);

              // Auto-add regular participants
              const regulars = db.getBcRegulars(guild.id, day);
              let addedCount = 0;
              for (const reg of regulars) {
                const userData = db.getUserByDiscordId(reg.discord_id);
                if (userData && userData.left_at) {
                  db.removeBcRegular(guild.id, reg.discord_id, day);
                  continue;
                }
                const result = db.addBangchienParticipant(partyKey, {
                  id: reg.discord_id,
                  username: reg.username,
                  gn: userData?.game_username || '',
                  name: (userData?.game_username) || reg.username,
                  joinedAt: Date.now(),
                  isLeader: false,
                  isRegular: true
                });
                if (result.success) {
                  addedCount++;
                  const regs = bangchienRegistrations.get(partyKey) || [];
                  regs.push({ id: reg.discord_id, username: reg.username, gn: userData?.game_username || '', name: (userData?.game_username) || reg.username, joinedAt: Date.now(), isLeader: false, isRegular: true });
                  bangchienRegistrations.set(partyKey, regs);

                  // Cáº¥p role BC
                  const bcRole = guild.roles.cache.find(r => r.name === 'bc');
                  if (bcRole) {
                    try {
                      const member = await guild.members.fetch(reg.discord_id).catch(() => null);
                      if (member && !member.roles.cache.has(bcRole.id)) await member.roles.add(bcRole);
                    } catch (e) { }
                  }
                }
              }

              // Sync láº¡i Supabase vá»›i regulars (náº¿u cÃ³)
              if (addedCount > 0) {
                const updatedSession = db.getActiveBangchien(partyKey);
                if (updatedSession) {
                  const formatted = supaSync.formatActiveSession(updatedSession, db, guild);
                  if (formatted) await supaSync.syncBCSession(guild.id, day, formatted);
                }
              }

              // Gá»­i thÃ´ng bÃ¡o vÃ o kÃªnh
              const channel = await client.channels.fetch(bcChannelId).catch(() => null);
              if (channel) {
                const { EmbedBuilder } = require('discord.js');
                const noteStr = newData.note ? ` â€” _${newData.note}_` : '';
                const embed = new EmbedBuilder()
                  .setColor(dayConfig.color)
                  .setTitle(`ðŸ†• BANG CHIáº¾N ${dayConfig.name.toUpperCase()} ÄÃƒ Má»ž!`)
                  .setDescription(`ðŸ“± ÄÆ°á»£c táº¡o tá»« **${creatorName}**${noteStr}\nâ° Thá»i gian: **${newData.time || '19:30'}**\n\n` +
                    `${addedCount > 0 ? `âœ… ÄÃ£ tá»± Ä‘á»™ng thÃªm **${addedCount}** ngÆ°á»i tham gia thÆ°á»ng xuyÃªn\n\n` : ''}` +
                    `ðŸ’¡ DÃ¹ng \`?bc\` Ä‘á»ƒ xem tá»•ng quan hoáº·c Ä‘Äƒng kÃ½ trÃªn web.`)
                  .setTimestamp();
                await channel.send({ embeds: [embed] });
              }

              // Gá»­i overview embed (báº£ng tá»•ng quan) ngay sau thÃ´ng bÃ¡o
              // Náº¿u Ä‘Ã£ cÃ³ overview â†’ xÃ³a cÅ© rá»“i gá»­i má»›i. Náº¿u chÆ°a cÃ³ â†’ táº¡o má»›i luÃ´n.
              const { createOverviewEmbed, createOverviewButton } = require('../../commands/bangchien/bangchien');
              const { bangchienOverviews } = require('../../utils/bangchienState');
              
              // XÃ³a overview cÅ© náº¿u cÃ³
              const existingOverview = bangchienOverviews.get(guild.id);
              if (existingOverview) {
                try { if (existingOverview.message) await existingOverview.message.delete(); } catch (e) { }
              }
              
              // Gá»­i overview embed má»›i vÃ o kÃªnh BC
              if (channel) {
                const overviewEmbed = createOverviewEmbed(guild.id, guild);
                const overviewButton = createOverviewButton(guild.id);
                const sendOptions = { embeds: [overviewEmbed] };
                if (overviewButton) sendOptions.components = [overviewButton];
                const overviewMsg = await channel.send(sendOptions);
                
                // LÆ°u vÃ o Map Ä‘á»ƒ cÃ¡c handler khÃ¡c cÃ³ thá»ƒ refresh
                bangchienOverviews.set(guild.id, {
                  messageId: overviewMsg.id,
                  channelId: bcChannelId,
                  message: overviewMsg
                });
              }

              // Cáº­p nháº­t lá»‹ch tuáº§n
              try {
                const { refreshScheduleEmbed } = require('../../commands/thongbao/thongbaoguild');
                await refreshScheduleEmbed(client, guild.id, null, 'resend');
              } catch (e) { }

              console.log(`[Supabase] âœ… Web INSERT â†’ táº¡o SQLite session ${day}, ${addedCount} regulars, thÃ´ng bÃ¡o #${channel?.name || bcChannelId}`);
            } catch (err) {
              console.error('[Supabase] âŒ Xá»­ lÃ½ web INSERT lá»—i:', err.message);
            }
            return;
          }

          // â•â•â• CASE: DELETE session tá»« web â•â•â•
          if (newData._deleted) {
            try {
              const { bangchienNotifications, bangchienRegistrations, bangchienChannels, getGuildBangchienKeys } = require('../../utils/bangchienState');
              const sessions = db.getActiveBangchienByGuild(guild.id);

              // TÃ¬m session(s) cáº§n xÃ³a
              let sessionsToDelete = [];
              if (newData._deleted_unknown && newData.remainingDays) {
                const remainingSet = new Set(newData.remainingDays);
                sessionsToDelete = sessions.filter(s => !remainingSet.has(s.day));
                console.log(`[Supabase] ðŸ—‘ï¸ Fallback DELETE: tÃ¬m ${sessionsToDelete.length} session cáº§n xÃ³a`);
              } else if (newData.day) {
                const found = sessions.find(s => s.day === newData.day);
                if (found) sessionsToDelete = [found];
                console.log(`[Supabase] ðŸ—‘ï¸ Web Ä‘Ã£ xÃ³a BC session ${newData.day}`);
              }

              for (const localSession of sessionsToDelete) {
                const partyKey = localSession.party_key;

                const participants = [
                  ...(localSession.team_attack1 || []),
                  ...(localSession.team_attack2 || []),
                  ...(localSession.team_defense || []),
                  ...(localSession.team_forest || [])
                ];
                const bcRole = guild.roles.cache.find(r => r.name === 'bc');
                if (bcRole && participants.length > 0) {
                  for (const p of participants) {
                    try {
                      const member = await guild.members.fetch(p.id).catch(() => null);
                      if (member && member.roles.cache.has(bcRole.id)) {
                        await member.roles.remove(bcRole);
                        console.log(`[Supabase] ðŸ”„ ÄÃ£ xoÃ¡ role BC cho ${member.user.username} (web delete)`);
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

                db.deleteActiveBangchien(partyKey);
                console.log(`[Supabase] âœ… ÄÃ£ xÃ³a SQLite session ${localSession.day} (web delete)`);
              }

              const remaining = getGuildBangchienKeys(guild.id);
              if (remaining.length === 0) bangchienChannels.delete(guild.id);

              const { refreshOverviewEmbed } = require('../../utils/bangchienState');
              await refreshOverviewEmbed(client, guild.id);
            } catch (err) {
              console.error('[Supabase] âŒ Xá»­ lÃ½ web DELETE lá»—i:', err.message);
            }
            return;
          }

          // â•â•â• CASE: UPDATE session tá»« web â•â•â•
          console.log(`[Supabase] ðŸ”„ Web Ä‘Ã£ sá»­a BC session (${newData.day})`);
          try {
            const sessions = db.getActiveBangchienByGuild(guild.id);
            const localSession = sessions.find(s => s.day === newData.day);
            if (!localSession) return;
            const sessionChangeSummaries = buildSessionChangeSummaries(localSession, newData);

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

            const nextSizeTotal = Number(nextSizes.attack1 ?? 0) + Number(nextSizes.attack2 ?? 0) + Number(nextSizes.defense ?? 0) + Number(nextSizes.forest ?? 0);
            if ((leaderIds.editor_action || 'sync') === 'resize' && nextSizeTotal === 30) {
              if (nextSizes.attack1 !== undefined) db.setTeamSize('attack1', nextSizes.attack1);
              if (nextSizes.attack2 !== undefined) db.setTeamSize('attack2', nextSizes.attack2);
              if (nextSizes.defense !== undefined) db.setTeamSize('defense', nextSizes.defense);
              if (nextSizes.forest !== undefined) db.setTeamSize('forest', nextSizes.forest);
            }

            const localAllIds = new Set([
              ...localSession.team_attack1, ...localSession.team_attack2,
              ...localSession.team_defense, ...localSession.team_forest,
              ...localSession.waiting_list
            ].map(p => p.id));
            const supaAllIds = new Set([
              ...supaTeams.team_attack1, ...supaTeams.team_attack2,
              ...supaTeams.team_defense, ...supaTeams.team_forest,
              ...supaTeams.waiting_list
            ].map(p => p.id));

            const removedIds = [...localAllIds].filter(id => !supaAllIds.has(id));

            const updateStmt = db.db.prepare(`
              UPDATE bangchien_active
              SET team_attack1=?, team_attack2=?, team_defense=?, team_forest=?, waiting_list=?,
                  team1_leader_id=?, team2_leader_id=?, team3_leader_id=?, team4_leader_id=?,
                  commander_id=?, note=?, time=?, updated_at=CURRENT_TIMESTAMP
              WHERE party_key=?
            `);
            updateStmt.run(
              JSON.stringify(supaTeams.team_attack1),
              JSON.stringify(supaTeams.team_attack2),
              JSON.stringify(supaTeams.team_defense),
              JSON.stringify(supaTeams.team_forest),
              JSON.stringify(supaTeams.waiting_list),
              leaderIds.team1 || null,
              leaderIds.team2 || null,
              leaderIds.team3 || null,
              leaderIds.team4 || null,
              leaderIds.commander || localSession.commander_id || null,
              newData.note || '',
              newData.time || '19:30',
              localSession.party_key
            );
            console.log(`[Supabase] âœ… ÄÃ£ sync ngÆ°á»£c SQLite cho BC ${newData.day}`);

            if (removedIds.length > 0) {
              const bcRole = guild.roles.cache.find(r => r.name === 'bc');
              if (bcRole) {
                for (const userId of removedIds) {
                  try {
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (member && member.roles.cache.has(bcRole.id)) {
                      await member.roles.remove(bcRole);
                      console.log(`[Supabase] ðŸ”„ ÄÃ£ xoÃ¡ role BC cho ${member.user.username} (web cancel)`);
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
              await refreshStoredListbcDetailMessage(guild, newData.day).catch((e) => {
                console.error('[Supabase] Khong refresh duoc listbc detail:', e.message);
              });
              await sendSessionChangeSummaries(client, guild, freshSession, sessionChangeSummaries).catch((e) => {
                console.error('[Supabase] Khong gui duoc thong bao doi hinh:', e.message);
              });
            }

          } catch (syncBackErr) {
            console.error('[Supabase] âŒ Sync ngÆ°á»£c lá»—i:', syncBackErr.message);
          }
        });
      }
    }

    // Khá»Ÿi táº¡o notifications tá»« file
    thongbao.initializeNotifications(client);

    // Khá»Ÿi táº¡o YenTiec Time Change Reminder
    // Tá»± Ä‘á»™ng láº¥y channel ID tá»« YenTiec notification Ä‘Ã£ lÆ°u
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
      console.log(`[yentiecReminder] Initialized with channel ${yentiecChannelId}`);
    } else {
      console.log('[yentiecReminder] No YenTiec notification found, skipping');
    }

    // Set status ban Ä‘áº§u (random)
    client.user.setPresence({
      activities: [getRandomStatus()],
      status: 'online',
    });

    // Random status má»—i 30 giÃ¢y
    setInterval(() => {
      client.user.setPresence({
        activities: [getRandomStatus()],
        status: 'online',
      });
    }, 30 * 1000); // 30 giÃ¢y
  }
};
