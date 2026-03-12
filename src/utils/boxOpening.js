/**
 * Box Opening System - Enhanced UX
 * Unified box opening with Continue/Open All/Dismantle flow
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const economy = require('../database/economy');
const { createEquipmentFromBox } = require('./tuneSystem');
const { SLOTS } = require('./classSystem');
const ICONS = require('../config/icons');

// Dynamic inventory slots - gets from database (default 500)
function getMaxInventory(userId) {
    return economy.getInvSlots(userId);
}

/**
 * Tạo embed và buttons để mở box
 * @param {string} userId 
 * @param {number} boxCount - Số box hiện có
 * @returns {Object} { embed, row }
 */
function createBoxOpenUI(userId, boxCount) {
    // Check blessing fire status
    const blessingStatus = economy.getBlessingFireStatus(userId);
    let blessingText = '';

    if (blessingStatus.active) {
        const remaining = Math.ceil((blessingStatus.expiresAt - new Date()) / 1000 / 60);
        const hours = Math.floor(remaining / 60);
        const mins = remaining % 60;
        const timeText = hours > 0 ? `${hours}h${mins}p` : `${mins} phút`;
        const typeName = blessingStatus.type === 'lcpcl' ? 'Lửa Cầu Phúc Cỡ Lớn' : 'Lửa Cầu Phúc';
        blessingText = `\n\n🔥 **${typeName}** đang đốt!\n> Tỉ lệ drop Vàng **+${blessingStatus.bonusPercent}%** • Còn **${timeText}**`;
    }

    const embed = new EmbedBuilder()
        .setColor(blessingStatus.active ? (blessingStatus.type === 'lcpcl' ? '#FF4500' : '#FFA07A') : '#F59E0B')
        .setTitle('📦 Hòm của bạn')
        .setDescription(`Bạn có **${boxCount}** 📦 Box T1${blessingText}`)
        .setFooter({ text: 'Chọn cách mở box' })
        .setTimestamp();

    const buttons = [];

    // Nút mở từng hộp (10 cái 1 lần) - luôn hiện nếu có box
    if (boxCount > 0) {
        const openCount = Math.min(10, boxCount);
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`box10_${userId}`)
                .setLabel(`📦 Mở ${openCount} hộp`)
                .setStyle(ButtonStyle.Primary)
        );
    }

    // Nút mở nhanh tất cả - chỉ hiện khi >= 10 box
    if (boxCount >= 10) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`boxall_${userId}`)
                .setLabel(`⚡ Mở nhanh (${boxCount})`)
                .setStyle(ButtonStyle.Success)
        );
    }

    const row = buttons.length > 0
        ? new ActionRowBuilder().addComponents(...buttons)
        : null;

    return { embed, row };
}

/**
 * Mở một số box với animation đơn giản
 */
async function openBoxesAnimated(interaction, boxCount, userId, msg = null) {
    const openedItems = [];
    const actualCount = Math.min(boxCount, 10);

    // Check inventory space
    const currentCount = economy.countUserEquipment(userId);
    const MAX_INVENTORY = getMaxInventory(userId);
    const availableSlots = MAX_INVENTORY - currentCount;

    if (availableSlots <= 0) {
        const fullEmbed = new EmbedBuilder()
            .setColor('#EF4444')
            .setTitle('❌ Kho đồ đầy!')
            .setDescription(`Bạn đã có **${currentCount}/${MAX_INVENTORY}** món đồ.\nHãy phân tách đồ tím để có chỗ trống.`)
            .setTimestamp();

        const purpleItems = economy.getUserPurpleEquipment(userId);
        if (purpleItems.length > 0) {
            const dismantleRow = createDismantleOnlyRow(userId, purpleItems.length);
            if (msg) {
                await msg.edit({ embeds: [fullEmbed], components: [dismantleRow] });
            } else {
                await interaction.update({ embeds: [fullEmbed], components: [dismantleRow] });
            }
            await setupDismantleCollector(msg || await interaction.fetchReply(), userId, null);
        } else {
            if (msg) {
                await msg.edit({ embeds: [fullEmbed], components: [] });
            } else {
                await interaction.update({ embeds: [fullEmbed], components: [] });
            }
        }
        return [];
    }

    const toOpen = Math.min(actualCount, availableSlots);

    // Initial embed
    let embed = new EmbedBuilder()
        .setColor('#F59E0B')
        .setTitle(`📦 Đang mở ${toOpen} box...`)
        .setDescription('⏳ *Đang chuẩn bị...*')
        .setTimestamp();

    if (!msg) {
        msg = await interaction.update({ embeds: [embed], components: [], fetchReply: true });
    } else {
        await msg.edit({ embeds: [embed], components: [] });
    }

    // Mở từng box với delay ngắn
    for (let i = 0; i < toOpen; i++) {
        await sleep(350);

        // Pity system: check counter
        const currentPity = economy.incrementPityCounter(userId);
        const forceGold = currentPity >= 100;

        const equipData = createEquipmentFromBox(null, forceGold, userId);
        const result = economy.addEquipment(userId, equipData);
        openedItems.push({ ...equipData, id: result.equipmentId });

        // Reset pity nếu nhận đồ vàng (tự nhiên hoặc force)
        if (equipData.rarity === 'gold') {
            economy.resetPityCounter(userId);
        }

        // Update mỗi 2 box để giảm rate limit
        if (i % 2 === 1 || i === toOpen - 1) {
            const progress = Math.floor(((i + 1) / toOpen) * 100);
            const displayItems = openedItems.slice(-4);

            let itemsList = '';
            for (const item of displayItems) {
                const rarityIcon = item.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;
                const slot = SLOTS[item.slot];
                itemsList += `${rarityIcon} \`${String(item.id).padStart(6, '0')}\` **${item.name}** ${slot.icon}\n`;

                // Chi tiết dòng đầu
                const line = item.lines[0];
                if (line) {
                    const lineIcon = line.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;
                    itemsList += `  └ ${lineIcon} ${line.icon} ${line.name} (${line.percent}%)\n`;
                }
            }

            embed = new EmbedBuilder()
                .setColor(openedItems.some(i => i.rarity === 'gold') ? '#F1C40F' : '#9B59B6')
                .setTitle(`📦 Đang mở box... (${i + 1}/${toOpen})`)
                .setDescription(`\`${'█'.repeat(Math.floor(progress / 10))}${'░'.repeat(10 - Math.floor(progress / 10))}\` ${progress}%`)
                .addFields({ name: '🎁 Đã nhận', value: itemsList || 'Đang mở...', inline: false })
                .setTimestamp();

            await msg.edit({ embeds: [embed] }).catch(() => { });
        }
    }

    // Final result
    await showFinalResult(msg, openedItems, userId);

    // Track progress and check for quest completion
    try {
        economy.updateProgress(userId, 'boxes_opened', toOpen);
        economy.updateProgress(userId, 'gold_items_obtained', openedItems.filter(i => i.rarity === 'gold').length);
        const { updateQuestProgress } = require('./questSystem');
        const completedQuests = updateQuestProgress(userId, 'boxes_opened', toOpen);

        // Notify if any quests completed
        if (completedQuests && completedQuests.length > 0) {
            const { EmbedBuilder } = require('discord.js');
            for (const cq of completedQuests) {
                // Format detailed rewards
                const rewardParts = [];
                if (cq.rewards.hat) rewardParts.push(`🌾 ${cq.rewards.hat.toLocaleString()} Hạt`);
                if (cq.rewards.thachAm) rewardParts.push(`🔮 ${cq.rewards.thachAm} Thạch Âm`);
                if (cq.rewards.daT1) rewardParts.push(`💎 ${cq.rewards.daT1} Đá T1`);
                if (cq.rewards.boxes) rewardParts.push(`📦 ${cq.rewards.boxes} Box T1`);
                if (cq.rewards.nhuaCung) rewardParts.push(`💊 ${cq.rewards.nhuaCung} Nhựa Cứng`);
                if (cq.rewards.daT1KhacAn) rewardParts.push(`💠 ${cq.rewards.daT1KhacAn} Đá T1 Khắc Ấn`);
                if (cq.rewards.thachAmKhacAn) rewardParts.push(`🔷 ${cq.rewards.thachAmKhacAn} Thạch Âm Khắc Ấn`);

                // Get remaining quests
                const questSystem = require('./questSystem');
                const allQuestsResult = cq.type === 'daily'
                    ? questSystem.getOrGenerateDailyQuests(userId)
                    : questSystem.getOrGenerateWeeklyQuests(userId);

                const allQuests = allQuestsResult.quests || allQuestsResult;

                const remaining = allQuests.filter(q => !q.claimed);
                let remainingText = '';
                if (remaining.length > 0) {
                    remainingText = '\n\n**Nhiệm vụ còn lại:**\n';
                    remaining.forEach((q, i) => {
                        const status = q.completed ? '✅' : '⬜';
                        remainingText += `${status} ${q.name} (${q.progress}/${q.target})\n`;
                    });
                }

                const questEmbed = new EmbedBuilder()
                    .setColor(0x22C55E)
                    .setTitle('🎉 Nhiệm vụ hoàn thành!')
                    .setDescription(
                        `**${cq.quest.name} (${cq.quest.progress || cq.quest.target}/${cq.quest.target})** (${cq.type === 'daily' ? 'Ngày' : 'Tuần'})\n\n` +
                        `🎁 **Phần thưởng:**\n${rewardParts.length > 0 ? rewardParts.join('\n') : '_(Đã nhận phần thưởng)_'}` +
                        remainingText
                    )
                    .setFooter({ text: '?q để xem chi tiết' })
                    .setTimestamp();

                await msg.channel.send({ embeds: [questEmbed] }).catch(() => { });
            }
        }
    } catch (e) { /* ignore */ }

    return openedItems;
}

/**
 * Mở tất cả box ngay lập tức (không animation)
 */
async function openBoxesInstant(interaction, boxCount, userId, msg = null) {
    const openedItems = [];

    // Check inventory space
    const currentCount = economy.countUserEquipment(userId);
    const MAX_INVENTORY = getMaxInventory(userId);
    const availableSlots = MAX_INVENTORY - currentCount;

    if (availableSlots <= 0) {
        const fullEmbed = new EmbedBuilder()
            .setColor('#EF4444')
            .setTitle('❌ Kho đồ đầy!')
            .setDescription(`Bạn đã có **${currentCount}/${MAX_INVENTORY}** món đồ.\nHãy phân tách đồ tím để có chỗ trống.`)
            .setTimestamp();

        const purpleItems = economy.getUserPurpleEquipment(userId);
        if (purpleItems.length > 0) {
            const dismantleRow = createDismantleOnlyRow(userId, purpleItems.length);
            if (msg) {
                await msg.edit({ embeds: [fullEmbed], components: [dismantleRow] });
            } else {
                await interaction.update({ embeds: [fullEmbed], components: [dismantleRow] });
            }
            await setupDismantleCollector(msg || await interaction.fetchReply(), userId, null);
        } else {
            if (msg) {
                await msg.edit({ embeds: [fullEmbed], components: [] });
            } else {
                await interaction.update({ embeds: [fullEmbed], components: [] });
            }
        }
        return [];
    }

    const toOpen = Math.min(boxCount, availableSlots);

    // Loading embed
    let embed = new EmbedBuilder()
        .setColor('#F59E0B')
        .setTitle(`⚡ Mở nhanh ${toOpen} box...`)
        .setDescription('*Đang xử lý...*')
        .setTimestamp();

    if (!msg) {
        msg = await interaction.update({ embeds: [embed], components: [], fetchReply: true });
    } else {
        await msg.edit({ embeds: [embed], components: [] });
    }

    // Mở tất cả ngay lập tức
    for (let i = 0; i < toOpen; i++) {
        // Pity system: check counter
        const currentPity = economy.incrementPityCounter(userId);
        const forceGold = currentPity >= 100;

        const equipData = createEquipmentFromBox(null, forceGold, userId);
        const result = economy.addEquipment(userId, equipData);
        openedItems.push({ ...equipData, id: result.equipmentId });

        // Reset pity nếu nhận đồ vàng (tự nhiên hoặc force)
        if (equipData.rarity === 'gold') {
            economy.resetPityCounter(userId);
        }
    }

    // Final result
    await showFinalResult(msg, openedItems, userId);

    // Track progress and check for quest completion
    try {
        economy.updateProgress(userId, 'boxes_opened', toOpen);
        economy.updateProgress(userId, 'gold_items_obtained', openedItems.filter(i => i.rarity === 'gold').length);
        const { updateQuestProgress, sendQuestNotifications } = require('./questSystem');
        const completedQuests = updateQuestProgress(userId, 'boxes_opened', toOpen);

        // Send quest completion notifications
        if (completedQuests && completedQuests.length > 0) {
            await sendQuestNotifications(msg.channel, userId, completedQuests);
        }
    } catch (e) { /* ignore */ }

    return openedItems;
}

/**
 * Tạo row chỉ có nút phân tách (khi kho đầy)
 */
function createDismantleOnlyRow(userId, purpleCount) {
    const sessionId = Date.now().toString(36);
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`qdis_${sessionId}_${userId}`)
                .setLabel(`🔨 Phân tách ${purpleCount} đồ Tím`)
                .setStyle(ButtonStyle.Danger)
        );
}

/**
 * Hiển thị kết quả cuối cùng với các nút action
 */
async function showFinalResult(msg, openedItems, userId) {
    try {
        console.log('[showFinalResult] Starting with', openedItems.length, 'items');

        const goldItems = openedItems.filter(i => i.rarity === 'gold');
        const purpleItems = openedItems.filter(i => i.rarity === 'purple');

        // Show last 10 items with detailed lines
        const displayItems = openedItems.slice(-10);
        const hiddenCount = openedItems.length - displayItems.length;

        let itemsList = '';
        for (const item of displayItems) {
            try {
                const rarityIcon = item.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;
                const slot = SLOTS[item.slot] || { icon: '📦' };

                // Dòng chính
                itemsList += `${rarityIcon} \`${String(item.id).padStart(6, '0')}\` **${item.name}** ${slot.icon}\n`;

                // Parse lines nếu là string
                let lines = item.lines;
                if (typeof lines === 'string') {
                    try { lines = JSON.parse(lines); } catch (e) { lines = []; }
                }
                if (!Array.isArray(lines)) lines = [];

                // Chi tiết dòng đầu tiên
                const line = lines[0];
                if (line) {
                    const lineRarityIcon = line.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;
                    const valueText = line.value ? `+${line.value}${line.unit || ''}` : '';
                    itemsList += `  └ ${lineRarityIcon} ${line.icon || '📊'} ${line.name || 'Stat'} ${valueText} (${line.percent || 0}%)\n`;
                }
            } catch (itemErr) {
                console.error('[showFinalResult] Error processing item:', itemErr.message);
            }
        }

        const hiddenText = hiddenCount > 0 ? `*...và ${hiddenCount} món khác*\n\n` : '';

        // Đảm bảo itemsList không rỗng và không quá dài (Discord giới hạn 1024 ký tự)
        let fieldValue = (hiddenText + itemsList).trim() || 'Không có vật phẩm';
        if (fieldValue.length > 1000) {
            fieldValue = fieldValue.substring(0, 997) + '...';
        }

        console.log('[showFinalResult] Field value length:', fieldValue.length);

        // Get current state
        const eco = economy.getOrCreateEconomy(userId);
        const boxCount = eco.boxes_t1 || 0;
        const equipCount = economy.countUserEquipment(userId);
        const MAX_INVENTORY = getMaxInventory(userId);
        const isFull = equipCount >= MAX_INVENTORY;

        // Check blessing fire status
        const blessingStatus = economy.getBlessingFireStatus(userId);
        let blessingText = '';
        let embedColor = goldItems.length > 0 ? '#F1C40F' : '#9B59B6';

        if (blessingStatus.active) {
            const remaining = Math.ceil((blessingStatus.expiresAt - new Date()) / 1000 / 60);
            const hours = Math.floor(remaining / 60);
            const mins = remaining % 60;
            const timeText = hours > 0 ? `${hours}h${mins}p` : `${mins}p`;
            const typeName = blessingStatus.type === 'lcpcl' ? 'Lửa Cầu Phúc Cỡ Lớn' : 'Lửa Cầu Phúc';
            blessingText = `\n🔥 **Đang đốt ${typeName}** (+${blessingStatus.bonusPercent}% vàng) • ${timeText}`;
            embedColor = blessingStatus.type === 'lcpcl' ? '#FF4500' : '#FFA07A';
        }

        const finalEmbed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle('✨ Mở hòm hoàn tất!')
            .setDescription(`${ICONS.rarity.gold} **${goldItems.length}** Vàng | ${ICONS.rarity.purple} **${purpleItems.length}** Tím\n📦 Còn **${boxCount}** box | 🎒 Kho **${equipCount}/${MAX_INVENTORY}**${blessingText}`)
            .addFields({
                name: '🎁 Vật phẩm nhận được',
                value: fieldValue,
                inline: false
            })
            .setFooter({ text: blessingStatus.active ? `🔥 Đang đốt ${blessingStatus.type === 'lcpcl' ? 'Lửa Cầu Phúc Cỡ Lớn' : 'Lửa Cầu Phúc'}` : '?tuido để xem kho • ?tune <id> để nâng cấp' })
            .setTimestamp();

        const sessionId = Date.now().toString(36);
        const components = [];

        // Lấy số đồ tím trong kho để phân tách
        const allPurpleItems = economy.getUserPurpleEquipment(userId);

        if (isFull) {
            // Kho đầy: chỉ hiện nút phân tách
            if (allPurpleItems.length > 0) {
                finalEmbed.setFooter({ text: '⚠️ Kho đầy! Phân tách để có chỗ trống' });
                components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`qdis_${sessionId}_${userId}`)
                        .setLabel(`🔨 Phân tách ${allPurpleItems.length} đồ Tím`)
                        .setStyle(ButtonStyle.Danger)
                ));
            } else {
                finalEmbed.setFooter({ text: '⚠️ Kho đầy! Dùng ?ban để bán đồ' });
            }
        } else {
            // Kho chưa đầy: hiện các nút continue
            const actionButtons = [];

            // Nút mở tiếp
            if (boxCount > 0) {
                const nextOpen = Math.min(10, boxCount);
                actionButtons.push(
                    new ButtonBuilder()
                        .setCustomId(`boxcont_${sessionId}_${userId}`)
                        .setLabel(`📦 Mở tiếp (${nextOpen})`)
                        .setStyle(ButtonStyle.Primary)
                );

                // Nút mở tất cả - chỉ khi còn >= 10 box
                if (boxCount >= 10) {
                    actionButtons.push(
                        new ButtonBuilder()
                            .setCustomId(`boxallcont_${sessionId}_${userId}`)
                            .setLabel(`⚡ Mở hết (${boxCount})`)
                            .setStyle(ButtonStyle.Success)
                    );
                }
            }

            // Nút phân tách
            if (allPurpleItems.length > 0) {
                actionButtons.push(
                    new ButtonBuilder()
                        .setCustomId(`qdis_${sessionId}_${userId}`)
                        .setLabel(`🔨 Phân tách (${allPurpleItems.length})`)
                        .setStyle(ButtonStyle.Danger)
                );
            }

            if (actionButtons.length > 0) {
                components.push(new ActionRowBuilder().addComponents(...actionButtons));
            }

            finalEmbed.setFooter({ text: '?tuido để xem kho • ?tune <id> để nâng cấp' });
        }

        console.log('[showFinalResult] About to edit message with embed');
        await msg.edit({ embeds: [finalEmbed], components });
        console.log('[showFinalResult] Message edited successfully');

        // Setup collectors
        if (components.length > 0) {
            await setupActionCollector(msg, userId, sessionId, allPurpleItems);
        }
        console.log('[showFinalResult] Completed successfully');
    } catch (error) {
        console.error('[showFinalResult] Critical error:', error);
        // Fallback - hiển thị kết quả cơ bản
        try {
            const fallbackEmbed = new EmbedBuilder()
                .setColor('#22C55E')
                .setTitle('✨ Mở hòm hoàn tất!')
                .setDescription(`Đã mở **${openedItems.length}** box!\nDùng \`?tuido\` để xem kho đồ.`)
                .setTimestamp();
            await msg.edit({ embeds: [fallbackEmbed], components: [] });
        } catch (e) {
            console.error('[showFinalResult] Fallback also failed:', e.message);
        }
    }
}

/**
 * Setup collector cho các action buttons sau khi mở box
 */
async function setupActionCollector(msg, userId, sessionId, purpleItems) {
    const collector = msg.createMessageComponentCollector({
        filter: i => i.user.id === userId && i.customId.includes(sessionId),
        time: 60000
    });

    collector.on('collect', async (btnInt) => {
        try {
            const customId = btnInt.customId;

            if (customId.startsWith('boxcont_')) {
                // Mở tiếp 10 box
                const eco = economy.getOrCreateEconomy(userId);
                const boxCount = eco.boxes_t1 || 0;

                if (boxCount <= 0) {
                    return btnInt.reply({ content: '❌ Bạn không còn box nào!', ephemeral: true });
                }

                const toOpen = Math.min(10, boxCount);
                economy.subtractBoxesT1(userId, toOpen);
                collector.stop('continue');
                await openBoxesAnimated(btnInt, toOpen, userId, null);

            } else if (customId.startsWith('boxallcont_')) {
                // Mở hết box còn lại
                const eco = economy.getOrCreateEconomy(userId);
                const boxCount = eco.boxes_t1 || 0;

                if (boxCount <= 0) {
                    return btnInt.reply({ content: '❌ Bạn không còn box nào!', ephemeral: true });
                }

                economy.subtractBoxesT1(userId, boxCount);
                collector.stop('continue');
                await openBoxesInstant(btnInt, boxCount, userId, null);

            } else if (customId.startsWith('qdis_')) {
                // Phân tách
                collector.stop('dismantle');
                await handleDismantle(btnInt, userId, sessionId);
            }
        } catch (error) {
            if (error.code === 10062 || error.code === 40060) {
                try { await msg.edit({ components: [] }); } catch (e) { }
            } else {
                console.error('[boxOpening] Lỗi xử lý nút:', error.message);
            }
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'time') {
            await msg.edit({ components: [] }).catch(() => { });
        }
    });
}

/**
 * Xử lý phân tách và hiển thị buttons sau đó
 */
async function handleDismantle(interaction, userId, sessionId) {
    const purpleItems = economy.getUserPurpleEquipment(userId);

    let dismantled = 0;
    let stoneGained = 0;

    for (const item of purpleItems) {
        economy.deleteEquipment(item.id);
        economy.addStoneT1(userId, 1);
        dismantled++;
        stoneGained += 1;
    }

    const eco = economy.getOrCreateEconomy(userId);
    const boxCount = eco.boxes_t1 || 0;

    // Quest progress
    let completedQuests = [];
    if (dismantled > 0) {
        const { updateQuestProgress } = require('./questSystem');
        completedQuests = updateQuestProgress(userId, 'items_dismantled', dismantled);
    }

    const dismantleEmbed = new EmbedBuilder()
        .setColor('#3B82F6')
        .setTitle('🔨 Phân tách hoàn tất!')
        .setDescription(`Đã phân tách **${dismantled}** đồ Tím`)
        .addFields(
            { name: '💎 Đá T1 nhận được', value: `\`+${stoneGained}\``, inline: true },
            { name: '📦 Còn lại', value: `${boxCount} box`, inline: true }
        )
        .setTimestamp();

    // Buttons sau khi phân tách
    const actionButtons = [];
    const newSessionId = Date.now().toString(36);

    if (boxCount > 0) {
        const nextOpen = Math.min(10, boxCount);
        actionButtons.push(
            new ButtonBuilder()
                .setCustomId(`boxcont_${newSessionId}_${userId}`)
                .setLabel(`📦 Mở tiếp (${nextOpen})`)
                .setStyle(ButtonStyle.Primary)
        );
    }

    actionButtons.push(
        new ButtonBuilder()
            .setCustomId(`viewinv_${newSessionId}_${userId}`)
            .setLabel('🎒 Xem kho đồ')
            .setStyle(ButtonStyle.Secondary)
    );

    const row = new ActionRowBuilder().addComponents(...actionButtons);
    const msg = await interaction.update({ embeds: [dismantleEmbed], components: [row], fetchReply: true });

    // Send quest notifications
    if (completedQuests && completedQuests.length > 0) {
        const { sendQuestNotifications } = require('./questSystem');
        await sendQuestNotifications(interaction.channel, userId, completedQuests);
    }

    // Collector cho buttons sau phân tách
    const collector = msg.createMessageComponentCollector({
        filter: i => i.user.id === userId && i.customId.includes(newSessionId),
        time: 60000
    });

    collector.on('collect', async (btnInt) => {
        try {
            if (btnInt.customId.startsWith('boxcont_')) {
                const currentEco = economy.getOrCreateEconomy(userId);
                const currentBoxes = currentEco.boxes_t1 || 0;

                if (currentBoxes <= 0) {
                    return btnInt.reply({ content: '❌ Bạn không còn box nào!', ephemeral: true });
                }

                const toOpen = Math.min(10, currentBoxes);
                economy.subtractBoxesT1(userId, toOpen);
                collector.stop('continue');
                await openBoxesAnimated(btnInt, toOpen, userId, null);

            } else if (btnInt.customId.startsWith('viewinv_')) {
                collector.stop('view');

                // Hiển thị inventory giống ?kho
                const { getPlayerClass, isDeCu, SLOTS } = require('./classSystem');
                const { calculateEquipmentMastery } = require('./tuneSystem');

                const items = economy.getUserEquipment(userId);
                const playerClass = 'dps'; // Default class, sẽ lấy từ member nếu có

                // Tính mastery và sắp xếp
                const itemsWithMastery = items.map(item => ({
                    ...item,
                    mastery: calculateEquipmentMastery(item, playerClass)
                }));

                const goldItems = itemsWithMastery.filter(i => i.rarity === 'gold').sort((a, b) => b.mastery - a.mastery);
                const purpleItems = itemsWithMastery.filter(i => i.rarity === 'purple').sort((a, b) => b.mastery - a.mastery);
                const sortedItems = [...goldItems, ...purpleItems];

                // Hiển thị 10 item đầu
                const displayItems = sortedItems.slice(0, 10);
                const MAX_INVENTORY = getMaxInventory(userId);
                let description = `📦 **${items.length}/${MAX_INVENTORY}** món\n\n`;

                for (const item of displayItems) {
                    const slot = SLOTS[item.slot];
                    const equipped = item.is_equipped ? ' ✅' : '';
                    const rarityIcon = item.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;

                    description += `${rarityIcon} \`${String(item.id).padStart(6, '0')}\` **${item.name}** ${slot.icon}${equipped}\n`;

                    // Chi tiết dòng vàng
                    const goldLines = item.lines.filter(l => l.rarity === 'gold');
                    if (goldLines.length > 0) {
                        const goldLineInfo = goldLines.map(l => `${l.icon} ${l.percent}%`).join(' ');
                        description += `  └ ${goldLineInfo} • \`${item.mastery} Mastery\`\n`;
                    } else {
                        description += `  └ \`${item.mastery} Mastery\`\n`;
                    }
                }

                if (sortedItems.length > 10) {
                    description += `\n*...và ${sortedItems.length - 10} món khác*`;
                }

                const invEmbed = new EmbedBuilder()
                    .setColor(goldItems.length > 0 ? '#F1C40F' : '#9B59B6')
                    .setTitle('🎒 Kho Đồ')
                    .setDescription(description)
                    .setFooter({ text: `Vàng: ${goldItems.length} | Tím: ${purpleItems.length} • ?kho để xem đầy đủ` })
                    .setTimestamp();

                await btnInt.update({ embeds: [invEmbed], components: [] });
            }
        } catch (error) {
            if (error.code === 10062 || error.code === 40060) {
                try { await msg.edit({ components: [] }); } catch (e) { }
            } else {
                console.error('[boxOpening] Lỗi xử lý nút:', error.message);
            }
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'time') {
            await msg.edit({ components: [] }).catch(() => { });
        }
    });
}

/**
 * Setup collector chỉ cho phân tách (khi kho đầy)
 */
async function setupDismantleCollector(msg, userId, sessionId) {
    const collector = msg.createMessageComponentCollector({
        filter: i => i.user.id === userId && i.customId.startsWith('qdis_'),
        time: 60000
    });

    collector.on('collect', async (btnInt) => {
        try {
            collector.stop('dismantle');
            const newSessionId = Date.now().toString(36);
            await handleDismantle(btnInt, userId, newSessionId);
        } catch (error) {
            if (error.code === 10062 || error.code === 40060) {
                try { await msg.edit({ components: [] }); } catch (e) { }
            } else {
                console.error('[boxOpening] Lỗi xử lý nút:', error.message);
            }
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'time') {
            await msg.edit({ components: [] }).catch(() => { });
        }
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    createBoxOpenUI,
    openBoxesAnimated,
    openBoxesInstant,
    getMaxInventory
};


