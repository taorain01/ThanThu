/**
 * ?bcql, ?bcquanly - Panel quản lý Bang Chiến (4-TEAM SYSTEM + MULTI-DAY)
 * Hiển thị thống kê từ database và các nút quản lý
 * MULTI-DAY: ?bcql t7, ?bcql cn
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database/db');
const {
    bangchienNotifications,
    getGuildBangchienKeys,
    DAY_CONFIG,
    parseDayArg,
    getDayNameWithDate
} = require('../../utils/bangchienState');

module.exports = {
    name: 'bcquanly',
    aliases: ['bcql', 'bangchienquanly'],
    description: 'Panel quản lý Bang Chiến. Dùng: ?bcql t7, ?bcql cn',

    async execute(message, args, client) {
        const guildId = message.guild.id;
        const userId = message.author.id;

        // Kiểm tra quyền
        const quanLyRole = message.guild.roles.cache.find(r => r.name === 'Quản Lý');
        const leaderBcRole = message.guild.roles.cache.find(r => r.name === 'Leader BC');
        const kyCuuRole = message.guild.roles.cache.find(r => r.name === 'Kỳ Cựu');

        const isQuanLy = quanLyRole && message.member.roles.cache.has(quanLyRole.id);
        const isLeaderBc = leaderBcRole && message.member.roles.cache.has(leaderBcRole.id);
        const isKyCuu = kyCuuRole && message.member.roles.cache.has(kyCuuRole.id);

        // Parse day từ args (MULTI-DAY)
        const day = parseDayArg(args);

        // Lấy active session
        let session;
        if (day) {
            // Có chỉ định ngày → lấy session của ngày đó
            session = db.getActiveBangchienByDay(guildId, day);
            if (!session) {
                return message.reply(`❌ Không có phiên BC ${DAY_CONFIG[day].name} đang chạy!`);
            }
        } else {
            // Không chỉ định ngày → lấy session đầu tiên
            const activeSessions = db.getActiveBangchienByGuild(guildId);
            if (activeSessions.length === 0) {
                return message.reply('❌ Hiện không có phiên Bang Chiến đang chạy!');
            }
            session = activeSessions[0];
        }

        const partyKey = session.party_key;
        const sessionDay = session.day || null;

        // Kiểm tra quyền: Leader của session hoặc Quản Lý/Leader BC/Kỳ Cựu
        const isSessionLeader = session.leader_id === userId;
        if (!isSessionLeader && !isQuanLy && !isLeaderBc && !isKyCuu) {
            return message.reply('❌ Chỉ Leader BC, Quản Lý, hoặc Kỳ Cựu mới được dùng lệnh này!');
        }

        // Lấy data từ database
        const teamAttack1 = session.team_attack1 || [];
        const teamAttack2 = session.team_attack2 || [];
        const teamDefense = session.team_defense || [];
        const teamForest = session.team_forest || [];
        const waitingList = session.waiting_list || [];

        const totalInTeams = teamAttack1.length + teamAttack2.length + teamDefense.length + teamForest.length;
        const total = totalInTeams + waitingList.length;

        // Dynamic team sizes
        const defenseSize = db.getTeamSize('defense');
        const forestSize = db.getTeamSize('forest');

        // Xác định màu và title theo ngày (MULTI-DAY)
        let embedColor = 0x9B59B6;
        let dayTitle = '';
        if (sessionDay && DAY_CONFIG[sessionDay]) {
            embedColor = DAY_CONFIG[sessionDay].color;
            dayTitle = ` - ${getDayNameWithDate(sessionDay)}`;  // Sử dụng ngày cụ thể
        }

        // Tạo embed thống kê
        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle(`🔧 QUẢN LÝ BANG CHIẾN${dayTitle}`)
            .setDescription(`**Leader:** ${session.leader_name}`)
            .addFields(
                { name: '⚔️ Công 1', value: `${teamAttack1.length}/10`, inline: true },
                { name: '🗡️ Công 2', value: `${teamAttack2.length}/10`, inline: true },
                { name: '📊 Tổng', value: `${total}`, inline: true },
                { name: '🛡️ Thủ', value: `${teamDefense.length}/${defenseSize}`, inline: true },
                { name: '🌲 Rừng', value: `${teamForest.length}/${forestSize}`, inline: true },
                { name: '⏳ Chờ', value: `${waitingList.length}`, inline: true }
            )
            .setFooter({ text: 'Dùng ?listbc để xem chi tiết | ?lenhbc để xem lệnh' })
            .setTimestamp();

        // Tạo buttons quản lý (2 rows) — truyền day vào customId giống ?listbc
        const dayParam = sessionDay || 'sat';
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

        const adminMessage = await message.reply({
            embeds: [embed],
            components: [row1, row2]
        });

        // Xóa tin nhắn lệnh
        try { await message.delete(); } catch (e) { }

        // Tự xóa sau 2 phút
        setTimeout(async () => {
            try { await adminMessage.delete(); } catch (e) { }
        }, 120000);
    }
};
