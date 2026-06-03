/**
 * ?listbc - Xem chi tiết lần bang chiến (4-TEAM SYSTEM + MULTI-DAY)
 * Hiển thị: Team Công 1, Team Công 2, Team Thủ, Team Rừng
 * ĐỒNG BỘ: Kiểm tra active session trước, sau đó mới lấy history
 * MULTI-DAY: ?listbc t7, ?listbc cn
 */

const { EmbedBuilder } = require('discord.js');
const { DAY_CONFIG, parseDayArg, getDayNameWithDate, LEAGUE_TIME, normalizeBcTime } = require('../../utils/bangchienState');
const bangchienRoster = require('../../utils/bangchienRoster');

// Helper: Lấy team config từ DB (size + tên tùy chỉnh, đồng bộ với bcsize và bcql_resize)
function getTeamConfig(db) {
    const names = db.getTeamNames ? db.getTeamNames() : {
        attack1: 'TEAM CÔNG 1', attack2: 'TEAM CÔNG 2',
        defense: 'TEAM THỦ', forest: 'TEAM RỪNG'
    };
    return {
        attack1: { name: names.attack1, emoji: '⚔️', maxSize: db.getTeamSize('attack1') || 10 },
        attack2: { name: names.attack2, emoji: '🗡️', maxSize: db.getTeamSize('attack2') || 10 },
        defense: { name: names.defense, emoji: '🛡️', maxSize: db.getTeamSize('defense') ?? 5 },
        forest:  { name: names.forest,  emoji: '🌲', maxSize: db.getTeamSize('forest')  ?? 5 }
    };
}

module.exports = {
    name: 'listbangchien',
    aliases: ['listbc'],
    description: '[ĐÓNG] Dùng ?bc để xem/đăng ký hoặc ?bcql để quản lý',

    async execute(message, args, client) {
        return message.reply({
            content: '❌ Lệnh `?listbc` đã đóng. Dùng `?bc` để xem/đăng ký hoặc `?bcql` để quản lý Bang Chiến.',
            allowedMentions: { repliedUser: false }
        });

        const db = require('../../database/db');
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const guildId = message.guild.id;
        const userId = message.author.id;

        // Parse day từ args (MULTI-DAY)
        const parsedDayArg = parseDayArg(args);
        const day = parsedDayArg?.day;
        const requestedTime = normalizeBcTime(parsedDayArg?.time || LEAGUE_TIME);

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

            const session = db.getActiveBangchienByDayTime
                ? db.getActiveBangchienByDayTime(guildId, day, requestedTime)
                : db.getActiveBangchienByDay(guildId, day);
            if (!session) {
                return message.reply(`📭 Chưa có phiên BC ${DAY_CONFIG[day].name} ${requestedTime} đang chạy!`);
            }
            return this.showDetailedSession(message, session, true, day, true); // showButtons = true
        }

        // ═══════════════════════════════════════════════════════════════════
        // CASE 2: ?listbc → Tóm tắt các ngày + buttons
        // ═══════════════════════════════════════════════════════════════════
        const allSessions = db.getActiveBangchienByGuild(guildId) || [];
        // Sắp xếp theo ngày tạo gần nhất (thay vì cố định Thứ 2 -> CN)
        allSessions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        // Helper: tính stats cho 1 session
        const getStats = (s) => {
            if (!s) return { total: 0, waiting: 0, byTeam: {}, layout: [] };
            const roster = bangchienRoster.normalizeRoster(s);
            const counts = bangchienRoster.getRosterCounts(roster);
            return { total: counts.active, waiting: counts.waiting, byTeam: counts.byTeam, layout: roster.layout };
        };

        const overviewEmbed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('📋 BANG CHIẾN TUẦN NÀY');

        if (allSessions.length === 0) {
            overviewEmbed.setDescription('📅 Chưa có phiên Bang Chiến nào đang mở.');
        } else {
            for (const sessionItem of allSessions) {
                const stats = getStats(sessionItem);
                const dateStr = getDayNameWithDate(sessionItem.day).toUpperCase();
                const teamLine = stats.layout
                    .map((team) => `${team.icon || '*'} ${team.name}: ${stats.byTeam[team.id] || 0}`)
                    .join(' | ');
                let line = `**${dateStr}** (${stats.total}/30) - Đang diễn ra`;
                if (teamLine) line += `\n${teamLine}`;
                if (stats.waiting > 0) line += `\nChờ: ${stats.waiting}`;
                overviewEmbed.addFields({ name: '\u200b', value: line, inline: false });
            }
        }

        overviewEmbed
            .setFooter({ text: hasPermission ? '💡 Bấm nút để xem chi tiết và quản lý' : '💡 Chỉ Kỳ Cựu mới xem chi tiết' })
            .setTimestamp();

        const overviewComponents = [];
        if (hasPermission && allSessions.length > 0) {
            const shortLabels = { mon: 'T2', tue: 'T3', wed: 'T4', thu: 'T5', fri: 'T6', sat: 'T7', sun: 'CN' };
            const row = new ActionRowBuilder();
            for (const sessionItem of allSessions.slice(0, 4)) {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`listbc_view_${sessionItem.party_key}`)
                        .setLabel(`📋 ${shortLabels[sessionItem.day] || sessionItem.day} ${sessionItem.time || LEAGUE_TIME}`)
                        .setStyle(ButtonStyle.Primary)
                );
            }
            // Add 1 nút Truy cập WEB cùng với các nút trên nếu có (hàng có tối đa 5 components)
            row.addComponents(
                new ButtonBuilder()
                    .setLabel('🌐 Truy cập WEB')
                    .setStyle(ButtonStyle.Link)
                    .setURL('https://langgiawar.vercel.app/')
            );
            overviewComponents.push(row);
        } else {
            const webRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('🌐 Truy cập WEB')
                        .setStyle(ButtonStyle.Link)
                        .setURL('https://langgiawar.vercel.app/')
                );
            overviewComponents.push(webRow);
        }

        return await message.reply({ embeds: [overviewEmbed], components: overviewComponents });
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

        const roster = bangchienRoster.normalizeRoster(session);
        const waitingList = roster.waitingList || [];

        // Collect all member IDs for batch fetch
        const allMemberIds = new Set();
        bangchienRoster.getAllRosterMembers(roster).forEach(p => allMemberIds.add(p.id));

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

        const totalInTeams = bangchienRoster.getRosterCounts(roster).active;

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
        for (const config of roster.layout) {
            const maxSize = Number(config.capacity) || 0;
            if (maxSize <= 0) continue;
            const team = roster.teams[config.id] || [];
            const statsText = getTeamStats(team);
            const teamList = formatTeamList(team, currentNum, maxSize);
            const chunks = splitListIntoChunks(teamList);

            chunks.forEach((chunk, index) => {
                embed.addFields({
                    name: index === 0 ? `${config.icon || '*'} ${config.name} (${team.length}/${maxSize}) [${statsText}]` : '\u200b',
                    value: chunk,
                    inline: false
                });
            });

            currentNum += maxSize;
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
            const dayParam = session.day || day || 'sat'; // Default to sat if not specified

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
                        .setStyle(ButtonStyle.Primary)
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
