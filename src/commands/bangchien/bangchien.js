const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const {
    bangchienNotifications,
    bangchienRegistrations,
    BANGCHIEN_MAX_MEMBERS,
    BANGCHIEN_MAX_PARTIES,
    getGuildBangchienKeys,
    getUserBangchienParty,
    bangchienChannels,
    bangchienOverviews,
    bcRefreshTimers,
    BC_REFRESH_DEBOUNCE,
    // Multi-day
    DAY_CONFIG,
    DAY_ALIASES,
    PRIMARY_DAYS,
    parseDayArg,
    createPartyKey,
    getDayFromPartyKey,
    getDayNameWithDate,
    normalizeBcTime,
    isLeagueSession,
    LEAGUE_TIME,
    refreshOverviewEmbed,
    // Auto-cleanup
    autoCleanupExpiredSessions
} = require('../../utils/bangchienState');
const bangchienRoster = require('../../utils/bangchienRoster');


// Táº¡o embed thĂ´ng bĂ¡o bang chiáº¿n - HIá»‚N THá» 4 TEAM
function createBangchienEmbed(partyKey, leaderName, guild = null) {
    const db = require('../../database/db');

    // DYNAMIC TEAM SIZES - Äá»“ng bá»™ vá»›i ?bcsize
    const TEAM_ATTACK1_SIZE = db.getTeamSize('attack1') || 10;
    const TEAM_ATTACK2_SIZE = db.getTeamSize('attack2') || 10;
    const TEAM_DEFENSE_SIZE = db.getTeamSize('defense') ?? 5;
    const TEAM_FOREST_SIZE = db.getTeamSize('forest') ?? 5;

    // Láº¥y data tá»« DB
    let teamAttack1 = [];
    let teamAttack2 = [];
    let teamDefense = [];
    let teamForest = [];
    let waitingList = [];

    const activeSession = db.getActiveBangchien(partyKey);
    if (activeSession) {
        teamAttack1 = activeSession.team_attack1 || [];
        teamAttack2 = activeSession.team_attack2 || [];
        teamDefense = activeSession.team_defense || [];
        teamForest = activeSession.team_forest || [];
        waitingList = activeSession.waiting_list || [];
    }

    // Role emojis
    const roleEmojis = { 'DPS': 'đŸ”µ', 'Quáº¡t DĂ¹': 'đŸ”µ', 'VĂ´ Danh': 'đŸ”µ', 'Song Äao': 'đŸ”µ', 'Cá»­u Kiáº¿m': 'đŸ”µ', 'Healer': 'đŸŸ¢', 'Tanker': 'đŸŸ ' };
    const dpsSubTypeRoles = ['Quáº¡t DĂ¹', 'VĂ´ Danh', 'Song Äao', 'Cá»­u Kiáº¿m'];
    const allRoleNames = ['DPS', 'Healer', 'Tanker'];
    const dpsShortTags = { 'Quáº¡t DĂ¹': 'QD', 'VĂ´ Danh': 'VD', 'Song Äao': 'SD', 'Cá»­u Kiáº¿m': '9K' };

    // Helper: láº¥y role - Æ¯U TIĂN Healer/Tanker trÆ°á»›c DPS
    function getMemberRole(memberId) {
        if (!guild) return null;
        try {
            const member = guild.members.cache.get(memberId);
            if (!member) return null;

            // Check Healer vĂ  Tanker TRÆ¯á»C (Æ°u tiĂªn cao hÆ¡n)
            const healerRole = guild.roles.cache.find(r => r.name === 'Healer');
            if (healerRole && member.roles.cache.has(healerRole.id)) return 'Healer';

            const tankerRole = guild.roles.cache.find(r => r.name === 'Tanker');
            if (tankerRole && member.roles.cache.has(tankerRole.id)) return 'Tanker';

            // Check DPS sub-types
            for (const subTypeName of dpsSubTypeRoles) {
                const role = guild.roles.cache.find(r => r.name === subTypeName);
                if (role && member.roles.cache.has(role.id)) return 'DPS';
            }

            // Check DPS role
            const dpsRole = guild.roles.cache.find(r => r.name === 'DPS');
            if (dpsRole && member.roles.cache.has(dpsRole.id)) return 'DPS';
        } catch (e) { }
        return null;
    }

    // Helper: format má»™t ngÆ°á»i
    function formatMember(r, index) {
        const userData = db.getUserByDiscordId(r.id);
        const gameName = userData?.game_username || null;
        // LUĂ”N detect role tá»« Discord (khĂ´ng fallback sang role DB)
        const role = getMemberRole(r.id);
        const roleDisplay = role ? roleEmojis[role] : 'â“';

        let subTypeTag = '';
        if (role === 'DPS' && guild) {
            const member = guild.members.cache.get(r.id);
            if (member) {
                for (const [subName, shortTag] of Object.entries(dpsShortTags)) {
                    const subRole = guild.roles.cache.find(rl => rl.name === subName);
                    if (subRole && member.roles.cache.has(subRole.id)) {
                        subTypeTag = `[${shortTag}]`;
                        break;
                    }
                }
            }
        }

        const nameDisplay = gameName ? `<@${r.id}> (${gameName})` : `<@${r.id}>`;
        const leaderIcon = r.isTeamLeader ? ' đŸ‘‘' : '';
        return `${index}. ${roleDisplay}${subTypeTag} ${nameDisplay}${leaderIcon}`;
    }

    // Helper: tĂ­nh stats
    function getTeamStats(team) {
        let stats = { healer: 0, tanker: 0, dps: 0, unknown: 0 };
        team.forEach(p => {
            // LUĂ”N detect role tá»« Discord (khĂ´ng fallback sang role DB)
            const role = getMemberRole(p.id);
            if (role === 'Healer') stats.healer++;
            else if (role === 'Tanker') stats.tanker++;
            else if (role === 'DPS') stats.dps++;
            else stats.unknown++;
        });
        return stats;
    }

    // Helper: format stats text
    function formatStats(stats) {
        let text = `đŸŸ¢${stats.healer} đŸŸ ${stats.tanker} đŸ”µ${stats.dps}`;
        if (stats.unknown > 0) text += ` â“${stats.unknown}`;
        return text;
    }

    // Helper: chia list dĂ i
    function splitListIntoChunks(list, maxLength = 1000) {
        const chunks = [];
        let currentChunk = '';
        const lines = list.split('\n');
        for (const line of lines) {
            if ((currentChunk + '\n' + line).length > maxLength && currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = line;
            } else {
                currentChunk = currentChunk ? currentChunk + '\n' + line : line;
            }
        }
        if (currentChunk) chunks.push(currentChunk);
        return chunks;
    }

    // Helper: add team field to embed (chá»‰ hiá»‡n 1 slot trá»‘ng náº¿u chÆ°a Ä‘áº§y)
    function addTeamField(embed, teamName, emoji, team, maxSize, startNum) {
        const stats = getTeamStats(team);
        const statsText = formatStats(stats);

        // Táº¡o danh sĂ¡ch: members + 1 slot trá»‘ng (náº¿u chÆ°a Ä‘áº§y)
        const lines = [];
        for (let i = 0; i < team.length; i++) {
            lines.push(formatMember(team[i], startNum + i));
        }
        // Chá»‰ thĂªm 1 slot trá»‘ng náº¿u team chÆ°a Ä‘áº§y
        if (team.length < maxSize) {
            const nextSlot = startNum + team.length;
            lines.push(`${nextSlot}. _Trá»‘ng..._`);
        }

        const list = lines.join('\n') || '_Trá»‘ng..._';
        const chunks = splitListIntoChunks(list);
        chunks.forEach((chunk, index) => {
            embed.addFields({
                name: index === 0 ? `${emoji} ${teamName} (${team.length}/${maxSize}) [${statsText}]` : 'â€‹',
                value: chunk,
                inline: false
            });
        });

        return maxSize; // Return maxSize Ä‘á»ƒ sá»‘ thá»© tá»± liĂªn tá»¥c
    }

    // Láº¥y mĂ u vĂ  tĂªn ngĂ y tá»« partyKey
    const day = getDayFromPartyKey(partyKey);
    const dayConfig = day ? DAY_CONFIG[day] : { name: '', color: 0x9B59B6 };
    const dayTitle = day ? ` - ${getDayNameWithDate(day)}` : '';

    const embed = new EmbedBuilder()
        .setColor(dayConfig.color)
        .setTitle(`â”ï¸ ÄÄ‚NG KĂ BANG CHIáº¾N LANG GIA${dayTitle}`)
        .setDescription('â“ = ChÆ°a dĂ¹ng `?pickrole` Ä‘á»ƒ chá»n vai trĂ²\n`?bcdoi <sá»‘1> <sá»‘2>` Ä‘á»ƒ Ä‘á»•i chá»—');

    // Láº¥y tĂªn team tĂ¹y chá»‰nh
    const teamNames = db.getTeamNames ? db.getTeamNames() : {
        attack1: 'TEAM CĂ”NG 1', attack2: 'TEAM CĂ”NG 2',
        defense: 'TEAM THá»¦', forest: 'TEAM Rá»ªNG'
    };

    // Team CĂ´ng 1: 1-10
    let currentNum = 1;
    const dynamicRoster = bangchienRoster.normalizeRoster(activeSession || {
        team_attack1: teamAttack1,
        team_attack2: teamAttack2,
        team_defense: teamDefense,
        team_forest: teamForest,
        waiting_list: waitingList
    });
    for (const team of dynamicRoster.layout) {
        currentNum += addTeamField(embed, team.name, team.icon || 'â€¢', dynamicRoster.teams[team.id] || [], team.capacity, currentNum);
    }
    if (false) {
    currentNum += addTeamField(embed, teamNames.attack1, 'â”ï¸', teamAttack1, TEAM_ATTACK1_SIZE, currentNum);

    // Team CĂ´ng 2: 11-20
    currentNum += addTeamField(embed, teamNames.attack2, 'đŸ—¡ï¸', teamAttack2, TEAM_ATTACK2_SIZE, currentNum);

    // Team Thá»§: chá»‰ hiá»‡n náº¿u size > 0
    if (TEAM_DEFENSE_SIZE > 0) {
        currentNum += addTeamField(embed, teamNames.defense, 'đŸ›¡ï¸', teamDefense, TEAM_DEFENSE_SIZE, currentNum);
    } else {
        // Váº«n cá»™ng maxSize Ä‘á»ƒ giá»¯ sá»‘ thá»© tá»± liĂªn tá»¥c
        currentNum += TEAM_DEFENSE_SIZE;
    }

    // Team Rá»«ng: chá»‰ hiá»‡n náº¿u size > 0
    if (TEAM_FOREST_SIZE > 0) {
        currentNum += addTeamField(embed, teamNames.forest, 'đŸŒ²', teamForest, TEAM_FOREST_SIZE, currentNum);
    } else {
        currentNum += TEAM_FOREST_SIZE;
    }
    }


    // Danh sĂ¡ch chá»
    if (waitingList.length > 0) {
        const waitList = waitingList.map((r, i) => formatMember(r, currentNum + i)).join('\n');
        const waitChunks = splitListIntoChunks(waitList);
        waitChunks.forEach((chunk, index) => {
            embed.addFields({
                name: index === 0 ? `â³ Danh sĂ¡ch chá» (${waitingList.length})` : 'â€‹',
                value: chunk,
                inline: false
            });
        });
    }

    const total = teamAttack1.length + teamAttack2.length + teamDefense.length + teamForest.length + waitingList.length;
    embed.setFooter({ text: `Leader: ${leaderName} â€¢ Tá»•ng: ${total}/30 ngÆ°á»i` })
        .setTimestamp();

    return embed;
}

// Táº¡o buttons cĂ´ng khai (cho táº¥t cáº£ ngÆ°á»i dĂ¹ng tháº¥y)
function createBangchienButtons(partyKey, day = null) {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`bangchien_join_${partyKey}`)
                .setLabel('âœ… Tham gia')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`bangchien_leave_${partyKey}`)
                .setLabel('âŒ Há»§y Ä‘Äƒng kĂ½')
                .setStyle(ButtonStyle.Secondary),
        );
    return row;
}

// Táº¡o buttons quáº£n lĂ½ (chá»‰ Leader tháº¥y qua ?bcql)
function createBangchienAdminButtons(partyKey) {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`bangchien_kick_${partyKey}`)
                .setLabel('âŒ Loáº¡i bá»')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`bangchien_priority_${partyKey}`)
                .setLabel('â¬†ï¸ Æ¯u tiĂªn')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`bangchien_finalize_${partyKey}`)
                .setLabel('đŸ“‹ Chá»‘t DS')
                .setStyle(ButtonStyle.Success)
        );

    return row;
}

// Fetch táº¥t cáº£ BC members vĂ o cache (gá»i 1 láº§n khi khĂ´i phá»¥c session sau restart)
async function fetchBcMembers(guild, participants) {
    if (!guild || !participants || participants.length === 0) return;
    try {
        const memberIds = participants.map(p => p.id);
        await guild.members.fetch({ user: memberIds, force: true });
        console.log(`[bangchien] Fetched ${memberIds.length} members into cache`);
    } catch (e) {
        console.error('[bangchien] Error fetching members:', e.message);
    }
}


    // Danh sĂ¡ch chá»
    if (waitingList.length > 0) {
        const waitList = waitingList.map((r, i) => formatMember(r, currentNum + i)).join('\n');
        const waitChunks = splitListIntoChunks(waitList);
        waitChunks.forEach((chunk, index) => {
            embed.addFields({
                name: index === 0 ? `â³ Danh sĂ¡ch chá» (${waitingList.length})` : 'â€‹',
                value: chunk,
                inline: false
            });
        });
    }

    const total = teamAttack1.length + teamAttack2.length + teamDefense.length + teamForest.length + waitingList.length;
    embed.setFooter({ text: `Leader: ${leaderName} â€¢ Tá»•ng: ${total}/30 ngÆ°á»i` })
        .setTimestamp();

    return embed;
}

// Táº¡o buttons cĂ´ng khai (cho táº¥t cáº£ ngÆ°á»i dĂ¹ng tháº¥y)
function createBangchienButtons(partyKey, day = null) {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`bangchien_join_${partyKey}`)
                .setLabel('âœ… Tham gia')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`bangchien_leave_${partyKey}`)
                .setLabel('âŒ Há»§y Ä‘Äƒng kĂ½')
                .setStyle(ButtonStyle.Secondary),
        );
    return row;
}

// Táº¡o buttons quáº£n lĂ½ (chá»‰ Leader tháº¥y qua ?bcql)
function createBangchienAdminButtons(partyKey) {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`bangchien_kick_${partyKey}`)
                .setLabel('âŒ Loáº¡i bá»')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`bangchien_priority_${partyKey}`)
                .setLabel('â¬†ï¸ Æ¯u tiĂªn')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`bangchien_finalize_${partyKey}`)
                .setLabel('đŸ“‹ Chá»‘t DS')
                .setStyle(ButtonStyle.Success)
        );

    return row;
}

// Fetch táº¥t cáº£ BC members vĂ o cache (gá»i 1 láº§n khi khĂ´i phá»¥c session sau restart)
async function fetchBcMembers(guild, participants) {
    if (!guild || !participants || participants.length === 0) return;
    try {
        const memberIds = participants.map(p => p.id);
        await guild.members.fetch({ user: memberIds, force: true });
        console.log(`[bangchien] Fetched ${memberIds.length} members into cache`);
    } catch (e) {
        console.error('[bangchien] Error fetching members:', e.message);
    }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MULTI-DAY OVERVIEW FUNCTIONS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function createOverviewEmbed(guildId, guild = null, userId = null) {
    const db = require('../../database/db');
    const allSessions = db.getActiveBangchienByGuild(guildId)
        .filter(s => s?.day && DAY_CONFIG[s.day])
        .sort((a, b) => {
            const aPrimary = PRIMARY_DAYS.includes(a.day) ? 0 : 1;
            const bPrimary = PRIMARY_DAYS.includes(b.day) ? 0 : 1;
            if (aPrimary !== bPrimary) return aPrimary - bPrimary;
            const aDayIndex = Object.keys(DAY_CONFIG).indexOf(a.day);
            const bDayIndex = Object.keys(DAY_CONFIG).indexOf(b.day);
            if (aDayIndex !== bDayIndex) return aDayIndex - bDayIndex;
            return normalizeBcTime(a.time || LEAGUE_TIME).localeCompare(normalizeBcTime(b.time || LEAGUE_TIME));
        });

    const byDay = {}, dayOrder = [];
    for (const s of allSessions) {
        if (!byDay[s.day]) { byDay[s.day] = []; dayOrder.push(s.day); }
        byDay[s.day].push(s);
    }
    const joinedCount = allSessions.filter(s => isUserInSession(s, userId)).length;

    const embed = new EmbedBuilder()
        .setColor(joinedCount > 0 ? 0x22C55E : 0xFFD700)
        .setTitle('\u2694\ufe0f  Bang Chiáº¿n Lang Gia')
        .setDescription(allSessions.length > 0
            ? '> Báº¥m **ÄÄƒng kĂ½** bĂªn dÆ°á»›i Ä‘á»ƒ chá»n tráº­n tham gia.'
            : '> ChÆ°a cĂ³ phiĂªn Bang Chiáº¿n nĂ o Ä‘ang má»Ÿ.');

    for (const day of dayOrder) {
        const lines = byDay[day].map(session => {
            const timeStr = normalizeBcTime(session.time || LEAGUE_TIME);
            const counts  = bangchienRoster.getRosterCounts(session);
            const total   = counts.active, waiting = counts.waiting;
            const league  = isLeagueSession(session) ? ' \u00b7 `LEAGUE`' : '';
            const waitStr = waiting > 0 ? ` _(+${waiting} chá»)_` : '';
            const filled  = Math.round((total / 30) * 8);
            const bar     = '[' + '\u2588'.repeat(filled) + '\u2591'.repeat(8 - filled) + ']';
            return isUserInSession(session, userId)
                ? `\u2705 **${timeStr}**${league}  ${bar}  \`${total}/30\`${waitStr}  \u2190 _ÄĂ£ Ä‘Äƒng kĂ½_`
                : `\u25ab\ufe0f **${timeStr}**${league}  ${bar}  \`${total}/30\`${waitStr}`;
        });
        embed.addFields({ name: `\ud83d\udcc5 ${getDayNameWithDate(day)}`, value: lines.join('\n'), inline: false });
    }

    if (dayOrder.length === 0) {
        embed.addFields({ name: '\u200b', value: '_ChÆ°a cĂ³ phiĂªn Bang Chiáº¿n nĂ o Ä‘ang má»Ÿ._', inline: false });
    }
    if (userId && joinedCount > 0) {
        embed.setFooter({ text: `\u2705 Báº¡n Ä‘Ă£ Ä‘Äƒng kĂ½ ${joinedCount}/${allSessions.length} tráº­n` });
    } else if (allSessions.length > 0) {
        embed.setFooter({ text: `Tá»•ng ${allSessions.length} tráº­n Ä‘ang má»Ÿ  â€¢  Báº¥m ÄÄƒng kĂ½ Ä‘á»ƒ tham gia` });
    }
    embed.setTimestamp();
    return embed;
}

function createOverviewButton(guildId) {
    const db = require('../../database/db');
    const allSessions = db.getActiveBangchienByGuild(guildId);
    const webButton = new ButtonBuilder()
        .setLabel('đŸŒ Truy cáº­p WEB')
        .setStyle(ButtonStyle.Link)
        .setURL('https://langgiawar.vercel.app/');
    if (allSessions.length === 0) {
        return new ActionRowBuilder().addComponents(webButton);
    }
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`bc_menu_${guildId}`)
            .setLabel('đŸ“‹ ÄÄƒng kĂ½ BANG CHIáº¾N')
            .setStyle(ButtonStyle.Primary),
        webButton
    );
}

// Helper: kiá»ƒm tra userId cĂ³ trong session khĂ´ng
function isUserInSession(session, userId) {
    if (!userId) return false;
    const allMembers = bangchienRoster.getAllRosterMembers(session);
    return allMembers.some(m => m.id === userId);
}
/**
 * Debounced refresh BC overview embed
 * Khi cĂ³ tin nháº¯n má»›i trong kĂªnh BC â†’ clear timer cÅ© â†’ set timer 5 phĂºt
 * Khi timer háº¿t â†’ xĂ³a embed cÅ©, gá»­i embed má»›i á»Ÿ cuá»‘i kĂªnh
 * @param {Client} client - Discord client
 * @param {string} guildId - Guild ID
 */
function refreshBcOverviewDebounced(client, guildId) {
    const db = require('../../database/db');
    const overviewData = bangchienOverviews.get(guildId);
    if (!overviewData) return;

    // Kiá»ƒm tra cĂ³ session Ä‘ang má»Ÿ khĂ´ng (báº¥t ká»³ ngĂ y nĂ o)
    const allSessions = db.getActiveBangchienByGuild(guildId);
    if (allSessions.length === 0) return;

    // Clear timer cÅ©
    const existingTimer = bcRefreshTimers.get(guildId);
    if (existingTimer) clearTimeout(existingTimer);

    // Set timer má»›i (5 phĂºt)
    const timeoutId = setTimeout(async () => {
        try {
            const data = bangchienOverviews.get(guildId);
            if (!data) return;

            // XĂ³a embed cÅ©
            try { if (data.message) await data.message.delete(); } catch (e) { }

            // Gá»­i embed má»›i
            const newEmbed = createOverviewEmbed(guildId, client.guilds.cache.get(guildId));
            const newRow = createOverviewButton(guildId);
            const channel = await client.channels.fetch(data.channelId).catch(() => null);
            if (!channel) return;

            const refreshOptions = { embeds: [newEmbed] };
            if (newRow) refreshOptions.components = [newRow];
            const newMessage = await channel.send(refreshOptions);

            // Cáº­p nháº­t reference
            data.messageId = newMessage.id;
            data.message = newMessage;

            console.log(`[bangchien] Debounced refresh overview táº¡i ${channel.name}`);
        } catch (e) {
            console.error('[bangchien] Error debounced refresh overview:', e.message);
        } finally {
            bcRefreshTimers.delete(guildId);
        }
    }, BC_REFRESH_DEBOUNCE);

    bcRefreshTimers.set(guildId, timeoutId);
}

module.exports = {
    name: 'bangchien',
    aliases: ['bc', 'dangkybangchien'],
    description: 'Báº¯t Ä‘áº§u Ä‘Äƒng kĂ½ Bang Chiáº¿n (30 ngÆ°á»i). DĂ¹ng: ?bc (tá»•ng quan), ?bc t7, ?bc cn',

    async execute(message, args, client) {
        const guildId = message.guild.id;
        const leaderId = message.author.id;
        const leaderName = message.author.username;
        const db = require('../../database/db');

        // Lookup tĂªn ingame tá»« DB
        const userInfo = db.getUserByDiscordId(leaderId);
        const gameName = userInfo?.game_username || '';
        const displayName = gameName || leaderName; // Æ¯u tiĂªn tĂªn ingame

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // AUTO-CLEANUP: Dá»n session BC háº¿t háº¡n trÆ°á»›c khi xá»­ lĂ½
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        await autoCleanupExpiredSessions(client, guildId);

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // PARSE ARGS: ?bc / ?bc t7 / ?bc t2 21h Ghi chĂº
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        const parsed = parseDayArg(args); // { day, time, note } hoáº·c null
        const day = parsed?.day || null;
        const bcTime = normalizeBcTime(parsed?.time || LEAGUE_TIME);
        const bcNote = parsed?.note || (day && PRIMARY_DAYS.includes(day) && bcTime === LEAGUE_TIME ? 'LEAGUE' : null);

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // CASE 1: ?bc (khĂ´ng cĂ³ args) â†’ Hiá»ƒn thá»‹ Overview táº¥t cáº£ ngĂ y
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        if (!day) {
            // XĂ³a overview cÅ© náº¿u cĂ³
            const existingOverview = bangchienOverviews.get(guildId);
            if (existingOverview) {
                // Clear debounce timer cÅ©
                const oldTimer = bcRefreshTimers.get(guildId);
                if (oldTimer) { clearTimeout(oldTimer); bcRefreshTimers.delete(guildId); }
                try { if (existingOverview.message) await existingOverview.message.delete(); } catch (e) { }
            }

            const overviewEmbed = createOverviewEmbed(guildId, message.guild);
            const overviewButton = createOverviewButton(guildId);

            // XĂ³a tin nháº¯n lá»‡nh
            try { await message.delete(); } catch (e) { }

            // Gá»­i embed - chá»‰ thĂªm components náº¿u cĂ³ button
            const sendOptions = { embeds: [overviewEmbed] };
            if (overviewButton) {
                sendOptions.components = [overviewButton];
            }
            const overviewMsg = await message.channel.send(sendOptions);

            // LÆ°u vĂ o Map (khĂ´ng cáº§n intervalId ná»¯a â€” dĂ¹ng debounce)
            bangchienOverviews.set(guildId, {
                messageId: overviewMsg.id,
                channelId: message.channel.id,
                message: overviewMsg
            });

            console.log(`[bangchien] ${leaderName} hiá»ƒn thá»‹ overview táº¡i ${message.guild.name}`);
            return;
        }

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // CASE 2: ?bc t7 / ?bc t2 21h ... â†’ Táº¡o hoáº·c hiá»ƒn thá»‹ session
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        const dayConfig = DAY_CONFIG[day];

        // Kiá»ƒm tra session hiá»‡n cĂ³ trong DB
        const existingSession = db.getActiveBangchienByDayTime
            ? db.getActiveBangchienByDayTime(guildId, day, bcTime)
            : db.getActiveBangchienByDay(guildId, day);

        if (existingSession) {
            // Session Ä‘Ă£ tá»“n táº¡i â†’ chá»‰ cáº­p nháº­t overview, KHĂ”NG gá»­i embed riĂªng
            const partyKey = existingSession.party_key;

            // KhĂ´i phá»¥c vĂ o memory náº¿u cáº§n (sau restart)
            if (!bangchienNotifications.has(partyKey)) {
                console.log(`[bangchien] KhĂ´i phá»¥c session ${day} tá»« DB: ${partyKey}`);

                bangchienNotifications.set(partyKey, {
                    intervalId: null,
                    channelId: existingSession.channel_id,
                    leaderId: existingSession.leader_id,
                    leaderName: existingSession.leader_name,
                    messageId: existingSession.message_id,
                    message: null,
                    startTime: new Date(existingSession.created_at).getTime(),
                    day: day,
                    time: existingSession.time || bcTime
                });

                // KhĂ´i phá»¥c registrations
                const allParticipants = [
                    ...(existingSession.team_attack1 || []),
                    ...(existingSession.team_attack2 || []),
                    ...(existingSession.team_defense || []),
                    ...(existingSession.team_forest || []),
                    ...(existingSession.waiting_list || [])
                ];
                bangchienRegistrations.set(partyKey, allParticipants);

                // Fetch members vĂ o cache
                await fetchBcMembers(message.guild, allParticipants);
            }

            // Cáº­p nháº­t overview thay vĂ¬ gá»­i embed riĂªng
            await refreshOverviewEmbed(client, guildId);

            // Sync lĂªn Supabase Ä‘á»ƒ web nháº­n realtime update
            // (quan trá»ng sau bot restart â€” web cáº§n data má»›i Ä‘á»ƒ hiá»ƒn thá»‹ Ä‘Ăºng)
            try {
                const supaSync = require('../../utils/supabaseSync');
                if (supaSync.isReady()) {
                    const formatted = supaSync.formatActiveSession(existingSession, db, message.guild);
                    if (formatted) {
                        formatted.time = existingSession.time || bcTime;
                        await supaSync.syncBCSession(guildId, day, formatted);
                        console.log(`[bangchien] âœ… Sync session ${day} lĂªn Supabase (?bc existing)`);
                    }
                }
            } catch (syncErr) {
                console.log('[bangchien] Lá»—i sync Supabase (existing session):', syncErr.message);
            }

            // Reply ngáº¯n cho user biáº¿t
            const reply = await message.reply({
                content: `âœ… Session **${dayConfig.name}** Ä‘ang má»Ÿ. Xem táº¡i kĂªnh ?bc overview.`,
                allowedMentions: { repliedUser: false }
            });
            setTimeout(() => { try { reply.delete(); } catch (e) { } }, 5000);

            // XĂ³a tin nháº¯n lá»‡nh
            try { await message.delete(); } catch (e) { }
            console.log(`[bangchien] ${leaderName} xem session ${dayConfig.name} â†’ cáº­p nháº­t overview`);
            return;
        }

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // CASE 3: Táº¡o session má»›i cho ngĂ y Ä‘Ă³ (CHá»ˆ Ká»² Cá»°U/QUáº¢N LĂ)
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

        // Kiá»ƒm tra quyá»n: Chá»‰ Ká»³ Cá»±u hoáº·c Quáº£n LĂ½ má»›i Ä‘Æ°á»£c má»Ÿ session má»›i
        const kyCuuRole = message.guild.roles.cache.find(r => r.name === 'Ká»³ Cá»±u');
        const quanLyRole = message.guild.roles.cache.find(r => r.name === 'Quáº£n LĂ½');
        const OWNER_ID = '395151484179841024';

        const isKyCuu = kyCuuRole && message.member.roles.cache.has(kyCuuRole.id);
        const isQuanLy = quanLyRole && message.member.roles.cache.has(quanLyRole.id);
        const isOwner = message.author.id === OWNER_ID;

        if (!isKyCuu && !isQuanLy && !isOwner) {
            return message.reply({
                content: `âŒ Chá»‰ **Ká»³ Cá»±u** hoáº·c **Quáº£n LĂ½** má»›i Ä‘Æ°á»£c má»Ÿ Bang Chiáº¿n!\nđŸ’¡ Náº¿u Ä‘Ă£ cĂ³ session, dĂ¹ng \`?bc\` Ä‘á»ƒ xem tá»•ng quan.`,
                allowedMentions: { repliedUser: false }
            });
        }

        const confirmEmbed = new EmbedBuilder()
            .setColor(dayConfig.color)
            .setTitle(`â”ï¸ XĂC NHáº¬N Táº O BANG CHIáº¾N - ${dayConfig.name}`)
            .setDescription(`**${leaderName}** muá»‘n má»Ÿ Ä‘Äƒng kĂ½ Bang Chiáº¿n cho **${dayConfig.name}**.\n\n` +
                `đŸ“‹ Sau khi xĂ¡c nháº­n, má»i ngÆ°á»i cĂ³ thá»ƒ Ä‘Äƒng kĂ½.\n` +
                `â° Báº¡n cĂ³ 30 giĂ¢y Ä‘á»ƒ xĂ¡c nháº­n.`)
            .setFooter({ text: 'Nháº¥n XĂ¡c Nháº­n Ä‘á»ƒ tiáº¿p tá»¥c' });

        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`bc_confirm_${day}_${leaderId}`)
                    .setLabel('âœ… XĂ¡c Nháº­n')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`bc_cancel_${day}_${leaderId}`)
                    .setLabel('âŒ Há»§y')
                    .setStyle(ButtonStyle.Danger)
            );

        const confirmMsg = await message.reply({ embeds: [confirmEmbed], components: [confirmRow] });

        // Chá» xĂ¡c nháº­n
        try {
            const filter = i => i.user.id === leaderId &&
                (i.customId === `bc_confirm_${day}_${leaderId}` || i.customId === `bc_cancel_${day}_${leaderId}`);
            const confirmation = await confirmMsg.awaitMessageComponent({ filter, time: 30000 });

            if (confirmation.customId === `bc_cancel_${day}_${leaderId}`) {
                await confirmMsg.delete().catch(() => { });
                return message.reply({ content: 'âŒ ÄĂ£ há»§y táº¡o Bang Chiáº¿n.', allowedMentions: { repliedUser: false } });
            }

            await confirmMsg.delete().catch(() => { });
        } catch (e) {
            await confirmMsg.delete().catch(() => { });
            return message.reply({ content: 'â° Háº¿t thá»i gian xĂ¡c nháº­n. Vui lĂ²ng thá»­ láº¡i.', allowedMentions: { repliedUser: false } });
        }

        // Táº¡o party key má»›i vá»›i day
        const partyKey = createPartyKey(guildId, day, leaderId, bcTime);

        // Khá»Ÿi táº¡o trong memory
        bangchienRegistrations.set(partyKey, [{
            id: leaderId,
            username: leaderName,
            name: displayName,
            gn: gameName,
            joinedAt: Date.now(),
            isLeader: true
        }]);

        // LÆ°u vĂ o DB vá»›i day, time, note
        db.createActiveBangchien({
            guildId,
            partyKey,
            leaderId,
            leaderName,
            channelId: message.channel.id,
            messageId: null,
            day: day,
            time: bcTime,
            note: bcNote || null
        });

        // Recurring signup is temporarily disabled; keep existing data untouched.

        // KHĂ”NG gá»­i embed riĂªng - chá»‰ cáº­p nháº­t overview
        // XĂ³a tin nháº¯n lá»‡nh
        try { await message.delete(); } catch (e) { }

        // LÆ°u thĂ´ng tin vĂ o memory (khĂ´ng cĂ³ interval refresh cho ?bc t7/cn)
        bangchienNotifications.set(partyKey, {
            intervalId: null,
            channelId: message.channel.id,
            leaderId,
            leaderName,
            messageId: null,
            message: null,
            startTime: Date.now(),
            day: day,
            time: bcTime
        });

        // Cáº­p nháº­t overview embed
        await refreshOverviewEmbed(client, guildId);

        // ThĂ´ng bĂ¡o ngáº¯n
        const reply = await message.channel.send(`âœ… ÄĂ£ má»Ÿ Ä‘Äƒng kĂ½ BC **${dayConfig.name}**! Xem táº¡i kĂªnh ?bc overview.`);
        setTimeout(() => { try { reply.delete(); } catch (e) { } }, 8000);

        // ÄÄƒng kĂ½ kĂªnh
        bangchienChannels.set(guildId, message.channel.id);

        // Sync lĂªn Supabase Ä‘á»ƒ web cáº­p nháº­t realtime
        try {
            const supaSync = require('../../utils/supabaseSync');
            const db = require('../../database/db');
            if (supaSync.isReady()) {
                const activeSession = db.getActiveBangchien(partyKey);
                if (activeSession) {
                    const formatted = supaSync.formatActiveSession(activeSession, db, message.guild);
                    if (formatted) {
                        formatted.time = bcTime;
                        formatted.note = bcNote || '';
                        await supaSync.syncBCSession(guildId, day, formatted);
                        console.log(`[bangchien] âœ… ÄĂ£ sync session ${day} lĂªn Supabase`);
                    } else {
                        console.log(`[bangchien] â ï¸ formatActiveSession tráº£ vá» null cho ${day}`);
                    }
                }
            }
        } catch (e) {
            console.log('[bangchien] Supabase sync error:', e.message);
        }

        console.log(`[bangchien] ${leaderName} táº¡o party ${dayConfig.name} táº¡i ${message.guild.name}`);

        // Cáº­p nháº­t lá»‹ch tuáº§n ngay khi má»Ÿ session (khĂ´ng truyá»n channelId Ä‘á»ƒ dĂ¹ng channel tá»« /thongbaoguild)
        try {
            const { refreshScheduleEmbed } = require('../thongbao/thongbaoguild');
            await refreshScheduleEmbed(message.client, guildId, null, 'resend');
            console.log(`[bangchien] ÄĂ£ cáº­p nháº­t lá»‹ch tuáº§n sau khi má»Ÿ BC ${day}`);
        } catch (e) {
            console.log('[bangchien] KhĂ´ng thá»ƒ cáº­p nháº­t lá»‹ch tuáº§n:', e.message);
        }

        // ===== Äáº¶T Lá»CH TAG ROLE BC VĂ€O 19:00 (30p trÆ°á»›c) VĂ€ 19:15 (15p trÆ°á»›c) =====
        // ===== VĂ€ XĂ“A ROLE BC VĂ€O 23:00 (sau khi Ä‘Ă¡nh xong) =====
        try {
            const BC_ROLE_NAME = 'bc';
            const vnOffset = 7 * 60;
            const localOffset = new Date().getTimezoneOffset();
            const now = new Date();
            const vnNow = new Date(now.getTime() + (localOffset + vnOffset) * 60 * 1000);

            // TĂ¬m ngĂ y T7 hoáº·c CN tiáº¿p theo
            const { DAY_NUM } = require('../../utils/bangchienState');
            const targetDayOfWeek = DAY_NUM[day] ?? 0; // DĂ¹ng DAY_NUM map cho táº¥t cáº£ ngĂ y
            const todayDayOfWeek = vnNow.getDay();

            let daysUntilTarget = targetDayOfWeek - todayDayOfWeek;
            if (daysUntilTarget < 0) daysUntilTarget += 7;

            const channelId = message.channel.id;

            // HĂ m helper Ä‘á»ƒ Ä‘áº·t lá»‹ch tag
            const scheduleTag = (hour, minute, tagMessage) => {
                const targetDate = new Date(vnNow);
                targetDate.setDate(targetDate.getDate() + daysUntilTarget);
                targetDate.setHours(hour, minute, 0, 0);

                const targetUTC = new Date(targetDate.getTime() - (localOffset + vnOffset) * 60 * 1000);
                const msUntilTag = targetUTC.getTime() - Date.now();

                if (msUntilTag > 0 && msUntilTag < 7 * 24 * 60 * 60 * 1000) {
                    setTimeout(async () => {
                        try {
                            const channel = await client.channels.fetch(channelId).catch(() => null);
                            if (channel) {
                                const role = channel.guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
                                if (role) {
                                    await channel.send(`đŸ° <@&${role.id}> ${tagMessage}`);
                                    console.log(`[bangchien] ÄĂ£ tag role BC cho ${day} lĂºc ${hour}:${minute.toString().padStart(2, '0')}`);
                                }
                            }
                        } catch (e) {
                            console.log('[bangchien] Lá»—i tag role:', e.message);
                        }
                    }, msUntilTag);

                    const hoursUntil = Math.floor(msUntilTag / (60 * 60 * 1000));
                    const minutesUntil = Math.floor((msUntilTag % (60 * 60 * 1000)) / (60 * 1000));
                    console.log(`[bangchien] Äáº·t lá»‹ch tag ${hour}:${minute.toString().padStart(2, '0')} ${day} sau ${hoursUntil}h${minutesUntil}m`);
                    return true;
                }
                return false;
            };

            // Tag lĂºc 19:00 (30 phĂºt trÆ°á»›c BC)
            scheduleTag(19, 0, 'â° CĂ²n **30 phĂºt** ná»¯a lĂ  Ä‘áº¿n giá» Bang Chiáº¿n! Chuáº©n bá»‹ táº­p trung!');

            // Tag lĂºc 19:15 (15 phĂºt trÆ°á»›c BC)
            scheduleTag(19, 15, 'â”ï¸ CĂ²n **15 phĂºt** ná»¯a lĂ  Ä‘áº¿n giá» Bang Chiáº¿n! Táº­p trung ngay!');

            // ===== Tá»° Äá»˜NG END BC LĂC 23:00 VN (full logic giá»‘ng ?bcend) =====
            const cleanupDate = new Date(vnNow);
            cleanupDate.setDate(cleanupDate.getDate() + daysUntilTarget);
            cleanupDate.setHours(23, 0, 0, 0);

            const cleanupUTC = new Date(cleanupDate.getTime() - (localOffset + vnOffset) * 60 * 1000);
            const msUntilCleanup = cleanupUTC.getTime() - Date.now();

            if (msUntilCleanup > 0 && msUntilCleanup < 7 * 24 * 60 * 60 * 1000) {
                setTimeout(async () => {
                    try {
                        const dbCleanup = require('../../database/db');
                        const channel = await client.channels.fetch(channelId).catch(() => null);
                        if (!channel) return;
                        const guild = channel.guild;

                        // Láº¥y session tá»« DB
                        const autoEndSession = dbCleanup.getActiveBangchienByDayTime
                            ? dbCleanup.getActiveBangchienByDayTime(guildId, day, bcTime)
                            : dbCleanup.getActiveBangchienByDay(guildId, day);
                        if (!autoEndSession) {
                            console.log(`[bangchien] Auto-end 23:00 ${day}: Session Ä‘Ă£ Ä‘Æ°á»£c end trÆ°á»›c Ä‘Ă³, bá» qua.`);
                            return;
                        }
                        const autoEndPartyKey = autoEndSession.party_key;

                        // 1. AUTO-SAVE PRESET Team Thá»§/Rá»«ng
                        const autoEndTeamDefense = autoEndSession.team_defense || [];
                        const autoEndTeamForest = autoEndSession.team_forest || [];
                        let presetSaved = { thu: 0, rung: 0 };

                        if (autoEndTeamDefense.length > 0) {
                            const currentPresetThu = dbCleanup.getBcPreset(guildId, 'thu', day);
                            const newPresetThu = [...currentPresetThu];
                            for (const p of autoEndTeamDefense) {
                                if (!newPresetThu.some(m => m.id === p.id)) {
                                    newPresetThu.push({ id: p.id, username: p.username });
                                }
                            }
                            dbCleanup.setBcPreset(guildId, 'thu', newPresetThu, day);
                            presetSaved.thu = autoEndTeamDefense.length;
                        }

                        if (autoEndTeamForest.length > 0) {
                            const currentPresetRung = dbCleanup.getBcPreset(guildId, 'rung', day);
                            const newPresetRung = [...currentPresetRung];
                            for (const p of autoEndTeamForest) {
                                if (!newPresetRung.some(m => m.id === p.id)) {
                                    newPresetRung.push({ id: p.id, username: p.username });
                                }
                            }
                            dbCleanup.setBcPreset(guildId, 'rung', newPresetRung, day);
                            presetSaved.rung = autoEndTeamForest.length;
                        }

                        // 2. XĂ“A ROLE BC cho táº¥t cáº£ participants
                        const participants = [
                            ...(autoEndSession.team_attack1 || []),
                            ...(autoEndSession.team_attack2 || []),
                            ...(autoEndSession.team_defense || []),
                            ...(autoEndSession.team_forest || [])
                        ];

                        const bcRole = guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
                        let removedCount = 0;

                        if (bcRole && participants.length > 0) {
                            for (const p of participants) {
                                try {
                                    const member = await guild.members.fetch({ user: p.id, force: true }).catch(() => null);
                                    if (member && member.roles.cache.has(bcRole.id)) {
                                        await member.roles.remove(bcRole);
                                        removedCount++;
                                    }
                                } catch (e) { }
                            }
                        }

                        // 3. XĂ“A MEMORY DATA
                        const notifData = bangchienNotifications.get(autoEndPartyKey);
                        if (notifData) {
                            if (notifData.intervalId) clearInterval(notifData.intervalId);
                            try { if (notifData.message) await notifData.message.delete(); } catch (e) { }
                        }
                        bangchienNotifications.delete(autoEndPartyKey);
                        bangchienRegistrations.delete(autoEndPartyKey);

                        // XĂ³a finalized parties liĂªn quan
                        const { bangchienFinalizedParties } = require('../../utils/bangchienState');
                        for (const [msgId, data] of bangchienFinalizedParties.entries()) {
                            if (data.guildId === guildId && data.leaderId === autoEndSession.leader_id) {
                                bangchienFinalizedParties.delete(msgId);
                            }
                        }

                        // Chá»‰ xĂ³a bangchienChannels náº¿u khĂ´ng cĂ²n session nĂ o khĂ¡c
                        const remainingKeys = getGuildBangchienKeys(guildId);
                        // Trá»« session Ä‘ang end ra (vĂ¬ chÆ°a xĂ³a khá»i notifications)
                        if (remainingKeys.filter(k => k !== autoEndPartyKey).length === 0) {
                            bangchienChannels.delete(guildId);
                        }

                        // 4. XĂ“A SESSION KHá»I DB
                        dbCleanup.deleteActiveBangchien(autoEndPartyKey);

                        // 4.5. LÆ°u snapshot thá»±c chiáº¿n cuá»‘i tuáº§n 19:30 trÆ°á»›c khi xĂ³a session
                        try {
                            if (['sat', 'sun'].includes(day) && (autoEndSession.time || '19:30') === '19:30') {
                                const { saveBattleTacticsHistorySnapshot } = require('../../utils/supabaseSync');
                                await saveBattleTacticsHistorySnapshot(guildId, day, {
                                    time: autoEndSession.time || '19:30',
                                    roster: {
                                        attack1: autoEndSession.team_attack1 || [],
                                        attack2: autoEndSession.team_attack2 || [],
                                        defense: autoEndSession.team_defense || [],
                                        forest: autoEndSession.team_forest || []
                                    },
                                    resultNote: `Auto-end ${DAY_CONFIG[day].name} 23:00`
                                });
                            }
                        } catch (e) {
                            console.log('[bangchien] Auto-end: Lá»—i lÆ°u battle snapshot:', e.message);
                        }

                        // 4.6. SYNC XĂ“A TRĂN SUPABASE â†’ web realtime DELETE
                        try {
                            const { deleteBCSession } = require('../../utils/supabaseSync');
                            await deleteBCSession(guildId, day, autoEndSession.time || bcTime);
                        } catch (e) {
                            console.log('[bangchien] Auto-end: Lá»—i xĂ³a Supabase:', e.message);
                        }

                        // 5. Cáº¬P NHáº¬T OVERVIEW EMBED
                        await refreshOverviewEmbed(client, guildId);

                        // 6. Cáº¬P NHáº¬T Lá»CH TUáº¦N
                        try {
                            const { refreshScheduleEmbed } = require('../thongbao/thongbaoguild');
                            await refreshScheduleEmbed(client, guildId, channelId, 'edit');
                        } catch (e) {
                            console.log('[bangchien] Auto-end: KhĂ´ng thá»ƒ cáº­p nháº­t lá»‹ch tuáº§n:', e.message);
                        }

                        // 7. Gá»¬I THĂ”NG BĂO
                        const { EmbedBuilder: AutoEndEmbed } = require('discord.js');
                        const autoEndEmbed = new AutoEndEmbed()
                            .setColor(0x2ECC71)
                            .setTitle(`âœ… BANG CHIáº¾N ${DAY_CONFIG[day].name.toUpperCase()} ÄĂƒ Tá»° Äá»˜NG Káº¾T THĂC!`)
                            .setDescription(`â° ÄĂ£ 23:00 - Bang Chiáº¿n **${DAY_CONFIG[day].name}** tá»± Ä‘á»™ng káº¿t thĂºc.`)
                            .addFields(
                                { name: 'đŸ‘¥ Sá»‘ ngÆ°á»i Ä‘Ă£ Ä‘i', value: `${participants.length} ngÆ°á»i`, inline: true },
                                { name: 'đŸ”´ ÄĂ£ xĂ³a role', value: `${removedCount} ngÆ°á»i`, inline: true },
                                { name: 'đŸ’¾ Preset Ä‘Ă£ lÆ°u', value: `đŸ›¡ï¸ Thá»§: ${presetSaved.thu} | đŸŒ² Rá»«ng: ${presetSaved.rung}`, inline: true }
                            )
                            .setTimestamp();

                        await channel.send({ embeds: [autoEndEmbed] });
                        console.log(`[bangchien] Auto-end 23:00 ${day}: End thĂ nh cĂ´ng (${removedCount} role removed, preset: thu=${presetSaved.thu} rung=${presetSaved.rung})`);
                    } catch (e) {
                        console.error('[bangchien] Lá»—i auto-end 23:00:', e.message);
                    }
                }, msUntilCleanup);

                const hoursUntil = Math.floor(msUntilCleanup / (60 * 60 * 1000));
                const minutesUntil = Math.floor((msUntilCleanup % (60 * 60 * 1000)) / (60 * 1000));
                console.log(`[bangchien] Äáº·t lá»‹ch auto-end BC lĂºc 23:00 ${day} sau ${hoursUntil}h${minutesUntil}m`);
            }

        } catch (e) {
            console.log('[bangchien] Lá»—i Ä‘áº·t lá»‹ch tag/cleanup:', e.message);
        }
        // ===== Káº¾T THĂC Äáº¶T Lá»CH TAG + CLEANUP =====
    },

    // Export functions
    createBangchienEmbed,
    createBangchienButtons,
    createBangchienAdminButtons,
    createOverviewEmbed,
    createOverviewButton,
    fetchBcMembers,
    refreshBcOverviewDebounced
};
