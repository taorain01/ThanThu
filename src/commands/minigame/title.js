/**
 * ?settitle, ?danhieu - Quản lý danh hiệu
 */

const { EmbedBuilder } = require('discord.js');
const economyDb = require('../../database/economy');
const { ACHIEVEMENTS, getPlayerAchievements } = require('../../utils/achievementSystem');

async function execute(message, args) {
    const userId = message.author.id;
    const eco = economyDb.getOrCreateEconomy(userId);

    // Lấy danh sách title đã unlock
    const unlockedIds = getPlayerAchievements(userId);
    const unlockedTitles = ACHIEVEMENTS
        .filter(a => unlockedIds.includes(a.id) && a.reward.title)
        .map(a => ({ id: a.id, title: a.reward.title, name: a.name }));

    // ?settitle remove - Bỏ title
    if (args[0] === 'remove' || args[0] === 'bo') {
        economyDb.db.prepare('UPDATE economy SET active_title = NULL WHERE discord_id = ?').run(userId);
        return message.reply('✅ Đã bỏ danh hiệu!');
    }

    // ?settitle <id> - Cài title
    if (args[0]) {
        const titleId = parseInt(args[0]);
        const selectedTitle = unlockedTitles.find(t => t.id === titleId);

        if (!selectedTitle) {
            return message.reply('❌ Danh hiệu không hợp lệ hoặc chưa unlock!');
        }

        economyDb.db.prepare('UPDATE economy SET active_title = ? WHERE discord_id = ?').run(selectedTitle.title, userId);
        return message.reply(`✅ Đã cài danh hiệu: **${selectedTitle.title}**`);
    }

    // ?settitle - Xem danh sách
    if (unlockedTitles.length === 0) {
        return message.reply('❌ Bạn chưa có danh hiệu nào!\nHoàn thành thành tựu đặc biệt để nhận danh hiệu.');
    }

    let description = '';
    for (const t of unlockedTitles) {
        const isActive = eco.active_title === t.title;
        description += `${isActive ? '✅' : '⬜'} **\`${t.id}\`** ${t.title}\n└ *${t.name}*\n`;
    }

    const embed = new EmbedBuilder()
        .setColor(0x8B5CF6)
        .setTitle('🏷️ DANH HIỆU')
        .setDescription(description)
        .addFields({
            name: 'Đang dùng',
            value: eco.active_title || 'Không có',
            inline: true
        })
        .setFooter({ text: '?settitle <id> để cài • ?settitle remove để bỏ' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

module.exports = { execute };


