/**
 * ?huybangchien - Huỷ đăng ký Bang Chiến (MULTI-DAY)
 * Cách dùng: ?huybc t7, ?huybc cn, ?huybc all
 */

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const {
    bangchienNotifications,
    bangchienRegistrations,
    bangchienChannels,
    getGuildBangchienKeys,
    DAY_CONFIG,
    parseDayArg
} = require('../../utils/bangchienState');

module.exports = {
    name: 'huybangchien',
    aliases: ['huybc'],
    description: 'Huỷ BC đang chạy. Dùng: ?huybc t7, ?huybc cn, ?huybc all',

    async execute(message, args, client) {
        const db = require('../../database/db');
        const guildId = message.guild.id;
        const userId = message.author.id;

        // Parse day từ args (MULTI-DAY: t7, cn, all)
        const dayArg = args[0]?.toLowerCase();
        const isAll = dayArg === 'all';
        const day = isAll ? null : parseDayArg(args);

        // Xác định sessions cần xử lý
        let sessionsToCancel = [];

        if (isAll) {
            // ?huybc all → huỷ cả 2 ngày
            const satSession = db.getActiveBangchienByDay(guildId, 'sat');
            const sunSession = db.getActiveBangchienByDay(guildId, 'sun');
            if (satSession) sessionsToCancel.push({ session: satSession, day: 'sat' });
            if (sunSession) sessionsToCancel.push({ session: sunSession, day: 'sun' });

            if (sessionsToCancel.length === 0) {
                return message.reply('📭 Không có bang chiến đang chạy để huỷ!');
            }
        } else if (day) {
            // ?huybc t7 hoặc ?huybc cn
            const session = db.getActiveBangchienByDay(guildId, day);
            if (!session) {
                return message.reply(`❌ Không có phiên BC ${DAY_CONFIG[day].name} đang chạy!`);
            }
            sessionsToCancel.push({ session, day });
        } else {
            // ?huybc (không có tham số) → hướng dẫn
            const activeDbSessions = db.getActiveBangchienByGuild(guildId);
            if (activeDbSessions.length === 0) {
                return message.reply('📭 Không có bang chiến đang chạy để huỷ!');
            }

            if (activeDbSessions.length > 1) {
                return message.reply('❓ Có nhiều phiên BC đang chạy. Vui lòng chọn:\n`?huybc t7` - Huỷ Thứ 7\n`?huybc cn` - Huỷ Chủ Nhật\n`?huybc all` - Huỷ tất cả');
            }

            const session = activeDbSessions[0];
            sessionsToCancel.push({ session, day: session.day || 'sat' });
        }

        // Kiểm tra quyền
        const hasManagePermission = message.member.permissions.has(PermissionFlagsBits.ManageGuild);

        for (const { session } of sessionsToCancel) {
            const isLeader = session.leader_id === userId;
            if (!isLeader && !hasManagePermission) {
                return message.reply(`❌ Chỉ Leader BC hoặc người có quyền quản lý server mới có thể huỷ!`);
            }
        }

        const results = [];

        // Xử lý huỷ từng session
        for (const { session, day: sessionDay } of sessionsToCancel) {
            const dayConfig = DAY_CONFIG[sessionDay];
            const partyKey = session.party_key;
            const notifData = bangchienNotifications.get(partyKey);

            // Đếm số người đăng ký
            const registrationCount = (session.team_attack1?.length || 0) +
                (session.team_attack2?.length || 0) +
                (session.team_defense?.length || 0) +
                (session.team_forest?.length || 0) +
                (session.waiting_list?.length || 0);

            // Huỷ interval
            if (notifData?.intervalId) {
                clearInterval(notifData.intervalId);
            }

            // Xoá tin nhắn embed cũ
            try {
                if (notifData?.message) {
                    await notifData.message.delete();
                }
            } catch (e) { }

            // Xoá dữ liệu từ các Map
            bangchienNotifications.delete(partyKey);
            bangchienRegistrations.delete(partyKey);

            // Xoá từ DB
            db.deleteActiveBangchien(partyKey);

            results.push({
                day: sessionDay,
                dayName: dayConfig.name,
                leaderName: session.leader_name,
                count: registrationCount
            });
        }

        // Xoá channel mapping nếu không còn session nào
        const remainingSessions = db.getActiveBangchienByGuild(guildId);
        if (remainingSessions.length === 0) {
            bangchienChannels.delete(guildId);
        }

        // Gửi thông báo xác nhận
        let description = '';
        for (const result of results) {
            description += `📅 **${result.dayName}**: Đã huỷ (${result.count} người đã đăng ký)\n`;
        }

        const successEmbed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('✅ Đã huỷ đăng ký Bang Chiến')
            .setDescription(description)
            .setFooter({ text: 'Sử dụng ?bc t7 hoặc ?bc cn để tạo phiên mới' })
            .setTimestamp();

        await message.channel.send({ embeds: [successEmbed] });

        // Xóa tin nhắn lệnh
        try {
            await message.delete();
        } catch (e) { }

        console.log(`[huybangchien] ${message.author.username} đã huỷ ${results.length} phiên BC`);
    }
};
