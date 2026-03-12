/**
 * ?checkmem - Kiểm tra thành viên đã rời server
 * So sánh danh sách trong DB với members thực tế trên Discord server
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');

module.exports = {
    name: 'checkmem',
    aliases: ['kiemtramem', 'checkroi'],
    description: 'Kiểm tra thành viên đã rời Discord server',

    async execute(message, args) {
        const guild = message.guild;

        // Lấy danh sách từ DB
        const activeMembers = db.getActiveUsers();

        if (activeMembers.length === 0) {
            return message.reply('📭 Chưa có thành viên nào trong database!');
        }

        const processingMsg = await message.reply('⏳ Đang kiểm tra thành viên...');

        const leftMembers = [];
        let checkedCount = 0;

        for (const mem of activeMembers) {
            if (!mem.discord_id) continue;

            try {
                // Thử fetch member từ guild
                const guildMember = await guild.members.fetch({ user: mem.discord_id, force: true }).catch(() => null);

                if (!guildMember) {
                    // Member đã rời server
                    leftMembers.push({
                        discord_id: mem.discord_id,
                        discord_name: mem.discord_name || 'N/A',
                        game_username: mem.game_username || 'N/A',
                        game_uid: mem.game_uid || 'N/A',
                        position: mem.position || 'mem'
                    });
                }
                checkedCount++;
            } catch (e) {
                // Fetch lỗi = member không còn
                leftMembers.push({
                    discord_id: mem.discord_id,
                    discord_name: mem.discord_name || 'N/A',
                    game_username: mem.game_username || 'N/A',
                    game_uid: mem.game_uid || 'N/A',
                    position: mem.position || 'mem'
                });
                checkedCount++;
            }
        }

        await processingMsg.delete().catch(() => { });

        // Build embed kết quả
        const embed = new EmbedBuilder()
            .setColor(leftMembers.length > 0 ? 0xE74C3C : 0x2ECC71)
            .setTitle('🔍 KẾT QUẢ KIỂM TRA THÀNH VIÊN')
            .setTimestamp()
            .setFooter({ text: 'Lang Gia Các' });

        if (leftMembers.length === 0) {
            embed.setDescription(`✅ Không có ai rời server!\n\n📊 Đã kiểm tra **${checkedCount}/${activeMembers.length}** thành viên.`);
        } else {
            // Hiển thị danh sách đã rời
            let list = '';
            leftMembers.forEach((mem, i) => {
                list += `**${i + 1}.** ${mem.game_username} (\`${mem.game_uid}\`)\n`;
                list += `   └ Discord: ${mem.discord_name} (${mem.discord_id})\n`;
            });

            if (list.length > 1900) {
                list = list.substring(0, 1900) + '\n... và thêm nữa';
            }

            embed.setDescription(
                `⚠️ Tìm thấy **${leftMembers.length}** người đã rời server!\n\n` +
                `📊 Đã kiểm tra **${checkedCount}/${activeMembers.length}** thành viên.\n\n` +
                `**Danh sách đã rời:**\n${list}`
            );

            // Thêm hướng dẫn xóa
            embed.addFields({
                name: '💡 Hướng dẫn',
                value: 'Dùng `?delmem <discord_id>` hoặc `?delid <game_uid>` để xóa khỏi danh sách.'
            });
        }

        return message.reply({ embeds: [embed] });
    }
};
