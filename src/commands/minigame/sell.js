/**
 * ?sell - Mở trang bán trong shop
 * ?sell 1 [số lượng] - Bán Thạch Âm (5000 Hạt/cục)
 * ?sell 2 [số lượng] - Bán đồ Tím ngẫu nhiên (theo mastery, max 150 Hạt/món)
 */

const { EmbedBuilder } = require('discord.js');
const economyDb = require('../../database/economy');
const { calculateEquipmentMastery } = require('../../utils/tuneSystem');
const { SLOTS, getPlayerClass } = require('../../utils/classSystem');

const THACH_AM_SELL_PRICE = 5000; // Hạt/Thạch Âm
const MAX_PURPLE_SELL_PRICE = 150; // Max Hạt/đồ tím

async function execute(message, args) {
    const userId = message.author.id;

    // Nếu không có args → mở trang bán shop
    if (args.length === 0) {
        const { executeSell } = require('./shop');
        return executeSell(message, args);
    }

    const input = args[0].toLowerCase();
    const quantity = Math.max(1, parseInt(args[1]) || 1);

    // ?sell 1 [qty] - Bán Thạch Âm
    if (input === '1' || input === 'thacham') {
        return sellThachAm(message, quantity);
    }

    // ?sell 2 [qty] - Bán đồ Tím ngẫu nhiên
    if (input === '2' || input === 'tim' || input === 'purple') {
        return sellPurpleRandom(message, quantity);
    }

    // ?sell <id> - Bán đồ Tím theo ID cụ thể
    const itemId = parseInt(input);
    if (!isNaN(itemId) && itemId > 10) {
        return sellPurpleById(message, itemId);
    }

    return message.reply('❌ Không hợp lệ!\n**Cách dùng:**\n• `?sell` - Mở shop bán\n• `?sell 1 [số lượng]` - Bán Thạch Âm\n• `?sell 2 [số lượng]` - Bán đồ Tím ngẫu nhiên');
}

async function sellThachAm(message, quantity) {
    const userId = message.author.id;
    const eco = economyDb.getOrCreateEconomy(userId);

    if (eco.thach_am < quantity) {
        return message.reply(`❌ Không đủ Thạch Âm! Cần **${quantity}**, bạn có **${eco.thach_am}**`);
    }

    const sellPrice = THACH_AM_SELL_PRICE * quantity;

    economyDb.subtractThachAm(userId, quantity);
    economyDb.addHat(userId, sellPrice);
    economyDb.logTransaction(userId, 'sell', `Bán ${quantity} Thạch Âm`, sellPrice);

    const newEco = economyDb.getOrCreateEconomy(userId);

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('💰 Bán Thạch Âm')
        .setDescription(`Đã bán **${quantity} Thạch Âm**!`)
        .addFields(
            { name: '💵 Nhận được', value: `+${sellPrice.toLocaleString()} 🌾`, inline: true },
            { name: '🌾 Hạt', value: `${newEco.hat.toLocaleString()}`, inline: true },
            { name: '🔮 Thạch Âm còn', value: `${newEco.thach_am}`, inline: true }
        )
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

async function sellPurpleRandom(message, quantity) {
    const userId = message.author.id;
    const playerClass = getPlayerClass(message.member);

    // Lấy đồ tím chưa mặc
    const items = economyDb.getUserEquipment(userId);
    const purpleItems = items.filter(i => i.rarity === 'purple' && !i.is_equipped);

    if (purpleItems.length === 0) {
        return message.reply('❌ Không có đồ Tím để bán!');
    }

    // Giới hạn số lượng bán
    const toSellCount = Math.min(quantity, purpleItems.length);
    const toSell = purpleItems.slice(0, toSellCount);

    let totalHat = 0;
    const soldItems = [];

    for (const item of toSell) {
        const mastery = calculateEquipmentMastery(item, playerClass);
        const sellPrice = Math.min(mastery, MAX_PURPLE_SELL_PRICE);

        economyDb.deleteEquipment(item.id);
        totalHat += sellPrice;
        soldItems.push({ name: item.name, price: sellPrice });
    }

    economyDb.addHat(userId, totalHat);
    economyDb.logTransaction(userId, 'sell', `Bán ${toSellCount} đồ Tím`, totalHat);

    const newEco = economyDb.getOrCreateEconomy(userId);

    // Format danh sách đã bán
    let soldList = soldItems.slice(0, 5).map(i => `🟣 ${i.name} → **${i.price}** Hạt`).join('\n');
    if (soldItems.length > 5) {
        soldList += `\n... và ${soldItems.length - 5} món khác`;
    }

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('💰 Bán Đồ Tím')
        .setDescription(`Đã bán **${toSellCount}** món đồ Tím!`)
        .addFields(
            { name: '📦 Đã bán', value: soldList || 'Không có', inline: false },
            { name: '💵 Tổng nhận', value: `+${totalHat.toLocaleString()} 🌾`, inline: true },
            { name: '🌾 Hạt hiện có', value: `${newEco.hat.toLocaleString()}`, inline: true }
        )
        .setFooter({ text: `Giá = min(Mastery, ${MAX_PURPLE_SELL_PRICE})` })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

async function sellPurpleById(message, itemId) {
    const userId = message.author.id;
    const playerClass = getPlayerClass(message.member);

    const item = economyDb.getEquipmentById(itemId);

    if (!item) {
        return message.reply(`❌ Không tìm thấy trang bị với ID \`${itemId}\`!`);
    }

    if (item.owner_id !== userId) {
        return message.reply('❌ Đây không phải trang bị của bạn!');
    }

    if (item.is_equipped) {
        return message.reply('❌ Không thể bán trang bị đang mặc! Hãy tháo ra trước.');
    }

    if (item.rarity !== 'purple') {
        return message.reply('❌ Chỉ có thể bán đồ **Tím** bằng lệnh này!\n💡 Đồ Vàng dùng `?buy 2` để đổi lấy đồ mới.');
    }

    const mastery = calculateEquipmentMastery(item, playerClass);
    const sellPrice = Math.min(mastery, MAX_PURPLE_SELL_PRICE);

    economyDb.deleteEquipment(itemId);
    economyDb.addHat(userId, sellPrice);
    economyDb.logTransaction(userId, 'sell', `Bán ${item.name} (Tím)`, sellPrice);

    const slot = SLOTS[item.slot];
    const newEco = economyDb.getOrCreateEconomy(userId);

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('💰 Bán Đồ Tím')
        .setDescription(`Đã bán **${item.name}** (${slot.name})`)
        .addFields(
            { name: '📊 Mastery', value: `${mastery}`, inline: true },
            { name: '💵 Nhận được', value: `+${sellPrice} 🌾`, inline: true },
            { name: '🌾 Hạt hiện có', value: `${newEco.hat.toLocaleString()}`, inline: true }
        )
        .setFooter({ text: `Giá = min(Mastery, ${MAX_PURPLE_SELL_PRICE})` })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

module.exports = { execute, THACH_AM_SELL_PRICE, MAX_PURPLE_SELL_PRICE };


