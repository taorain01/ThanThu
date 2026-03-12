/**
 * ?cleardung - Admin command to clear expired dungeon sessions
 * Usage: ?cleardung [all|user @mention]
 */

const { EmbedBuilder } = require('discord.js');
const economy = require('../../../database/economy');

// Owner ID - only owner can use this
const OWNER_ID = '395151484179841024';

module.exports = {
    name: 'cleardung',
    aliases: ['dungclear', 'resetdung'],
    description: 'Xóa dungeon sessions (Admin only)',

    async execute(message, args) {
        // Permission check - owner only
        if (message.author.id !== OWNER_ID) {
            return message.reply('❌ Chỉ owner mới có thể sử dụng lệnh này!');
        }

        try {
            let result;
            let description;

            if (args[0] === 'all') {
                // Clear ALL sessions
                result = economy.db.prepare(`
                    UPDATE dungeon_sessions SET status = 'cancelled' 
                    WHERE status = 'in_progress'
                `).run();
                description = `Đã hủy **${result.changes}** dungeon session(s) đang chạy.`;
            } else if (message.mentions.users.first()) {
                // Clear specific user's sessions
                const targetUser = message.mentions.users.first();
                result = economy.db.prepare(`
                    UPDATE dungeon_sessions SET status = 'cancelled' 
                    WHERE status = 'in_progress' AND leader_id = ?
                `).run(targetUser.id);
                description = `Đã hủy **${result.changes}** dungeon session(s) của <@${targetUser.id}>.`;
            } else {
                // Clear caller's sessions (default)
                result = economy.db.prepare(`
                    UPDATE dungeon_sessions SET status = 'cancelled' 
                    WHERE status = 'in_progress' AND leader_id = ?
                `).run(message.author.id);
                description = `Đã hủy **${result.changes}** dungeon session(s) của bạn.`;
            }

            const embed = new EmbedBuilder()
                .setColor('#22C55E')
                .setTitle('🧹 Clear Dungeon Sessions')
                .setDescription(description)
                .addFields({
                    name: '💡 Cách dùng',
                    value: [
                        '`?cleardung` - Xóa sessions của bạn',
                        '`?cleardung @user` - Xóa sessions của user',
                        '`?cleardung all` - Xóa TẤT CẢ sessions'
                    ].join('\n')
                })
                .setTimestamp();

            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error clearing dungeon sessions:', error);
            await message.reply('❌ Có lỗi xảy ra khi xóa sessions!');
        }
    }
};
