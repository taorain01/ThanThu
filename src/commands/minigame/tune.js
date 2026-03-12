/**
 * ?tune - Tune equipment (Select Menu)
 */

const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const economyDb = require('../../database/economy');
const { SLOTS, getPlayerClass, getClassInfo, isDeCu } = require('../../utils/classSystem');
const { rollLine, formatLine, getTuneCost, getBatchTuneCost, calculateEquipmentMastery, calculateTotalMastery } = require('../../utils/tuneSystem');
const ICONS = require('../../config/icons');

async function execute(message, args) {
    const userId = message.author.id;
    const playerClass = getPlayerClass(message.member);

    // Kiểm tra phái
    if (!playerClass) {
        return message.reply('❌ Bạn chưa chọn phái!\nDùng `?pickrole` để chọn DPS, Tanker hoặc Healer.');
    }

    // ========== ?tune all - Tune tất cả đồ vàng chưa full ==========
    if (args[0] && args[0].toLowerCase() === 'all') {
        return bulkTuneAll(message, userId, playerClass);
    }

    // ========== ?tune 1-10 - Tune nhiều trang bị cùng lúc ==========
    if (args.length === 1) {
        const num = parseInt(args[0]);
        if (!isNaN(num) && num >= 1 && num <= 10) {
            return bulkTuneMultiple(message, userId, playerClass, num);
        }
    }

    // ========== QUICK TUNE: ?tune <id> hoặc ?tune <id> <số dòng> ==========
    if (args.length >= 1) {
        const equipId = parseInt(args[0]);
        if (isNaN(equipId)) {
            return message.reply('❌ ID không hợp lệ!\n**Cách dùng:**\n• `?tune` - Chọn từ menu\n• `?tune <id>` - Tune theo ID\n• `?tune 1-10` - Tune nhiều đồ\n• `?tune all` - Tune tất cả');
        }

        // Kiểm tra equipment
        const equipment = economyDb.getEquipment(equipId);
        if (!equipment) {
            return message.reply('❌ Không tìm thấy trang bị!');
        }

        // Kiểm tra ownership - KHÔNG cho tune đồ người khác
        if (equipment.discord_id !== userId) {
            return message.reply('❌ Đây không phải trang bị của bạn!');
        }

        // Kiểm tra đồ vàng
        if (equipment.rarity !== 'gold') {
            return message.reply('❌ Chỉ có thể tune đồ **Vàng**!');
        }

        // Kiểm tra đã tune xong chưa
        if (equipment.final_line) {
            return message.reply('❌ Trang bị này đã tune xong 6 dòng rồi!');
        }

        // Nếu có số dòng: ?tune <id> <số dòng> - Quick tune
        if (args.length >= 2) {
            const times = parseInt(args[1]);
            if (isNaN(times) || times < 1 || times > 4) {
                return message.reply('❌ Số dòng tune phải từ 1-4! Dùng `?tune <id> <1-4>`');
            }

            const remaining = 5 - equipment.lines.length;
            if (times > remaining) {
                return message.reply(`❌ Chỉ còn ${remaining} dòng có thể tune! (${equipment.lines.length}/5)`);
            }

            // Quick tune trực tiếp
            return quickTuneDirect(message, equipment, times, playerClass);
        }

        // Nếu chỉ có ID: ?tune <id> - Hiện UI tune
        return showTuneDetailsFromMessage(message, equipment, playerClass);
    }

    // ========== NORMAL: Hiển thị Select Menu ==========
    // Lấy đồ Vàng chưa tune xong (chưa có final_line)
    const allGoldItems = economyDb.getUserGoldEquipment(userId);
    const goldItems = allGoldItems.filter(item => !item.final_line);

    if (goldItems.length === 0) {
        return message.reply('❌ Bạn không có đồ Vàng nào để tune!\n💡 Mở box bằng `?buy box` - 30% ra đồ Vàng.');
    }

    // Tính điểm cho từng item dựa trên ưu tiên:
    // 1. Vàng đề cử + chưa tune xong (< 5 dòng) = ưu tiên cao nhất
    // 2. Vàng đề cử + chỉ còn dòng cuối (5 dòng, chưa final)
    // 3. Tím đề cử + chưa tune xong
    // 4. Tím đề cử + chỉ còn dòng cuối
    // 5. Còn lại
    const getItemScore = (item) => {
        let hasGoldDeCu = false, hasPurpleDeCu = false;
        let bestGoldPercent = 0, bestPurplePercent = 0;

        const allLines = [...item.lines, item.final_line].filter(Boolean);
        for (const line of allLines) {
            const laDeCu = isDeCu(line.stat, playerClass);
            if (line.rarity === 'gold' && laDeCu) {
                hasGoldDeCu = true;
                if (line.percent > bestGoldPercent) bestGoldPercent = line.percent;
            } else if (line.rarity === 'purple' && laDeCu) {
                hasPurpleDeCu = true;
                if (line.percent > bestPurplePercent) bestPurplePercent = line.percent;
            }
        }

        // Trạng thái tune: chưa full (< 5 dòng) vs chỉ còn dòng cuối (= 5 dòng)
        const needsNormalTune = item.lines.length < 5; // Còn cần tune dòng 2-5
        const needsFinalOnly = item.lines.length >= 5 && !item.final_line; // Chỉ còn dòng cuối

        // Tính priority score (cao = ưu tiên hơn)
        let priorityScore = 0;
        if (hasGoldDeCu && needsNormalTune) {
            priorityScore = 5000000 + bestGoldPercent * 1000; // Ưu tiên 1: Vàng ĐCử chưa tune
        } else if (hasGoldDeCu && needsFinalOnly) {
            priorityScore = 4000000 + bestGoldPercent * 1000; // Ưu tiên 2: Vàng ĐCử còn dòng cuối
        } else if (hasPurpleDeCu && needsNormalTune) {
            priorityScore = 3000000 + bestPurplePercent * 1000; // Ưu tiên 3: Tím ĐCử chưa tune
        } else if (hasPurpleDeCu && needsFinalOnly) {
            priorityScore = 2000000 + bestPurplePercent * 1000; // Ưu tiên 4: Tím ĐCử còn dòng cuối
        } else {
            priorityScore = 1000000 + item.lines.length * 100; // Ưu tiên 5: Còn lại
        }

        return priorityScore;
    };

    // Sắp xếp theo priority score (cao nhất lên trên)
    goldItems.sort((a, b) => getItemScore(b) - getItemScore(a));

    // Rút gọn tên stat để fit vào description (100 chars limit)
    const shortStatName = (statType) => {
        const SHORT_NAMES = {
            'max_hp': 'HP', 'defense': 'PThủ', 'min_attack': 'TấnMin', 'max_attack': 'TấnMax',
            'critical_rate': 'TỉLệChí', 'critical_damage': 'STChí', 'affinity_rate': 'ThânHòa',
            'evasion': 'NéTránh', 'damage_reduction': 'GiảmST', 'agility': 'Tốc', 'momentum': 'Thế',
            'penetration': 'XuyênGiáp', 'the': 'Thế', 'the_stat': 'Thể', 'ngu': 'Ngự',
            'man': 'Mẫn', 'luc': 'Lực', 'cooldown': 'HồiChiêu',
            'tank_endurance': 'ChịuĐựng', 'dps_assault': 'TấnCông', 'healer_restore': 'PhụcHồi',
            'universal_weapon': 'VũKhí'
        };
        return SHORT_NAMES[statType] || statType;
    };

    // Tạo Select Menu với chi tiết dòng
    const options = goldItems.slice(0, 25).map(item => {
        const slot = SLOTS[item.slot];
        const linesCount = item.lines.length + (item.final_line ? 1 : 0);

        // Thu thập dòng vàng đề cử và tím đề cử
        let goldDeCuLines = [], purpleDeCuCount = 0;
        const allLines = [...item.lines, item.final_line].filter(Boolean);
        for (const line of allLines) {
            const laDeCu = isDeCu(line.stat, playerClass);
            if (line.rarity === 'gold' && laDeCu) {
                goldDeCuLines.push({ stat: line.stat, percent: line.percent });
            } else if (line.rarity === 'purple' && laDeCu) {
                purpleDeCuCount++;
            }
        }

        // Tạo mô tả chi tiết - hiển thị tên dòng (KHÔNG dùng custom emote vì Discord description không render)
        let desc = `${linesCount}/6`;
        if (goldDeCuLines.length > 0) {
            // Sắp xếp theo % cao nhất, hiển thị tên dòng
            goldDeCuLines.sort((a, b) => b.percent - a.percent);
            const lineNames = goldDeCuLines.slice(0, 2).map(l =>
                `🟡${shortStatName(l.stat)} ${l.percent}%`
            ).join(' ');
            desc += ` | ${lineNames}`;
        } else if (purpleDeCuCount > 0) {
            desc += ` | 🟣${purpleDeCuCount} ĐCử`;
        }

        return {
            label: `${item.name} (${slot.shortName})`,
            description: desc.substring(0, 100), // Discord limit 100 chars
            value: item.id.toString(),
            emoji: { id: '1459647061124317345', name: 'dongvang' } // Custom emote vàng
        };
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`tune_select_${userId}`)
        .setPlaceholder('Chọn trang bị để tune...')
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const classInfo = getClassInfo(playerClass);
    const embed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('⚙️ TUNE TRANG BỊ')
        .setDescription(`Chọn trang bị **Vàng** để tune:\n*Ưu tiên đồ có dòng vàng đề cử % cao nhất*\n\n💡 *Hoặc dùng:*\n\`?tune <id>\` - Tune nhanh theo ID\n\`?tune <id> <1-4>\` - Tune nhiều dòng`)
        .addFields(
            { name: '📊 Phái của bạn', value: `${classInfo.icon} ${classInfo.name}`, inline: true },
            { name: `${ICONS.rarity.gold} Đồ Vàng`, value: `${goldItems.length} món`, inline: true }
        )
        .setFooter({ text: 'Vàng = Vàng Đề Cử | ĐCử = Đề Cử cho phái bạn' })
        .setTimestamp();

    const reply = await message.reply({ embeds: [embed], components: [row] });

    // Collector cho Select Menu
    const collector = reply.createMessageComponentCollector({
        filter: (i) => i.user.id === userId,
        time: 60000
    });

    collector.on('collect', async (interaction) => {
        try {
            if (interaction.customId === `tune_select_${userId}`) {
                const equipId = parseInt(interaction.values[0]);
                await showTuneDetails(interaction, equipId, playerClass);
            } else if (interaction.customId.startsWith('tune_batch_')) {
                // tune_batch_<times>_<equipId>
                const [, , times, equipId] = interaction.customId.split('_');
                await tuneBatch(interaction, parseInt(equipId), parseInt(times), playerClass);
            } else if (interaction.customId.startsWith('tune_final_')) {
                const equipId = parseInt(interaction.customId.split('_')[2]);
                await tuneFinalLine(interaction, equipId, playerClass);
            } else if (interaction.customId.startsWith('tune_equip_')) {
                const equipId = parseInt(interaction.customId.split('_')[2]);
                await quickEquipFromTune(interaction, equipId, playerClass);
            }
        } catch (error) {
            if (error.code === 10062 || error.code === 40060) {
                try { await reply.edit({ components: [] }); } catch (e) { }
            } else {
                console.error('[tune] Lỗi xử lý nút:', error.message);
            }
        }
    });

    collector.on('end', async () => {
        try {
            await reply.edit({ components: [] });
        } catch (e) { }
    });
}

/**
 * Hiển thị UI tune từ message (cho ?tune <id>)
 */
async function showTuneDetailsFromMessage(message, equipment, playerClass) {
    const userId = message.author.id;
    const equipId = equipment.id;
    const slot = SLOTS[equipment.slot];
    const eco = economyDb.getOrCreateEconomy(userId);
    const mastery = calculateEquipmentMastery(equipment, playerClass);
    const classInfo = getClassInfo(playerClass);

    // Format lines
    let linesText = '';
    for (let i = 0; i < 5; i++) {
        if (equipment.lines[i]) {
            linesText += `${formatLine(equipment.lines[i], playerClass)}\n`;
        } else {
            const cost = getTuneCost(i + 1);
            linesText += `[${i + 1}] Chưa tune - **${cost} 💎**\n`;
        }
    }

    // Final line
    let finalLineText;
    if (equipment.final_line) {
        finalLineText = formatLine(equipment.final_line, playerClass);
    } else if (equipment.lines.length >= 5) {
        finalLineText = `⚡ Sẵn sàng tune! (**1 🔮**) ${eco.thach_am >= 1 ? '✅' : '❌ Thiếu Thạch Âm'}`;
    } else {
        finalLineText = '🔒 Cần 5 dòng để mở khóa';
    }

    const embed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle(`${slot.icon} ${equipment.name} (${slot.shortName})`)
        .setDescription(`Tier ${equipment.tier} | ${classInfo.icon} ${classInfo.name}`)
        .addFields(
            { name: '📊 Các dòng', value: linesText, inline: false },
            { name: '⚡ Dòng cuối', value: finalLineText, inline: false },
            { name: '🏆 Mastery', value: `${mastery} điểm`, inline: true },
            { name: '💎 Đá T1', value: `${eco.enhancement_stone_t1}`, inline: true },
            { name: '🔮 Thạch Âm', value: `${eco.thach_am}`, inline: true }
        )
        .setTimestamp();

    // Tạo buttons cho batch tune
    const buttons = [];
    const remaining = 5 - equipment.lines.length;

    for (let times = 1; times <= Math.min(remaining, 4); times++) {
        const cost = getBatchTuneCost(equipment.lines.length, times);
        const canAfford = eco.enhancement_stone_t1 >= cost;

        buttons.push(
            new ButtonBuilder()
                .setCustomId(`tune_batch_${times}_${equipId}`)
                .setLabel(`${times} Lần (${cost}💎)`)
                .setStyle(canAfford ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(!canAfford)
        );
    }

    // Button tune dòng cuối
    if (equipment.lines.length >= 5 && !equipment.final_line) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`tune_final_${equipId}`)
                .setLabel('Dòng Cuối (1🔮)')
                .setStyle(eco.thach_am >= 1 ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(eco.thach_am < 1)
        );
    }

    // Button gắn trang bị nhanh (chỉ hiện nếu chưa gắn)
    const isEquipped = equipment.is_equipped === 1;
    if (!isEquipped) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`tune_equip_${equipId}`)
                .setLabel('🎽 Gắn nhanh')
                .setStyle(ButtonStyle.Success)
        );
    }

    const components = buttons.length > 0 ? [new ActionRowBuilder().addComponents(buttons)] : [];

    const reply = await message.reply({ embeds: [embed], components });

    // Collector cho buttons
    const collector = reply.createMessageComponentCollector({
        filter: (i) => i.user.id === userId,
        time: 60000
    });

    collector.on('collect', async (interaction) => {
        try {
            if (interaction.customId.startsWith('tune_batch_')) {
                const [, , times, eqId] = interaction.customId.split('_');
                await tuneBatch(interaction, parseInt(eqId), parseInt(times), playerClass);
            } else if (interaction.customId.startsWith('tune_final_')) {
                const eqId = parseInt(interaction.customId.split('_')[2]);
                await tuneFinalLine(interaction, eqId, playerClass);
            } else if (interaction.customId.startsWith('tune_equip_')) {
                const eqId = parseInt(interaction.customId.split('_')[2]);
                await quickEquipFromTune(interaction, eqId, playerClass);
            }
        } catch (error) {
            if (error.code === 10062 || error.code === 40060) {
                try { await reply.edit({ components: [] }); } catch (e) { }
            } else {
                console.error('[tune quick] Lỗi xử lý nút:', error.message);
            }
        }
    });

    collector.on('end', async () => {
        try { await reply.edit({ components: [] }); } catch (e) { }
    });
}

/**
 * Quick tune trực tiếp từ command (cho ?tune <id> <số dòng>)
 */
async function quickTuneDirect(message, equipment, times, playerClass) {
    const userId = message.author.id;
    const equipId = equipment.id;
    const totalCost = getBatchTuneCost(equipment.lines.length, times);

    // Trừ đá
    const result = economyDb.subtractStoneT1(userId, totalCost);
    if (!result.success) {
        return message.reply(`❌ Không đủ Đá T1! Cần ${totalCost} 💎`);
    }

    // Check buff Tinh Thể Vàng (chỉ áp dụng cho dòng đầu tiên)
    const hasGoldBuff = economyDb.consumeTuneGoldBuff(userId);

    // Roll nhiều dòng
    const newLines = [];
    for (let i = 0; i < times; i++) {
        // Dòng đầu tiên dùng buff nếu có
        const forceGold = (i === 0 && hasGoldBuff);
        const newLine = rollLine(equipment.slot, forceGold);
        equipment.lines.push(newLine);
        newLines.push(newLine);
    }

    // Lưu
    economyDb.updateEquipmentLines(equipId, equipment.lines);
    economyDb.logTransaction(userId, 'tune_batch', `${equipment.name} x${times} dòng`, -totalCost);

    // Track progress and quest
    let completedQuests = [];
    try {
        economyDb.updateProgress(userId, 'tune_count', times);
        const { updateQuestProgress } = require('../../utils/questSystem');
        completedQuests = updateQuestProgress(userId, 'tune_count', times);
    } catch (e) { console.error('Quest progress error:', e); }

    // Format kết quả - Dùng UI mới như updateBatchTuneEmbed
    const slot = SLOTS[equipment.slot];
    const mastery = calculateEquipmentMastery(equipment, playerClass);
    const eco = economyDb.getOrCreateEconomy(userId);

    // Đếm dòng đề cử cho mỗi class
    const deCuCount = { dps: 0, tanker: 0, healer: 0 };
    const allLines = [...equipment.lines, equipment.final_line].filter(Boolean);
    for (const line of allLines) {
        if (isDeCu(line.stat, 'dps')) deCuCount.dps++;
        if (isDeCu(line.stat, 'tanker')) deCuCount.tanker++;
        if (isDeCu(line.stat, 'healer')) deCuCount.healer++;
    }

    let bestClass = 'dps';
    let maxCount = deCuCount.dps;
    if (deCuCount.tanker > maxCount) { bestClass = 'tanker'; maxCount = deCuCount.tanker; }
    if (deCuCount.healer > maxCount) { bestClass = 'healer'; }

    const classNames = { dps: 'DPS ⚔️', tanker: 'Tanker 🛡️', healer: 'Healer 💚' };
    const recommendedClass = classNames[bestClass];

    // Kiểm tra PERFECT ROLL
    let hasGoldDeCu = false;
    for (const line of newLines) {
        if (line.rarity === 'gold' && isDeCu(line.stat, playerClass)) hasGoldDeCu = true;
    }

    // Format lines với emote bốc lửa cho dòng mới tune
    const oldLineCount = equipment.lines.length - times;
    let linesText = '';
    for (let i = 0; i < equipment.lines.length; i++) {
        const line = equipment.lines[i];
        const isNewLine = i >= oldLineCount;
        linesText += `${formatLine(line, playerClass, isNewLine)}`;
        if (isNewLine && isDeCu(line.stat, playerClass)) linesText += ' 🎉';
        linesText += '\n';
    }

    // Thêm các dòng chưa tune
    for (let i = equipment.lines.length; i < 5; i++) {
        const cost = getTuneCost(i + 1);
        linesText += `[${i + 1}] Chưa tune - **${cost} 💎**\n`;
    }

    // Slot names cho comparison text
    const slotNames = {
        mu: 'Mũ', giap: 'Giáp', gang: 'Găng Tay', giay: 'Giày',
        vukhi: 'Vũ Khí Chính', vukhiphu: 'Vũ Khí Phụ', ngocboi: 'Ngọc Bội', khuyentai: 'Khuyên Tai'
    };

    // So sánh với trang bị đang mặc
    const equippedItems = economyDb.getEquippedItems(userId);
    const currentEquipped = equippedItems.find(item => item.slot === equipment.slot);
    let comparisonField = null;

    if (currentEquipped && currentEquipped.id !== equipment.id) {
        const equippedMastery = calculateEquipmentMastery(currentEquipped, playerClass);
        const diff = mastery - equippedMastery;
        const diffSign = diff >= 0 ? '+' : '';
        const diffColor = diff >= 0 ? '🟢' : '🔴';

        // Format dòng của trang bị đang mặc
        let equippedLines = '';
        for (let i = 0; i < currentEquipped.lines.length; i++) {
            equippedLines += `${formatLine(currentEquipped.lines[i], playerClass)}\n`;
        }
        if (currentEquipped.final_line) {
            equippedLines += `${ICONS.rarity.starDecu} ${formatLine(currentEquipped.final_line, playerClass)}`;
        }
        if (!equippedLines) equippedLines = '*Chưa có dòng*';

        comparisonField = {
            name: `📊 So sánh: ${currentEquipped.name} • 🏆 ${equippedMastery} điểm (${diffSign}${diff})`,
            value: equippedLines || '*Chưa có dòng*',
            inline: false
        };
    } else if (!currentEquipped) {
        comparisonField = {
            name: '📊 So sánh',
            value: `📭 Chưa trang bị **${slotNames[equipment.slot]}**`,
            inline: false
        };
    }

    // Build description - Tier/Phù hợp TRÊN PERFECT ROLL
    let description = `Tier ${equipment.tier} | **Phù hợp cho: ${recommendedClass}**`;
    if (hasGoldDeCu) {
        description += `\n\n🏆 **PERFECT ROLL! Có Vàng Đề Cử!**`;
    }

    const bestRarity = newLines.some(l => l.rarity === 'gold') ? 'gold' : 'purple';

    // Build fields array - Mastery sau Các dòng, comparison tiếp theo, Đá T1/Thạch Âm cuối
    const fields = [
        { name: `🎯 Các dòng • 🏆 ${mastery} điểm`, value: linesText, inline: false }
    ];

    // Thêm comparison field
    if (comparisonField) {
        fields.push(comparisonField);
    }

    // Đá T1 và Thạch Âm ở cuối cùng
    fields.push(
        { name: '💎 Đá T1 còn', value: `${eco.enhancement_stone_t1}`, inline: true },
        { name: '🔮 Thạch Âm', value: `${eco.thach_am}`, inline: true }
    );

    const embed = new EmbedBuilder()
        .setColor(bestRarity === 'gold' ? 0xF1C40F : 0x9B59B6)
        .setTitle(`${slot.icon} ${equipment.name} (${slot.shortName})`)
        .setDescription(description)
        .addFields(...fields)
        .setFooter({ text: `Tiêu ${totalCost} Đá T1` })
        .setTimestamp();

    await message.reply({ embeds: [embed] });

    // Quest notification
    if (completedQuests && completedQuests.length > 0) {
        const { sendQuestNotifications } = require('../../utils/questSystem');
        await sendQuestNotifications(message.channel, userId, completedQuests);
    }
}

async function showTuneDetails(interaction, equipId, playerClass) {
    const equipment = economyDb.getEquipment(equipId);

    if (!equipment) {
        return interaction.reply({ content: '❌ Không tìm thấy trang bị!', ephemeral: true });
    }

    const slot = SLOTS[equipment.slot];
    const eco = economyDb.getOrCreateEconomy(interaction.user.id);
    const mastery = calculateEquipmentMastery(equipment, playerClass);
    const classInfo = getClassInfo(playerClass);

    // Format lines
    let linesText = '';
    for (let i = 0; i < 5; i++) {
        if (equipment.lines[i]) {
            linesText += `${formatLine(equipment.lines[i], playerClass)}\n`;
        } else {
            const cost = getTuneCost(i + 1);
            linesText += `[${i + 1}] Chưa tune - **${cost} 💎**\n`;
        }
    }

    // Final line
    let finalLineText;
    if (equipment.final_line) {
        finalLineText = formatLine(equipment.final_line, playerClass);
    } else if (equipment.lines.length >= 5) {
        finalLineText = `⚡ Sẵn sàng tune! (**1 🔮**) ${eco.thach_am >= 1 ? '✅' : '❌ Thiếu Thạch Âm'}`;
    } else {
        finalLineText = '🔒 Cần 5 dòng để mở khóa';
    }

    const embed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle(`${slot.icon} ${equipment.name} (${slot.shortName})`)
        .setDescription(`Tier ${equipment.tier} | ${classInfo.icon} ${classInfo.name}`)
        .addFields(
            { name: '📊 Các dòng', value: linesText, inline: false },
            { name: '⚡ Dòng cuối', value: finalLineText, inline: false },
            { name: '🏆 Mastery', value: `${mastery} điểm`, inline: true },
            { name: '💎 Đá T1', value: `${eco.enhancement_stone_t1}`, inline: true },
            { name: '🔮 Thạch Âm', value: `${eco.thach_am}`, inline: true }
        )
        .setTimestamp();

    // Tạo buttons cho batch tune (1 Lần, 2 Lần, 3 Lần, 4 Lần)
    const buttons = [];
    const remaining = 5 - equipment.lines.length; // Số dòng còn lại để tune

    for (let times = 1; times <= Math.min(remaining, 4); times++) {
        const cost = getBatchTuneCost(equipment.lines.length, times);
        const canAfford = eco.enhancement_stone_t1 >= cost;

        // Tính dòng sẽ tune
        const fromLine = equipment.lines.length + 1;
        const toLine = equipment.lines.length + times;
        const lineRange = times === 1 ? `Dòng ${fromLine}` : `Dòng ${fromLine}-${toLine}`;

        buttons.push(
            new ButtonBuilder()
                .setCustomId(`tune_batch_${times}_${equipId}`)
                .setLabel(`${times} Lần (${cost}💎)`)
                .setStyle(canAfford ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(!canAfford)
        );
    }

    // Button tune dòng cuối
    if (equipment.lines.length >= 5 && !equipment.final_line) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`tune_final_${equipId}`)
                .setLabel('Dòng Cuối (1🔮)')
                .setStyle(eco.thach_am >= 1 ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(eco.thach_am < 1)
        );
    }

    const components = buttons.length > 0 ? [new ActionRowBuilder().addComponents(buttons)] : [];

    await interaction.update({ embeds: [embed], components });
}

async function tuneBatch(interaction, equipId, times, playerClass) {
    const equipment = economyDb.getEquipment(equipId);
    const totalCost = getBatchTuneCost(equipment.lines.length, times);

    // Trừ đá
    const result = economyDb.subtractStoneT1(interaction.user.id, totalCost);
    if (!result.success) {
        return interaction.reply({ content: `❌ Không đủ Đá T1! Cần ${totalCost} 💎`, ephemeral: true });
    }

    // Check buff Tinh Thể Vàng (chỉ áp dụng cho dòng đầu tiên)
    const hasGoldBuff = economyDb.consumeTuneGoldBuff(interaction.user.id);

    // Roll nhiều dòng
    const newLines = [];
    for (let i = 0; i < times; i++) {
        // Dòng đầu tiên dùng buff nếu có
        const forceGold = (i === 0 && hasGoldBuff);
        const newLine = rollLine(equipment.slot, forceGold);
        equipment.lines.push(newLine);
        newLines.push(newLine);
    }

    // Lưu
    economyDb.updateEquipmentLines(equipId, equipment.lines);
    economyDb.logTransaction(interaction.user.id, 'tune_batch', `${equipment.name} x${times} dòng`, -totalCost);

    // Track progress and quest
    let completedQuests = [];
    try {
        economyDb.updateProgress(interaction.user.id, 'tune_count', times);
        const { updateQuestProgress } = require('../../utils/questSystem');
        completedQuests = updateQuestProgress(interaction.user.id, 'tune_count', times);
    } catch (e) { console.error('Quest progress error:', e); }

    // Cập nhật embed với kết quả
    await updateBatchTuneEmbed(interaction, equipId, playerClass, newLines);

    // Quest notification (sau khi embed đã update)
    if (completedQuests && completedQuests.length > 0) {
        const { sendQuestNotifications } = require('../../utils/questSystem');
        await sendQuestNotifications(interaction.channel, interaction.user.id, completedQuests);
    }
}

async function tuneFinalLine(interaction, equipId, playerClass) {
    const equipment = economyDb.getEquipment(equipId);

    // Trừ Thạch Âm
    const result = economyDb.subtractThachAm(interaction.user.id, 1);
    if (!result.success) {
        return interaction.reply({ content: '❌ Không đủ Thạch Âm!', ephemeral: true });
    }

    // Check buff Thạch Âm Vàng
    const hasGoldBuff = economyDb.consumeFinalLineGoldBuff(interaction.user.id);

    // Roll dòng cuối (với buff nếu có)
    const finalLine = rollLine(equipment.slot, hasGoldBuff);

    // Lưu
    economyDb.updateEquipmentFinalLine(equipId, finalLine);
    economyDb.logTransaction(interaction.user.id, 'tune_final', `${equipment.name} dòng cuối`, -1);

    // Track progress and quest
    let completedQuests = [];
    try {
        economyDb.updateProgress(interaction.user.id, 'tune_count', 1);
        const { updateQuestProgress } = require('../../utils/questSystem');
        completedQuests = updateQuestProgress(interaction.user.id, 'tune_count', 1);
    } catch (e) { console.error('Quest progress error:', e); }

    // Cập nhật embed với dòng cuối
    await updateBatchTuneEmbed(interaction, equipId, playerClass, [{ ...finalLine, isFinalLine: true }]);

    // Quest notification (sau khi embed đã update)
    if (completedQuests && completedQuests.length > 0) {
        const { sendQuestNotifications } = require('../../utils/questSystem');
        await sendQuestNotifications(interaction.channel, interaction.user.id, completedQuests);
    }
}

/**
 * Cập nhật embed tune với kết quả batch roll
 */
async function updateBatchTuneEmbed(interaction, equipId, playerClass, newLines) {
    const equipment = economyDb.getEquipment(equipId);
    const slot = SLOTS[equipment.slot];
    const eco = economyDb.getOrCreateEconomy(interaction.user.id);
    const mastery = calculateEquipmentMastery(equipment, playerClass);

    // Đếm dòng đề cử cho mỗi class để xác định "Phù hợp cho"
    const deCuCount = { dps: 0, tanker: 0, healer: 0 };
    const allLines = [...equipment.lines, equipment.final_line].filter(Boolean);

    for (const line of allLines) {
        if (isDeCu(line.stat, 'dps')) deCuCount.dps++;
        if (isDeCu(line.stat, 'tanker')) deCuCount.tanker++;
        if (isDeCu(line.stat, 'healer')) deCuCount.healer++;
    }

    // Tìm class phù hợp nhất
    let bestClass = 'dps';
    let maxCount = deCuCount.dps;
    if (deCuCount.tanker > maxCount) { bestClass = 'tanker'; maxCount = deCuCount.tanker; }
    if (deCuCount.healer > maxCount) { bestClass = 'healer'; }

    const classNames = { dps: 'DPS ⚔️', tanker: 'Tanker 🛡️', healer: 'Healer 💚' };
    const recommendedClass = classNames[bestClass];

    // Kiểm tra PERFECT ROLL (Vàng + Đề Cử cho player class)
    let hasGoldDeCu = false;
    const newLineIndices = new Set();

    // Xác định index của các dòng mới tune
    const oldLineCount = equipment.lines.length - newLines.filter(l => !l.isFinalLine).length;
    for (let i = oldLineCount; i < equipment.lines.length; i++) {
        newLineIndices.add(i);
    }

    for (const line of newLines) {
        const laDeCu = isDeCu(line.stat, playerClass);
        if (line.rarity === 'gold' && laDeCu) hasGoldDeCu = true;
    }

    // Format lines với indicators cho dòng mới
    let linesText = '';
    for (let i = 0; i < 5; i++) {
        if (equipment.lines[i]) {
            const line = equipment.lines[i];
            const isNewLine = newLineIndices.has(i);
            linesText += `${formatLine(line, playerClass, isNewLine)}`;
            if (isNewLine && isDeCu(line.stat, playerClass)) linesText += ' 🎉';
            linesText += '\n';
        } else {
            const cost = getTuneCost(i + 1);
            linesText += `[${i + 1}] Chưa tune - **${cost} 💎**\n`;
        }
    }

    // Final line
    let finalLineText;
    const isFinalLineNew = newLines.some(l => l.isFinalLine);
    if (equipment.final_line) {
        finalLineText = `${formatLine(equipment.final_line, playerClass, isFinalLineNew)}`;
        if (isFinalLineNew && isDeCu(equipment.final_line.stat, playerClass)) finalLineText += ' 🎉';
    } else if (equipment.lines.length >= 5) {
        finalLineText = `⚡ Sẵn sàng tune! (**1 🔮**) ${eco.thach_am >= 1 ? '✅' : '❌ Thiếu Thạch Âm'}`;
    } else {
        finalLineText = '🔒 Cần 5 dòng để mở khóa';
    }

    // Slot names cho comparison text
    const slotNames = {
        mu: 'Mũ', giap: 'Giáp', gang: 'Găng Tay', giay: 'Giày',
        vukhi: 'Vũ Khí Chính', vukhiphu: 'Vũ Khí Phụ', ngocboi: 'Ngọc Bội', khuyentai: 'Khuyên Tai'
    };

    // So sánh với trang bị đang mặc
    const equippedItems = economyDb.getEquippedItems(interaction.user.id);
    const currentEquipped = equippedItems.find(item => item.slot === equipment.slot);
    let comparisonField = null;

    if (currentEquipped && currentEquipped.id !== equipment.id) {
        const equippedMastery = calculateEquipmentMastery(currentEquipped, playerClass);
        const diff = mastery - equippedMastery;
        const diffSign = diff >= 0 ? '+' : '';
        const diffColor = diff >= 0 ? '🟢' : '🔴';

        // Format dòng của trang bị đang mặc
        let equippedLines = '';
        for (let i = 0; i < currentEquipped.lines.length; i++) {
            equippedLines += `${formatLine(currentEquipped.lines[i], playerClass)}\n`;
        }
        if (currentEquipped.final_line) {
            equippedLines += `${ICONS.rarity.starDecu} ${formatLine(currentEquipped.final_line, playerClass)}`;
        }
        if (!equippedLines) equippedLines = '*Chưa có dòng*';

        comparisonField = {
            name: `📊 So sánh: ${currentEquipped.name} • 🏆 ${equippedMastery} điểm (${diffSign}${diff})`,
            value: equippedLines || '*Chưa có dòng*',
            inline: false
        };
    } else if (!currentEquipped) {
        comparisonField = {
            name: '📊 So sánh',
            value: `📭 Chưa trang bị **${slotNames[equipment.slot]}**`,
            inline: false
        };
    }

    // Build description - Tier/Phù hợp TRÊN PERFECT ROLL
    let description = `Tier ${equipment.tier} | **Phù hợp cho: ${recommendedClass}**`;
    if (hasGoldDeCu) {
        description += `\n\n🏆 **PERFECT ROLL! Có Vàng Đề Cử!**`;
    }

    // Chọn màu dựa trên kết quả tốt nhất
    const bestRarity = newLines.some(l => l.rarity === 'gold') ? 'gold' : 'purple';

    // Build fields array - Mastery ngay sau Các dòng, comparison tiếp theo, Đá T1/Thạch Âm cuối cùng
    const fields = [
        { name: `🎯 Các dòng • 🏆 ${mastery} điểm`, value: linesText, inline: false },
        { name: '⚡ Dòng cuối', value: finalLineText, inline: false }
    ];

    // Thêm comparison field
    if (comparisonField) {
        fields.push(comparisonField);
    }

    // Đá T1 và Thạch Âm ở cuối cùng
    fields.push(
        { name: '💎 Đá T1', value: `${eco.enhancement_stone_t1}`, inline: true },
        { name: '🔮 Thạch Âm', value: `${eco.thach_am}`, inline: true }
    );

    const embed = new EmbedBuilder()
        .setColor(bestRarity === 'gold' ? 0xF1C40F : 0x9B59B6)
        .setTitle(`${slot.icon} ${equipment.name} (${slot.shortName})`)
        .setDescription(description)
        .addFields(...fields)
        .setTimestamp();

    // Tạo buttons cho batch tune
    const buttons = [];
    const remaining = 5 - equipment.lines.length;

    for (let times = 1; times <= Math.min(remaining, 4); times++) {
        const cost = getBatchTuneCost(equipment.lines.length, times);
        const canAfford = eco.enhancement_stone_t1 >= cost;

        buttons.push(
            new ButtonBuilder()
                .setCustomId(`tune_batch_${times}_${equipId}`)
                .setLabel(`${times} Lần (${cost}💎)`)
                .setStyle(canAfford ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(!canAfford)
        );
    }

    // Button tune dòng cuối
    if (equipment.lines.length >= 5 && !equipment.final_line) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`tune_final_${equipId}`)
                .setLabel('Dòng Cuối (1🔮)')
                .setStyle(eco.thach_am >= 1 ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(eco.thach_am < 1)
        );
    }

    // Button gắn trang bị nhanh (chỉ hiện nếu chưa gắn)
    const isEquipped = equipment.is_equipped === 1;
    if (!isEquipped) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`tune_equip_${equipId}`)
                .setLabel('🎽 Gắn nhanh')
                .setStyle(ButtonStyle.Success)
        );
    }

    const components = buttons.length > 0 ? [new ActionRowBuilder().addComponents(buttons)] : [];

    await interaction.update({ embeds: [embed], components });
}

/**
 * Gắn trang bị nhanh từ tune
 */
async function quickEquipFromTune(interaction, equipId, playerClass) {
    const equipment = economyDb.getEquipment(equipId);
    const userId = interaction.user.id;

    if (!equipment) {
        return interaction.reply({ content: '❌ Không tìm thấy trang bị!', ephemeral: true });
    }

    // Check if already equipped
    if (equipment.is_equipped === 1) {
        return interaction.reply({ content: '✅ Trang bị này đã được gắn rồi!', ephemeral: true });
    }

    // Check if there's another item in the same slot
    const equippedItems = economyDb.getEquippedItems(userId);
    const existingItem = equippedItems.find(i => i.slot === equipment.slot);

    // Equip the new item (equipItem already handles unequipping old item in same slot)
    economyDb.equipItem(userId, equipId);

    // Quest progress
    const { updateQuestProgress, sendQuestNotifications } = require('../../utils/questSystem');
    const completedQuests = updateQuestProgress(userId, 'items_equipped', 1);

    const slot = SLOTS[equipment.slot];
    const mastery = calculateEquipmentMastery(equipment, playerClass);
    const updatedEquipped = economyDb.getEquippedItems(userId);
    const totalMastery = calculateTotalMastery(updatedEquipped, playerClass);

    const embed = new EmbedBuilder()
        .setColor(0x22C55E)
        .setTitle('🎽 Gắn Trang Bị Thành Công!')
        .setDescription(existingItem
            ? `Đã thay **${existingItem.name}** bằng **${equipment.name}**`
            : `Đã gắn **${equipment.name}**`)
        .addFields(
            { name: 'Slot', value: `${slot.icon} ${slot.name}`, inline: true },
            { name: 'Mastery', value: `${mastery} điểm`, inline: true },
            { name: '📊 Tổng Mastery', value: `${totalMastery} điểm (${updatedEquipped.length}/8 món)`, inline: false }
        )
        .setTimestamp();

    await interaction.update({ embeds: [embed], components: [] });
    await sendQuestNotifications(interaction.channel, userId, completedQuests);
}

/**
 * Bulk Tune: ?tune 1-10 - Tune nhiều trang bị cùng lúc
 * Tìm 1-10 đồ vàng chưa full 5 dòng và tune lên 5 dòng
 */
async function bulkTuneMultiple(message, userId, playerClass, count) {
    const eco = economyDb.getOrCreateEconomy(userId);

    // Tìm đồ vàng chưa full 5 dòng
    const allGoldItems = economyDb.getUserGoldEquipment(userId);
    const tuneableItems = allGoldItems.filter(item => !item.final_line && item.lines.length < 5);

    if (tuneableItems.length === 0) {
        return message.reply('❌ Không có đồ vàng nào cần tune!\nTất cả đã có đủ 5 dòng hoặc đã tune xong.');
    }

    // Lấy số lượng thực tế (tối đa count hoặc số đồ có sẵn)
    const actualCount = Math.min(count, tuneableItems.length);
    const itemsToTune = tuneableItems.slice(0, actualCount);

    // Tính tổng chi phí
    let totalCost = 0;
    let lineDetails = [];

    for (const item of itemsToTune) {
        const remaining = 5 - item.lines.length;
        const cost = getBatchTuneCost(item.lines.length, remaining);
        totalCost += cost;
        lineDetails.push({ item, remaining, cost });
    }

    // Kiểm tra đủ đá không
    if (eco.enhancement_stone_t1 < totalCost) {
        const shortage = totalCost - eco.enhancement_stone_t1;

        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('❌ Không đủ Đá T1!')
            .setDescription([
                `Cần tune **${actualCount}** đồ lên 5 dòng`,
                `Tổng chi phí: **${totalCost}** 💎`,
                `Bạn có: **${eco.enhancement_stone_t1}** 💎`,
                `Thiếu: **${shortage}** 💎`,
                '',
                '💡 *Phân tách đồ tím để lấy đá*',
                '`?inv` → Nút "Phân Tách Nhanh"'
            ].join('\n'))
            .setTimestamp();

        // Thêm nút phân tách nhanh
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`bulk_tune_dismantle_${userId}_${actualCount}`)
                .setLabel('⚡ Phân Tách Tím')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`bulk_tune_cancel_${userId}`)
                .setLabel('Hủy')
                .setStyle(ButtonStyle.Secondary)
        );

        const reply = await message.reply({ embeds: [embed], components: [row] });

        const collector = reply.createMessageComponentCollector({
            filter: i => i.user.id === userId,
            time: 60000
        });

        collector.on('collect', async (interaction) => {
            if (interaction.customId === `bulk_tune_cancel_${userId}`) {
                await interaction.update({ content: '❌ Đã hủy.', embeds: [], components: [] });
            } else if (interaction.customId.startsWith('bulk_tune_dismantle_')) {
                // Phân tách nhanh tất cả đồ tím
                const purpleItems = economyDb.getUserEquipment(userId).filter(i =>
                    i.rarity === 'purple' && !i.is_equipped && !i.is_locked
                );

                if (purpleItems.length === 0) {
                    return interaction.update({ content: '❌ Không có đồ tím nào để phân tách!', embeds: [], components: [] });
                }

                let stonesGained = 0;
                for (const item of purpleItems) {
                    stonesGained += 5; // 5 đá T1 mỗi đồ tím
                    economyDb.deleteEquipment(item.id);
                }
                economyDb.addStoneT1(userId, stonesGained);

                // Track dismantle quest
                const { updateQuestProgress, sendQuestNotifications } = require('../../utils/questSystem');
                const completedQuests = updateQuestProgress(userId, 'items_dismantled', purpleItems.length);

                await interaction.update({
                    content: `✅ Đã phân tách **${purpleItems.length}** đồ tím → **+${stonesGained}** 💎\nDùng \`?tune ${actualCount}\` lại để tune!`,
                    embeds: [],
                    components: []
                });

                // Send quest notifications if any completed
                if (completedQuests.length > 0) {
                    await sendQuestNotifications(interaction.channel, userId, completedQuests);
                }
            }
        });

        collector.on('end', async () => {
            try { await reply.edit({ components: [] }); } catch (e) { }
        });

        return;
    }

    // Đủ đá - hiện xác nhận (giới hạn hiển thị 15 items)
    let itemsList = lineDetails.slice(0, 15).map(d => {
        const slot = SLOTS[d.item.slot];
        return `${slot.icon} ${d.item.name}: ${d.item.lines.length}→5 dòng (${d.cost}💎)`;
    }).join('\n');

    if (lineDetails.length > 15) {
        itemsList += `\n*...và ${lineDetails.length - 15} đồ khác*`;
    }

    const confirmEmbed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle(`⚡ Bulk Tune ${actualCount} đồ`)
        .setDescription([
            `**Tổng chi phí: ${totalCost} 💎**`,
            `Đá hiện có: ${eco.enhancement_stone_t1} 💎`,
            '',
            itemsList
        ].join('\n'))
        .setFooter({ text: 'Nhấn để tune tất cả lên 5 dòng' })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`bulk_tune_confirm_${userId}_${actualCount}`)
            .setLabel(`⚡ Tune ${actualCount} đồ (${totalCost}💎)`)
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`bulk_tune_cancel_${userId}`)
            .setLabel('Hủy')
            .setStyle(ButtonStyle.Secondary)
    );

    const reply = await message.reply({ embeds: [confirmEmbed], components: [row] });

    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === userId,
        time: 60000
    });

    collector.on('collect', async (interaction) => {
        if (interaction.customId === `bulk_tune_cancel_${userId}`) {
            await interaction.update({ content: '❌ Đã hủy.', embeds: [], components: [] });
        } else if (interaction.customId.startsWith('bulk_tune_confirm_')) {
            await executeBulkTune(interaction, userId, playerClass, actualCount);
        }
    });

    collector.on('end', async () => {
        try { await reply.edit({ components: [] }); } catch (e) { }
    });
}

/**
 * Thực hiện bulk tune
 */
async function executeBulkTune(interaction, userId, playerClass, count) {
    const allGoldItems = economyDb.getUserGoldEquipment(userId);
    const tuneableItems = allGoldItems.filter(item => !item.final_line && item.lines.length < 5);
    const itemsToTune = tuneableItems.slice(0, count);

    let totalCost = 0;
    let totalLines = 0;
    let results = [];

    for (const item of itemsToTune) {
        const remaining = 5 - item.lines.length;
        const cost = getBatchTuneCost(item.lines.length, remaining);

        // Trừ đá
        const result = economyDb.subtractStoneT1(userId, cost);
        if (!result.success) break;

        // Roll các dòng
        for (let i = 0; i < remaining; i++) {
            const newLine = rollLine(item.slot, false);
            item.lines.push(newLine);
        }

        // Lưu
        economyDb.updateEquipmentLines(item.id, item.lines);
        economyDb.logTransaction(userId, 'bulk_tune', `${item.name} x${remaining} dòng`, -cost);

        totalCost += cost;
        totalLines += remaining;

        const slot = SLOTS[item.slot];
        const mastery = calculateEquipmentMastery(item, playerClass);
        results.push(`${slot.icon} **${item.name}**: +${remaining} dòng (🏆${mastery})`);
    }

    // Track quest
    let completedQuests = [];
    try {
        economyDb.updateProgress(userId, 'tune_count', totalLines);
        const { updateQuestProgress } = require('../../utils/questSystem');
        completedQuests = updateQuestProgress(userId, 'tune_count', totalLines);
    } catch (e) { }

    const eco = economyDb.getOrCreateEconomy(userId);

    // Giới hạn hiển thị 20 items
    let resultsDisplay = results.slice(0, 20).join('\n');
    if (results.length > 20) {
        resultsDisplay += `\n*...và ${results.length - 20} đồ khác*`;
    }

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle(`✅ Bulk Tune Hoàn Tất!`)
        .setDescription([
            `Đã tune **${results.length}** đồ lên 5 dòng`,
            `Tổng: **${totalLines}** dòng | **-${totalCost}** 💎`,
            '',
            resultsDisplay
        ].join('\n'))
        .addFields(
            { name: '💎 Đá T1 còn', value: `${eco.enhancement_stone_t1}`, inline: true }
        )
        .setTimestamp();

    await interaction.update({ embeds: [embed], components: [] });

    // Quest notification
    if (completedQuests && completedQuests.length > 0) {
        const { sendQuestNotifications } = require('../../utils/questSystem');
        await sendQuestNotifications(interaction.channel, userId, completedQuests);
    }
}

/**
 * ?tune all - Tune tất cả đồ vàng chưa full
 */
async function bulkTuneAll(message, userId, playerClass) {
    const allGoldItems = economyDb.getUserGoldEquipment(userId);
    const tuneableItems = allGoldItems.filter(item => !item.final_line && item.lines.length < 5);

    if (tuneableItems.length === 0) {
        return message.reply('✅ Tất cả đồ vàng đã có đủ 5 dòng!');
    }

    // Gọi bulkTuneMultiple với số lượng tối đa
    return bulkTuneMultiple(message, userId, playerClass, tuneableItems.length);
}

module.exports = { execute };


