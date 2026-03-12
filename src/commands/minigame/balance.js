/**
 * ?bal / ?balance - Xem số dư tiền tệ
 */

const { EmbedBuilder } = require('discord.js');
const economyDb = require('../../database/economy');
const { getPlayerClass, getClassInfo } = require('../../utils/classSystem');

async function execute(message, args) {
    const userId = message.author.id;
    const eco = economyDb.getOrCreateEconomy(userId);
    const nhuaInfo = economyDb.getCurrentNhua(userId);
    const lcpCounts = economyDb.getLcpCounts(userId);
    const blessingStatus = economyDb.getBlessingFireStatus(userId);
    const playerClass = getPlayerClass(message.member);
    const classInfo = getClassInfo(playerClass);

    // Build items list
    const items = [];

    // === CURRENCY ===
    if (eco.hat > 0) items.push({ icon: '🌾', name: 'Hạt', amount: eco.hat, category: 'currency', id: 1 });

    // === STAMINA ===
    items.push({ icon: '💧', name: 'Nhựa', amount: `${nhuaInfo.current}/${nhuaInfo.max}`, category: 'stamina', special: true, id: 2 });

    // === MATERIALS ===
    if (eco.enhancement_stone_t1 > 0) items.push({ icon: '💎', name: 'Đá T1', amount: eco.enhancement_stone_t1, category: 'material', id: 3 });
    if (eco.thach_am > 0) items.push({ icon: '🔮', name: 'Thạch Âm', amount: eco.thach_am, category: 'material', id: 4 });
    if (eco.boxes_t1 > 0) items.push({ icon: '📦', name: 'Box T1', amount: eco.boxes_t1, category: 'material', id: 5 });
    if ((eco.black_stone_empty || 0) > 0) items.push({ icon: '🌑', name: 'Đá Đen', amount: eco.black_stone_empty, category: 'material', id: 11 });

    // === CONSUMABLES ===
    if ((eco.nhua_cung || 0) > 0) items.push({ icon: '💊', name: 'Nhựa Cứng', amount: eco.nhua_cung, category: 'consumable', id: 6 });
    if ((eco.bua_khac_yeu || 0) > 0) items.push({ icon: '📜', name: 'Bùa Khắc Yêu', amount: eco.bua_khac_yeu, category: 'consumable', id: 12 });
    if (lcpCounts.lcp > 0) items.push({ icon: '🔥', name: 'Lửa Cầu Phúc', amount: lcpCounts.lcp, category: 'consumable', id: 9 });
    if (lcpCounts.lcpcl > 0) items.push({ icon: '🔥', name: 'LCP Cỡ Lớn', amount: lcpCounts.lcpcl, category: 'consumable', id: 10 });

    // === SPECIAL ITEMS ===
    if ((eco.da_t1_khac_an || 0) > 0) items.push({ icon: '💠', name: 'Tinh Thể Vàng', amount: eco.da_t1_khac_an, category: 'special', id: 7 });
    if ((eco.thach_am_khac_an || 0) > 0) items.push({ icon: '🔷', name: 'Thạch Âm Vàng', amount: eco.thach_am_khac_an, category: 'special', id: 8 });

    // Group by category
    const currency = items.filter(i => i.category === 'currency');
    const stamina = items.filter(i => i.category === 'stamina');
    const materials = items.filter(i => i.category === 'material');
    const consumables = items.filter(i => i.category === 'consumable');
    const special = items.filter(i => i.category === 'special');

    // Format description
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
        materials.forEach(item => {
            description += `${item.icon} ${item.name} [\`${item.id}\`]: \`${item.amount.toLocaleString()}\`\n`;
        });
        description += '\n';
    }

    if (consumables.length > 0) {
        description += '**🧪 Tiêu hao:**\n';
        consumables.forEach(item => {
            description += `${item.icon} ${item.name} [\`${item.id}\`]: \`${item.amount.toLocaleString()}\`\n`;
        });
        description += '\n';
    }

    if (special.length > 0) {
        description += '**✨ Đặc biệt:**\n';
        special.forEach(item => {
            description += `${item.icon} ${item.name} [\`${item.id}\`]: \`${item.amount.toLocaleString()}\`\n`;
        });
    }

    // Build blessing fire footer text
    let blessingFooter = '';
    if (blessingStatus.active) {
        const remaining = Math.ceil((blessingStatus.expiresAt - new Date()) / 1000 / 60);
        const hours = Math.floor(remaining / 60);
        const mins = remaining % 60;
        const timeText = hours > 0 ? `${hours}h${mins}p` : `${mins}p`;
        const typeName = blessingStatus.type === 'lcpcl' ? 'LCP Cỡ Lớn' : 'Lửa Cầu Phúc';
        blessingFooter = ` • 🔥 Đang đốt ${typeName} (${timeText})`;
    }

    const embed = new EmbedBuilder()
        .setColor(blessingStatus.active ? (blessingStatus.type === 'lcpcl' ? 0xFF4500 : 0xFFA07A) : 0x7C3AED)
        .setTitle('💰 Túi Tiền')
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
        .setDescription(description.trim())
        .setFooter({
            text: (playerClass
                ? `Phái: ${classInfo.icon} ${classInfo.name}`
                : `⚠️ Chưa chọn phái! Dùng ?pickrole`) +
                (nhuaInfo.regenTime ? ` • ⏱️ Nhựa: ${nhuaInfo.regenTime}` : '') +
                blessingFooter +
                ` • ?look <id> xem chi tiết`
        })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

module.exports = { execute };


