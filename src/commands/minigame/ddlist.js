/**
 * ?ddlist / ?dadenlist - Xem danh sách tất cả Đá Đen
 * Hiển thị đá trống và đá đã hút năng lực
 */

const { EmbedBuilder } = require('discord.js');
const economyDb = require('../../database/economy');
const { SLOTS } = require('../../utils/classSystem');

async function execute(message, args) {
    const userId = message.author.id;

    const emptyStones = economyDb.getBlackStoneCount(userId);
    const absorbedStones = economyDb.getAbsorbedStones(userId);

    if (emptyStones === 0 && absorbedStones.length === 0) {
        return message.reply([
            '❌ Bạn không có **Đá Đen** nào!',
            '',
            '**Mua:** `?buy daden` (500 Đá T1)',
            '**Hút:** `?daden` để hút năng lực từ đồ vàng'
        ].join('\n'));
    }

    // Format absorbed stones
    let absorbedText = '_Chưa có đá nào được hút_';
    if (absorbedStones.length > 0) {
        absorbedText = absorbedStones.map(stone => {
            const slot = SLOTS[stone.equipment_type];
            const createdAt = new Date(stone.created_at);
            const dateStr = createdAt.toLocaleDateString('vi-VN');
            return [
                `**#${stone.id}** | ${slot.icon} ${slot.shortName}`,
                `  └ ${stone.line_icon} ${stone.line_name}: **${stone.line_value}${stone.line_unit || ''}** (${stone.line_percent}%)`
            ].join('\n');
        }).join('\n\n');
    }

    const embed = new EmbedBuilder()
        .setColor('#1F2937')
        .setTitle('🌑 Đá Đen của bạn')
        .setDescription([
            `📦 **Đá Đen Trống:** ${emptyStones}`,
            '',
            '**Đá Đã Hút Năng Lực:**',
            absorbedText
        ].join('\n'))
        .addFields(
            { name: '📊 Tổng', value: `${emptyStones + absorbedStones.length} đá`, inline: true },
            { name: '🌑 Trống', value: `${emptyStones}`, inline: true },
            { name: '⚡ Đã hút', value: `${absorbedStones.length}`, inline: true }
        )
        .setFooter({ text: '?daden để hút thêm | ?khacda <stone_id> <equip_id> <line> để khắc' })
        .setTimestamp();

    return message.reply({ embeds: [embed] });
}

module.exports = { execute };


