const { EmbedBuilder } = require('discord.js');
const { DAY_CONFIG, parseDayArg } = require('../../utils/bangchienState');

module.exports = {
    name: 'bcrole',
    aliases: ['bctanker', 'bcdps', 'bchealer'],
    description: 'Xem thành viên BC theo role. Dùng: ?bcrole t7/cn <tanker|dps|healer>',

    async execute(message, args, client) {
        const db = require('../../database/db');
        const guildId = message.guild.id;
        const guild = message.guild;
        const commandName = message.content.split(' ')[0].slice(1).toLowerCase();

        // Parse day từ args (MULTI-DAY)
        const day = parseDayArg(args);

        // Xác định role cần lọc
        let targetRole = null;
        let roleEmoji = '';
        let roleColor = 0x9B59B6;

        if (commandName === 'bctanker') {
            targetRole = 'Tanker';
            roleEmoji = '🟠';
            roleColor = 0xFF9900;
        } else if (commandName === 'bcdps') {
            targetRole = 'DPS';
            roleEmoji = '🔵';
            roleColor = 0x0099FF;
        } else if (commandName === 'bchealer') {
            targetRole = 'Healer';
            roleEmoji = '🟢';
            roleColor = 0x00FF00;
        } else {
            // ?bcrole <role> hoặc ?bcrole t7/cn <role>
            // Tìm role arg (không phải t7/cn)
            const roleArg = args.find(a => ['tanker', 'dps', 'healer'].includes(a.toLowerCase()));
            if (roleArg?.toLowerCase() === 'tanker') {
                targetRole = 'Tanker';
                roleEmoji = '🟠';
                roleColor = 0xFF9900;
            } else if (roleArg?.toLowerCase() === 'dps') {
                targetRole = 'DPS';
                roleEmoji = '🔵';
                roleColor = 0x0099FF;
            } else if (roleArg?.toLowerCase() === 'healer') {
                targetRole = 'Healer';
                roleEmoji = '🟢';
                roleColor = 0x00FF00;
            } else {
                return message.reply('❌ Cách dùng:\n`?bctanker` `?bcdps` `?bchealer`\nhoặc `?bcrole t7/cn <tanker|dps|healer>`');
            }
        }

        // Lấy session (ưu tiên active, fallback history)
        let session;
        if (day) {
            session = db.getActiveBangchienByDay(guildId, day);
            if (!session) {
                // Fallback to history
                const history = db.getBangchienHistory(guildId, 1);
                if (history.length === 0) {
                    return message.reply(`❌ Không có phiên BC ${DAY_CONFIG[day].name}!`);
                }
                session = history[0];
            }
        } else {
            const activeSessions = db.getActiveBangchienByGuild(guildId);
            if (activeSessions.length > 0) {
                session = activeSessions[0];
            } else {
                const history = db.getBangchienHistory(guildId, 1);
                if (history.length === 0) {
                    return message.reply('📭 Chưa có lịch sử bang chiến nào!');
                }
                session = history[0];
            }
        }

        // Không cần check kết quả nữa

        // Lấy danh sách tất cả participants
        let allMembers = [];
        if (session.team_defense && session.team_offense) {
            allMembers = [...session.team_defense, ...session.team_offense];
        } else if (session.participants) {
            allMembers = session.participants.slice(0, session.participant_count);
        }

        if (allMembers.length === 0) {
            return message.reply('❌ Không có dữ liệu thành viên trong session này!');
        }

        // Helper: fetch và check role - ƯU TIÊN Healer/Tanker trước DPS
        async function getMemberRole(memberId) {
            try {
                let member;
                try {
                    member = await guild.members.fetch({ user: memberId, force: true });
                } catch (e) {
                    member = guild.members.cache.get(memberId);
                }
                if (!member) return 'Unknown';

                // Check Healer và Tanker TRƯỚC (ưu tiên cao hơn)
                const healerRole = guild.roles.cache.find(r => r.name === 'Healer');
                if (healerRole && member.roles.cache.has(healerRole.id)) return 'Healer';

                const tankerRole = guild.roles.cache.find(r => r.name === 'Tanker');
                if (tankerRole && member.roles.cache.has(tankerRole.id)) return 'Tanker';

                // Check DPS sub-types
                const dpsSubTypes = ['Quạt Dù', 'Vô Danh', 'Song Đao', 'Cửu Kiếm'];
                for (const subTypeName of dpsSubTypes) {
                    const role = guild.roles.cache.find(r => r.name === subTypeName);
                    if (role && member.roles.cache.has(role.id)) return 'DPS';
                }

                // Check DPS role
                const dpsRole = guild.roles.cache.find(r => r.name === 'DPS');
                if (dpsRole && member.roles.cache.has(dpsRole.id)) return 'DPS';
            } catch (e) { }
            return 'Unknown';
        }

        // Lọc members theo role - GIỮ NGUYÊN SỐ THỨ TỰ GỐC
        const filteredMembers = [];
        const defenseLen = session.team_defense?.length || 0;

        for (let i = 0; i < allMembers.length; i++) {
            const p = allMembers[i];
            const role = p.role || await getMemberRole(p.id);
            if (role === targetRole) {
                const userData = db.getUserByDiscordId(p.id);
                const gameName = userData?.game_username || null;
                // Tính số thứ tự gốc: Defense 1-15, Offense 16-30
                const originalIndex = i + 1;
                filteredMembers.push({
                    id: p.id,
                    username: p.username,
                    gameName: gameName,
                    isTeamLeader: p.isTeamLeader || false,
                    originalIndex: originalIndex,
                    team: i < defenseLen ? '🛡️' : '⚔️'
                });
            }
        }

        if (filteredMembers.length === 0) {
            return message.reply(`❌ Không có thành viên nào là **${targetRole}** trong lần BC này!`);
        }

        // Tạo danh sách - SỬ DỤNG SỐ THỨ TỰ GỐC
        const memberList = filteredMembers.map((p) => {
            const nameDisplay = p.gameName ? `<@${p.id}> (${p.gameName})` : `<@${p.id}>`;
            const leaderIcon = p.isTeamLeader ? ' <a:oz_diamond:1251414256990031965>' : '';
            return `${p.originalIndex}. ${p.team} ${nameDisplay}${leaderIcon}`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setColor(roleColor)
            .setTitle(`${roleEmoji} DANH SÁCH ${targetRole.toUpperCase()} - BANG CHIẾN`)
            .setDescription(`**Tổng: ${filteredMembers.length} người**\n\n${memberList}`)
            .setFooter({ text: `Lần BC gần nhất • Leader: ${session.leader_name || 'Unknown'}` })
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }
};
