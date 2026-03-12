/**
 * ?unequip <id> - Gỡ trang bị
 * ?unequip all - Gỡ tất cả trang bị
 * Aliases: ?ue, ?go
 */

const { EmbedBuilder } = require('discord.js');
const economyDb = require('../../database/economy');
const { SLOTS } = require('../../utils/classSystem');

async function execute(message, args) {
    const userId = message.author.id;

    // ?unequip all - Gỡ hết
    if (args[0] && args[0].toLowerCase() === 'all') {
        return unequipAll(message, userId);
    }

    // Phải có ID
    if (args.length === 0) {
        return message.reply('❌ Vui lòng nhập ID trang bị!\n**Cách dùng:** `?unequip <id>` hoặc `?unequip all`');
    }

    const equipId = parseInt(args[0]);
    if (isNaN(equipId)) {
        return message.reply('❌ ID không hợp lệ!');
    }

    // Lấy equipment
    const equipment = economyDb.getEquipment(equipId);
    if (!equipment) {
        return message.reply('❌ Không tìm thấy trang bị!');
    }
    if (equipment.discord_id !== userId) {
        return message.reply('❌ Đây không phải trang bị của bạn!');
    }

    // Kiểm tra đã mặc chưa
    if (!equipment.is_equipped) {
        return message.reply('❌ Bạn chưa mặc trang bị này!');
    }

    // Gỡ trang bị
    economyDb.unequipItem(userId, equipId);

    const slot = SLOTS[equipment.slot];
    const embed = new EmbedBuilder()
        .setColor(0x95A5A6)
        .setTitle('✅ Đã Gỡ Trang Bị')
        .setDescription(`Đã gỡ **${equipment.name}** khỏi slot ${slot.icon} ${slot.name}`)
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

async function unequipAll(message, userId) {
    const equippedItems = economyDb.getEquippedItems(userId);

    if (equippedItems.length === 0) {
        return message.reply('❌ Bạn chưa mặc đồ nào!');
    }

    // Gỡ tất cả
    for (const item of equippedItems) {
        economyDb.unequipItem(userId, item.id);
    }

    const embed = new EmbedBuilder()
        .setColor(0x95A5A6)
        .setTitle('✅ Đã Gỡ Tất Cả')
        .setDescription(`Đã gỡ **${equippedItems.length}** món trang bị`)
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

module.exports = { execute };


