/**
 * ?equip, ?gan <id> - Trang bị equipment
 * ?equip auto - Tự động gắn đồ tốt nhất vào slot trống
 * ?trangbi - Xem trang bị đang mặc
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const economyDb = require('../../database/economy');
const { SLOTS, getPlayerClass, getClassInfo } = require('../../utils/classSystem');
const { calculateEquipmentMastery, calculateTotalMastery } = require('../../utils/tuneSystem');
const ICONS = require('../../config/icons');

// Thứ tự slot hiển thị: 4 trên + 4 dưới
const SLOT_ORDER_TOP = ['mu', 'giap', 'gang', 'giay'];
const SLOT_ORDER_BOTTOM = ['vukhi', 'vukhiphu', 'khuyentai', 'ngocboi'];

/**
 * ?equip, ?gan <id> - Gắn trang bị
 */
async function execute(message, args) {
    // Xử lý ?equip auto / ?equip all
    if (args[0] && (args[0].toLowerCase() === 'auto' || args[0].toLowerCase() === 'all')) {
        return executeAuto(message);
    }

    if (args.length === 0) {
        return executeViewWithMenu(message);
    }

    const equipId = parseInt(args[0]);
    if (isNaN(equipId)) {
        return message.reply('❌ ID không hợp lệ!');
    }

    const userId = message.author.id;
    const playerClass = getPlayerClass(message.member);

    // Lấy equipment muốn gắn
    const equipment = economyDb.getEquipment(equipId);
    if (!equipment) {
        return message.reply('❌ Không tìm thấy trang bị!');
    }
    if (equipment.discord_id !== userId) {
        return message.reply('❌ Đây không phải trang bị của bạn!');
    }

    // Kiểm tra đã mặc chưa
    if (equipment.is_equipped) {
        return message.reply('❌ Bạn đã mặc trang bị này rồi!');
    }

    const slot = SLOTS[equipment.slot];

    // Kiểm tra slot đã có đồ khác chưa
    const equippedItems = economyDb.getEquippedItems(userId);
    const existingItem = equippedItems.find(item => item.slot === equipment.slot);

    if (existingItem) {
        // Đã có đồ cùng slot → hỏi xác nhận
        const existingSlot = SLOTS[existingItem.slot];
        const existingMastery = calculateEquipmentMastery(existingItem, playerClass);
        const newMastery = calculateEquipmentMastery(equipment, playerClass);

        const embed = new EmbedBuilder()
            .setColor(0xE67E22)
            .setTitle('⚠️ Xác Nhận Thay Thế')
            .setDescription(`Bạn đang mặc **${existingItem.name}** ở slot ${existingSlot.icon} ${existingSlot.name}.\nBạn có muốn thay bằng **${equipment.name}** không?`)
            .addFields(
                { name: '🔄 Đang mặc', value: `${existingItem.name} (${existingMastery} pts)`, inline: true },
                { name: '➡️ Thay thế', value: `${equipment.name} (${newMastery} pts)`, inline: true }
            )
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`equip_confirm_${equipId}_${userId}`)
                .setLabel('Thay thế')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`equip_cancel_${userId}`)
                .setLabel('Hủy')
                .setStyle(ButtonStyle.Secondary)
        );

        const reply = await message.reply({ embeds: [embed], components: [row] });

        // Collector
        const collector = reply.createMessageComponentCollector({
            filter: (i) => i.user.id === userId,
            time: 30000
        });

        collector.on('collect', async (interaction) => {
            try {
                if (interaction.customId === `equip_confirm_${equipId}_${userId}`) {
                    // Thực hiện thay thế
                    economyDb.equipItem(userId, equipId);

                    // Quest progress
                    const { updateQuestProgress, sendQuestNotifications } = require('../../utils/questSystem');
                    const completedQuests = updateQuestProgress(userId, 'items_equipped', 1);

                    const successEmbed = new EmbedBuilder()
                        .setColor(0x2ECC71)
                        .setTitle('✅ Đã Thay Thế')
                        .setDescription(`Đã thay **${existingItem.name}** bằng **${equipment.name}**`)
                        .setTimestamp();

                    await interaction.update({ embeds: [successEmbed], components: [] });
                    await sendQuestNotifications(interaction.channel, userId, completedQuests);
                } else {
                    const cancelEmbed = new EmbedBuilder()
                        .setColor(0x95A5A6)
                        .setTitle('❌ Đã Hủy')
                        .setTimestamp();

                    await interaction.update({ embeds: [cancelEmbed], components: [] });
                }
            } catch (error) {
                if (error.code === 10062 || error.code === 40060) {
                    try { await reply.edit({ components: [] }); } catch (e) { }
                } else {
                    console.error('[equip] Lỗi xử lý nút:', error.message);
                }
            }
        });

        collector.on('end', async () => {
            try {
                await reply.edit({ components: [] });
            } catch (e) { }
        });

        return;
    }

    // Không có đồ cùng slot → gắn thẳng
    economyDb.equipItem(userId, equipId);

    // Quest progress
    const { updateQuestProgress, sendQuestNotifications } = require('../../utils/questSystem');
    const completedQuests = updateQuestProgress(userId, 'items_equipped', 1);

    // Hiển thị thông báo ngắn + gọi xem trang bị đầy đủ
    const confirmEmbed = new EmbedBuilder()
        .setColor(equipment.rarity === 'gold' ? 0xF1C40F : 0x9B59B6)
        .setDescription(`✅ Đã mặc **${equipment.name}** (${slot.shortName})`)
        .setTimestamp();

    await message.reply({ embeds: [confirmEmbed] });
    await sendQuestNotifications(message.channel, userId, completedQuests);

    // Hiển thị trang bị đang mặc
    await executeView(message, []);
}

/**
 * ?trangbi - Xem trang bị đang mặc
 */
async function executeView(message, args, targetUser = null) {
    // Hỗ trợ xem trang bị của người khác
    const user = targetUser || message.author;
    const member = targetUser
        ? await message.guild.members.fetch(user.id).catch(() => null)
        : message.member;

    const userId = user.id;
    const playerClass = member ? getPlayerClass(member) : null;
    const classInfo = playerClass ? getClassInfo(playerClass) : null;

    const equippedItems = economyDb.getEquippedItems(userId);

    // Tạo map slot -> item
    const slotMap = {};
    for (const item of equippedItems) {
        slotMap[item.slot] = item;
    }

    // Tính điểm mastery từng slot
    let totalMastery = 0;

    // Format hàng trên (Mũ, Giáp, Găng, Giày) - Phòng Thủ
    let topRow = '';
    for (const slotKey of SLOT_ORDER_TOP) {
        const slot = SLOTS[slotKey];
        const item = slotMap[slotKey];
        if (item) {
            const rarityIcon = item.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;
            const mastery = calculateEquipmentMastery(item, playerClass);
            totalMastery += mastery;
            const idStr = String(item.id).padStart(6, '0');
            topRow += `${rarityIcon} \`${idStr}\` ${slot.icon} **${item.name}** (${slot.shortName})\n└ Mastery: \`${mastery}\`\n`;
        } else {
            topRow += `▫️ ${slot.icon} *Trống*\n`;
        }
    }

    // Format hàng dưới (Vũ Khí, Vũ Khí Phụ, Khuyên, Ngọc) - Tấn Công
    let bottomRow = '';
    for (const slotKey of SLOT_ORDER_BOTTOM) {
        const slot = SLOTS[slotKey];
        const item = slotMap[slotKey];
        if (item) {
            const rarityIcon = item.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;
            const mastery = calculateEquipmentMastery(item, playerClass);
            totalMastery += mastery;
            const idStr = String(item.id).padStart(6, '0');
            bottomRow += `${rarityIcon} \`${idStr}\` ${slot.icon} **${item.name}** (${slot.shortName})\n└ Mastery: \`${mastery}\`\n`;
        } else {
            bottomRow += `▫️ ${slot.icon} *Trống*\n`;
        }
    }

    // Tạo progress bar cho Mastery (max 10000)
    const equippedCount = equippedItems.length;
    const maxMastery = 10000;
    const masteryPercent = Math.min(totalMastery / maxMastery, 1);
    const filledBlocks = Math.round(masteryPercent * 10);
    const progressBar = '▓'.repeat(filledBlocks) + '░'.repeat(10 - filledBlocks);

    // Màu theo class
    const embedColor = playerClass === 'dps' ? 0x3498DB
        : playerClass === 'tanker' ? 0xE67E22
            : playerClass === 'healer' ? 0x2ECC71
                : 0x9B59B6;

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: `${user.username}`,
            iconURL: user.displayAvatarURL({ dynamic: true })
        })
        .setTitle('⚔️ Trang Bị Đang Mặc')
        .setDescription(classInfo
            ? `${classInfo.icon} **${classInfo.name}** • Mastery: **${totalMastery}**`
            : '⚠️ *Chưa chọn phái - dùng ?pickrole*')
        .addFields(
            { name: '🛡️ Phòng Thủ', value: topRow || '▫️ *Trống*', inline: true },
            { name: '⚔️ Tấn Công', value: bottomRow || '▫️ *Trống*', inline: true },
            { name: `📊 Tiến độ (${equippedCount}/8)`, value: `\`${progressBar}\` **${totalMastery}**/${maxMastery} Mastery`, inline: false }
        )
        .setFooter({ text: '?gan <id> để thay • ?equip auto để tự gắn' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}


/**
 * ?equip auto - Tự động gắn đồ có mastery cao nhất, bao gồm thay thế đồ cũ
 */
async function executeAuto(message) {
    const userId = message.author.id;
    const playerClass = getPlayerClass(message.member);

    // Lấy đồ đang mặc
    const equippedItems = economyDb.getEquippedItems(userId);
    const equippedMap = new Map(equippedItems.map(i => [i.slot, { ...i, mastery: calculateEquipmentMastery(i, playerClass) }]));

    // Lấy tất cả đồ chưa mặc
    const allItems = economyDb.getUserEquipment(userId).filter(i => !i.is_equipped);

    if (allItems.length === 0) {
        return message.reply('❌ Không có đồ nào trong kho để gắn!');
    }

    // Tính mastery cho mỗi đồ trong kho
    const itemsWithMastery = allItems.map(item => ({
        ...item,
        mastery: calculateEquipmentMastery(item, playerClass)
    }));

    // Group items by slot, sorted by mastery desc
    const allSlots = [...SLOT_ORDER_TOP, ...SLOT_ORDER_BOTTOM];
    let equipped = [];
    let replaced = [];

    for (const slot of allSlots) {
        // Tìm đồ tốt nhất trong kho cho slot này
        const itemsForSlot = itemsWithMastery
            .filter(i => i.slot === slot && !equipped.some(e => e.id === i.id))
            .sort((a, b) => {
                // Ưu tiên vàng
                if (a.rarity !== b.rarity) {
                    return a.rarity === 'gold' ? -1 : 1;
                }
                // Rồi mastery cao
                return b.mastery - a.mastery;
            });

        if (itemsForSlot.length === 0) continue;

        const bestItem = itemsForSlot[0];
        const currentEquipped = equippedMap.get(slot);

        // Nếu slot trống -> gắn ngay
        if (!currentEquipped) {
            economyDb.equipItem(userId, bestItem.id);
            equipped.push(bestItem);
        }
        // Nếu đồ trong kho có mastery cao hơn đồ đang mặc -> thay thế
        else if (bestItem.mastery > currentEquipped.mastery) {
            economyDb.equipItem(userId, bestItem.id);
            replaced.push({
                old: currentEquipped,
                new: bestItem
            });
        }
    }

    if (equipped.length === 0 && replaced.length === 0) {
        return message.reply('✅ Tất cả slot đã có đồ tốt nhất! Không có gì để cải thiện.');
    }

    // Tạo danh sách đồ đã gắn mới
    let equippedList = '';
    for (const item of equipped) {
        const slot = SLOTS[item.slot];
        const rarityIcon = item.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;
        equippedList += `${slot.icon} ${rarityIcon} **${item.name}** [\`${item.mastery}\`]\n`;
    }

    // Tạo danh sách đồ đã thay thế
    let replacedList = '';
    for (const r of replaced) {
        const slot = SLOTS[r.new.slot];
        const oldIcon = r.old.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;
        const newIcon = r.new.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;
        replacedList += `${slot.icon} ${oldIcon} ${r.old.name} [\`${r.old.mastery}\`] → ${newIcon} **${r.new.name}** [\`${r.new.mastery}\`]\n`;
    }

    const updatedEquipped = economyDb.getEquippedItems(userId);
    const totalMastery = calculateTotalMastery(updatedEquipped, playerClass);

    // Progress bar
    const maxMastery = 10000;
    const masteryPercent = Math.min(totalMastery / maxMastery, 1);
    const filledBlocks = Math.round(masteryPercent * 10);
    const progressBar = '▓'.repeat(filledBlocks) + '░'.repeat(10 - filledBlocks);

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('⚡ Auto Equip Hoàn Tất!');

    let description = '';
    if (equipped.length > 0) {
        description += `**Gắn mới (${equipped.length}):**\n${equippedList}\n`;
    }
    if (replaced.length > 0) {
        description += `**Nâng cấp (${replaced.length}):**\n${replacedList}`;
    }

    embed.setDescription(description)
        .addFields({
            name: '📊 Mastery',
            value: `**${totalMastery}**/${maxMastery} (${updatedEquipped.length}/8 món)\n\`${progressBar}\``,
            inline: false
        })
        .setFooter({ text: '?trangbi để xem trang bị hiện tại' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

/**
 * ?equip - Hiển thị trang bị và select menu đồ vàng
 */
async function executeViewWithMenu(message) {
    const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder } = require('discord.js');
    const userId = message.author.id;
    const playerClass = getPlayerClass(message.member);
    const classInfo = getClassInfo(playerClass);

    const equippedItems = economyDb.getEquippedItems(userId);
    const equippedSlots = new Set(equippedItems.map(i => i.slot));

    // Tạo map slot -> item
    const slotMap = {};
    for (const item of equippedItems) {
        slotMap[item.slot] = item;
    }

    // Format hàng trên (Mũ, Giáp, Găng, Giày)
    let topRow = '';
    for (const slotKey of SLOT_ORDER_TOP) {
        const slot = SLOTS[slotKey];
        const item = slotMap[slotKey];
        if (item) {
            const rarityIcon = item.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;
            const mastery = calculateEquipmentMastery(item, playerClass);
            topRow += `${slot.icon} **${item.name}** (${slot.shortName}) ${rarityIcon} (${mastery} pts)\n`;
        } else {
            topRow += `${slot.icon} *Trống*\n`;
        }
    }

    // Format hàng dưới (Vũ Khí, Vũ Khí Phụ, Khuyên, Ngọc)
    let bottomRow = '';
    for (const slotKey of SLOT_ORDER_BOTTOM) {
        const slot = SLOTS[slotKey];
        const item = slotMap[slotKey];
        if (item) {
            const rarityIcon = item.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;
            const mastery = calculateEquipmentMastery(item, playerClass);
            bottomRow += `${slot.icon} **${item.name}** (${slot.shortName}) ${rarityIcon} (${mastery} pts)\n`;
        } else {
            bottomRow += `${slot.icon} *Trống*\n`;
        }
    }

    const totalMastery = calculateTotalMastery(equippedItems, playerClass);

    // Progress bar
    const maxMastery = 10000;
    const masteryPercent = Math.min(totalMastery / maxMastery, 1);
    const filledBlocks = Math.round(masteryPercent * 10);
    const progressBar = '▓'.repeat(filledBlocks) + '░'.repeat(10 - filledBlocks);

    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('⚔️ Trang Bị Đang Mặc')
        .setDescription(playerClass ? `Phái: ${classInfo.icon} ${classInfo.name}` : '⚠️ Chưa chọn phái')
        .addFields(
            { name: '🔝 Phòng Thủ', value: topRow || 'Trống', inline: true },
            { name: '⚔️ Tấn Công', value: bottomRow || 'Trống', inline: true },
            { name: '📊 Mastery', value: `**${totalMastery}**/${maxMastery} (${equippedItems.length}/8 món)\n\`${progressBar}\``, inline: false }
        )
        .setFooter({ text: 'Chọn đồ vàng bên dưới để gắn' })
        .setTimestamp();

    // Lấy đồ vàng chưa mặc
    const goldItems = economyDb.getUserEquipment(userId)
        .filter(i => i.rarity === 'gold' && !i.is_equipped)
        .map(item => ({
            ...item,
            mastery: calculateEquipmentMastery(item, playerClass)
        }));

    if (goldItems.length === 0) {
        embed.setFooter({ text: '?gan <id> để thay • ?equip auto để gắn tự động' });
        return message.reply({ embeds: [embed] });
    }

    // Sắp xếp theo mastery giảm dần (cao nhất trước)
    goldItems.sort((a, b) => b.mastery - a.mastery);

    // Lấy tối đa 25 item (Discord limit)
    const sortedGoldItems = goldItems.slice(0, 25);

    // Tìm các slot trống để đánh dấu
    const emptySlots = [...SLOT_ORDER_TOP, ...SLOT_ORDER_BOTTOM].filter(s => !equippedSlots.has(s));

    // Tạo select menu
    const options = sortedGoldItems.map(item => {
        const slot = SLOTS[item.slot];
        const isEmpty = emptySlots.includes(item.slot);
        const label = `${slot.icon} ${item.name} (${slot.shortName}) [${item.mastery}]`;
        const description = `ID: ${String(item.id).padStart(6, '0')} • ${isEmpty ? '✨ Slot trống' : 'Thay thế'}`;

        return new StringSelectMenuOptionBuilder()
            .setLabel(label.substring(0, 100)) // Discord limit
            .setDescription(description.substring(0, 100))
            .setValue(`equip_${item.id}`);
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`equipmenu_${userId}`)
        .setPlaceholder(`${ICONS.rarity.gold} Chọn đồ vàng để gắn...`)
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const reply = await message.reply({ embeds: [embed], components: [row] });

    // Collector
    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === userId,
        time: 60000
    });

    collector.on('collect', async (interaction) => {
        try {
            const equipId = parseInt(interaction.values[0].replace('equip_', ''));

            // Gắn đồ
            const equipment = economyDb.getEquipment(equipId);
            if (!equipment || equipment.discord_id !== userId) {
                return interaction.reply({ content: '❌ Lỗi: Không tìm thấy trang bị!', ephemeral: true });
            }

            if (equipment.is_equipped) {
                return interaction.reply({ content: '❌ Đã mặc trang bị này rồi!', ephemeral: true });
            }

            // Kiểm tra slot có đồ khác không
            const existingItem = equippedItems.find(item => item.slot === equipment.slot);

            if (existingItem) {
                // Có đồ cũ -> thay thế
                economyDb.equipItem(userId, equipId);

                // Quest progress
                const { updateQuestProgress, sendQuestNotifications } = require('../../utils/questSystem');
                const completedQuests = updateQuestProgress(userId, 'items_equipped', 1);

                const newMastery = calculateEquipmentMastery(equipment, playerClass);
                const updatedEquipped = economyDb.getEquippedItems(userId);
                const newTotalMastery = calculateTotalMastery(updatedEquipped, playerClass);

                const successEmbed = new EmbedBuilder()
                    .setColor(0x2ECC71)
                    .setTitle('✅ Đã Thay Thế')
                    .setDescription(`Đã thay **${existingItem.name}** bằng **${equipment.name}**`)
                    .addFields(
                        { name: '📊 Tổng Mastery', value: `**${newTotalMastery}** điểm`, inline: false }
                    )
                    .setTimestamp();

                await interaction.update({ embeds: [successEmbed], components: [] });
                await sendQuestNotifications(interaction.channel, userId, completedQuests);
            } else {
                // Slot trống -> gắn thẳng
                economyDb.equipItem(userId, equipId);

                // Quest progress  
                const { updateQuestProgress, sendQuestNotifications } = require('../../utils/questSystem');
                const completedQuests = updateQuestProgress(userId, 'items_equipped', 1);

                const mastery = calculateEquipmentMastery(equipment, playerClass);
                const updatedEquipped = economyDb.getEquippedItems(userId);
                const newTotalMastery = calculateTotalMastery(updatedEquipped, playerClass);

                const successEmbed = new EmbedBuilder()
                    .setColor(0x2ECC71)
                    .setTitle('✅ Trang Bị Thành Công')
                    .setDescription(`Đã mặc **${equipment.name}**`)
                    .addFields(
                        { name: 'Mastery', value: `${mastery} điểm`, inline: true },
                        { name: '📊 Tổng Mastery', value: `**${newTotalMastery}** điểm (${updatedEquipped.length}/8 món)`, inline: false }
                    )
                    .setTimestamp();

                await interaction.update({ embeds: [successEmbed], components: [] });
                await sendQuestNotifications(interaction.channel, userId, completedQuests);
            }

            collector.stop();
        } catch (error) {
            if (error.code === 10062 || error.code === 40060) {
                try { await reply.edit({ components: [] }); } catch (e) { }
            } else {
                console.error('[equip] Lỗi xử lý nút:', error.message);
            }
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'time') {
            await reply.edit({ components: [] }).catch(() => { });
        }
    });
}

module.exports = { execute, executeView, executeAuto };


