/**
 * ?dismantle - Phân tách đồ Tím lấy Đá T1
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const economyDb = require('../../database/economy');
const { SLOTS } = require('../../utils/classSystem');

async function execute(message, args) {
    const userId = message.author.id;

    // Lấy đồ Tím
    const purpleItems = economyDb.getUserPurpleEquipment(userId);

    if (purpleItems.length === 0) {
        return message.reply('❌ Bạn không có đồ Tím nào để phân tách!\nMở box bằng `?buy box` để nhận đồ.');
    }

    // Nếu có argument là ID
    if (args.length > 0) {
        if (args[0].toLowerCase() === 'all') {
            return dismantleAll(message, purpleItems);
        }

        const equipId = parseInt(args[0]);
        if (isNaN(equipId)) {
            return message.reply('❌ ID không hợp lệ!');
        }

        return dismantleSingle(message, equipId, purpleItems);
    }

    // Hiển thị danh sách đồ Tím
    const itemList = purpleItems.slice(0, 10).map((item, i) => {
        const slot = SLOTS[item.slot];
        return `\`${item.id}\` ${slot.icon} **${item.name}** (${slot.name})`;
    }).join('\n');

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🔨 Phân Tách Trang Bị')
        .setDescription(`Bạn có **${purpleItems.length}** đồ Tím.\nMỗi đồ Tím = **1 💎 Đá T1**`)
        .addFields(
            { name: '📋 Danh sách (10 đầu)', value: itemList || 'Không có', inline: false }
        )
        .setFooter({ text: '?dismantle <id> | ?dismantle all' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

async function dismantleSingle(message, equipId, purpleItems) {
    const item = purpleItems.find(i => i.id === equipId);

    if (!item) {
        return message.reply('❌ Không tìm thấy đồ Tím với ID này!');
    }

    // Xóa equipment
    economyDb.deleteEquipment(equipId);

    // Cộng 1 Đá T1
    economyDb.addStoneT1(message.author.id, 1);
    economyDb.logTransaction(message.author.id, 'dismantle', `${item.name}`, 1);

    const eco = economyDb.getOrCreateEconomy(message.author.id);
    const slot = SLOTS[item.slot];

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ Phân Tách Thành Công')
        .setDescription(`Đã phân tách **${item.name}** (${slot.icon} ${slot.name})`)
        .addFields(
            { name: '💎 Nhận được', value: '1 Đá T1', inline: true },
            { name: '💎 Đá T1 hiện có', value: `${eco.enhancement_stone_t1}`, inline: true }
        )
        .setTimestamp();

    // Quest progress
    const { updateQuestProgress, sendQuestNotifications } = require('../../utils/questSystem');
    const completedQuests = updateQuestProgress(message.author.id, 'items_dismantled', 1);

    await message.reply({ embeds: [embed] });
    await sendQuestNotifications(message.channel, message.author.id, completedQuests);
}

async function dismantleAll(message, purpleItems) {
    const count = purpleItems.length;
    const stones = count * 1;

    // Xóa tất cả
    for (const item of purpleItems) {
        economyDb.deleteEquipment(item.id);
    }

    // Cộng Đá T1
    economyDb.addStoneT1(message.author.id, stones);
    economyDb.logTransaction(message.author.id, 'dismantle_all', `${count} items`, stones);

    const eco = economyDb.getOrCreateEconomy(message.author.id);

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ Phân Tách Tất Cả')
        .setDescription(`Đã phân tách **${count}** đồ Tím`)
        .addFields(
            { name: '💎 Nhận được', value: `${stones} Đá T1`, inline: true },
            { name: '💎 Đá T1 hiện có', value: `${eco.enhancement_stone_t1}`, inline: true }
        )
        .setTimestamp();

    // Quest progress
    const { updateQuestProgress, sendQuestNotifications } = require('../../utils/questSystem');
    const completedQuests = updateQuestProgress(message.author.id, 'items_dismantled', count);

    await message.reply({ embeds: [embed] });
    await sendQuestNotifications(message.channel, message.author.id, completedQuests);
}

module.exports = { execute };


