/**
 * ?addnhuafull - Fill nhựa to max (Owner only)
 * Usage: ?addnhuafull hoặc ?addnhuafull @user
 */

const { EmbedBuilder } = require('discord.js');
const economy = require('../../../database/economy');

const OWNER_ID = '395151484179841024';
const MAX_NHUA = 500;

async function execute(message, args) {
    // Check owner permission
    if (message.author.id !== OWNER_ID) {
        return message.reply('❌ Bạn không có quyền sử dụng lệnh này!');
    }

    // Target user: mentioned or self
    const targetUser = message.mentions.users.first() || message.author;
    const targetId = targetUser.id;

    // Fill nhựa to max
    economy.db.prepare(`
        UPDATE economy SET nhua = ?, nhua_updated_at = ?
        WHERE discord_id = ?
    `).run(MAX_NHUA, new Date().toISOString(), targetId);

    // If user doesn't exist, create them first
    economy.getOrCreateEconomy(targetId);
    economy.db.prepare(`
        UPDATE economy SET nhua = ?, nhua_updated_at = ?
        WHERE discord_id = ?
    `).run(MAX_NHUA, new Date().toISOString(), targetId);

    const embed = new EmbedBuilder()
        .setColor('#22C55E')
        .setTitle('💧 Nhựa đã được nạp đầy!')
        .setDescription(`<@${targetId}> đã được nạp **${MAX_NHUA}** 💧 Nhựa`)
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

module.exports = { execute };


