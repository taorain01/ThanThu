/**
 * ?bcchot - Chốt danh sách Bang Chiến (4-TEAM + MULTI-DAY)
 * - Lưu danh sách vào history (snapshot)
 * - Thêm role Bang Chiến 30vs30 cho tất cả người tham gia
 * Cách dùng: ?bcchot t7, ?bcchot cn, ?bcchot all
 */

const { EmbedBuilder } = require('discord.js');
const { DAY_CONFIG, parseDayArg, getDayNameWithDate } = require('../../utils/bangchienState');

const BC_ROLE_NAME = 'bc';

module.exports = {
    name: 'bcchot',
    aliases: ['chotdanhsach', 'finalize', 'chotbc', 'chotbangchien', 'addbcrole'],
    description: 'Chốt BC + thêm role. Dùng: ?bcchot t7, ?bcchot cn, ?bcchot all',

    async execute(message, args, client) {
        const db = require('../../database/db');
        const {
            bangchienNotifications,
            bangchienRegistrations,
            bangchienChannels,
            getGuildBangchienKeys
        } = require('../../utils/bangchienState');

        const guildId = message.guild.id;
        const guild = message.guild;

        // Kiểm tra quyền
        const quanLyRole = guild.roles.cache.find(r => r.name === 'Quản Lý');
        const isQuanLy = quanLyRole && message.member.roles.cache.has(quanLyRole.id);

        // Parse day từ args (MULTI-DAY: t7, cn, all)
        const dayArg = args[0]?.toLowerCase();
        const isAll = dayArg === 'all';
        const day = isAll ? null : parseDayArg(args);

        // Xác định sessions cần xử lý
        let sessionsToProcess = [];

        if (isAll) {
            // ?bcchot all → xử lý cả 2 ngày
            const satSession = db.getActiveBangchienByDay(guildId, 'sat');
            const sunSession = db.getActiveBangchienByDay(guildId, 'sun');
            if (satSession) sessionsToProcess.push({ session: satSession, day: 'sat' });
            if (sunSession) sessionsToProcess.push({ session: sunSession, day: 'sun' });

            if (sessionsToProcess.length === 0) {
                return message.reply('📭 Không có bang chiến đang chạy để chốt!');
            }
        } else if (day) {
            // ?bcchot t7 hoặc ?bcchot cn
            const session = db.getActiveBangchienByDay(guildId, day);
            if (!session) {
                return message.reply(`❌ Không có phiên BC ${DAY_CONFIG[day].name} đang chạy!`);
            }
            sessionsToProcess.push({ session, day });
        } else {
            // ?bcchot (không có tham số) → lấy session đầu tiên
            const activeSessions = db.getActiveBangchienByGuild(guildId);
            if (activeSessions.length === 0) {
                return message.reply('📭 Không có bang chiến đang chạy để chốt!\nDùng: `?bcchot t7`, `?bcchot cn`, hoặc `?bcchot all`');
            }
            const session = activeSessions[0];
            sessionsToProcess.push({ session, day: session.day || 'sat' });
        }

        // Kiểm tra quyền cho từng session
        for (const { session } of sessionsToProcess) {
            if (message.author.id !== session.leader_id && !isQuanLy) {
                return message.reply('❌ Chỉ Leader BC hoặc Quản Lý mới được chốt danh sách!');
            }
        }

        // Role BC đã được cấp ngay khi bấm Tham gia, không cần cấp lại ở đây

        // Thông báo đang xử lý
        const processingMsg = await message.reply(`⏳ Đang chốt ${sessionsToProcess.length} phiên BC...`);

        const results = [];

        // Xử lý từng session
        for (const { session, day: sessionDay } of sessionsToProcess) {
            const dayConfig = DAY_CONFIG[sessionDay];

            // Lấy 4 team data
            const teamAttack1 = session.team_attack1 || [];
            const teamAttack2 = session.team_attack2 || [];
            const teamDefense = session.team_defense || [];
            const teamForest = session.team_forest || [];
            const waitingList = session.waiting_list || [];

            const totalParticipants = teamAttack1.length + teamAttack2.length + teamDefense.length + teamForest.length;
            const allParticipants = [...teamAttack1, ...teamAttack2, ...teamDefense, ...teamForest, ...waitingList];

            if (totalParticipants === 0) {
                results.push({ day: sessionDay, dayName: getDayNameWithDate(sessionDay), status: 'empty', count: 0 });
                continue;
            }

            // Lưu vào history (snapshot)
            db.saveBangchienHistory({
                guildId,
                leaderId: session.leader_id,
                leaderName: session.leader_name,
                participants: allParticipants.slice(0, totalParticipants),
                participantCount: totalParticipants,
                allParticipants,
                totalRegistrations: allParticipants.length,
                teamDefense,
                teamOffense: [],
                commanderId: session.commander_id,
                team1LeaderId: session.team1_leader_id,
                team2LeaderId: session.team2_leader_id,
                teamAttack1,
                teamAttack2,
                teamForest,
                team3LeaderId: session.team3_leader_id,
                team4LeaderId: session.team4_leader_id
            });

            results.push({
                day: sessionDay,
                dayName: getDayNameWithDate(sessionDay),
                status: 'success',
                count: totalParticipants
            });
        }

        // Xóa tin processing
        await processingMsg.delete().catch(() => { });

        // Tạo embed kết quả
        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('📋 CHỐT DANH SÁCH BANG CHIẾN LANG GIA!');

        let description = '';
        for (const result of results) {
            if (result.status === 'empty') {
                description += `📅 **${result.dayName}**: Không có ai đăng ký\n`;
            } else {
                description += `📅 **${result.dayName}**: ${result.count} người\n`;
            }
        }

        embed.setDescription(description);

        embed.setFooter({ text: 'Dùng ?listbc để xem | ?bcend để kết thúc' })
            .setTimestamp();

        await message.reply({ embeds: [embed] });

        console.log(`[bcchot] ${message.author.username} chốt ${results.length} phiên BC`);
    }
};

// Export role name để các lệnh khác sử dụng
module.exports.BC_ROLE_NAME = BC_ROLE_NAME;

