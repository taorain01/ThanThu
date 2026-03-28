/**
 * ?listbccus - Xem danh sách BC Tự Do (Custom)
 * Hoạt động giống ?listbc nhưng chỉ tương tác với session custom
 * 
 * Aliases: ?lbcc
 */

const { EmbedBuilder } = require('discord.js');
const { DAY_CONFIG } = require('../../utils/bangchienState');

module.exports = {
    name: 'listbccus',
    aliases: ['lbcc'],
    description: 'Xem danh sách BC Tự Do. Dùng: ?listbccus hoặc ?lbcc',

    async execute(message, args, client) {
        const db = require('../../database/db');
        const guildId = message.guild.id;

        // Tìm session custom đang mở
        const session = db.getActiveBangchienByDay(guildId, 'custom');

        if (!session) {
            return message.reply('📭 Không có phiên **BC Tự Do** đang chạy!');
        }

        // Kiểm tra quyền để hiện buttons quản lý
        const kyCuuRole = message.guild.roles.cache.find(r => r.name === 'Kỳ Cựu');
        const quanLyRole = message.guild.roles.cache.find(r => r.name === 'Quản Lý');
        const leaderBcRole = message.guild.roles.cache.find(r => r.name === 'Leader BC');

        const isKyCuu = kyCuuRole && message.member.roles.cache.has(kyCuuRole.id);
        const isQuanLy = quanLyRole && message.member.roles.cache.has(quanLyRole.id);
        const isLeaderBc = leaderBcRole && message.member.roles.cache.has(leaderBcRole.id);

        // Kiểm tra whitelist từ bccusperm
        const bccuspermCommand = require('./bccusperm');
        const isWhitelisted = bccuspermCommand.isWhitelisted(db, message.author.id);

        // Leader của session cũng có quyền quản lý
        const isSessionLeader = session.leader_id === message.author.id;

        const hasPermission = isKyCuu || isQuanLy || isLeaderBc || isWhitelisted || isSessionLeader;

        // Tái sử dụng showDetailedSession từ listbangchien.js
        const listbangchienCommand = require('./listbangchien');
        await listbangchienCommand.showDetailedSession(message, session, true, 'custom', hasPermission);
    }
};
