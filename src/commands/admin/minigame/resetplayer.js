/**
 * ?resetplayer @user - Reset toàn bộ dữ liệu minigame của user
 * Usage: ?resetplayer @user
 * Requires: Owner only
 */

const { EmbedBuilder } = require('discord.js');
const economyDb = require('../../../database/economy');

// Owner ID - Only this user can use this command
const OWNER_ID = '395151484179841024';

async function execute(message, args, commandName) {
    // Check permission - Owner only
    if (message.author.id !== OWNER_ID) {
        return message.reply('❌ Bạn không có quyền thực hiện lệnh này!');
    }

    // Determine target user
    let targetUser;

    // 1. Check for mentions first
    const mentionedUser = message.mentions.users.first();
    if (mentionedUser) {
        targetUser = mentionedUser;
    }
    // 2. Check for username/display name in args
    else if (args.length > 0) {
        const searchTerm = args.join(' ').toLowerCase();

        try {
            const members = await message.guild.members.fetch();
            const found = members.find(m =>
                !m.user.bot && (
                    m.user.username.toLowerCase() === searchTerm ||
                    m.displayName.toLowerCase() === searchTerm ||
                    m.user.username.toLowerCase().includes(searchTerm) ||
                    m.displayName.toLowerCase().includes(searchTerm)
                )
            );

            if (found) {
                targetUser = found.user;
            } else {
                return message.reply(`❌ Không tìm thấy user "${args.join(' ')}"!\nThử:\n• \`?reset @user\`\n• \`?reset username\`\n• \`?reset\` (reset bản thân)`);
            }
        } catch (e) {
            console.error('Error finding user:', e);
            return message.reply('❌ Có lỗi khi tìm user!');
        }
    }
    // 3. No args = reset self
    else {
        targetUser = message.author;
    }

    // Get current data before reset
    const economy = economyDb.getOrCreateEconomy(targetUser.id);
    const equipmentCount = economyDb.countUserEquipment(targetUser.id);

    try {
        // Get quest and achievement stats before reset
        let questsDeleted = 0;
        let achievementsDeleted = 0;
        let progressDeleted = 0;

        try {
            const dailyQuests = economyDb.db.prepare('SELECT * FROM daily_quests WHERE discord_id = ?').get(targetUser.id);
            const weeklyQuests = economyDb.db.prepare('SELECT * FROM weekly_quests WHERE discord_id = ?').get(targetUser.id);
            const achievements = economyDb.db.prepare('SELECT COUNT(*) as count FROM achievements WHERE discord_id = ?').get(targetUser.id);
            const progress = economyDb.db.prepare('SELECT * FROM player_progress WHERE discord_id = ?').get(targetUser.id);

            if (dailyQuests) questsDeleted += 5;
            if (weeklyQuests) questsDeleted += 2;
            if (achievements) achievementsDeleted = achievements.count;
            if (progress) progressDeleted = 1;
        } catch (e) { /* ignore if tables don't exist */ }

        // Reset all minigame data
        const result = economyDb.clearUserEconomy(targetUser.id);

        if (result.success) {
            // Reset quests, achievements, and progress
            try {
                economyDb.db.prepare('DELETE FROM daily_quests WHERE discord_id = ?').run(targetUser.id);
                economyDb.db.prepare('DELETE FROM weekly_quests WHERE discord_id = ?').run(targetUser.id);
                economyDb.db.prepare('DELETE FROM achievements WHERE discord_id = ?').run(targetUser.id);
                economyDb.db.prepare('DELETE FROM player_progress WHERE discord_id = ?').run(targetUser.id);
            } catch (e) { /* ignore if tables don't exist */ }

            // Reset blessing fire status
            try {
                economyDb.db.prepare(`
                    UPDATE economy SET 
                        blessing_fire_type = NULL,
                        blessing_fire_expires_at = NULL,
                        lcp_auto_type = NULL
                    WHERE discord_id = ?
                `).run(targetUser.id);
            } catch (e) { /* ignore */ }

            // Reset inventory slots về 500
            try {
                economyDb.resetInvSlots(targetUser.id);
            } catch (e) { /* ignore */ }

            const embed = new EmbedBuilder()
                .setColor('#EF4444')
                .setTitle('🔄 Reset Player thành công!')
                .setDescription(`Đã reset **TẤT CẢ** dữ liệu minigame của <@${targetUser.id}>`)
                .addFields(
                    { name: '🎒 Trang bị đã xóa', value: `${equipmentCount}`, inline: true },
                    { name: '💰 Hạt đã xóa', value: `${economy.hat.toLocaleString()}`, inline: true },
                    { name: '💎 Đá T1 đã xóa', value: `${economy.enhancement_stone_t1}`, inline: true },
                    { name: '🔮 Thạch Âm đã xóa', value: `${economy.thach_am}`, inline: true },
                    { name: '📦 Box đã xóa', value: `${economy.boxes_t1 || 0}`, inline: true },
                    { name: '💧 Nhựa đã reset', value: `${economy.nhua || 0} → 500`, inline: true },
                    { name: '🔥 LCP đã xóa', value: `${economy.lcp || 0}`, inline: true },
                    { name: '🔥 LCPCL đã xóa', value: `${economy.lcpcl || 0}`, inline: true },
                    { name: '💊 Nhựa Cứng đã xóa', value: `${economy.nhua_cung || 0}`, inline: true },
                    { name: '💠 Tinh Thể Vàng đã xóa', value: `${economy.da_t1_khac_an || 0}`, inline: true },
                    { name: '🔷 Thạch Âm Vàng đã xóa', value: `${economy.thach_am_khac_an || 0}`, inline: true },
                    { name: '📋 Nhiệm vụ đã xóa', value: `${questsDeleted}`, inline: true }
                )
                .setFooter({ text: `⚠️ Thực hiện bởi ${message.author.username}` })
                .setTimestamp();

            await message.reply({ embeds: [embed] });

            // Log
            economyDb.logTransaction(
                targetUser.id,
                'admin_reset',
                `Reset player: ${equipmentCount} items, ${economy.hat} Hạt, ${questsDeleted} quests, ${achievementsDeleted} achievements`,
                0
            );
        } else {
            await message.reply(`❌ Có lỗi xảy ra: ${result.error}`);
        }
    } catch (error) {
        console.error('Error resetting player:', error);
        await message.reply('❌ Có lỗi xảy ra khi reset player!');
    }
}

module.exports = { execute };


