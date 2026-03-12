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
    parseDayArg,
    createPartyKey,
    getDayFromPartyKey,
    getDayNameWithDate,
    refreshOverviewEmbed
} = require('../../utils/bangchienState');


// Tạo embed thông báo bang chiến - HIỂN THỊ 4 TEAM
function createBangchienEmbed(partyKey, leaderName, guild = null) {
    const db = require('../../database/db');

    // DYNAMIC TEAM SIZES - Đồng bộ với ?bcsize
    const TEAM_ATTACK1_SIZE = db.getTeamSize('attack1') || 10;
    const TEAM_ATTACK2_SIZE = db.getTeamSize('attack2') || 10;
    const TEAM_DEFENSE_SIZE = db.getTeamSize('defense') || 5;
    const TEAM_FOREST_SIZE = db.getTeamSize('forest') || 5;

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
        // LUÔN detect role từ Discord (không dùng role đã lưu vì có thể sai)
        const role = getMemberRole(r.id) || r.role;
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
        const leaderIcon = r.isLeader || r.isTeamLeader ? ' 👑' : '';
        return `${index}. ${roleDisplay}${subTypeTag} ${nameDisplay}${leaderIcon}`;
    }

    // Helper: tính stats
    function getTeamStats(team) {
        let stats = { healer: 0, tanker: 0, dps: 0, unknown: 0 };
        team.forEach(p => {
            // LUÔN detect role từ Discord
            const role = getMemberRole(p.id) || p.role;
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

    // Team Công 1: 1-10
    let currentNum = 1;
    currentNum += addTeamField(embed, 'TEAM CÔNG 1', '⚔️', teamAttack1, TEAM_ATTACK1_SIZE, currentNum);

    // Team Công 2: 11-20
    currentNum += addTeamField(embed, 'TEAM CÔNG 2', '🗡️', teamAttack2, TEAM_ATTACK2_SIZE, currentNum);

    // Team Thủ: 21-25
    currentNum += addTeamField(embed, 'TEAM THỦ', '🛡️', teamDefense, TEAM_DEFENSE_SIZE, currentNum);

    // Team Rừng: 26-30
    currentNum += addTeamField(embed, 'TEAM RỪNG', '🌲', teamForest, TEAM_FOREST_SIZE, currentNum);

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
function createBangchienButtons(partyKey) {
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
            new ButtonBuilder()
                .setCustomId(`bangchien_regular_${partyKey}`)
                .setLabel('🔄 Luôn tham gia')
                .setStyle(ButtonStyle.Primary)
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

/**
 * Tạo embed tổng quan 2 ngày BC
 * @param {string} guildId - Guild ID
 * @returns {EmbedBuilder} Embed với thông tin cả 2 ngày
 */
function createOverviewEmbed(guildId) {
    const db = require('../../database/db');

    const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('⚔️ BANG CHIẾN LANG GIA 📅')
        .setDescription('Bấm nút bên dưới để đăng ký Bang Chiến');

    // Lấy sessions của 2 ngày
    const satSession = db.getActiveBangchienByDay(guildId, 'sat');
    const sunSession = db.getActiveBangchienByDay(guildId, 'sun');

    // Helper: tính tổng và stats cho 1 session
    const getSessionStats = (session) => {
        if (!session) return { total: 0, attack: 0, defense: 0, forest: 0, healer: 0, tanker: 0, dps: 0 };
        const attack = (session.team_attack1?.length || 0) + (session.team_attack2?.length || 0);
        const defense = session.team_defense?.length || 0;
        const forest = session.team_forest?.length || 0;
        const total = attack + defense + forest;

        // Count roles
        const allMembers = [
            ...(session.team_attack1 || []),
            ...(session.team_attack2 || []),
            ...(session.team_defense || []),
            ...(session.team_forest || [])
        ];
        let healer = 0, tanker = 0, dps = 0;
        allMembers.forEach(m => {
            if (m.role === 'Healer') healer++;
            else if (m.role === 'Tanker') tanker++;
            else dps++;
        });

        return { total, attack, defense, forest, healer, tanker, dps };
    };

    // Thứ 7 - với ngày cụ thể
    const satStats = getSessionStats(satSession);
    const satDateStr = getDayNameWithDate('sat').toUpperCase();
    const satStatus = satSession
        ? `📅 **${satDateStr}** (${satStats.total}/30)\n⚔️ Công: ${satStats.attack} | 🛡️ Thủ: ${satStats.defense} | 🌲 Rừng: ${satStats.forest}\n🟢${satStats.healer} 🟠${satStats.tanker} 🔵${satStats.dps}`
        : `📅 **${satDateStr}** - _Chưa mở_\n💡 Dùng \`?bc t7\` để mở`;

    embed.addFields({ name: '\u200b', value: satStatus, inline: false });

    // Chủ Nhật - với ngày cụ thể
    const sunStats = getSessionStats(sunSession);
    const sunDateStr = getDayNameWithDate('sun').toUpperCase();
    const sunStatus = sunSession
        ? `📅 **${sunDateStr}** (${sunStats.total}/30)\n⚔️ Công: ${sunStats.attack} | 🛡️ Thủ: ${sunStats.defense} | 🌲 Rừng: ${sunStats.forest}\n🟢${sunStats.healer} 🟠${sunStats.tanker} 🔵${sunStats.dps}`
        : `📅 **${sunDateStr}** - _Chưa mở_\n💡 Dùng \`?bc cn\` để mở`;

    embed.addFields({ name: '\u200b', value: sunStatus, inline: false });

    embed.setFooter({ text: '💡 Bấm nút để xem chi tiết và đăng ký' })
        .setTimestamp();

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
    const satSession = db.getActiveBangchienByDay(guildId, 'sat');
    const sunSession = db.getActiveBangchienByDay(guildId, 'sun');

    // Nếu không có session nào thì không hiện button
    if (!satSession && !sunSession) {
        return null;
    }

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`bc_menu_${guildId}`)
                .setLabel('📋 Đăng ký BANG CHIẾN')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`bc_viewdetail_${guildId}`)
                .setLabel('🔍 Xem chi tiết')
                .setStyle(ButtonStyle.Secondary)
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

    // Kiểm tra có overview đang hiển thị không
    const overviewData = bangchienOverviews.get(guildId);
    if (!overviewData) return;

    // Kiểm tra có session đang mở không
    const sat = db.getActiveBangchienByDay(guildId, 'sat');
    const sun = db.getActiveBangchienByDay(guildId, 'sun');
    if (!sat && !sun) return;

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
            const newEmbed = createOverviewEmbed(guildId);
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

        // ═══════════════════════════════════════════════════════════════════
        // PARSE ARGS: ?bc / ?bc t7 / ?bc cn
        // ═══════════════════════════════════════════════════════════════════
        const day = parseDayArg(args); // 'sat', 'sun', or null

        // ═══════════════════════════════════════════════════════════════════
        // CASE 1: ?bc (không có args) → Hiển thị Overview 2 ngày
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

            const overviewEmbed = createOverviewEmbed(guildId);
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
        // CASE 2: ?bc t7 / ?bc cn → Tạo hoặc hiển thị session cho ngày đó
        // ═══════════════════════════════════════════════════════════════════
        const dayConfig = DAY_CONFIG[day];

        // Kiểm tra session hiện có trong DB
        const existingSession = db.getActiveBangchienByDay(guildId, day);

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
                    day: day
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
        const partyKey = createPartyKey(guildId, day, leaderId);

        // Khởi tạo trong memory
        bangchienRegistrations.set(partyKey, [{
            id: leaderId,
            username: leaderName,
            joinedAt: Date.now(),
            isLeader: true
        }]);

        // Lưu vào DB với day
        db.createActiveBangchien({
            guildId,
            partyKey,
            leaderId,
            leaderName,
            channelId: message.channel.id,
            messageId: null,
            day: day  // MULTI-DAY: Lưu ngày
        });

        // Auto-add regular participants (CHỈ của ngày đó)
        const regulars = db.getBcRegulars(guildId, day);
        let addedCount = 0;
        const addedUserIds = []; // Lưu lại để cấp role sau
        for (const reg of regulars) {
            if (reg.discord_id === leaderId) continue;

            // Kiểm tra user đã rời guild chưa (left_at)
            const userData = db.getUserByDiscordId(reg.discord_id);
            if (userData && userData.left_at) {
                // Người đã rời guild → xóa khỏi regular và bỏ qua
                db.removeBcRegular(guildId, reg.discord_id, day);
                console.log(`[bangchien] Bỏ regular ${reg.username} vì đã rời guild`);
                continue;
            }

            const result = db.addBangchienParticipant(partyKey, {
                id: reg.discord_id,
                username: reg.username,
                joinedAt: Date.now(),
                isLeader: false,
                isRegular: true
            });

            if (result.success) {
                addedCount++;
                addedUserIds.push(reg.discord_id);
                const regs = bangchienRegistrations.get(partyKey) || [];
                regs.push({
                    id: reg.discord_id,
                    username: reg.username,
                    joinedAt: Date.now(),
                    isLeader: false,
                    isRegular: true
                });
                bangchienRegistrations.set(partyKey, regs);
            }
        }

        // Cấp role Bang Chiến 30vs30 cho regular participants vừa auto-add
        if (addedUserIds.length > 0) {
            const BC_ROLE = 'Bang Chiến 30vs30';
            let bcRole = message.guild.roles.cache.find(r => r.name === BC_ROLE);
            if (!bcRole) {
                try { bcRole = await message.guild.roles.create({ name: BC_ROLE, color: 0xE74C3C, reason: 'BC role' }); } catch (e) { }
            }
            if (bcRole) {
                for (const uid of addedUserIds) {
                    try {
                        const member = await message.guild.members.fetch(uid).catch(() => null);
                        if (member && !member.roles.cache.has(bcRole.id)) await member.roles.add(bcRole);
                    } catch (e) { }
                }
            }
            console.log(`[bangchien] Auto-added ${addedCount} regular participants for ${day} + cấp role BC`);
        }

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
            day: day
        });

        // Cập nhật overview embed
        await refreshOverviewEmbed(client, guildId);

        // Thông báo ngắn
        const reply = await message.channel.send(`✅ Đã mở đăng ký BC **${dayConfig.name}**! Xem tại kênh ?bc overview.`);
        setTimeout(() => { try { reply.delete(); } catch (e) { } }, 8000);

        // Đăng ký kênh
        bangchienChannels.set(guildId, message.channel.id);

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
            const BC_ROLE_NAME = 'Bang Chiến 30vs30';
            const vnOffset = 7 * 60;
            const localOffset = new Date().getTimezoneOffset();
            const now = new Date();
            const vnNow = new Date(now.getTime() + (localOffset + vnOffset) * 60 * 1000);

            // Tìm ngày T7 hoặc CN tiếp theo
            const targetDayOfWeek = day === 'sat' ? 6 : 0; // 6 = T7, 0 = CN
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

            // ===== XÓA ROLE BC LÚC 23:00 VN (sau khi đánh xong) =====
            const cleanupDate = new Date(vnNow);
            cleanupDate.setDate(cleanupDate.getDate() + daysUntilTarget);
            cleanupDate.setHours(23, 0, 0, 0);

            const cleanupUTC = new Date(cleanupDate.getTime() - (localOffset + vnOffset) * 60 * 1000);
            const msUntilCleanup = cleanupUTC.getTime() - Date.now();

            if (msUntilCleanup > 0 && msUntilCleanup < 7 * 24 * 60 * 60 * 1000) {
                setTimeout(async () => {
                    try {
                        const channel = await client.channels.fetch(channelId).catch(() => null);
                        if (!channel) return;
                        const guild = channel.guild;
                        const bcRole = guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
                        if (!bcRole) return;

                        // Lấy tất cả member có role BC
                        const membersWithRole = bcRole.members;
                        let removedCount = 0;

                        for (const [, member] of membersWithRole) {
                            try {
                                await member.roles.remove(bcRole);
                                removedCount++;
                            } catch (e) { }
                        }

                        await channel.send(`🔴 Đã tự động xóa role @${BC_ROLE_NAME} cho **${removedCount}** người sau khi Bang Chiến kết thúc.`);
                        console.log(`[bangchien] Auto-cleanup: Xóa role BC cho ${removedCount} người lúc 23:00 ${day}`);
                    } catch (e) {
                        console.error('[bangchien] Lỗi auto-cleanup role:', e.message);
                    }
                }, msUntilCleanup);

                const hoursUntil = Math.floor(msUntilCleanup / (60 * 60 * 1000));
                const minutesUntil = Math.floor((msUntilCleanup % (60 * 60 * 1000)) / (60 * 1000));
                console.log(`[bangchien] Đặt lịch xóa role BC lúc 23:00 ${day} sau ${hoursUntil}h${minutesUntil}m`);
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
