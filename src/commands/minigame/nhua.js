/**
 * ?nhua - Xem tất cả vật phẩm đang sở hữu
 * Alias: ?item, ?vatpham
 */

const { EmbedBuilder } = require('discord.js');
const economyDb = require('../../database/economy');

async function execute(message, args) {
    const userId = message.author.id;
    const eco = economyDb.getOrCreateEconomy(userId);
    const nhuaInfo = economyDb.getCurrentNhua(userId);

    // Build items list - only show items with quantity > 0
    const items = [];

    // === CURRENCY ===
    if (eco.hat > 0) items.push({ icon: '🌾', name: 'Hạt', amount: eco.hat, category: 'currency' });

    // === STAMINA ===
    items.push({ icon: '💧', name: 'Nhựa', amount: `${nhuaInfo.current}/${nhuaInfo.max}`, category: 'stamina', special: true });

    // === MATERIALS ===
    if (eco.enhancement_stone_t1 > 0) items.push({ icon: '💎', name: 'Đá Cường Hóa T1', amount: eco.enhancement_stone_t1, category: 'material' });
    if (eco.thach_am > 0) items.push({ icon: '🔮', name: 'Thạch Âm', amount: eco.thach_am, category: 'material' });
    if (eco.boxes_t1 > 0) items.push({ icon: '📦', name: 'Hòm T1', amount: eco.boxes_t1, category: 'material' });
    if ((eco.black_stone_empty || 0) > 0) items.push({ icon: '🌑', name: 'Đá Đen', amount: eco.black_stone_empty, category: 'material' });

    // === CONSUMABLES ===
    if ((eco.nhua_cung || 0) > 0) items.push({ icon: '💊', name: 'Nhựa Cứng', amount: eco.nhua_cung, category: 'consumable' });
    if ((eco.bua_khac_yeu || 0) > 0) items.push({ icon: '📜', name: 'Bùa Khắc Yêu', amount: eco.bua_khac_yeu, category: 'consumable' });
    if ((eco.lcp || 0) > 0) items.push({ icon: '🔥', name: 'Lửa Cầu Phúc', amount: eco.lcp, category: 'consumable' });
    if ((eco.lcpcl || 0) > 0) items.push({ icon: '🔥', name: 'LCP Cỡ Lớn', amount: eco.lcpcl, category: 'consumable' });

    // === SPECIAL ITEMS ===
    if ((eco.da_t1_khac_an || 0) > 0) items.push({ icon: '💠', name: 'Tinh Thể Vàng', amount: eco.da_t1_khac_an, category: 'special' });
    if ((eco.thach_am_khac_an || 0) > 0) items.push({ icon: '🔷', name: 'Thạch Âm Vàng', amount: eco.thach_am_khac_an, category: 'special' });

    // Build embed
    const embed = new EmbedBuilder()
        .setColor('#7C3AED')
        .setTitle('🎒 VẬT PHẨM')
        .setDescription(`👤 **${message.author.displayName}**`)
        .setTimestamp();

    // Group by category
    const currency = items.filter(i => i.category === 'currency');
    const stamina = items.filter(i => i.category === 'stamina');
    const materials = items.filter(i => i.category === 'material');
    const consumables = items.filter(i => i.category === 'consumable');
    const special = items.filter(i => i.category === 'special');

    // Format each category
    let description = '';

    if (currency.length > 0 || stamina.length > 0) {
        description += '**💰 Tiền tệ:**\n';
        [...currency, ...stamina].forEach(item => {
            const amountStr = typeof item.amount === 'string' ? item.amount : item.amount.toLocaleString();
            description += `${item.icon} ${item.name}: \`${amountStr}\`\n`;
        });
        description += '\n';
    }

    if (materials.length > 0) {
        description += '**📦 Nguyên liệu:**\n';
        // Map item names to IDs
        const idMap = {
            'Đá Cường Hóa T1': 3,
            'Thạch Âm': 4,
            'Hòm T1': 5,
            'Đá Đen': 11
        };
        materials.forEach(item => {
            const id = idMap[item.name] || '?';
            description += `${item.icon} ${item.name} [\`${id}\`]: \`${item.amount.toLocaleString()}\`\n`;
        });
        description += '\n';
    }

    if (consumables.length > 0) {
        description += '**🧪 Tiêu hao:**\n';
        const idMap = {
            'Nhựa Cứng': 6,
            'Bùa Khắc Yêu': 12,
            'Lửa Cầu Phúc': 9,
            'LCP Cỡ Lớn': 10
        };
        consumables.forEach(item => {
            const id = idMap[item.name] || '?';
            description += `${item.icon} ${item.name} [\`${id}\`]: \`${item.amount.toLocaleString()}\`\n`;
        });
        description += '\n';
    }

    if (special.length > 0) {
        description += '**✨ Đặc biệt:**\n';
        const idMap = {
            'Tinh Thể Vàng': 7,
            'Thạch Âm Vàng': 8
        };
        special.forEach(item => {
            const id = idMap[item.name] || '?';
            description += `${item.icon} ${item.name} [\`${id}\`]: \`${item.amount.toLocaleString()}\`\n`;
        });
    }

    embed.setDescription(`👤 **${message.author.displayName}**\n\n${description}`);

    // Add stamina regen info
    if (nhuaInfo.regenTime) {
        embed.setFooter({ text: `⏱️ Nhựa full sau: ${nhuaInfo.regenTime} • ?look <id> để xem chi tiết` });
    } else {
        embed.setFooter({ text: '✅ Nhựa đã đầy • ?look <id> để xem chi tiết' });
    }

    await message.reply({ embeds: [embed] });
}

module.exports = { execute };
