/**
 * ?daden / ?dd / ?use daden - Chuyển dòng từ đồ vàng này sang đồ vàng khác
 * Yêu cầu: 1 Đá Đen (mua từ shop: ?buy daden)
 * Tỉ lệ: 40% thành công
 * Đồ nguồn biến mất sau khi chuyển (dù thành công hay thất bại)
 * 
 * Cách dùng:
 * ?daden              - Hiển thị hướng dẫn + danh sách đồ vàng
 * ?daden <nguồn> <đích> - Chọn 2 đồ để chuyển dòng
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const economyDb = require('../../database/economy');
const { SLOTS, getPlayerClass, isDeCu } = require('../../utils/classSystem');
const { calculateEquipmentMastery } = require('../../utils/tuneSystem');
const ICONS = require('../../config/icons');

const SUCCESS_RATE = 0.40; // 40%

/**
 * Tính chi phí truyền dòng dựa trên số lần đã truyền
 * Lần 1: 1 đá, Lần 2: 2 đá (1*1.5=1.5), Lần 3: 3 đá (2.25), Lần 4: 4 đá (3.375)...
 */
function getTransferCost(transferCount = 0) {
    return Math.ceil(Math.pow(1.5, transferCount));
}

async function execute(message, args) {
    const userId = message.author.id;
    const playerClass = getPlayerClass(message.member);
    const eco = economyDb.getOrCreateEconomy(userId);
    const stoneCount = eco.black_stone_empty || 0;

    // Không có args → hiển thị hướng dẫn
    if (args.length === 0) {
        return showGuide(message, userId, playerClass, eco);
    }

    // 1 arg → hiển thị đồ nguồn và gợi ý chọn đích
    if (args.length === 1) {
        const sourceId = parseInt(args[0]);
        if (isNaN(sourceId)) {
            return message.reply('❌ ID không hợp lệ! Dùng `?daden` để xem hướng dẫn.');
        }
        return showSourceEquipment(message, userId, sourceId, playerClass, eco);
    }

    // 2 args → chọn nguồn và đích, hiện các dòng khớp
    const sourceId = parseInt(args[0]);
    const targetId = parseInt(args[1]);

    if (isNaN(sourceId) || isNaN(targetId)) {
        return message.reply('❌ ID không hợp lệ!\n**Cách dùng:** `?daden <đồ_nguồn> <đồ_đích>`');
    }

    return showMatchingLines(message, userId, sourceId, targetId, playerClass, eco);
}

/**
 * Hiển thị hướng dẫn và danh sách đồ vàng - 2 cột thông minh
 * Trái: Kho (sort theo dòng đề cử + % cao nhất)
 * Phải: 2 đồ đang mặc có dòng khớp nhưng % thấp hơn (mục tiêu nâng cấp)
 */
async function showGuide(message, userId, playerClass, eco) {
    const goldItems = economyDb.getUserGoldEquipment(userId);

    if (goldItems.length < 2) {
        return message.reply('❌ Cần ít nhất **2 đồ Vàng** để chuyển dòng!\nDùng `?box` để mở hòm.');
    }

    // Tách đồ đang mặc và đồ trong kho
    const equippedItems = goldItems.filter(i => i.is_equipped);
    const inventoryItems = goldItems.filter(i => !i.is_equipped);

    // Tìm dòng đề cử tốt nhất cho mỗi item trong kho
    const invWithBestLine = inventoryItems.map(item => {
        const lines = item.lines || [];
        // Tìm dòng đề cử có % cao nhất
        const deCuLines = lines.filter(l => isDeCu(l.stat, playerClass));
        const bestDeCu = deCuLines.length > 0
            ? deCuLines.sort((a, b) => b.percent - a.percent)[0]
            : null;
        // Nếu không có đề cử, lấy dòng % cao nhất
        const bestLine = bestDeCu || (lines.length > 0 ? lines.sort((a, b) => b.percent - a.percent)[0] : null);

        return {
            ...item,
            bestLine,
            isDeCu: !!bestDeCu,
            mastery: calculateEquipmentMastery(item, playerClass)
        };
    });

    // Sort: ưu tiên đề cử trước, rồi % cao
    invWithBestLine.sort((a, b) => {
        if (a.isDeCu !== b.isDeCu) return a.isDeCu ? -1 : 1;
        const aPercent = a.bestLine?.percent || 0;
        const bPercent = b.bestLine?.percent || 0;
        return bPercent - aPercent;
    });

    // Format cột trái (kho) - ⭐ sau %
    let leftCol = invWithBestLine.slice(0, 10).map(item => {
        const locked = item.is_locked ? '🔒' : '';
        const line = item.bestLine;
        if (!line) return `\`${String(item.id).padStart(6, '0')}\` ${locked} ---`;

        const deCu = item.isDeCu ? ICONS.rarity.starDecu : '';
        const shortName = line.name.slice(0, 5);
        return `\`${String(item.id).padStart(6, '0')}\` ${line.icon}${locked} ${shortName} **${line.percent}%**${deCu}`;
    }).join('\n');

    if (invWithBestLine.length > 10) {
        leftCol += `\n_+${invWithBestLine.length - 10} khác_`;
    }
    if (invWithBestLine.length === 0) {
        leftCol = '_Không có đồ trong kho_';
    }

    // Tìm 2 đồ đang mặc có dòng khớp với đồ top bên trái
    // Ưu tiên: có dòng cùng tên nhưng % thấp hơn (có thể nâng cấp)
    let matchedEquipped = [];

    // Lấy các dòng top từ inventory
    const topInvLines = invWithBestLine.slice(0, 5).filter(i => i.bestLine).map(i => ({
        stat: i.bestLine.stat,
        name: i.bestLine.name,
        percent: i.bestLine.percent,
        sourceId: i.id
    }));

    // Tìm equipped items có dòng khớp và % thấp hơn
    for (const eq of equippedItems) {
        const eqLines = eq.lines || [];
        const mastery = calculateEquipmentMastery(eq, playerClass);

        for (const topLine of topInvLines) {
            const matchingLine = eqLines.find(l => l.name === topLine.name && l.percent < topLine.percent);
            if (matchingLine) {
                matchedEquipped.push({
                    ...eq,
                    matchLine: matchingLine,
                    canUpgradeTo: topLine.percent,
                    mastery
                });
                break;
            }
        }
    }

    // Sort by mastery (cao hơn trước) và lấy 2
    matchedEquipped.sort((a, b) => b.mastery - a.mastery);
    const topMatched = matchedEquipped.slice(0, 2);

    // Format cột phải
    let rightCol = '';
    if (topMatched.length > 0) {
        rightCol = topMatched.map(item => {
            const slot = SLOTS[item.slot];
            const lines = item.lines || [];

            let itemDisplay = `**${slot.icon} \`${String(item.id).padStart(6, '0')}\`**\n`;

            lines.forEach(line => {
                const deCu = isDeCu(line.stat, playerClass) ? ICONS.rarity.starDecu : '';
                const shortName = line.name.slice(0, 5);
                // Highlight dòng có thể nâng cấp
                const isMatch = line.name === item.matchLine.name;
                const percent = isMatch ? `**${line.percent}%**` : `${line.percent}%`;
                itemDisplay += `${line.icon} ${shortName} ${percent}${deCu}\n`;
            });

            return itemDisplay;
        }).join('\n');
    } else if (equippedItems.length > 0) {
        // Không có khớp, hiện 2 đồ mastery cao nhất
        const topEquipped = equippedItems
            .map(eq => ({ ...eq, mastery: calculateEquipmentMastery(eq, playerClass) }))
            .sort((a, b) => b.mastery - a.mastery)
            .slice(0, 2);

        rightCol = topEquipped.map(item => {
            const slot = SLOTS[item.slot];
            const lines = item.lines || [];

            let itemDisplay = `**${slot.icon} \`${String(item.id).padStart(6, '0')}\`**\n`;
            lines.forEach(line => {
                const deCu = isDeCu(line.stat, playerClass) ? ICONS.rarity.starDecu : '';
                const shortName = line.name.slice(0, 5);
                itemDisplay += `${line.icon} ${shortName} **${line.percent}%**${deCu}\n`;
            });
            return itemDisplay;
        }).join('\n');
    } else {
        rightCol = '_Chưa mặc đồ vàng_';
    }

    const embed = new EmbedBuilder()
        .setColor('#1F2937')
        .setTitle('🌑 Truyền Dòng Trang Bị')
        .setDescription([
            '**Cách dùng:** `?td <id>` hoặc `?daden <nguồn> <đích>`',
            '',
            '💡 **Mẹo:** Chọn ID từ cột trái, bot sẽ tự tìm đồ phù hợp!'
        ].join('\n'))
        .addFields(
            {
                name: '📦 Đồ trong kho:',
                value: leftCol,
                inline: true
            },
            {
                name: '📌 Có thể nâng cấp:',
                value: rightCol,
                inline: true
            }
        )
        .addFields(
            { name: '🌑 Đá Đen', value: `${eco.black_stone_empty || 0}`, inline: true },
            { name: '💎 Đá T1', value: `${(eco.enhancement_stone_t1 || 0).toLocaleString()}`, inline: true },
            { name: `${ICONS.rarity.starDecu} = Đề cử`, value: '🔒 = Khóa', inline: true }
        )
        .setFooter({ text: '?dd, ?daden, ?truyen • 40% thành công • Đồ nguồn biến mất' })
        .setTimestamp();

    return message.reply({ embeds: [embed] });
}

/**
 * Hiển thị đồ nguồn với gợi ý đích và nút Truyền
 * - Nếu nguồn là đồ trong kho: Tìm đồ đang mặc có dòng thấp hơn để nâng cấp
 * - Nếu nguồn là đồ đang mặc: Tìm đồ trong kho có dòng cao hơn để truyền vào
 */
async function showSourceEquipment(message, userId, sourceId, playerClass, eco) {
    const source = economyDb.getEquipment(sourceId);

    if (!source || source.discord_id !== userId) {
        return message.reply('❌ Không tìm thấy trang bị!');
    }

    if (source.rarity !== 'gold') {
        return message.reply('❌ Chỉ có thể chuyển từ đồ **Vàng**!');
    }

    if (source.is_locked) {
        return message.reply('❌ Đồ nguồn đang **khóa**! Dùng `?lock` để mở.');
    }

    const slot = SLOTS[source.slot];
    const sourceLines = source.lines || [];
    const goldItems = economyDb.getUserGoldEquipment(userId);

    // Xác định nguồn là đồ đang mặc hay trong kho
    const isSourceEquipped = source.is_equipped;

    let targetItem = null;
    let bestTransfer = null; // { srcLine, tgtLine, srcIdx, tgtIdx }

    if (isSourceEquipped) {
        // NGUỒN LÀ ĐỒ ĐANG MẶC → Tìm đồ trong kho có dòng cao hơn
        // Tìm dòng yếu nhất của nguồn (đồ đang mặc) mà có đề cử
        const weakLines = [...sourceLines]
            .filter(l => isDeCu(l.stat, playerClass))
            .sort((a, b) => a.percent - b.percent);
        const weakestLine = weakLines[0] || sourceLines.sort((a, b) => a.percent - b.percent)[0];

        if (weakestLine) {
            // Tìm đồ trong kho có dòng cùng tên với % cao hơn
            const inventoryItems = goldItems.filter(i => !i.is_equipped && !i.is_locked);

            for (const inv of inventoryItems) {
                const invLines = inv.lines || [];
                const matchLine = invLines.find(l => l.name === weakestLine.name && l.percent > weakestLine.percent);
                if (matchLine) {
                    const mastery = calculateEquipmentMastery(inv, playerClass);
                    if (!targetItem || matchLine.percent > bestTransfer.srcLine.percent) {
                        targetItem = { ...inv, mastery };
                        bestTransfer = {
                            srcLine: matchLine,
                            tgtLine: weakestLine,
                            srcIdx: invLines.indexOf(matchLine),
                            tgtIdx: sourceLines.indexOf(weakestLine)
                        };
                    }
                }
            }
        }
    } else {
        // NGUỒN LÀ ĐỒ TRONG KHO → Tìm đồ đang mặc có dòng yếu hơn
        // Tìm dòng mạnh nhất của nguồn (ưu tiên đề cử)
        const strongLines = [...sourceLines]
            .filter(l => isDeCu(l.stat, playerClass))
            .sort((a, b) => b.percent - a.percent);
        const strongestLine = strongLines[0] || sourceLines.sort((a, b) => b.percent - a.percent)[0];

        if (strongestLine) {
            // Tìm đồ đang mặc có dòng cùng tên với % thấp hơn
            const equippedItems = goldItems.filter(i => i.is_equipped);

            for (const eq of equippedItems) {
                const eqLines = eq.lines || [];
                const matchLine = eqLines.find(l => l.name === strongestLine.name && l.percent < strongestLine.percent);
                if (matchLine) {
                    const mastery = calculateEquipmentMastery(eq, playerClass);
                    if (!targetItem || mastery > targetItem.mastery) {
                        targetItem = { ...eq, mastery };
                        bestTransfer = {
                            srcLine: strongestLine,
                            tgtLine: matchLine,
                            srcIdx: sourceLines.indexOf(strongestLine),
                            tgtIdx: eqLines.indexOf(matchLine)
                        };
                    }
                }
            }
        }
    }

    // Format dòng nguồn
    let srcLinesText = sourceLines.map((line, idx) => {
        const deCu = isDeCu(line.stat, playerClass) ? ICONS.rarity.starDecu : '';
        const isTransfer = bestTransfer && line.name === bestTransfer.srcLine.name;
        const highlight = isTransfer ? '→' : '';
        return `${line.icon} ${line.name.slice(0, 6)} **${line.percent}%**${deCu} ${highlight}`;
    }).join('\n');

    // Format dòng đích
    let tgtLinesText = '_Không tìm thấy đồ phù hợp_';
    if (targetItem) {
        const tgtLines = targetItem.lines || [];
        tgtLinesText = tgtLines.map((line, idx) => {
            const deCu = isDeCu(line.stat, playerClass) ? ICONS.rarity.starDecu : '';
            const isTransfer = bestTransfer && line.name === bestTransfer.tgtLine.name;
            const highlight = isTransfer ? '←' : '';
            return `${highlight} ${line.icon} ${line.name.slice(0, 6)} **${line.percent}%**${deCu}`;
        }).join('\n');
    }

    const embed = new EmbedBuilder()
        .setColor(isSourceEquipped ? '#3B82F6' : '#F59E0B')
        .setTitle(`🌑 Chuyển Dòng`)
        .addFields(
            {
                name: isSourceEquipped ? `📌 ĐANG MẶC` : `📦 NGUỒN`,
                value: `**${slot.icon} ${source.name}**\nID: \`${String(source.id).padStart(6, '0')}\`\n${srcLinesText}`,
                inline: true
            },
            {
                name: targetItem ? (isSourceEquipped ? `📦 GỢI Ý` : `📌 ĐÍCH`) : '❌ KHÔNG TÌM THẤY',
                value: targetItem
                    ? `**${SLOTS[targetItem.slot].icon} ${targetItem.name}**\nID: \`${String(targetItem.id).padStart(6, '0')}\`\n${tgtLinesText}`
                    : '_Không có đồ có dòng phù hợp_',
                inline: true
            }
        );

    // Thêm thông tin truyền nếu có
    if (bestTransfer && targetItem) {
        // Lấy transfer_count từ dòng đích
        const tgtLines = targetItem.lines || [];
        const transferCount = tgtLines[bestTransfer.tgtIdx]?.transfer_count || 0;
        const cost = getTransferCost(transferCount);

        const transferInfo = `**${bestTransfer.srcLine.name}**: ${bestTransfer.tgtLine.percent}% → **${bestTransfer.srcLine.percent}%**`;
        const costInfo = transferCount > 0
            ? `🌑 Chi phí: **${cost}** đá (lần ${transferCount + 1})`
            : `🌑 Chi phí: **${cost}** đá`;

        embed.addFields({
            name: '⚡ Truyền dòng:',
            value: `${transferInfo}\n${costInfo}\n_Đồ nguồn sẽ biến mất • 40% thành công_`,
            inline: false
        });

        // Tạo nút Truyền
        const actualSourceId = isSourceEquipped ? targetItem.id : source.id;
        const actualTargetId = isSourceEquipped ? source.id : targetItem.id;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`daden_transfer_${actualSourceId}_${actualTargetId}_${userId}`)
                .setLabel('🌑 Truyền Dòng')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`daden_cancel_${userId}`)
                .setLabel('Hủy')
                .setStyle(ButtonStyle.Secondary)
        );

        embed.setFooter({ text: `🌑 Đá Đen: ${eco.black_stone_empty || 0} • Cần 1 đá để truyền` });

        const reply = await message.reply({ embeds: [embed], components: [row] });

        // Collector cho nút
        const collector = reply.createMessageComponentCollector({
            filter: i => i.user.id === userId,
            time: 60000
        });

        collector.on('collect', async (interaction) => {
            if (interaction.customId === `daden_cancel_${userId}`) {
                await interaction.update({ content: '❌ Đã hủy.', embeds: [], components: [] });
                return;
            }

            if (interaction.customId.startsWith('daden_transfer_')) {
                // Chuyển sang flow xác nhận truyền
                const parts = interaction.customId.split('_');
                const srcId = parseInt(parts[2]);
                const tgtId = parseInt(parts[3]);

                // Gọi flow truyền thực tế
                await handleQuickTransfer(interaction, userId, srcId, tgtId, playerClass);
            }
        });

        collector.on('end', async () => {
            try { await reply.edit({ components: [] }); } catch (e) { }
        });

        return;
    }

    embed.setFooter({ text: `🌑 Đá Đen: ${eco.black_stone_empty || 0}` });
    return message.reply({ embeds: [embed] });
}

/**
 * Xử lý truyền nhanh từ nút
 */
async function handleQuickTransfer(interaction, userId, sourceId, targetId, playerClass) {
    const eco = economyDb.getOrCreateEconomy(userId);

    const source = economyDb.getEquipment(sourceId);
    const target = economyDb.getEquipment(targetId);

    if (!source || !target) {
        return interaction.update({ content: '❌ Trang bị không còn tồn tại!', embeds: [], components: [] });
    }

    // Tìm dòng khớp
    const sourceLines = source.lines || [];
    const targetLines = target.lines || [];

    let bestPair = null;
    for (const srcLine of sourceLines) {
        for (let i = 0; i < targetLines.length; i++) {
            const tgtLine = targetLines[i];
            if (srcLine.name === tgtLine.name && srcLine.percent > tgtLine.percent) {
                if (!bestPair || srcLine.percent > bestPair.srcLine.percent) {
                    bestPair = {
                        srcLine,
                        tgtLine,
                        srcIdx: sourceLines.indexOf(srcLine),
                        tgtIdx: i,
                        transferCount: tgtLine.transfer_count || 0
                    };
                }
            }
        }
    }

    if (!bestPair) {
        return interaction.update({ content: '❌ Không còn dòng nào có thể truyền!', embeds: [], components: [] });
    }

    // Tính chi phí dựa trên số lần đã truyền
    const cost = getTransferCost(bestPair.transferCount);

    if ((eco.black_stone_empty || 0) < cost) {
        return interaction.update({
            content: `❌ Không đủ **Đá Đen**!\nCần **${cost}** đá (lần truyền thứ ${bestPair.transferCount + 1})\nBạn có: **${eco.black_stone_empty || 0}**\nMua: \`?buy daden\``,
            embeds: [],
            components: []
        });
    }

    // Trừ đá
    economyDb.subtractBlackStone(userId, cost);

    // Roll
    const isSuccess = Math.random() < SUCCESS_RATE;

    // Xóa nguồn (luôn luôn)
    economyDb.deleteEquipment(sourceId);

    const slot = SLOTS[target.slot];

    if (isSuccess) {
        // Cập nhật dòng đích + tăng transfer_count
        targetLines[bestPair.tgtIdx] = {
            ...targetLines[bestPair.tgtIdx],
            percent: bestPair.srcLine.percent,
            value: bestPair.srcLine.value,
            transfer_count: (bestPair.transferCount || 0) + 1
        };
        economyDb.updateEquipmentLines(targetId, targetLines);
        economyDb.logTransaction(userId, 'transfer_success', `Chuyển ${bestPair.srcLine.name} sang ${target.name}`, -cost);

        const newMastery = calculateEquipmentMastery({ ...target, lines: targetLines }, playerClass);
        const nextCost = getTransferCost(bestPair.transferCount + 1);

        const embed = new EmbedBuilder()
            .setColor('#22C55E')
            .setTitle('✅ TRUYỀN DÒNG THÀNH CÔNG!')
            .setDescription([
                `🎉 **Chúc mừng!**`,
                '',
                `**${slot.icon} ${target.name}**`,
                `${bestPair.srcLine.icon} **${bestPair.srcLine.name}:** ${bestPair.tgtLine.percent}% → **${bestPair.srcLine.percent}%**`,
                '',
                `📊 Mastery mới: \`${newMastery}\``,
                `🌑 Đã tiêu: **${cost}** Đá Đen`,
                `📈 Lần truyền tiếp: **${nextCost}** đá`,
                `🗑️ _${source.name} đã biến mất_`
            ].join('\n'))
            .setTimestamp();

        await interaction.update({ embeds: [embed], components: [] });
    } else {
        // Thất bại vẫn tăng transfer_count
        targetLines[bestPair.tgtIdx] = {
            ...targetLines[bestPair.tgtIdx],
            transfer_count: (bestPair.transferCount || 0) + 1
        };
        economyDb.updateEquipmentLines(targetId, targetLines);
        economyDb.logTransaction(userId, 'transfer_fail', `Chuyển ${bestPair.srcLine.name} thất bại`, -cost);

        const nextCost = getTransferCost(bestPair.transferCount + 1);

        const embed = new EmbedBuilder()
            .setColor('#EF4444')
            .setTitle('❌ TRUYỀN DÒNG THẤT BẠI')
            .setDescription([
                `💔 Dòng **không thay đổi**.`,
                '',
                `**${slot.icon} ${target.name}**`,
                `${bestPair.srcLine.icon} ${bestPair.srcLine.name}: **${bestPair.tgtLine.percent}%** (giữ nguyên)`,
                '',
                `🌑 Đã tiêu: **${cost}** Đá Đen`,
                `📈 Lần truyền tiếp: **${nextCost}** đá`,
                `🗑️ _${source.name} đã biến mất_`
            ].join('\n'))
            .setFooter({ text: 'Thử lại với đồ khác!' })
            .setTimestamp();

        await interaction.update({ embeds: [embed], components: [] });
    }
}

/**
 * Hiển thị các dòng khớp giữa 2 đồ
 */
async function showMatchingLines(message, userId, sourceId, targetId, playerClass, eco) {
    // Validate
    if (sourceId === targetId) {
        return message.reply('❌ Đồ nguồn và đích phải khác nhau!');
    }

    const source = economyDb.getEquipment(sourceId);
    const target = economyDb.getEquipment(targetId);

    if (!source || source.discord_id !== userId) {
        return message.reply('❌ Không tìm thấy đồ nguồn!');
    }
    if (!target || target.discord_id !== userId) {
        return message.reply('❌ Không tìm thấy đồ đích!');
    }

    if (source.rarity !== 'gold' || target.rarity !== 'gold') {
        return message.reply('❌ Cả hai đồ phải là **Vàng**!');
    }

    // Không cần cùng loại - chỉ cần cùng tên dòng

    if (source.is_locked) {
        return message.reply('❌ Đồ nguồn đang **khóa**!');
    }

    // Check stone
    if ((eco.black_stone_empty || 0) < 1) {
        return message.reply(`❌ Bạn không có **Đá Đen**!\nMua: \`?buy daden\` (200 Đá T1)`);
    }

    // Find matching lines (same name, source % > target %)
    const sourceLines = source.lines || [];
    const targetLines = target.lines || [];

    const matchingPairs = [];
    sourceLines.forEach((srcLine, srcIdx) => {
        targetLines.forEach((tgtLine, tgtIdx) => {
            if (srcLine.name === tgtLine.name && srcLine.percent > tgtLine.percent) {
                matchingPairs.push({
                    srcIdx,
                    tgtIdx,
                    srcLine,
                    tgtLine,
                    upgrade: `${tgtLine.percent}% → ${srcLine.percent}%`
                });
            }
        });
    });

    if (matchingPairs.length === 0) {
        return message.reply([
            '❌ Không có dòng nào có thể chuyển!',
            '',
            '**Điều kiện:**',
            '• Dòng phải **cùng tên**',
            '• % nguồn phải **cao hơn** % đích'
        ].join('\n'));
    }

    const slot = SLOTS[source.slot];

    let pairsText = matchingPairs.map((pair, idx) => {
        const rarity = pair.srcLine.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;
        return `**${idx + 1}.** ${rarity} ${pair.srcLine.icon} ${pair.srcLine.name}: ${pair.upgrade}`;
    }).join('\n');

    const embed = new EmbedBuilder()
        .setColor('#6366F1')
        .setTitle('🌑 Chọn Dòng Để Chuyển')
        .setDescription([
            `**Nguồn:** ${source.name} → **Đích:** ${target.name}`,
            `${slot.icon} ${slot.name}`,
            '',
            '**Dòng có thể chuyển:**',
            pairsText,
            '',
            `🌑 **Chi phí:** 1 Đá Đen`,
            `🎲 **Tỉ lệ:** 40% thành công`,
            '',
            '> ⚠️ **Đồ nguồn sẽ BIẾN MẤT** dù thành công hay thất bại!'
        ].join('\n'))
        .setFooter({ text: `Đá Đen: ${eco.black_stone_empty || 0}` })
        .setTimestamp();

    // Create buttons for each matching pair (max 5)
    const buttons = new ActionRowBuilder();
    const maxPairs = Math.min(matchingPairs.length, 5);

    for (let i = 0; i < maxPairs; i++) {
        buttons.addComponents(
            new ButtonBuilder()
                .setCustomId(`transfer_${sourceId}_${targetId}_${i}_${userId}`)
                .setLabel(`Dòng ${i + 1}`)
                .setStyle(ButtonStyle.Primary)
        );
    }

    const cancelRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`transfer_cancel_${userId}`)
            .setLabel('❌ Hủy')
            .setStyle(ButtonStyle.Secondary)
    );

    const reply = await message.reply({ embeds: [embed], components: [buttons, cancelRow] });

    // Store matching pairs for later use
    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === userId,
        time: 60000
    });

    collector.on('collect', async (interaction) => {
        if (interaction.customId === `transfer_cancel_${userId}`) {
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0x95A5A6).setTitle('❌ Đã hủy')],
                components: []
            });
            collector.stop();
            return;
        }

        if (interaction.customId.startsWith('transfer_')) {
            const parts = interaction.customId.split('_');
            const pairIdx = parseInt(parts[3]);
            const pair = matchingPairs[pairIdx];

            collector.stop();
            await executeTransfer(interaction, userId, source, target, pair, playerClass);
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            await reply.edit({ components: [] }).catch(() => { });
        }
    });
}

/**
 * Thực hiện chuyển dòng
 */
async function executeTransfer(interaction, userId, source, target, pair, playerClass) {
    // Re-validate everything
    const eco = economyDb.getOrCreateEconomy(userId);

    if ((eco.black_stone_empty || 0) < 1) {
        return interaction.update({ content: '❌ Không còn Đá Đen!', embeds: [], components: [] });
    }

    const currentSource = economyDb.getEquipment(source.id);
    const currentTarget = economyDb.getEquipment(target.id);

    if (!currentSource || !currentTarget) {
        return interaction.update({ content: '❌ Trang bị không còn tồn tại!', embeds: [], components: [] });
    }

    // Deduct stone
    economyDb.subtractBlackStone(userId, 1);

    // Roll success/fail
    const isSuccess = Math.random() < SUCCESS_RATE;

    // Delete source equipment (always)
    economyDb.deleteEquipment(source.id);

    const slot = SLOTS[source.slot];

    if (isSuccess) {
        // Update target line
        const targetLines = currentTarget.lines || [];
        targetLines[pair.tgtIdx] = {
            ...targetLines[pair.tgtIdx],
            value: pair.srcLine.value,
            percent: pair.srcLine.percent
        };
        economyDb.updateEquipmentLines(target.id, targetLines);

        economyDb.logTransaction(userId, 'transfer_success', `Chuyển ${pair.srcLine.name} từ ${source.name} sang ${target.name}`, -1);

        const newMastery = calculateEquipmentMastery({ ...currentTarget, lines: targetLines }, playerClass);

        const embed = new EmbedBuilder()
            .setColor('#22C55E')
            .setTitle('✅ CHUYỂN DÒNG THÀNH CÔNG!')
            .setDescription([
                `🎉 **Chúc mừng!**`,
                '',
                `**${slot.icon} ${target.name}**`,
                `${pair.srcLine.icon} **${pair.srcLine.name}:** ${pair.tgtLine.percent}% → **${pair.srcLine.percent}%**`,
                '',
                `📊 Mastery mới: \`${newMastery}\``,
                `🌑 Đã tiêu: 1 Đá Đen`,
                `🗑️ _${source.name} đã biến mất_`
            ].join('\n'))
            .setTimestamp();

        await interaction.update({ embeds: [embed], components: [] });

    } else {
        economyDb.logTransaction(userId, 'transfer_fail', `Chuyển ${pair.srcLine.name} thất bại`, -1);

        const embed = new EmbedBuilder()
            .setColor('#EF4444')
            .setTitle('❌ CHUYỂN DÒNG THẤT BẠI')
            .setDescription([
                `💔 Dòng **không thay đổi**.`,
                '',
                `**${slot.icon} ${target.name}**`,
                `${pair.srcLine.icon} ${pair.srcLine.name}: **${pair.tgtLine.percent}%** (giữ nguyên)`,
                '',
                `🌑 Đã tiêu: 1 Đá Đen`,
                `🗑️ _${source.name} đã biến mất_`
            ].join('\n'))
            .setFooter({ text: 'Thử lại với đồ khác!' })
            .setTimestamp();

        await interaction.update({ embeds: [embed], components: [] });
    }
}

module.exports = { execute };

