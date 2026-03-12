/**
 * ?khacda <stone_id> <equip_id> <line> - Khắc ấn dòng từ Đá Đen lên trang bị
 * 40% thành công, 60% thất bại
 * Chi phí tăng dần: 1 → 2 → 4 → 8 đá
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const economyDb = require('../../database/economy');
const { SLOTS, getPlayerClass, isDeCu } = require('../../utils/classSystem');
const { calculateEquipmentMastery } = require('../../utils/tuneSystem');

const SUCCESS_RATE = 0.40; // 40%

async function execute(message, args) {
    const userId = message.author.id;
    const playerClass = getPlayerClass(message.member);

    // Validate args
    if (args.length < 3) {
        return showUsage(message, userId);
    }

    const stoneId = parseInt(args[0]);
    const equipId = parseInt(args[1]);
    const lineNum = parseInt(args[2]);

    if (isNaN(stoneId) || isNaN(equipId) || isNaN(lineNum)) {
        return message.reply('❌ Cú pháp không đúng!\n**Cách dùng:** `?khacda <stone_id> <equip_id> <line_number>`');
    }

    // Validate stone
    const stone = economyDb.getAbsorbedStone(stoneId);
    if (!stone) {
        return message.reply(`❌ Không tìm thấy Đá Đen #${stoneId}!\nDùng \`?ddlist\` để xem danh sách đá.`);
    }

    if (stone.discord_id !== userId) {
        return message.reply('❌ Đây không phải đá của bạn!');
    }

    // Validate equipment
    const equip = economyDb.getEquipment(equipId);
    if (!equip) {
        return message.reply(`❌ Không tìm thấy trang bị ID ${equipId}!`);
    }

    if (equip.discord_id !== userId) {
        return message.reply('❌ Đây không phải trang bị của bạn!');
    }

    if (equip.rarity !== 'gold') {
        return message.reply('❌ Chỉ có thể khắc ấn lên trang bị **Vàng**!');
    }

    // Validate same equipment type
    if (equip.slot !== stone.equipment_type) {
        const stoneSlot = SLOTS[stone.equipment_type];
        const equipSlot = SLOTS[equip.slot];
        return message.reply(`❌ Không khớp loại trang bị!\n🌑 Đá: **${stoneSlot.name}**\n🛡️ Đồ: **${equipSlot.name}**`);
    }

    // Validate line exists and has same name
    const lines = equip.lines || [];
    const lineIdx = lineNum - 1;

    if (lineIdx < 0 || lineIdx >= lines.length) {
        return message.reply(`❌ Dòng ${lineNum} không tồn tại! Trang bị có ${lines.length} dòng.`);
    }

    const targetLine = lines[lineIdx];

    if (targetLine.name !== stone.line_name) {
        return message.reply(`❌ Dòng không khớp!\n🌑 Đá: **${stone.line_name}**\n🛡️ Dòng ${lineNum}: **${targetLine.name}**`);
    }

    // Validate stone % > target %
    if (stone.line_percent <= targetLine.percent) {
        return message.reply(`❌ % đá phải cao hơn % dòng đích!\n🌑 Đá: ${stone.line_percent}%\n🛡️ Đồ: ${targetLine.percent}%`);
    }

    // Check enhance cost
    const cost = economyDb.getEnhanceCost(userId, equipId);
    const absorbedStones = economyDb.getAbsorbedStones(userId);

    // Count stones with same line name and equipment type
    const compatibleStones = absorbedStones.filter(s =>
        s.equipment_type === stone.equipment_type &&
        s.line_name === stone.line_name
    );

    if (compatibleStones.length < cost) {
        return message.reply([
            `❌ Không đủ đá để khắc!`,
            `📊 Lần khắc này cần: **${cost}** đá "${stone.line_name}" (${SLOTS[stone.equipment_type].name})`,
            `🌑 Bạn có: **${compatibleStones.length}** đá phù hợp`,
            '',
            `_Chi phí tăng gấp đôi mỗi lần khắc trên cùng 1 đồ_`
        ].join('\n'));
    }

    // Show confirmation
    return showConfirmEnhance(message, userId, stone, equip, targetLine, lineIdx, cost, playerClass);
}

/**
 * Hiển thị cách dùng
 */
async function showUsage(message, userId) {
    const absorbedStones = economyDb.getAbsorbedStones(userId);

    let stonesText = '_Không có đá nào_';
    if (absorbedStones.length > 0) {
        stonesText = absorbedStones.slice(0, 5).map(s => {
            const slot = SLOTS[s.equipment_type];
            return `#${s.id} | ${slot.shortName} | ${s.line_name} (${s.line_percent}%)`;
        }).join('\n');
    }

    const embed = new EmbedBuilder()
        .setColor('#6366F1')
        .setTitle('🌑 Khắc Ấn - Cách dùng')
        .setDescription([
            '**Cú pháp:** `?khacda <stone_id> <equip_id> <line_number>`',
            '',
            '**Ví dụ:** `?khacda 5 123 2`',
            '→ Khắc đá #5 lên dòng 2 của đồ ID 123',
            '',
            '**Quy tắc:**',
            '• Đồ phải là **Vàng** và **cùng loại** với đá',
            '• Dòng phải **cùng tên** (Crit Rate → Crit Rate)',
            '• % đá phải **cao hơn** % dòng đích',
            '• Tỉ lệ: **40% thành công**, 60% thất bại',
            '• Chi phí: **1 → 2 → 4 → 8** đá (tăng gấp đôi)',
            '',
            '**Đá của bạn:**',
            stonesText
        ].join('\n'))
        .setFooter({ text: '?ddlist để xem chi tiết | ?daden để hút thêm' })
        .setTimestamp();

    return message.reply({ embeds: [embed] });
}

/**
 * Hiển thị xác nhận khắc ấn
 */
async function showConfirmEnhance(message, userId, stone, equip, targetLine, lineIdx, cost, playerClass) {
    const slot = SLOTS[equip.slot];
    const stoneRarityMark = stone.line_rarity === 'gold' ? '🟡' : '🟣';
    const targetRarityMark = targetLine.rarity === 'gold' ? '🟡' : '🟣';

    const embed = new EmbedBuilder()
        .setColor('#F59E0B')
        .setTitle('🌑 Xác Nhận Khắc Ấn')
        .setDescription([
            `**Đá Đen #${stone.id}:**`,
            `${stone.line_icon} ${stone.line_name}: **${stone.line_value}${stone.line_unit || ''}** (${stone.line_percent}%)`,
            '',
            `**Trang bị đích:**`,
            `${slot.icon} ${equip.name} (ID: \`${String(equip.id).padStart(6, '0')}\`)`,
            `${targetRarityMark} Dòng ${lineIdx + 1}: ${targetLine.name} ${targetLine.value}${targetLine.unit || ''} (${targetLine.percent}%)`,
            '',
            `📈 **Nếu thành công:** ${targetLine.percent}% → **${stone.line_percent}%**`,
            '',
            `💰 **Chi phí:** ${cost} đá cùng loại`,
            `🎲 **Tỉ lệ:** 40% thành công`
        ].join('\n'))
        .setFooter({ text: '⚠️ Đá sẽ bị tiêu hao dù thành công hay thất bại!' })
        .setTimestamp();

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`enhance_confirm_${stone.id}_${equip.id}_${lineIdx}_${cost}_${userId}`)
            .setLabel('🎲 Khắc Ấn')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`enhance_cancel_${userId}`)
            .setLabel('❌ Hủy')
            .setStyle(ButtonStyle.Secondary)
    );

    const reply = await message.reply({ embeds: [embed], components: [buttons] });

    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === userId,
        time: 30000
    });

    collector.on('collect', async (interaction) => {
        if (interaction.customId === `enhance_cancel_${userId}`) {
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0x95A5A6).setTitle('❌ Đã hủy')],
                components: []
            });
            collector.stop();
            return;
        }

        if (interaction.customId.startsWith('enhance_confirm_')) {
            collector.stop();
            await executeEnhance(interaction, userId, stone, equip, targetLine, lineIdx, cost, playerClass);
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            await reply.edit({ components: [] }).catch(() => { });
        }
    });
}

/**
 * Thực hiện khắc ấn
 */
async function executeEnhance(interaction, userId, stone, equip, targetLine, lineIdx, cost, playerClass) {
    // Re-validate
    const currentStone = economyDb.getAbsorbedStone(stone.id);
    if (!currentStone) {
        return interaction.update({ content: '❌ Đá không còn tồn tại!', embeds: [], components: [] });
    }

    const currentEquip = economyDb.getEquipment(equip.id);
    if (!currentEquip) {
        return interaction.update({ content: '❌ Trang bị không còn tồn tại!', embeds: [], components: [] });
    }

    // Get all compatible stones to consume
    const absorbedStones = economyDb.getAbsorbedStones(userId);
    const compatibleStones = absorbedStones.filter(s =>
        s.equipment_type === stone.equipment_type &&
        s.line_name === stone.line_name
    ).slice(0, cost);

    if (compatibleStones.length < cost) {
        return interaction.update({ content: '❌ Không còn đủ đá!', embeds: [], components: [] });
    }

    // Roll success/fail
    const isSuccess = Math.random() < SUCCESS_RATE;

    // Delete consumed stones
    for (const s of compatibleStones) {
        economyDb.deleteAbsorbedStone(s.id);
    }

    // Increment enhance count
    economyDb.incrementEnhanceCount(userId, equip.id);

    const slot = SLOTS[equip.slot];

    if (isSuccess) {
        // Update equipment line
        const lines = currentEquip.lines || [];
        lines[lineIdx] = {
            ...lines[lineIdx],
            value: stone.line_value,
            percent: stone.line_percent
        };
        economyDb.updateEquipmentLines(equip.id, lines);

        economyDb.logTransaction(userId, 'enhance_success', `Khắc ${stone.line_name} lên ${equip.name}`, 0);

        const newMastery = calculateEquipmentMastery({ ...currentEquip, lines }, playerClass);

        const embed = new EmbedBuilder()
            .setColor('#22C55E')
            .setTitle('✅ KHẮC ẤN THÀNH CÔNG!')
            .setDescription([
                `🎉 **Chúc mừng!** Dòng đã được nâng cấp!`,
                '',
                `**${slot.icon} ${equip.name}**`,
                `${stone.line_icon} **${stone.line_name}:** ${targetLine.percent}% → **${stone.line_percent}%**`,
                '',
                `📊 Mastery mới: \`${newMastery}\``,
                `💰 Đã tiêu: ${cost} đá`
            ].join('\n'))
            .setFooter({ text: 'Lần khắc tiếp theo sẽ cần gấp đôi số đá!' })
            .setTimestamp();

        await interaction.update({ embeds: [embed], components: [] });

    } else {
        economyDb.logTransaction(userId, 'enhance_fail', `Khắc ${stone.line_name} thất bại`, 0);

        const nextCost = cost * 2;

        const embed = new EmbedBuilder()
            .setColor('#EF4444')
            .setTitle('❌ KHẮC ẤN THẤT BẠI')
            .setDescription([
                `💔 Dòng **không thay đổi**, đá đã bị tiêu hao.`,
                '',
                `**${slot.icon} ${equip.name}**`,
                `${stone.line_icon} ${stone.line_name}: **${targetLine.percent}%** (giữ nguyên)`,
                '',
                `💰 Đã mất: ${cost} đá`,
                `📈 Chi phí lần sau: ${nextCost} đá`
            ].join('\n'))
            .setFooter({ text: '?daden để hút thêm đá | ?ddlist để xem đá còn lại' })
            .setTimestamp();

        await interaction.update({ embeds: [embed], components: [] });
    }
}

module.exports = { execute };


