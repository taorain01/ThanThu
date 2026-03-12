/**
 * ?buy <item> [quantity] - Mua item từ shop
 * ?buy 1 hoặc ?buy box - Mua Box
 * ?buy 2 hoặc ?doi - Đổi 3 đồ vàng lấy 1 đồ vàng random
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const economyDb = require('../../database/economy');
const { createEquipmentFromBox, formatLine, calculateEquipmentMastery } = require('../../utils/tuneSystem');
const { SLOTS, getPlayerClass, isDeCu } = require('../../utils/classSystem');
const ICONS = require('../../config/icons');

// MAX_INVENTORY removed - now uses dynamic inv_slots from database

async function execute(message, args) {
    // Nếu không có args → mở shop
    if (args.length === 0) {
        const shopCommand = require('./shop');
        return shopCommand.execute(message, args);
    }

    const input = args[0].toLowerCase();
    const quantity = Math.max(1, parseInt(args[1]) || 1);
    const eco = economyDb.getOrCreateEconomy(message.author.id);

    // Map ID hoặc tên → function
    const itemMap = {
        'box': () => buyBox(message, eco, quantity),
        '1': () => buyBox(message, eco, quantity),
        '2': () => exchangeGold(message, quantity),
        'lcp': () => buyLcp(message, eco, quantity),
        '3': () => buyLcp(message, eco, quantity),
        'daden': () => buyBlackStone(message, eco, quantity),
        'dd': () => buyBlackStone(message, eco, quantity),
        '4': () => buyBlackStone(message, eco, quantity),
        'slot': () => buySlot(message, quantity),
        'slots': () => buySlot(message, quantity),
        'kho': () => buySlot(message, quantity),
        '5': () => buySlot(message, quantity)
    };

    if (itemMap[input]) {
        return itemMap[input]();
    } else {
        return message.reply('❌ Item không tồn tại!\n**Cách dùng:** `?buy <item> <số lượng>` hoặc `?mua <item> <số lượng>`\n**Có sẵn:** `1` Box | `2` Đổi Vàng | `3` LCP | `4` Đá Đen | `5` Slot Kho\n💵 **Bán:** Dùng `?sell` để bán');
    }
}

async function buyBox(message, eco, quantity = 1) {
    const price = 100 * quantity;

    if (eco.hat < price) {
        return message.reply(`❌ Không đủ Hạt! Cần **${price.toLocaleString()}** 🌾, bạn có **${eco.hat.toLocaleString()}** 🌾`);
    }

    economyDb.subtractHat(message.author.id, price);
    economyDb.addBoxesT1(message.author.id, quantity);
    economyDb.logTransaction(message.author.id, 'buy', `Box Tier 1 x${quantity}`, -price);

    // Track shop_bought quest
    const { updateQuestProgress, sendQuestNotifications } = require('../../utils/questSystem');
    const completedQuests = updateQuestProgress(message.author.id, 'shop_bought', 1);
    if (completedQuests.length > 0) {
        await sendQuestNotifications(message.channel, message.author.id, completedQuests);
    }

    const newEco = economyDb.getOrCreateEconomy(message.author.id);
    const totalBoxes = newEco.boxes_t1 || 0;

    // Check blessing fire status
    const blessingStatus = economyDb.getBlessingFireStatus(message.author.id);
    let blessingText = '';
    let embedColor = '#22C55E';

    if (blessingStatus.active) {
        const remaining = Math.ceil((blessingStatus.expiresAt - new Date()) / 1000 / 60);
        const hours = Math.floor(remaining / 60);
        const mins = remaining % 60;
        const timeText = hours > 0 ? `${hours}h${mins}p` : `${mins}p`;
        const typeName = blessingStatus.type === 'lcpcl' ? 'Lửa Cầu Phúc Cỡ Lớn' : 'Lửa Cầu Phúc';
        blessingText = `\n🔥 **Đang đốt ${typeName}** (+${blessingStatus.bonusPercent}% vàng) • ${timeText}`;
        // LCP: màu nhạt hơn (#FFA07A - salmon), LCPCL: màu đậm (#FF4500 - orangered)
        embedColor = blessingStatus.type === 'lcpcl' ? '#FF4500' : '#FFA07A';
    }

    const { createBoxOpenUI, openBoxesAnimated, openBoxesInstant } = require('../../utils/boxOpening');
    const { embed: boxEmbed, row } = createBoxOpenUI(message.author.id, totalBoxes);

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle('📦 Mua Box thành công!')
        .setDescription(`Đã mua **${quantity} Box T1**\n💰 Chi phí: **${price.toLocaleString()}** Hạt${blessingText}`)
        .addFields(
            { name: '📦 Tổng Box', value: `${totalBoxes}`, inline: true },
            { name: '💰 Hạt còn lại', value: `${newEco.hat.toLocaleString()}`, inline: true }
        )
        .setFooter({ text: blessingStatus.active ? `🔥 Đang đốt ${blessingStatus.type === 'lcpcl' ? 'Lửa Cầu Phúc Cỡ Lớn' : 'Lửa Cầu Phúc'}` : 'Chọn cách mở box bên dưới' })
        .setTimestamp();

    const components = row ? [row] : [];
    const reply = await message.reply({ embeds: [embed], components });

    if (!row) return;

    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === message.author.id && (i.customId.startsWith('box10_') || i.customId.startsWith('boxall_')),
        time: 60000
    });

    collector.on('collect', async (interaction) => {
        try {
            const currentEco = economyDb.getOrCreateEconomy(message.author.id);
            const currentBoxes = currentEco.boxes_t1 || 0;

            if (currentBoxes <= 0) {
                return interaction.reply({ content: '❌ Bạn không còn box nào!', ephemeral: true });
            }

            collector.stop('open');

            if (interaction.customId.startsWith('box10_')) {
                const toOpen = Math.min(10, currentBoxes);
                economyDb.subtractBoxesT1(message.author.id, toOpen);
                await openBoxesAnimated(interaction, toOpen, message.author.id);
            } else if (interaction.customId.startsWith('boxall_')) {
                economyDb.subtractBoxesT1(message.author.id, currentBoxes);
                await openBoxesInstant(interaction, currentBoxes, message.author.id);
            }
        } catch (error) {
            if (error.code === 10062 || error.code === 40060) {
                try { await reply.edit({ components: [] }); } catch (e) { }
            } else {
                console.error('[buy] Lỗi xử lý nút:', error.message);
            }
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            await reply.edit({ components: [] }).catch(() => { });
        }
    });
}

/**
 * Mua slot kho với giá leo thang
 * Lần 1-5: 5,000 Hạt
 * Lần 6-10: 10,000 Hạt
 * Lần 11+: 20,000 Hạt
 */
async function buySlot(message, quantity = 1) {
    const userId = message.author.id;
    const qty = Math.max(1, Math.min(100, quantity)); // Max 100 lần

    // Calculate total cost for multiple purchases
    let totalCost = 0;
    let totalSlots = 0;
    const purchaseCount = economyDb.getSlotPurchaseCount(userId);

    for (let i = 0; i < qty; i++) {
        const currentCount = purchaseCount + i;
        let price;
        if (currentCount < 5) price = 5000;
        else if (currentCount < 10) price = 10000;
        else price = 20000;
        totalCost += price;
        totalSlots += 100;
    }

    const eco = economyDb.getOrCreateEconomy(userId);
    if (eco.hat < totalCost) {
        return message.reply(`❌ Không đủ Hạt!\nCần **${totalCost.toLocaleString()}** 🌾 để mua **${qty}** lần (${totalSlots.toLocaleString()} slots)\nBạn có: **${eco.hat.toLocaleString()}** 🌾`);
    }

    // Purchase multiple times
    let successCount = 0;
    let actualCost = 0;
    let actualSlots = 0;

    for (let i = 0; i < qty; i++) {
        const result = economyDb.purchaseSlots(userId, 100);
        if (!result.success) break;
        successCount++;
        actualCost += result.price;
        actualSlots += 100;
    }

    if (successCount === 0) {
        return message.reply('❌ Không thể mua slot!');
    }

    const newPurchaseCount = economyDb.getSlotPurchaseCount(userId);
    const finalEco = economyDb.getOrCreateEconomy(userId);
    const newSlots = finalEco.inv_slots;
    const remainingHat = finalEco.hat;

    const tierInfo = newPurchaseCount <= 5
        ? `Tier 1 (${newPurchaseCount}/5)`
        : newPurchaseCount <= 10
            ? `Tier 2 (${newPurchaseCount - 5}/5)`
            : `Tier 3`;

    // Calculate next price
    let nextPrice;
    if (newPurchaseCount < 5) nextPrice = 5000;
    else if (newPurchaseCount < 10) nextPrice = 10000;
    else nextPrice = 20000;

    const embed = new EmbedBuilder()
        .setColor('#22C55E')
        .setTitle('🎒 Mở Rộng Kho Thành Công!')
        .setDescription(successCount > 1 ? `Đã mua **${successCount}** lần (+**${actualSlots.toLocaleString()}** slots)` : `+**100** slot kho đồ`)
        .addFields(
            { name: '📦 Slot mới', value: `**${newSlots.toLocaleString()}**`, inline: true },
            { name: '💰 Đã trả', value: `**${actualCost.toLocaleString()}** Hạt`, inline: true },
            { name: '📈 Giá tiếp', value: `**${nextPrice.toLocaleString()}** Hạt`, inline: true },
            { name: '🌾 Hạt còn lại', value: `**${remainingHat.toLocaleString()}**`, inline: true }
        )
        .setFooter({ text: `${tierInfo} • Giá: 5k→10k→20k theo tier` })
        .setTimestamp();

    economyDb.logTransaction(userId, 'buy_slot', `+${actualSlots} slots (${successCount}x)`, -actualCost);

    // Track shop_bought quest
    const { updateQuestProgress, sendQuestNotifications } = require('../../utils/questSystem');
    const completedQuests = updateQuestProgress(userId, 'shop_bought', 1);

    await message.reply({ embeds: [embed] });
    await sendQuestNotifications(message.channel, userId, completedQuests);
}

// Mua Lửa Cầu Phúc
async function buyLcp(message, eco, quantity = 1) {
    const userId = message.author.id;
    const price = 10000 * quantity;

    if (eco.hat < price) {
        return message.reply(`❌ Không đủ Hạt! Cần **${price.toLocaleString()}** 🌾, bạn có **${eco.hat.toLocaleString()}** 🌾`);
    }

    // Trừ Hạt, thêm LCP
    economyDb.subtractHat(userId, price);
    economyDb.addLcp(userId, quantity);
    economyDb.logTransaction(userId, 'buy', `Lửa Cầu Phúc x${quantity}`, -price);

    // Track shop_bought quest
    const { updateQuestProgress, sendQuestNotifications } = require('../../utils/questSystem');
    const completedQuests = updateQuestProgress(userId, 'shop_bought', quantity);

    const newEco = economyDb.getOrCreateEconomy(userId);

    const embed = new EmbedBuilder()
        .setColor('#FFA07A')
        .setTitle('🔥 Mua Lửa Cầu Phúc thành công!')
        .setDescription([
            `📦 **Số lượng:** ${quantity}`,
            `💰 **Tổng giá:** ${price.toLocaleString()} Hạt`,
            '',
            `🔥 **LCP hiện có:** ${newEco.lcp || 0}`,
            `🌾 **Hạt còn lại:** ${newEco.hat.toLocaleString()}`
        ].join('\n'))
        .setFooter({ text: '?use lcp để đốt ngay!' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
    await sendQuestNotifications(message.channel, userId, completedQuests);
}

// Mua Đá Đen (200 Đá T1 / viên)
async function buyBlackStone(message, eco, quantity = 1) {
    const userId = message.author.id;
    const pricePerUnit = 200;
    const totalPrice = pricePerUnit * quantity;

    if (eco.enhancement_stone_t1 < totalPrice) {
        return message.reply(`❌ Không đủ Đá T1! Cần **${totalPrice.toLocaleString()}** 💎, bạn có **${(eco.enhancement_stone_t1 || 0).toLocaleString()}** 💎`);
    }

    // Trừ Đá T1, thêm Đá Đen
    economyDb.subtractStoneT1(userId, totalPrice);
    economyDb.addBlackStone(userId, quantity);
    economyDb.logTransaction(userId, 'buy', `Đá Đen x${quantity}`, -totalPrice);

    // Track shop_bought quest
    const { updateQuestProgress, sendQuestNotifications } = require('../../utils/questSystem');
    const completedQuests = updateQuestProgress(userId, 'shop_bought', quantity);

    const newEco = economyDb.getOrCreateEconomy(userId);

    const embed = new EmbedBuilder()
        .setColor('#1F2937')
        .setTitle('🌑 Mua Đá Đen thành công!')
        .setDescription([
            `📦 **Số lượng:** ${quantity}`,
            `💎 **Tổng giá:** ${totalPrice.toLocaleString()} Đá T1`,
            '',
            `🌑 **Đá Đen trống:** ${newEco.black_stone_empty || 0}`,
            `💎 **Đá T1 còn lại:** ${(newEco.enhancement_stone_t1 || 0).toLocaleString()}`
        ].join('\n'))
        .setFooter({ text: '?daden để hút năng lực | ?ddlist để xem đá' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
    await sendQuestNotifications(message.channel, userId, completedQuests);
}

// Mua đồ vàng từ shop (phí 3 đồ vàng → 1 đồ vàng)
async function exchangeGold(message, quantity = 1) {
    const userId = message.author.id;
    const playerClass = getPlayerClass(message.member);
    const isBulk = quantity > 1;

    // Lấy tất cả đồ vàng chưa mặc
    const allItems = economyDb.getUserEquipment(userId);
    const goldItems = allItems.filter(i => i.rarity === 'gold' && !i.is_equipped);

    // Giới hạn số lượng có thể mua
    const maxCanBuy = Math.floor(goldItems.length / 3);
    const actualQty = Math.min(quantity, maxCanBuy);

    if (goldItems.length < 3) {
        return message.reply(`❌ Cần ít nhất **3 đồ Vàng** chưa mặc để mua!\nBạn có: **${goldItems.length}/3** đồ Vàng trong kho`);
    }

    // Tính điểm ưu tiên cho mỗi item (ưu tiên đã tune + không có đề cử vàng)
    const scoredItems = goldItems.map(item => {
        let lines = item.lines;
        if (typeof lines === 'string') {
            try { lines = JSON.parse(lines); } catch (e) { lines = []; }
        }
        if (!Array.isArray(lines)) lines = [];

        const hasGoldDeCu = lines.some(l => l.rarity === 'gold' && isDeCu(l.stat, playerClass));
        const isTuned = lines.some(l => l.tuned);

        let score = 0;
        if (isTuned) score += 10;
        if (!hasGoldDeCu) score += 20;

        return { ...item, score, hasGoldDeCu, lines };
    }).sort((a, b) => b.score - a.score);

    // ===== MUA NHIỀU (BULK) =====
    if (isBulk) {
        const toSpend = actualQty * 3;
        const selectedItems = scoredItems.slice(0, toSpend);

        // Xóa đồ cũ
        for (const item of selectedItems) {
            economyDb.deleteEquipment(item.id);
        }

        // Tạo đồ mới
        const newItems = [];
        for (let i = 0; i < actualQty; i++) {
            const equipData = createEquipmentFromBox(null, true, userId);
            const result = economyDb.addEquipment(userId, equipData);
            newItems.push({ ...equipData, id: result.equipmentId });
        }

        // Format kết quả
        let resultList = newItems.map((item, idx) => {
            const slot = SLOTS[item.slot];
            let lines = item.lines;
            if (typeof lines === 'string') {
                try { lines = JSON.parse(lines); } catch (e) { lines = []; }
            }
            if (!Array.isArray(lines)) lines = [];

            const mastery = calculateEquipmentMastery(item, playerClass);
            return `${idx + 1}. ${ICONS.rarity.gold} \`${String(item.id).padStart(6, '0')}\` **${item.name}** (${slot.shortName}) \`${mastery}\``;
        }).join('\n');

        const remainingItems = economyDb.getUserEquipment(userId);
        const remainingGold = remainingItems.filter(i => i.rarity === 'gold' && !i.is_equipped).length;

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('🎉 Mua Thành Công!')
            .setDescription(`Đã mua **${actualQty}** trang bị Vàng\nPhí: **${toSpend}** đồ Vàng`)
            .addFields(
                { name: '📥 Đồ mới nhận', value: resultList || 'Không có', inline: false },
                { name: '💰 Còn lại', value: `${remainingGold} đồ vàng trong kho`, inline: true }
            )
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    // ===== MUA 1 CÁI (có xác nhận) =====
    const selectedItems = scoredItems.slice(0, 3);
    const hasAnyDeCu = selectedItems.some(i => i.hasGoldDeCu);

    let itemsList = selectedItems.map((item, idx) => {
        const slot = SLOTS[item.slot];
        const mastery = calculateEquipmentMastery(item, playerClass);
        const deCuMark = item.hasGoldDeCu ? ` ${ICONS.rarity.starDecu}` : '';
        return `${idx + 1}. ${ICONS.rarity.gold} \`${String(item.id).padStart(6, '0')}\` **${item.name}** (${slot.shortName}) \`${mastery}\`${deCuMark}`;
    }).join('\n');

    const embed = new EmbedBuilder()
        .setColor(hasAnyDeCu ? 0xE67E22 : 0x3498DB)
        .setTitle('🛒 Mua Trang Bị Vàng')
        .setDescription(hasAnyDeCu
            ? '⚠️ **Có đồ có dòng Vàng Đề Cử!** Bạn chắc chắn muốn mua?'
            : 'Mua 1 trang bị Vàng ngẫu nhiên từ Shop')
        .addFields(
            { name: '💰 Phí', value: itemsList, inline: false },
            { name: '📥 Nhận được', value: `${ICONS.rarity.gold} **1 Trang bị Vàng ngẫu nhiên**`, inline: false }
        )
        .setFooter({ text: `Có ${goldItems.length} đồ vàng trong kho` })
        .setTimestamp();

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`exchange_confirm_${userId}`)
            .setLabel('✅ Xác nhận mua')
            .setStyle(hasAnyDeCu ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`exchange_cancel_${userId}`)
            .setLabel('❌ Hủy')
            .setStyle(ButtonStyle.Secondary)
    );

    const reply = await message.reply({ embeds: [embed], components: [buttons] });

    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === userId,
        time: 30000
    });

    collector.on('collect', async (interaction) => {
        if (interaction.customId === `exchange_confirm_${userId}`) {
            // Xóa 3 đồ cũ
            for (const item of selectedItems) {
                economyDb.deleteEquipment(item.id);
            }

            // Tạo 1 đồ vàng mới
            const equipData = createEquipmentFromBox(null, true, userId);
            const result = economyDb.addEquipment(userId, equipData);
            const newItem = { ...equipData, id: result.equipmentId };

            const slot = SLOTS[newItem.slot];
            let newLines = newItem.lines;
            if (typeof newLines === 'string') {
                try { newLines = JSON.parse(newLines); } catch (e) { newLines = []; }
            }
            if (!Array.isArray(newLines)) newLines = [];

            const newMastery = calculateEquipmentMastery(newItem, playerClass);

            let linesText = newLines.map(l => {
                const deCu = isDeCu(l.stat, playerClass) ? ICONS.rarity.starDecu : '';
                const rarityMark = l.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;
                return `${rarityMark} ${l.icon} ${l.name}: **${l.value}** (${l.percent}%)${deCu}`;
            }).join('\n');

            const remainingItems = economyDb.getUserEquipment(userId);
            const remainingGold = remainingItems.filter(i => i.rarity === 'gold' && !i.is_equipped).length;

            const resultEmbed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('🎉 Mua Thành Công!')
                .setDescription(`Đã nhận 1 trang bị Vàng mới từ Shop`)
                .addFields(
                    { name: `${ICONS.rarity.gold} ${newItem.name} (${slot.name})`, value: linesText || 'Không có dòng', inline: false },
                    { name: '📊 Mastery', value: `\`${newMastery}\``, inline: true },
                    { name: '🆔 ID', value: `\`${String(newItem.id).padStart(6, '0')}\``, inline: true },
                    { name: '💰 Còn lại', value: `${remainingGold} đồ vàng trong kho`, inline: true }
                )
                .setTimestamp();

            // Thêm nút mua tiếp nếu còn đủ đồ (chỉ khi mua 1)
            const successButtons = new ActionRowBuilder();
            if (remainingGold >= 3) {
                successButtons.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`exchange_again_${userId}`)
                        .setLabel('🛒 Mua tiếp')
                        .setStyle(ButtonStyle.Primary)
                );
            }
            successButtons.addComponents(
                new ButtonBuilder()
                    .setCustomId(`exchange_done_${userId}`)
                    .setLabel('✅ Xong')
                    .setStyle(ButtonStyle.Secondary)
            );

            await interaction.update({ embeds: [resultEmbed], components: [successButtons] });

        } else if (interaction.customId === `exchange_cancel_${userId}`) {
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0x95A5A6).setTitle('❌ Đã hủy')],
                components: []
            });
            collector.stop();
        } else if (interaction.customId === `exchange_again_${userId}`) {
            collector.stop();
            await reply.edit({ components: [] }).catch(() => { });
            return exchangeGold(message, 1);
        } else if (interaction.customId === `exchange_done_${userId}`) {
            await interaction.update({ components: [] });
            collector.stop();
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            await reply.edit({ components: [] }).catch(() => { });
        }
    });
}

module.exports = { execute, exchangeGold };


