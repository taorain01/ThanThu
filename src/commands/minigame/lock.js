/**
 * ?lock <id> - Khóa/Mở khóa trang bị
 * Trang bị bị khóa không thể bán hoặc phân tách
 */

const { EmbedBuilder } = require('discord.js');
const economyDb = require('../../database/economy');
const { SLOTS } = require('../../utils/classSystem');

async function execute(message, args) {
    if (args.length === 0) {
        return message.reply('❌ Vui lòng nhập ID trang bị!\n**Cách dùng:** `?lock <id>`');
    }

    const equipId = parseInt(args[0]);
    if (isNaN(equipId)) {
        return message.reply('❌ ID không hợp lệ!');
    }

    const userId = message.author.id;

    // Lấy equipment
    const equipment = economyDb.getEquipment(equipId);
    if (!equipment) {
        return message.reply('❌ Không tìm thấy trang bị!');
    }
    if (equipment.discord_id !== userId) {
        return message.reply('❌ Đây không phải trang bị của bạn!');
    }

    // Toggle lock
    const newLockStatus = equipment.is_locked ? 0 : 1;
    economyDb.toggleLockItem(equipId, newLockStatus);

    const slot = SLOTS[equipment.slot];
    const rarityIcon = equipment.rarity === 'gold' ? '🟡' : '🟣';

    const embed = new EmbedBuilder()
        .setColor(newLockStatus ? 0xE74C3C : 0x95A5A6)
        .setTitle(newLockStatus ? '🔒 Đã Khóa' : '🔓 Đã Mở Khóa')
        .setDescription(`${rarityIcon} **${equipment.name}** ${slot.icon}\n\`ID: ${String(equipId).padStart(6, '0')}\``)
        .addFields({
            name: 'Trạng thái',
            value: newLockStatus ? '🔒 Bị khóa - Không thể bán/phân tách' : '🔓 Không khóa - Có thể bán/phân tách',
            inline: false
        })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

module.exports = { execute };


