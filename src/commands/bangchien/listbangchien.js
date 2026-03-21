/**
 * ?listbc - Xem chi tiết lần bang chiến (4-TEAM SYSTEM + MULTI-DAY)
 * Hiển thị: Team Công 1, Team Công 2, Team Thủ, Team Rừng
 * ĐỒNG BỘ: Kiểm tra active session trước, sau đó mới lấy history
 * MULTI-DAY: ?listbc t7, ?listbc cn
 */

const { EmbedBuilder } = require('discord.js');
const { DAY_CONFIG, parseDayArg, getDayNameWithDate } = require('../../utils/bangchienState');

// Helper: Lấy team sizes từ DB (đồng bộ với ?bcsize)
function getTeamConfig(db) {
    return {
        attack1: { name: 'TEAM CÔNG 1', emoji: '⚔️', maxSize: db.getTeamSize('attack1') || 10 },
        attack2: { name: 'TEAM CÔNG 2', emoji: '🗡️', maxSize: db.getTeamSize('attack2') || 10 },
        defense: { name: 'TEAM THỦ', emoji: '🛡️', maxSize: db.getTeamSize('defense') ?? 5 },
        forest: { name: 'TEAM RỪNG', emoji: '🌲', maxSize: db.getTeamSize('forest') ?? 5 }
    };
}

module.exports = {
    name: 'listbangchien',
    aliases: ['listbc'],
    description: 'Xem bang chiến. ?listbc (tổng quan), ?listbc t7/cn (chi tiết, Kỳ Cựu)',

    async execute(message, args, client) {
        const db = require('../../database/db');
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const guildId = message.guild.id;
        const userId = message.author.id;

        // Parse day từ args (MULTI-DAY)
        const day = parseDayArg(args);

        // Kiểm tra quyền Kỳ Cựu cho ?listbc t7/cn
        const kyCuuRole = message.guild.roles.cache.find(r => r.name === 'Kỳ Cựu');
        const quanLyRole = message.guild.roles.cache.find(r => r.name === 'Quản Lý');
        const leaderBcRole = message.guild.roles.cache.find(r => r.name === 'Leader BC');

        const isKyCuu = kyCuuRole && message.member.roles.cache.has(kyCuuRole.id);
        const isQuanLy = quanLyRole && message.member.roles.cache.has(quanLyRole.id);
        const isLeaderBc = leaderBcRole && message.member.roles.cache.has(leaderBcRole.id);
        const hasPermission = isKyCuu || isQuanLy || isLeaderBc;

        // ═══════════════════════════════════════════════════════════════════
        // CASE 1: ?listbc t7 / ?listbc cn → Chi tiết + bcql buttons (Kỳ Cựu only)
        // ═══════════════════════════════════════════════════════════════════
        if (day) {
            if (!hasPermission) {
                return message.reply('❌ Chỉ Kỳ Cựu, Leader BC, hoặc Quản Lý mới xem chi tiết theo ngày!');
            }

            const session = db.getActiveBangchienByDay(guildId, day);
            if (!session) {
                return message.reply(`📭 Chưa có phiên BC ${DAY_CONFIG[day].name} đang chạy!`);
            }
            return this.showDetailedSession(message, session, true, day, true); // showButtons = true
        }

        // ═══════════════════════════════════════════════════════════════════
        // CASE 2: ?listbc → Tóm tắt 2 ngày + buttons T7/CN
        // ═══════════════════════════════════════════════════════════════════
        const satSession = db.getActiveBangchienByDay(guildId, 'sat');
        const sunSession = db.getActiveBangchienByDay(guildId, 'sun');

        // Helper: tính stats cho 1 session
        const getStats = (s) => {
            if (!s) return { total: 0, attack: 0, defense: 0, forest: 0 };
            const attack = (s.team_attack1?.length || 0) + (s.team_attack2?.length || 0);
            const defense = s.team_defense?.length || 0;
            const forest = s.team_forest?.length || 0;
            return { total: attack + defense + forest, attack, defense, forest };
        };

        const satStats = getStats(satSession);
        const sunStats = getStats(sunSession);

        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('📋 BANG CHIẾN TUẦN NÀY');

        // Thứ 7 - với ngày cụ thể
        const satDateStr = getDayNameWithDate('sat').toUpperCase();
        const satStatus = satSession
            ? (() => {
                let line = `📅 **${satDateStr}** (${satStats.total}/30) - Đang diễn ra\n⚔️ Công: ${satStats.attack}`;
                if ((db.getTeamSize('defense') ?? 5) > 0) line += ` | 🛡️ Thủ: ${satStats.defense}`;
                if ((db.getTeamSize('forest') ?? 5) > 0) line += ` | 🌲 Rừng: ${satStats.forest}`;
                return line;
            })()
            : `📅 **${satDateStr}** - _Chưa mở_`;
        embed.addFields({ name: '\u200b', value: satStatus, inline: false });

        // Chủ Nhật - với ngày cụ thể
        const sunDateStr = getDayNameWithDate('sun').toUpperCase();
        const sunStatus = sunSession
            ? (() => {
                let line = `📅 **${sunDateStr}** (${sunStats.total}/30) - Đang diễn ra\n⚔️ Công: ${sunStats.attack}`;
                if ((db.getTeamSize('defense') ?? 5) > 0) line += ` | 🛡️ Thủ: ${sunStats.defense}`;
                if ((db.getTeamSize('forest') ?? 5) > 0) line += ` | 🌲 Rừng: ${sunStats.forest}`;
                return line;
            })()
            : `📅 **${sunDateStr}** - _Chưa mở_`;
        embed.addFields({ name: '\u200b', value: sunStatus, inline: false });

        embed.setFooter({ text: hasPermission ? '💡 Bấm nút để xem chi tiết và quản lý' : '💡 Chỉ Kỳ Cựu mới xem chi tiết' })
            .setTimestamp();

        // Buttons T7/CN (chỉ cho Kỳ Cựu+)
        const components = [];
        if (hasPermission) {
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`listbc_view_sat_${guildId}`)
                        .setLabel('📋 Thứ 7')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(!satSession),
                    new ButtonBuilder()
                        .setCustomId(`listbc_view_sun_${guildId}`)
                        .setLabel('📋 Chủ Nhật')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(!sunSession)
                );
            components.push(row);
        }

        await message.reply({ embeds: [embed], components });
    },


    async showDetailedSession(message, session, isActive = false, day = null, showButtons = false) {
        const db = require('../../database/db');
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const guild = message.guild;
        const TEAM_CONFIG = getTeamConfig(db);

        // Xác định màu và title theo ngày (MULTI-DAY)
        let embedColor = isActive ? 0x00FF00 : 0x9B59B6;
        let dayTitle = '';
        if (day && DAY_CONFIG[day]) {
            embedColor = DAY_CONFIG[day].color;
            dayTitle = ` - ${getDayNameWithDate(day)}`;  // Sử dụng ngày cụ thể
        }

        // Role emojis
        const roleEmojis = {
            'DPS': '🔵', 'Quạt Dù': '🔵', 'Vô Danh': '🔵', 'Song Đao': '🔵', 'Cửu Kiếm': '🔵',
            'Healer': '🟢', 'Tanker': '🟠', 'Unknown': '❓'
        };
        const dpsSubTypeRoles = ['Quạt Dù', 'Vô Danh', 'Song Đao', 'Cửu Kiếm'];
        const allRoleNames = ['DPS', 'Healer', 'Tanker'];
        const dpsShortTags = { 'Quạt Dù': 'QD', 'Vô Danh': 'VD', 'Song Đao': 'SD', 'Cửu Kiếm': '9K' };

        // Parse 4 teams from session
        const teams = {
            attack1: typeof session.team_attack1 === 'string' ? JSON.parse(session.team_attack1 || '[]') : session.team_attack1 || [],
            attack2: typeof session.team_attack2 === 'string' ? JSON.parse(session.team_attack2 || '[]') : session.team_attack2 || [],
            defense: typeof session.team_defense === 'string' ? JSON.parse(session.team_defense || '[]') : session.team_defense || [],
            forest: typeof session.team_forest === 'string' ? JSON.parse(session.team_forest || '[]') : session.team_forest || []
        };
        const waitingList = typeof session.waiting_list === 'string' ? JSON.parse(session.waiting_list || '[]') : session.waiting_list || [];

        // Collect all member IDs for batch fetch
        const allMemberIds = new Set();
        Object.values(teams).forEach(team => team.forEach(p => allMemberIds.add(p.id)));
        waitingList.forEach(p => allMemberIds.add(p.id));

        // Batch fetch all members
        try {
            await guild.members.fetch({ user: [...allMemberIds] });
        } catch (e) {
            console.log('[listbc] Batch fetch warning:', e.message);
        }

        // Helper: get role from cache - ƯU TIÊN Healer/Tanker trước DPS
        function getMemberRole(memberId) {
            try {
                const member = guild.members.cache.get(memberId);
                if (!member) return 'Unknown';

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
            return 'Unknown';
        }

        // Helper: format team list (chỉ hiện 1 slot trống nếu chưa đầy)
        function formatTeamList(team, startIndex = 1, maxSize = null) {
            const lines = [];
            // Hiển thị members
            for (let i = 0; i < team.length; i++) {
                const slotNum = startIndex + i;
                const p = team[i];
                const userData = db.getUserByDiscordId(p.id);
                const gameName = userData?.game_username || null;
                const role = getMemberRole(p.id);
                const roleIcon = roleEmojis[role] || '❓';

                let subTypeTag = '';
                if (role === 'DPS') {
                    const member = guild.members.cache.get(p.id);
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

                const nameDisplay = gameName ? `<@${p.id}> (${gameName})` : `<@${p.id}>`;
                const leaderIcon = p.isTeamLeader ? ' 👑' : '';
                lines.push(`${slotNum}. ${roleIcon}${subTypeTag} ${nameDisplay}${leaderIcon}`);
            }
            // Chỉ thêm 1 slot trống nếu team chưa đầy
            if (maxSize && team.length < maxSize) {
                const nextSlot = startIndex + team.length;
                lines.push(`${nextSlot}. _Trống..._`);
            }
            return lines.join('\n') || '_Trống..._';
        }

        // Helper: get team stats
        function getTeamStats(team) {
            let stats = { healer: 0, tanker: 0, dps: 0, unknown: 0 };
            for (const p of team) {
                const role = getMemberRole(p.id);
                if (role === 'Healer') stats.healer++;
                else if (role === 'Tanker') stats.tanker++;
                else if (role === 'DPS') stats.dps++;
                else stats.unknown++;
            }
            return `🟢${stats.healer} 🟠${stats.tanker} 🔵${stats.dps}` + (stats.unknown > 0 ? ` ❓${stats.unknown}` : '');
        }

        // Helper: split long list
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

        const date = new Date(session.created_at).toLocaleString('vi-VN', {
            weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        const totalInTeams = teams.attack1.length + teams.attack2.length + teams.defense.length + teams.forest.length;

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle(isActive ? `⚔️ BANG CHIẾN ĐANG DIỄN RA${dayTitle}` : `📋 DUYỆT DANH SÁCH BANG CHIẾN LANG GIA${dayTitle}`)
            .setDescription(`**Ngày:** ${date}`)
            .addFields({
                name: '📊 Tổng quan',
                value: `Đi: **${totalInTeams}** | Chờ: **${waitingList.length}** | Tổng: **${totalInTeams + waitingList.length}**`,
                inline: false
            });

        // Add teams - chỉ hiện team có maxSize > 0
        let currentNum = 1;
        for (const [teamKey, config] of Object.entries(TEAM_CONFIG)) {
            if (config.maxSize === 0) {
                // Skip team có size = 0, vẫn cộng maxSize để giữ số thứ tự liên tục
                currentNum += config.maxSize;
                continue;
            }
            const team = teams[teamKey];
            const statsText = getTeamStats(team);
            const teamList = formatTeamList(team, currentNum, config.maxSize);
            const chunks = splitListIntoChunks(teamList);

            chunks.forEach((chunk, index) => {
                embed.addFields({
                    name: index === 0 ? `${config.emoji} ${config.name} (${team.length}/${config.maxSize}) [${statsText}]` : '​',
                    value: chunk,
                    inline: false
                });
            });

            currentNum += config.maxSize; // Dùng maxSize để số thứ tự cố định
        }

        // Add waiting list
        if (waitingList.length > 0) {
            const waitingFormatted = formatTeamList(waitingList, currentNum);
            const waitingChunks = splitListIntoChunks(waitingFormatted);
            waitingChunks.forEach((chunk, index) => {
                embed.addFields({
                    name: index === 0 ? `⏳ DANH SÁCH CHỜ (${waitingList.length})` : '​',
                    value: chunk,
                    inline: false
                });
            });
        }

        embed.setFooter({ text: isActive ? `🟢 Active • Dùng ?bcend khi xong` : `ID: ${session.id || 'N/A'} • History` })
            .setTimestamp(new Date(session.created_at));

        // Nếu là Kỳ Cựu+ và active session → thêm bcql buttons
        const components = [];
        if (showButtons && isActive && session.party_key) {
            const partyKey = session.party_key;
            const dayParam = day || 'sat'; // Default to sat if not specified

            const row1 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`bcql_kick_${partyKey}_${dayParam}`)
                        .setLabel('❌ Loại bỏ')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(`bcql_finalize_${partyKey}_${dayParam}`)
                        .setLabel('📋 Chốt DS')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`bcql_resize_${partyKey}_${dayParam}`)
                        .setLabel('📏 Resize')
                        .setStyle(ButtonStyle.Secondary)
                );

            const row2 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`bcql_swap_${partyKey}_${dayParam}`)
                        .setLabel('🔄 Đổi chỗ')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`bcql_add_${partyKey}_${dayParam}`)
                        .setLabel('➕ Thêm người')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`bcql_setleader_${partyKey}_${dayParam}`)
                        .setLabel('👑 Set Leader')
                        .setStyle(ButtonStyle.Secondary)
                );

            components.push(row1, row2);
        }

        await message.reply({ embeds: [embed], components });
    }
};
