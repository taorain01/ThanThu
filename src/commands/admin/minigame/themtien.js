/**
 * ?themtien command - Add Hạt to a user (Admin)
 * Usage: ?themtien <amount> @user
 * Requires: "Quản Lý" role
 */

const { EmbedBuilder } = require('discord.js');
const economyDb = require('../../../database/economy');

// Owner ID - Only this user can use this command
const OWNER_ID = '395151484179841024';

/**
 * Execute themtien command
 */
async function execute(message, args) {
    // Check permission - Owner only
    if (message.author.id !== OWNER_ID) {
        return message.channel.send('❌ Bạn không có quyền thực hiện lệnh này!');
    }

    // Parse arguments: ?themtien <amount> @user
    if (args.length < 2) {
        return message.channel.send('❌ Sử dụng: `?themtien <số tiền> @user`\nVí dụ: `?themtien 100000 @rain`');
    }

    // Parse amount
    const amount = parseInt(args[0]);
    const MAX_AMOUNT = 9999999;

    if (isNaN(amount) || amount <= 0) {
        return message.channel.send('❌ Số tiền không hợp lệ! Phải là số nguyên dương.\nVí dụ: `?themtien 100000 @rain`');
    }

    if (amount > MAX_AMOUNT) {
        return message.channel.send(`❌ Số tiền vượt quá giới hạn! Tối đa: **${MAX_AMOUNT.toLocaleString()}** Hạt`);
    }

    // Parse mentioned user
    const mentionedUser = message.mentions.users.first();
    if (!mentionedUser) {
        return message.channel.send('❌ Vui lòng tag người dùng! Ví dụ: `?themtien 100000 @rain`');
    }

    // Add Hạt
    try {
        economyDb.addHat(mentionedUser.id, amount);

        // Get updated balance
        const economy = economyDb.getOrCreateEconomy(mentionedUser.id);

        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('💰 Đã thêm Hạt!')
            .setDescription(`Đã thêm **${amount.toLocaleString()}** Hạt cho <@${mentionedUser.id}>`)
            .addFields(
                { name: '➕ Số tiền thêm', value: `${amount.toLocaleString()} Hạt`, inline: true },
                { name: '💵 Số dư hiện tại', value: `${economy.hat.toLocaleString()} Hạt`, inline: true }
            )
            .setFooter({ text: `Thực hiện bởi ${message.author.username}` })
            .setTimestamp();

        await message.channel.send({ embeds: [embed] });

        // Log transaction
        economyDb.logTransaction(mentionedUser.id, 'admin_add', `Admin added ${amount} Hạt`, amount);
    } catch (error) {
        console.error('Error adding Hạt:', error);
        await message.channel.send('❌ Có lỗi xảy ra khi thêm tiền!');
    }
}

module.exports = { execute };


