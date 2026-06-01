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


// Tạo embed thông báo bang chiến - HIỂN THỊ 4 TEAM
function createBangchienEmbed(partyKey, leaderName, guild = null) {
    const db = require('../../database/db');

    // DYNAMIC TEAM SIZES - Đồng bộ với ?bcsize
    const TEAM_ATTACK1_SIZE = db.getTeamSize('attack1') || 10;
    const TEAM_ATTACK2_SIZE = db.getTeamSize('attack2') || 10;
    const TEAM_DEFENSE_SIZE = db.getTeamSize('defense') ?? 5;
    const TEAM_FOREST_SIZE = db.getTeamSize('forest') ?? 5;

    // Lấy data từ DB
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
    const roleEmojis = { 'DPS': '🔵', 'Quạt Dù': '🔵', 'Vô Danh': '🔵', 'Song Đao': '🔵', 'Cửu Kiếm': '🔵', 'Healer': '🟢', 'Tanker': '🟠' };
    const dpsSubTypeRoles = ['Quạt Dù', 'Vô Danh', 'Song Đao', 'Cửu Kiếm'];
    const allRoleNames = ['DPS', 'Healer', 'Tanker'];
    const dpsShortTags = { 'Quạt Dù': 'QD', 'Vô Danh': 'VD', 'Song Đao': 'SD', 'Cửu Kiếm': '9K' };

    // Helper: lấy role - ƯU TIÊN Healer/Tanker trước DPS
    function getMemberRole(memberId) {
        if (!guild) return null;
        try {
            const member = guild.members.cache.get(memberId);
            if (!member) return null;

            // Check Healer và Tanker TRƯỚC (ưu tiên cao hơn)
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

    // Helper: format một người
    function formatMember(r, index) {
        const userData = db.getUserByDiscordId(r.id);
        const gameName = userData?.game_username || null;
        // LUÔN detect role từ Discord (không fallback sang role DB)
        const role = getMemberRole(r.id);
        const roleDisplay = role ? roleEmojis[role] : '❓';

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
        const leaderIcon = r.isTeamLeader ? ' 👑' : '';
        return `${index}. ${roleDisplay}${subTypeTag} ${nameDisplay}${leaderIcon}`;
    }

    // Helper: tính stats
    function getTeamStats(team) {
        let stats = { healer: 0, tanker: 0, dps: 0, unknown: 0 };
        team.forEach(p => {
            // LUÔN detect role từ Discord (không fallback sang role DB)
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
        let text = `🟢${stats.healer} 🟠${stats.tanker} 🔵${stats.dps}`;
        if (stats.unknown > 0) text += ` ❓${stats.unknown}`;
        return text;
    }

    // Helper: chia list dài
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

    // Helper: add team field to embed (chỉ hiện 1 slot trống nếu chưa đầy)
    function addTeamField(embed, teamName, emoji, team, maxSize, startNum) {
        const stats = getTeamStats(team);
        const statsText = formatStats(stats);

        // Tạo danh sách: members + 1 slot trống (nếu chưa đầy)
        const lines = [];
        for (let i = 0; i < team.length; i++) {
            lines.push(formatMember(team[i], startNum + i));
        }
        // Chỉ thêm 1 slot trống nếu team chưa đầy
        if (team.length < maxSize) {
            const nextSlot = startNum + team.length;
            lines.push(`${nextSlot}. _Trống..._`);
        }

        const list = lines.join('\n') || '_Trống..._';
        const chunks = splitListIntoChunks(list);
        chunks.forEach((chunk, index) => {
            embed.addFields({
                name: index === 0 ? `${emoji} ${teamName} (${team.length}/${maxSize}) [${statsText}]` : '​',
                value: chunk,
                inline: false
            });
        });

        return maxSize; // Return maxSize để số thứ tự liên tục
    }

    // Lấy màu và tên ngày từ partyKey
    const day = getDayFromPartyKey(partyKey);
    const dayConfig = day ? DAY_CONFIG[day] : { name: '', color: 0x9B59B6 };
    const dayTitle = day ? ` - ${getDayNameWithDate(day)}` : '';

    const embed = new EmbedBuilder()
        .setColor(dayConfig.color)
        .setTitle(`⚔️ ĐĂNG KÝ BANG CHIẾN LANG GIA${dayTitle}`)
        .setDescription('❓ = Chưa dùng `?pickrole` để chọn vai trò\n`?bcdoi <số1> <số2>` để đổi chỗ');

    // Lấy tên team tùy chỉnh
    const teamNames = db.getTeamNames ? db.getTeamNames() : {
        attack1: 'TEAM CÔNG 1', attack2: 'TEAM CÔNG 2',
        defense: 'TEAM THỦ', forest: 'TEAM RỪNG'
    };

    // Team Công 1: 1-10
    let currentNum = 1;
    currentNum += addTeamField(embed, teamNames.attack1, '⚔️', teamAttack1, TEAM_ATTACK1_SIZE, currentNum);

    // Team Công 2: 11-20
    currentNum += addTeamField(embed, teamNames.attack2, '🗡️', teamAttack2, TEAM_ATTACK2_SIZE, currentNum);

    // Team Thủ: chỉ hiện nếu size > 0
    if (TEAM_DEFENSE_SIZE > 0) {
        currentNum += addTeamField(embed, teamNames.defense, '🛡️', teamDefense, TEAM_DEFENSE_SIZE, currentNum);
    } else {
        // Vẫn cộng maxSize để giữ số thứ tự liên tục
        currentNum += TEAM_DEFENSE_SIZE;
    }

    // Team Rừng: chỉ hiện nếu size > 0
    if (TEAM_FOREST_SIZE > 0) {
        currentNum += addTeamField(embed, teamNames.forest, '🌲', teamForest, TEAM_FOREST_SIZE, currentNum);
    } else {
        currentNum += TEAM_FOREST_SIZE;
    }


    // Danh sách chờ
    if (waitingList.length > 0) {
        const waitList = waitingList.map((r, i) => formatMember(r, currentNum + i)).join('\n');
        const waitChunks = splitListIntoChunks(waitList);
        waitChunks.forEach((chunk, index) => {
            embed.addFields({
                name: index === 0 ? `⏳ Danh sách chờ (${waitingList.length})` : '​',
                value: chunk,
                inline: false
            });
        });
    }

    const total = teamAttack1.length + teamAttack2.length + teamDefense.length + teamForest.length + waitingList.length;
    embed.setFooter({ text: `Leader: ${leaderName} • Tổng: ${total}/30 người` })
        .setTimestamp();

    return embed;
}

// Tạo buttons công khai (cho tất cả người dùng thấy)
function createBangchienButtons(partyKey, day = null) {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`bangchien_join_${partyKey}`)
                .setLabel('✅ Tham gia')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`bangchien_leave_${partyKey}`)
                .setLabel('❌ Hủy đăng ký')
                .setStyle(ButtonStyle.Secondary),
        );
    return row;
}

// Tạo buttons quản lý (chỉ Leader thấy qua ?bcql)
function createBangchienAdminButtons(partyKey) {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`bangchien_kick_${partyKey}`)
                .setLabel('❌ Loại bỏ')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`bangchien_priority_${partyKey}`)
                .setLabel('⬆️ Ưu tiên')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`bangchien_finalize_${partyKey}`)
                .setLabel('📋 Chốt DS')
                .setStyle(ButtonStyle.Success)
        );

    return row;
}

// Fetch tất cả BC members vào cache (gọi 1 lần khi khôi phục session sau restart)
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

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-DAY OVERVIEW FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

// Helper: kiểm tra userId có trong session không
function isUserInSession(session, userId) {
    if (!userId) return false;
    const allMembers = [
        ...(session.team_attack1 || []),
        ...(session.team_attack2 || []),
        ...(session.team_defense || []),
        ...(session.team_forest  || []),
        ...(session.waiting_list || [])
    ];
    return allMembers.some(m => m.id === userId);
}

/**
 * Tạo embed tổng quan 2 ngày BC — group theo ngày, tick ✅ nếu user đã đăng ký
 * @param {string} guildId - Guild ID
 * @param {Object|null} guild - Guild object (không dùng, giữ compat)
 * @param {string|null} userId - Discord user ID để hiện dấu tích
 * @returns {EmbedBuilder} Embed với thông tin cả 2 ngày
 */
function createOverviewEmbed(guildId, guild = null, userId = null) {
    const db = require('../../database/db');

    const allSessions = db.getActiveBangchienByGuild(guildId)
        .filter(session => session?.day && DAY_CONFIG[session.day])
        .sort((a, b) => {
            const aPrimary = PRIMARY_DAYS.includes(a.day) ? 0 : 1;
            const bPrimary = PRIMARY_DAYS.includes(b.day) ? 0 : 1;
            if (aPrimary !== bPrimary) return aPrimary - bPrimary;
            const aDayIndex = Object.keys(DAY_CONFIG).indexOf(a.day);
            const bDayIndex = Object.keys(DAY_CONFIG).indexOf(b.day);
            if (aDayIndex !== bDayIndex) return aDayIndex - bDayIndex;
            return normalizeBcTime(a.time || LEAGUE_TIME).localeCompare(normalizeBcTime(b.time || LEAGUE_TIME));
        });

    // Group theo ngày
    const byDay = {};
    for (const session of allSessions) {
        if (!byDay[session.day]) byDay[session.day] = [];
        byDay[session.day].push(session);
    }

    const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('⚔️ BANG CHIẾN LANG GIA')
        .setDescription('Bấm **Đăng ký** bên dưới hoặc xem chi tiết trên WEB.');

    for (const day of Object.keys(byDay)) {
        const sessions = byDay[day];
        const dateStr = getDayNameWithDate(day).toUpperCase();

        const lines = sessions.map(session => {
            const timeStr = normalizeBcTime(session.time || LEAGUE_TIME);
            const total   = (session.team_attack1?.length || 0) + (session.team_attack2?.length || 0)
                          + (session.team_defense?.length  || 0) + (session.team_forest?.length  || 0);
            const league  = isLeagueSession(session) ? ' · LEAGUE' : '';
            const tick    = isUserInSession(session, userId) ? '✅' : '▫️';
            return `${tick} **${timeStr}**${league} · ${total}/30`;
        });

        embed.addFields({
            name: `📅 ${dateStr}`,
            value: lines.join('\n'),
            inline: false
        });
    }

    if (Object.keys(byDay).length === 0) {
        embed.addFields({ name: '\u200b', value: '_Chưa có phiên Bang Chiến nào đang mở._', inline: false });
    }

    embed.setTimestamp();
    return embed;
}

/**
 * Tạo button đăng ký BC (mở ephemeral menu)
 * Chỉ hiện button khi có session
 * @param {string} guildId - Guild ID
 * @returns {ActionRowBuilder|null} Row với nút đăng ký hoặc null nếu không có session
 */
function createOverviewButton(guildId) {
    const db = require('../../database/db');
    const allSessions = db.getActiveBangchienByGuild(guildId);

    const webButton = new ButtonBuilder()
        .setLabel('🌐 Truy cập WEB')
        .setStyle(ButtonStyle.Link)
        .setURL('https://langgiawar.vercel.app/');

    if (allSessions.length === 0) {
        return new ActionRowBuilder().addComponents(webButton);
    }

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`bc_menu_${guildId}`)
                .setLabel('📋 Đăng ký BANG CHIẾN')
                .setStyle(ButtonStyle.Primary),
            webButton
        );
    return row;
}

/**
 * Debounced refresh BC overview embed
 * Khi có tin nhắn mới trong kênh BC → clear timer cũ → set timer 5 phút
 * Khi timer hết → xóa embed cũ, gửi embed mới ở cuối kênh
 * @param {Client} client - Discord client
 * @param {string} guildId - Guild ID
 */
function refreshBcOverviewDebounced(client, guildId) {
    const db = require('../../database/db');
    const overviewData = bangchienOverviews.get(guildId);
    if (!overviewData) return;

    // Kiểm tra có session đang mở không (bất kỳ ngày nào)
    const allSessions = db.getActiveBangchienByGuild(guildId);
    if (allSessions.length === 0) return;

    // Clear timer cũ
    const existingTimer = bcRefreshTimers.get(guildId);
    if (existingTimer) clearTimeout(existingTimer);

    // Set timer mới (5 phút)
    const timeoutId = setTimeout(async () => {
        try {
            const data = bangchienOverviews.get(guildId);
            if (!data) return;

            // Xóa embed cũ
            try { if (data.message) await data.message.delete(); } catch (e) { }

            // Gửi embed mới
            const newEmbed = createOverviewEmbed(guildId, client.guilds.cache.get(guildId));
            const newRow = createOverviewButton(guildId);
            const channel = await client.channels.fetch(data.channelId).catch(() => null);
            if (!channel) return;

            const refreshOptions = { embeds: [newEmbed] };
            if (newRow) refreshOptions.components = [newRow];
            const newMessage = await channel.send(refreshOptions);

            // Cập nhật reference
            data.messageId = newMessage.id;
            data.message = newMessage;

            console.log(`[bangchien] Debounced refresh overview tại ${channel.name}`);
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
    description: 'Bắt đầu đăng ký Bang Chiến (30 người). Dùng: ?bc (tổng quan), ?bc t7, ?bc cn',

    async execute(message, args, client) {
        const guildId = message.guild.id;
        const leaderId = message.author.id;
        const leaderName = message.author.username;
        const db = require('../../database/db');

        // Lookup tên ingame từ DB
        const userInfo = db.getUserByDiscordId(leaderId);
        const gameName = userInfo?.game_username || '';
        const displayName = gameName || leaderName; // Ưu tiên tên ingame

        // ═══════════════════════════════════════════════════════════════════
        // AUTO-CLEANUP: Dọn session BC hết hạn trước khi xử lý
        // ═══════════════════════════════════════════════════════════════════
        await autoCleanupExpiredSessions(client, guildId);

        // ═══════════════════════════════════════════════════════════════════
        // PARSE ARGS: ?bc / ?bc t7 / ?bc t2 21h Ghi chú
        // ═══════════════════════════════════════════════════════════════════
        const parsed = parseDayArg(args); // { day, time, note } hoặc null
        const day = parsed?.day || null;
        const bcTime = normalizeBcTime(parsed?.time || LEAGUE_TIME);
        const bcNote = parsed?.note || (day && PRIMARY_DAYS.includes(day) && bcTime === LEAGUE_TIME ? 'LEAGUE' : null);

        // ═══════════════════════════════════════════════════════════════════
        // CASE 1: ?bc (không có args) → Hiển thị Overview tất cả ngày
        // ═══════════════════════════════════════════════════════════════════
        if (!day) {
            // Xóa overview cũ nếu có
            const existingOverview = bangchienOverviews.get(guildId);
            if (existingOverview) {
                // Clear debounce timer cũ
                const oldTimer = bcRefreshTimers.get(guildId);
                if (oldTimer) { clearTimeout(oldTimer); bcRefreshTimers.delete(guildId); }
                try { if (existingOverview.message) await existingOverview.message.delete(); } catch (e) { }
            }

            const overviewEmbed = createOverviewEmbed(guildId, message.guild);
            const overviewButton = createOverviewButton(guildId);

            // Xóa tin nhắn lệnh
            try { await message.delete(); } catch (e) { }

            // Gửi embed - chỉ thêm components nếu có button
            const sendOptions = { embeds: [overviewEmbed] };
            if (overviewButton) {
                sendOptions.components = [overviewButton];
            }
            const overviewMsg = await message.channel.send(sendOptions);

            // Lưu vào Map (không cần intervalId nữa — dùng debounce)
            bangchienOverviews.set(guildId, {
                messageId: overviewMsg.id,
                channelId: message.channel.id,
                message: overviewMsg
            });

            console.log(`[bangchien] ${leaderName} hiển thị overview tại ${message.guild.name}`);
            return;
        }

        // ═══════════════════════════════════════════════════════════════════
        // CASE 2: ?bc t7 / ?bc t2 21h ... → Tạo hoặc hiển thị session
        // ═══════════════════════════════════════════════════════════════════
        const dayConfig = DAY_CONFIG[day];

        // Kiểm tra session hiện có trong DB
        const existingSession = db.getActiveBangchienByDayTime
            ? db.getActiveBangchienByDayTime(guildId, day, bcTime)
            : db.getActiveBangchienByDay(guildId, day);

        if (existingSession) {
            // Session đã tồn tại → chỉ cập nhật overview, KHÔNG gửi embed riêng
            const partyKey = existingSession.party_key;

            // Khôi phục vào memory nếu cần (sau restart)
            if (!bangchienNotifications.has(partyKey)) {
                console.log(`[bangchien] Khôi phục session ${day} từ DB: ${partyKey}`);

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

                // Khôi phục registrations
                const allParticipants = [
                    ...(existingSession.team_attack1 || []),
                    ...(existingSession.team_attack2 || []),
                    ...(existingSession.team_defense || []),
                    ...(existingSession.team_forest || []),
                    ...(existingSession.waiting_list || [])
                ];
                bangchienRegistrations.set(partyKey, allParticipants);

                // Fetch members vào cache
                await fetchBcMembers(message.guild, allParticipants);
            }

            // Cập nhật overview thay vì gửi embed riêng
            await refreshOverviewEmbed(client, guildId);

            // Sync lên Supabase để web nhận realtime update
            // (quan trọng sau bot restart — web cần data mới để hiển thị đúng)
            try {
                const supaSync = require('../../utils/supabaseSync');
                if (supaSync.isReady()) {
                    const formatted = supaSync.formatActiveSession(existingSession, db, message.guild);
                    if (formatted) {
                        formatted.time = existingSession.time || bcTime;
                        await supaSync.syncBCSession(guildId, day, formatted);
                        console.log(`[bangchien] ✅ Sync session ${day} lên Supabase (?bc existing)`);
                    }
                }
            } catch (syncErr) {
                console.log('[bangchien] Lỗi sync Supabase (existing session):', syncErr.message);
            }

            // Reply ngắn cho user biết
            const reply = await message.reply({
                content: `✅ Session **${dayConfig.name}** đang mở. Xem tại kênh ?bc overview.`,
                allowedMentions: { repliedUser: false }
            });
            setTimeout(() => { try { reply.delete(); } catch (e) { } }, 5000);

            // Xóa tin nhắn lệnh
            try { await message.delete(); } catch (e) { }
            console.log(`[bangchien] ${leaderName} xem session ${dayConfig.name} → cập nhật overview`);
            return;
        }

        // ═══════════════════════════════════════════════════════════════════
        // CASE 3: Tạo session mới cho ngày đó (CHỈ KỲ CỰU/QUẢN LÝ)
        // ═══════════════════════════════════════════════════════════════════

        // Kiểm tra quyền: Chỉ Kỳ Cựu hoặc Quản Lý mới được mở session mới
        const kyCuuRole = message.guild.roles.cache.find(r => r.name === 'Kỳ Cựu');
        const quanLyRole = message.guild.roles.cache.find(r => r.name === 'Quản Lý');
        const OWNER_ID = '395151484179841024';

        const isKyCuu = kyCuuRole && message.member.roles.cache.has(kyCuuRole.id);
        const isQuanLy = quanLyRole && message.member.roles.cache.has(quanLyRole.id);
        const isOwner = message.author.id === OWNER_ID;

        if (!isKyCuu && !isQuanLy && !isOwner) {
            return message.reply({
                content: `❌ Chỉ **Kỳ Cựu** hoặc **Quản Lý** mới được mở Bang Chiến!\n💡 Nếu đã có session, dùng \`?bc\` để xem tổng quan.`,
                allowedMentions: { repliedUser: false }
            });
        }

        const confirmEmbed = new EmbedBuilder()
            .setColor(dayConfig.color)
            .setTitle(`⚔️ XÁC NHẬN TẠO BANG CHIẾN - ${dayConfig.name}`)
            .setDescription(`**${leaderName}** muốn mở đăng ký Bang Chiến cho **${dayConfig.name}**.\n\n` +
                `📋 Sau khi xác nhận, mọi người có thể đăng ký.\n` +
                `⏰ Bạn có 30 giây để xác nhận.`)
            .setFooter({ text: 'Nhấn Xác Nhận để tiếp tục' });

        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`bc_confirm_${day}_${leaderId}`)
                    .setLabel('✅ Xác Nhận')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`bc_cancel_${day}_${leaderId}`)
                    .setLabel('❌ Hủy')
                    .setStyle(ButtonStyle.Danger)
            );

        const confirmMsg = await message.reply({ embeds: [confirmEmbed], components: [confirmRow] });

        // Chờ xác nhận
        try {
            const filter = i => i.user.id === leaderId &&
                (i.customId === `bc_confirm_${day}_${leaderId}` || i.customId === `bc_cancel_${day}_${leaderId}`);
            const confirmation = await confirmMsg.awaitMessageComponent({ filter, time: 30000 });

            if (confirmation.customId === `bc_cancel_${day}_${leaderId}`) {
                await confirmMsg.delete().catch(() => { });
                return message.reply({ content: '❌ Đã hủy tạo Bang Chiến.', allowedMentions: { repliedUser: false } });
            }

            await confirmMsg.delete().catch(() => { });
        } catch (e) {
            await confirmMsg.delete().catch(() => { });
            return message.reply({ content: '⏰ Hết thời gian xác nhận. Vui lòng thử lại.', allowedMentions: { repliedUser: false } });
        }

        // Tạo party key mới với day
        const partyKey = createPartyKey(guildId, day, leaderId, bcTime);

        // Khởi tạo trong memory
        bangchienRegistrations.set(partyKey, [{
            id: leaderId,
            username: leaderName,
            name: displayName,
            gn: gameName,
            joinedAt: Date.now(),
            isLeader: true
        }]);

        // Lưu vào DB với day, time, note
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

        // KHÔNG gửi embed riêng - chỉ cập nhật overview
        // Xóa tin nhắn lệnh
        try { await message.delete(); } catch (e) { }

        // Lưu thông tin vào memory (không có interval refresh cho ?bc t7/cn)
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

        // Cập nhật overview embed
        await refreshOverviewEmbed(client, guildId);

        // Thông báo ngắn
        const reply = await message.channel.send(`✅ Đã mở đăng ký BC **${dayConfig.name}**! Xem tại kênh ?bc overview.`);
        setTimeout(() => { try { reply.delete(); } catch (e) { } }, 8000);

        // Đăng ký kênh
        bangchienChannels.set(guildId, message.channel.id);

        // Sync lên Supabase để web cập nhật realtime
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
                        console.log(`[bangchien] ✅ Đã sync session ${day} lên Supabase`);
                    } else {
                        console.log(`[bangchien] ⚠️ formatActiveSession trả về null cho ${day}`);
                    }
                }
            }
        } catch (e) {
            console.log('[bangchien] Supabase sync error:', e.message);
        }

        console.log(`[bangchien] ${leaderName} tạo party ${dayConfig.name} tại ${message.guild.name}`);

        // Cập nhật lịch tuần ngay khi mở session (không truyền channelId để dùng channel từ /thongbaoguild)
        try {
            const { refreshScheduleEmbed } = require('../thongbao/thongbaoguild');
            await refreshScheduleEmbed(message.client, guildId, null, 'resend');
            console.log(`[bangchien] Đã cập nhật lịch tuần sau khi mở BC ${day}`);
        } catch (e) {
            console.log('[bangchien] Không thể cập nhật lịch tuần:', e.message);
        }

        // ===== ĐẶT LỊCH TAG ROLE BC VÀO 19:00 (30p trước) VÀ 19:15 (15p trước) =====
        // ===== VÀ XÓA ROLE BC VÀO 23:00 (sau khi đánh xong) =====
        try {
            const BC_ROLE_NAME = 'bc';
            const vnOffset = 7 * 60;
            const localOffset = new Date().getTimezoneOffset();
            const now = new Date();
            const vnNow = new Date(now.getTime() + (localOffset + vnOffset) * 60 * 1000);

            // Tìm ngày T7 hoặc CN tiếp theo
            const { DAY_NUM } = require('../../utils/bangchienState');
            const targetDayOfWeek = DAY_NUM[day] ?? 0; // Dùng DAY_NUM map cho tất cả ngày
            const todayDayOfWeek = vnNow.getDay();

            let daysUntilTarget = targetDayOfWeek - todayDayOfWeek;
            if (daysUntilTarget < 0) daysUntilTarget += 7;

            const channelId = message.channel.id;

            // Hàm helper để đặt lịch tag
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
                                    await channel.send(`🏰 <@&${role.id}> ${tagMessage}`);
                                    console.log(`[bangchien] Đã tag role BC cho ${day} lúc ${hour}:${minute.toString().padStart(2, '0')}`);
                                }
                            }
                        } catch (e) {
                            console.log('[bangchien] Lỗi tag role:', e.message);
                        }
                    }, msUntilTag);

                    const hoursUntil = Math.floor(msUntilTag / (60 * 60 * 1000));
                    const minutesUntil = Math.floor((msUntilTag % (60 * 60 * 1000)) / (60 * 1000));
                    console.log(`[bangchien] Đặt lịch tag ${hour}:${minute.toString().padStart(2, '0')} ${day} sau ${hoursUntil}h${minutesUntil}m`);
                    return true;
                }
                return false;
            };

            // Tag lúc 19:00 (30 phút trước BC)
            scheduleTag(19, 0, '⏰ Còn **30 phút** nữa là đến giờ Bang Chiến! Chuẩn bị tập trung!');

            // Tag lúc 19:15 (15 phút trước BC)
            scheduleTag(19, 15, '⚔️ Còn **15 phút** nữa là đến giờ Bang Chiến! Tập trung ngay!');

            // ===== TỰ ĐỘNG END BC LÚC 23:00 VN (full logic giống ?bcend) =====
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

                        // Lấy session từ DB
                        const autoEndSession = dbCleanup.getActiveBangchienByDayTime
                            ? dbCleanup.getActiveBangchienByDayTime(guildId, day, bcTime)
                            : dbCleanup.getActiveBangchienByDay(guildId, day);
                        if (!autoEndSession) {
                            console.log(`[bangchien] Auto-end 23:00 ${day}: Session đã được end trước đó, bỏ qua.`);
                            return;
                        }
                        const autoEndPartyKey = autoEndSession.party_key;

                        // 1. AUTO-SAVE PRESET Team Thủ/Rừng
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

                        // 2. XÓA ROLE BC cho tất cả participants
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

                        // 3. XÓA MEMORY DATA
                        const notifData = bangchienNotifications.get(autoEndPartyKey);
                        if (notifData) {
                            if (notifData.intervalId) clearInterval(notifData.intervalId);
                            try { if (notifData.message) await notifData.message.delete(); } catch (e) { }
                        }
                        bangchienNotifications.delete(autoEndPartyKey);
                        bangchienRegistrations.delete(autoEndPartyKey);

                        // Xóa finalized parties liên quan
                        const { bangchienFinalizedParties } = require('../../utils/bangchienState');
                        for (const [msgId, data] of bangchienFinalizedParties.entries()) {
                            if (data.guildId === guildId && data.leaderId === autoEndSession.leader_id) {
                                bangchienFinalizedParties.delete(msgId);
                            }
                        }

                        // Chỉ xóa bangchienChannels nếu không còn session nào khác
                        const remainingKeys = getGuildBangchienKeys(guildId);
                        // Trừ session đang end ra (vì chưa xóa khỏi notifications)
                        if (remainingKeys.filter(k => k !== autoEndPartyKey).length === 0) {
                            bangchienChannels.delete(guildId);
                        }

                        // 4. XÓA SESSION KHỎI DB
                        dbCleanup.deleteActiveBangchien(autoEndPartyKey);

                        // 4.5. Lưu snapshot thực chiến cuối tuần 19:30 trước khi xóa session
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
                            console.log('[bangchien] Auto-end: Lỗi lưu battle snapshot:', e.message);
                        }

                        // 4.6. SYNC XÓA TRÊN SUPABASE → web realtime DELETE
                        try {
                            const { deleteBCSession } = require('../../utils/supabaseSync');
                            await deleteBCSession(guildId, day, autoEndSession.time || bcTime);
                        } catch (e) {
                            console.log('[bangchien] Auto-end: Lỗi xóa Supabase:', e.message);
                        }

                        // 5. CẬP NHẬT OVERVIEW EMBED
                        await refreshOverviewEmbed(client, guildId);

                        // 6. CẬP NHẬT LỊCH TUẦN
                        try {
                            const { refreshScheduleEmbed } = require('../thongbao/thongbaoguild');
                            await refreshScheduleEmbed(client, guildId, channelId, 'edit');
                        } catch (e) {
                            console.log('[bangchien] Auto-end: Không thể cập nhật lịch tuần:', e.message);
                        }

                        // 7. GỬI THÔNG BÁO
                        const { EmbedBuilder: AutoEndEmbed } = require('discord.js');
                        const autoEndEmbed = new AutoEndEmbed()
                            .setColor(0x2ECC71)
                            .setTitle(`✅ BANG CHIẾN ${DAY_CONFIG[day].name.toUpperCase()} ĐÃ TỰ ĐỘNG KẾT THÚC!`)
                            .setDescription(`⏰ Đã 23:00 - Bang Chiến **${DAY_CONFIG[day].name}** tự động kết thúc.`)
                            .addFields(
                                { name: '👥 Số người đã đi', value: `${participants.length} người`, inline: true },
                                { name: '🔴 Đã xóa role', value: `${removedCount} người`, inline: true },
                                { name: '💾 Preset đã lưu', value: `🛡️ Thủ: ${presetSaved.thu} | 🌲 Rừng: ${presetSaved.rung}`, inline: true }
                            )
                            .setTimestamp();

                        await channel.send({ embeds: [autoEndEmbed] });
                        console.log(`[bangchien] Auto-end 23:00 ${day}: End thành công (${removedCount} role removed, preset: thu=${presetSaved.thu} rung=${presetSaved.rung})`);
                    } catch (e) {
                        console.error('[bangchien] Lỗi auto-end 23:00:', e.message);
                    }
                }, msUntilCleanup);

                const hoursUntil = Math.floor(msUntilCleanup / (60 * 60 * 1000));
                const minutesUntil = Math.floor((msUntilCleanup % (60 * 60 * 1000)) / (60 * 1000));
                console.log(`[bangchien] Đặt lịch auto-end BC lúc 23:00 ${day} sau ${hoursUntil}h${minutesUntil}m`);
            }

        } catch (e) {
            console.log('[bangchien] Lỗi đặt lịch tag/cleanup:', e.message);
        }
        // ===== KẾT THÚC ĐẶT LỊCH TAG + CLEANUP =====
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
