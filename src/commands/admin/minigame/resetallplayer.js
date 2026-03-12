/**
 * ?resetallplayer - Reset ALL players' minigame data
 * Usage: ?resetallplayer
 * Requires: Owner only
 * CẢNH BÁO: Lệnh này sẽ xóa toàn bộ dữ liệu của TẤT CẢ người chơi!
 */

const { EmbedBuilder } = require('discord.js');
const economyDb = require('../../../database/economy');

// Owner ID - Only this user can use this command
const OWNER_ID = '395151484179841024';

async function execute(message, args) {
    // Check permission - Owner only
    if (message.author.id !== OWNER_ID) {
        return message.reply('❌ Bạn không có quyền thực hiện lệnh này!');
    }

    // Require confirmation
    if (!args[0] || args[0].toLowerCase() !== 'confirm') {
        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('⚠️ CẢNH BÁO: RESET TẤT CẢ NGƯỜI CHƠI')
            .setDescription(`
**Lệnh này sẽ XÓA toàn bộ dữ liệu của TẤT CẢ người chơi:**
• Hạt, Đá T1, Thạch Âm, Box
• Tất cả trang bị
• Nhiệm vụ, thành tựu, tiến độ
• Nhựa và dungeon sessions

**Để xác nhận, gõ:**
\`\`\`
?resetallplayer confirm
\`\`\`
            `)
            .setFooter({ text: 'CẢNH BÁO: Hành động này KHÔNG THỂ HOÀN TÁC!' })
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    try {
        // Get total counts before reset
        const allPlayers = economyDb.db.prepare('SELECT discord_id FROM economy').all();
        const totalPlayers = allPlayers.length;
        let totalEquipment = 0;
        let totalQuests = 0;
        let totalAchievements = 0;

        // Calculate totals
        for (const player of allPlayers) {
            totalEquipment += economyDb.countUserEquipment(player.discord_id);
        }

        try {
            const questCount = economyDb.db.prepare('SELECT COUNT(*) as count FROM daily_quests').get();
            totalQuests += questCount.count;
            const weeklyCount = economyDb.db.prepare('SELECT COUNT(*) as count FROM weekly_quests').get();
            totalQuests += weeklyCount.count;
            const achCount = economyDb.db.prepare('SELECT COUNT(*) as count FROM achievements').get();
            totalAchievements = achCount.count;
        } catch (e) { /* ignore */ }

        // Reset all players
        let successCount = 0;
        let failCount = 0;

        for (const player of allPlayers) {
            try {
                const result = economyDb.clearUserEconomy(player.discord_id);
                if (result.success) {
                    // Reset quests, achievements, progress
                    try {
                        economyDb.db.prepare('DELETE FROM daily_quests WHERE discord_id = ?').run(player.discord_id);
                        economyDb.db.prepare('DELETE FROM weekly_quests WHERE discord_id = ?').run(player.discord_id);
                        economyDb.db.prepare('DELETE FROM achievements WHERE discord_id = ?').run(player.discord_id);
                        economyDb.db.prepare('DELETE FROM player_progress WHERE discord_id = ?').run(player.discord_id);
                        economyDb.db.prepare('DELETE FROM dungeon_sessions WHERE leader_id = ?').run(player.discord_id);
                    } catch (e) { /* ignore */ }
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (e) {
                console.error(`Failed to reset player ${player.discord_id}:`, e);
                failCount++;
            }
        }

        // Success embed
        const embed = new EmbedBuilder()
            .setColor(0x22C55E)
            .setTitle('✅ ĐÃ RESET TẤT CẢ NGƯỜI CHƠI')
            .setDescription(`
**Đã reset thành công ${successCount}/${totalPlayers} người chơi**

**Dữ liệu đã xóa:**
• 👥 ${totalPlayers} người chơi
• ⚔️ ${totalEquipment} trang bị
• 📋 ${totalQuests} nhiệm vụ
• 🏆 ${totalAchievements} thành tựu
${failCount > 0 ? `\n⚠️ **${failCount} lỗi** khi reset` : ''}
            `)
            .setFooter({ text: 'Tất cả người chơi đã được reset về trạng thái ban đầu' })
            .setTimestamp();

        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Reset all players error:', error);
        await message.reply(`❌ Có lỗi xảy ra: ${error.message}`);
    }
}

module.exports = { execute };


