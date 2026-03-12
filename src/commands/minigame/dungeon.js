/**
 * Dungeon Command
 * ?dung, ?dungeon, ?bicanh
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const economy = require('../../database/economy');
const dungeonSystem = require('../../utils/dungeonSystem');
const { REWARDS } = dungeonSystem;
const { getPlayerClass } = require('../../utils/classSystem');

/**
 * Helper: Tính số Nhựa Cứng cần để đạt mức nhựa target
 * @returns {number} Số NC cần, 0 nếu đủ nhựa
 */
function calcNhuaCungNeeded(currentNhua, targetNhua) {
    if (currentNhua >= targetNhua) return 0;
    const deficit = targetNhua - currentNhua;
    return Math.ceil(deficit / 60);
}

module.exports = {
    name: 'dungeon',
    aliases: ['dung', 'bicanh'],
    description: 'Hệ thống Dungeon (Bí Cảnh)',

    async execute(message, args) {
        const userId = message.author.id;

        // Lấy thông tin nhựa
        const nhuaInfo = economy.getCurrentNhua(userId);

        // Lấy mastery từ equipment
        const equippedItems = economy.getEquippedItems(userId);
        const playerClass = getPlayerClass(message.member);
        const mastery = dungeonSystem.calculateMasteryFromEquipment(equippedItems, playerClass);

        // Kiểm tra có đang trong dungeon không
        const activeDungeon = getActiveDungeon(userId);
        if (activeDungeon) {
            // Kiểm tra xem dungeon đã quá hạn chưa
            const endsAt = new Date(activeDungeon.ends_at);
            if (Date.now() >= endsAt.getTime()) {
                // Dungeon đã hoàn thành nhưng chưa được xử lý (do bot restart)
                // Auto-trigger completion
                return handleExpiredDungeon(message, activeDungeon);
            }
            return showActiveDungeon(message, activeDungeon);
        }

        // Hiển thị menu chọn dungeon - UI đẹp với Select Menu
        const soloInfo = dungeonSystem.DUNGEON_TYPES.solo;
        const coopInfo = dungeonSystem.DUNGEON_TYPES.coop5;
        const bossInfo = dungeonSystem.DUNGEON_TYPES.boss10;

        // Check if low stamina and has Nhua Cung
        const eco = economy.getOrCreateEconomy(userId);
        const nhuaCung = eco.nhua_cung || 0;
        const buaKhacYeu = eco.bua_khac_yeu || 0;
        let lowStaminaHint = '';
        if (nhuaInfo.current < 180 && nhuaCung > 0) {
            lowStaminaHint = `\n💊 *Nhựa thấp! Dùng \`.use nhuacung\` để hồi +60 (có ${nhuaCung})*`;
        }

        // Bùa Khắc Yêu hint
        let buaHint = '';
        if (buaKhacYeu > 0) {
            buaHint = `\n📜 **Có ${buaKhacYeu} Bùa Khắc Yêu!** Skip timer + miễn nhựa`;
        }

        // Check blessing fire status
        const blessingStatus = economy.getBlessingFireStatus(userId);
        let blessingText = '';
        if (blessingStatus.active) {
            const remaining = Math.ceil((blessingStatus.expiresAt - new Date()) / 1000 / 60);
            const hours = Math.floor(remaining / 60);
            const mins = remaining % 60;
            const timeText = hours > 0 ? `${hours}h${mins}p` : `${mins} phút`;
            const typeName = blessingStatus.type === 'lcpcl' ? 'LCP Cỡ Lớn' : 'Lửa Cầu Phúc';
            blessingText = `\n🔥 **${typeName}** đang đốt! (+5% gear Vàng) • Còn **${timeText}**`;
        }

        const embed = new EmbedBuilder()
            .setColor(blessingStatus.active ? (blessingStatus.type === 'lcpcl' ? '#FF4500' : '#FFA07A') : '#7C3AED')
            .setTitle('⚔️ BÍ CẢNH KHẢO NGHIỆM ⚔️')
            .setDescription(`
━━━━━━━━━━━━━━━━━━━━━━
💧 **Nhựa:** \`${nhuaInfo.current}/${nhuaInfo.max}\`${nhuaInfo.regenTime ? ` ⏱️ ${nhuaInfo.regenTime}` : ' ✅ Đầy'}${lowStaminaHint}
💪 **Mastery:** \`${mastery.toLocaleString()}\` pts
🎭 **Phái:** ${playerClass ? `\`${playerClass.toUpperCase()}\`` : '⚠️ Chưa chọn'}${blessingText}${buaHint}
━━━━━━━━━━━━━━━━━━━━━━

**Chọn bí cảnh từ menu bên dưới:**
            `)
            .addFields(
                {
                    name: soloInfo.dungeonName,
                    value: `\`${soloInfo.baseNhua}-${soloInfo.baseNhua * 3}\` nhựa • 📦 ${REWARDS.solo.boxes}-${REWARDS.solo.boxes * 3} Hòm`,
                    inline: false
                },
                {
                    name: coopInfo.dungeonName,
                    value: `\`${coopInfo.baseNhua}-${coopInfo.baseNhua * 3}\` nhựa • 📦 ${REWARDS.coop5.boxes}-${REWARDS.coop5.boxes * 3} Hòm`,
                    inline: false
                }
            )
            .setFooter({ text: buaKhacYeu > 0 ? '📜 Dùng Bùa = Skip timer + free!' : '💡 Nhựa tiêu SAU khi hoàn thành' })
            .setTimestamp();

        const { StringSelectMenuBuilder } = require('discord.js');

        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`dungselect_${userId}`)
                    .setPlaceholder('🏰 Chọn bí cảnh...')
                    .addOptions([
                        {
                            label: 'Hang Động U Minh',
                            description: `Solo • ${soloInfo.baseNhua}-${soloInfo.baseNhua * 3} nhựa`,
                            value: 'solo',
                            emoji: '🗡️'
                        },
                        {
                            label: 'Thành Cổ Ma Quái',
                            description: `Coop 5 • ${coopInfo.baseNhua}-${coopInfo.baseNhua * 3} nhựa`,
                            value: 'coop5',
                            emoji: '👥'
                        },
                        {
                            label: 'Lãnh Địa Ma Vương',
                            description: 'Boss 10 • Miễn phí • 1 lần/tuần',
                            value: 'boss10',
                            emoji: '👑'
                        }
                    ])
            );

        const reply = await message.reply({ embeds: [embed], components: [row] });


        // Collector cho select menu
        const collector = reply.createMessageComponentCollector({
            filter: i => i.user.id === userId,
            time: 60000
        });

        collector.on('collect', async (interaction) => {
            // Get selected value from select menu
            const selectedDungeon = interaction.values ? interaction.values[0] : null;

            if (!selectedDungeon) {
                return interaction.reply({ content: '❌ Có lỗi xảy ra!', ephemeral: true });
            }

            await interaction.deferUpdate();

            if (selectedDungeon === 'solo') {
                await handleSoloDungeon(message, reply, userId, nhuaInfo, mastery, playerClass, buaKhacYeu);
            } else if (selectedDungeon === 'coop5') {
                await handleCoopDungeon(message, reply, userId, nhuaInfo, mastery, playerClass, buaKhacYeu);
            } else if (selectedDungeon === 'boss10') {
                await handleBossDungeon(message, reply, userId, mastery, playerClass);
            }

            collector.stop();
        });

        collector.on('end', (collected, reason) => {
            if (reason === 'time') {
                reply.edit({ components: [] }).catch(() => { });
            }
        });
    },

    // Hủy dungeon đang chạy
    async executeCancel(message, args) {
        const userId = message.author.id;
        const activeDungeon = getActiveDungeon(userId);

        if (!activeDungeon) {
            return message.reply('❌ Bạn không có dungeon nào đang chạy!');
        }

        const dungeonType = dungeonSystem.DUNGEON_TYPES[activeDungeon.dungeon_type];
        const members = JSON.parse(activeDungeon.members || '[]');
        const isLeader = activeDungeon.leader_id === userId;
        const isCoop = activeDungeon.dungeon_type === 'coop5' || activeDungeon.dungeon_type === 'boss10';

        // ========== SOLO: Hủy dungeon hoàn toàn ==========
        if (!isCoop || members.length <= 1) {
            economy.db.prepare(`
                UPDATE dungeon_sessions SET status = 'cancelled' 
                WHERE id = ?
            `).run(activeDungeon.id);

            const embed = new EmbedBuilder()
                .setColor('#22C55E')
                .setTitle('✅ Dungeon Đã Hủy!')
                .setDescription(`Bạn đã hủy dungeon **${activeDungeon.dungeon_type}**`)
                .setFooter({ text: 'Dungeon đã kết thúc' })
                .setTimestamp();

            return message.reply({ embeds: [embed] });
        }

        // ========== COOP/BOSS: Chỉ rời party ==========
        const remainingMembers = members.filter(m => m.id !== userId);

        if (remainingMembers.length === 0) {
            // Không còn ai - hủy dungeon
            economy.db.prepare(`
                UPDATE dungeon_sessions SET status = 'cancelled', members = '[]'
                WHERE id = ?
            `).run(activeDungeon.id);

            const embed = new EmbedBuilder()
                .setColor('#EF4444')
                .setTitle('❌ Dungeon Đã Hủy!')
                .setDescription(`Không còn thành viên nào trong party.\nDungeon **${activeDungeon.dungeon_type}** đã bị hủy!`)
                .setTimestamp();

            return message.reply({ embeds: [embed] });
        }

        // Cập nhật members list (người rời đã bị remove)
        economy.db.prepare(`
            UPDATE dungeon_sessions SET members = ?
            WHERE id = ?
        `).run(JSON.stringify(remainingMembers), activeDungeon.id);

        // Nếu leader rời, chuyển leader cho người tiếp theo
        if (isLeader && remainingMembers.length > 0) {
            economy.db.prepare(`
                UPDATE dungeon_sessions SET leader_id = ?
                WHERE id = ?
            `).run(remainingMembers[0].id, activeDungeon.id);
        }

        const membersList = remainingMembers.map(m => `<@${m.id}>`).join(', ');

        const embed = new EmbedBuilder()
            .setColor('#F59E0B')
            .setTitle('👋 Thành viên rời đội!')
            .setDescription(`<@${userId}> đã rời khỏi dungeon **${activeDungeon.dungeon_type}**.\n\n**Dungeon vẫn tiếp tục!**`)
            .addFields(
                { name: '👥 Thành viên còn lại', value: membersList, inline: false },
                { name: '👑 Leader', value: `<@${isLeader ? remainingMembers[0].id : activeDungeon.leader_id}>`, inline: true }
            )
            .setFooter({ text: 'Dungeon tiếp tục với những thành viên còn lại' })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    }
};

// ============== SOLO DUNGEON ==============

async function handleSoloDungeon(message, reply, userId, nhuaInfo, mastery, playerClass, buaKhacYeu = 0) {
    const dungeon = dungeonSystem.DUNGEON_TYPES.solo;
    const baseNhua = dungeon.baseNhua;

    // Tính thời gian clear
    const clearResult = dungeonSystem.calculateClearTime('solo', [{ mastery, role: playerClass }]);

    // Check Nhựa Cứng
    const eco = economy.getOrCreateEconomy(userId);
    const nhuaCungCount = eco.nhua_cung || 0;

    let buaHint = '';
    if (buaKhacYeu > 0) {
        buaHint = `\n\n📜 **Có ${buaKhacYeu} Bùa Khắc Yêu!** Skip timer + miễn nhựa`;
    }

    const embed = new EmbedBuilder()
        .setColor('#3B82F6')
        .setTitle('🗡️ Dungeon Solo')
        .setDescription(`Bắt đầu dungeon ngay! Nhựa sẽ được tính SAU khi hoàn thành.${buaHint}`)
        .addFields(
            { name: '⏱️ Thời gian clear', value: formatTime(clearResult.finalTime), inline: true },
            { name: '💧 Nhựa hiện có', value: `${nhuaInfo.current}/${nhuaInfo.max}`, inline: true },
            { name: '💪 Mastery', value: `${mastery.toLocaleString()} (${Math.round((1 - clearResult.masteryFactor) * 100)}% giảm)`, inline: true }
        )
        .addFields(
            { name: '🎁 Phần thưởng (chọn sau)', value: `x1: ${REWARDS.solo.boxes} Hòm | x2: ${REWARDS.solo.boxes * 2} Hòm | x3: ${REWARDS.solo.boxes * 3} Hòm`, inline: false }
        )
        .setFooter({ text: buaKhacYeu > 0 ? '📜 Dùng Bùa = Instant clear + free nhựa!' : 'Nhựa sẽ tiêu SAU khi hoàn thành' });

    const buttons = [
        new ButtonBuilder()
            .setCustomId(`solostart_${userId}`)
            .setLabel('🗡️ Bắt đầu ngay!')
            .setStyle(ButtonStyle.Success)
    ];

    // Add Bùa button if available
    if (buaKhacYeu > 0) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`solobua_${userId}`)
                .setLabel('📜 Dùng Bùa (Skip)')
                .setStyle(ButtonStyle.Primary)
        );
    }

    buttons.push(
        new ButtonBuilder()
            .setCustomId(`solo_cancel_${userId}`)
            .setLabel('❌ Hủy')
            .setStyle(ButtonStyle.Danger)
    );

    const row = new ActionRowBuilder().addComponents(buttons);

    await reply.edit({ embeds: [embed], components: [row] });

    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === userId,
        time: 30000
    });

    collector.on('collect', async (interaction) => {
        const [action] = interaction.customId.split('_');

        if (action === 'solo' && interaction.customId.includes('cancel')) {
            await interaction.update({ content: '❌ Đã hủy.', embeds: [], components: [] });
            return collector.stop();
        }

        // === Dùng Bùa Khắc Yêu - Skip timer + instant reward ===
        if (action === 'solobua') {
            collector.stop();

            // Check again if user has Bùa
            const currentEco = economy.getOrCreateEconomy(userId);
            if ((currentEco.bua_khac_yeu || 0) <= 0) {
                return interaction.update({ content: '❌ Không còn Bùa Khắc Yêu!', embeds: [], components: [] });
            }

            // Deduct Bùa
            economy.subtractBuaKhacYeu(userId, 1);

            // Show instant multiplier selection (FREE - no stamina cost)
            const currentNhua = economy.getCurrentNhua(userId);
            const currentNhuaCung = economy.getOrCreateEconomy(userId).nhua_cung || 0;

            const buaEmbed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('📜 BÙA KHẮC YÊU - SKIP TIMER!')
                .setDescription(`**Dungeon Solo** hoàn thành tức thì!\n\n💧 **Nhựa:** \`${currentNhua.current}/${currentNhua.max}\`\n💊 **Nhựa Cứng:** \`${currentNhuaCung}\`\n\nChọn mức nhựa để nhận thưởng:`)
                .setFooter({ text: 'Chọn trong 60 giây • Không có Bùa = chờ timer' })
                .setTimestamp();

            // Build multiplier buttons (same as expired dungeon)
            const row1 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`buasolo_0_${userId}`)
                        .setLabel('Bỏ qua')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`buasolo_1_${userId}`)
                        .setLabel(`x1 (${baseNhua} nhựa)`)
                        .setStyle(currentNhua.current >= baseNhua ? ButtonStyle.Primary : ButtonStyle.Secondary)
                        .setDisabled(currentNhua.current < baseNhua),
                    new ButtonBuilder()
                        .setCustomId(`buasolo_2_${userId}`)
                        .setLabel(`x2 (${baseNhua * 2} nhựa)`)
                        .setStyle(currentNhua.current >= baseNhua * 2 ? ButtonStyle.Primary : ButtonStyle.Secondary)
                        .setDisabled(currentNhua.current < baseNhua * 2),
                    new ButtonBuilder()
                        .setCustomId(`buasolo_3_${userId}`)
                        .setLabel(`x3 (${baseNhua * 3} nhựa)`)
                        .setStyle(currentNhua.current >= baseNhua * 3 ? ButtonStyle.Primary : ButtonStyle.Secondary)
                        .setDisabled(currentNhua.current < baseNhua * 3)
                );

            const components = [row1];

            // Row 2: Nhựa Cứng shortcuts
            if (currentNhuaCung > 0) {
                const row2Buttons = [];
                for (let mult = 1; mult <= 3; mult++) {
                    const targetNhua = baseNhua * mult;
                    const ncNeeded = calcNhuaCungNeeded(currentNhua.current, targetNhua);
                    if (ncNeeded > 0 && ncNeeded <= currentNhuaCung && currentNhua.current < targetNhua) {
                        row2Buttons.push(
                            new ButtonBuilder()
                                .setCustomId(`buasolo_nc_${mult}_${ncNeeded}_${userId}`)
                                .setLabel(`💊${ncNeeded} NC → x${mult}`)
                                .setStyle(ButtonStyle.Success)
                        );
                    }
                }
                if (row2Buttons.length > 0) {
                    components.push(new ActionRowBuilder().addComponents(row2Buttons));
                }
            }

            await interaction.update({ embeds: [buaEmbed], components });

            // Collector for bua solo buttons
            const buaCollector = reply.createMessageComponentCollector({
                filter: i => i.user.id === userId && i.customId.startsWith('buasolo_'),
                time: 60000
            });

            buaCollector.on('collect', async (buaInt) => {
                // Handle NC shortcut
                if (buaInt.customId.startsWith('buasolo_nc_')) {
                    const parts = buaInt.customId.split('_');
                    const multiplier = parseInt(parts[2]);
                    const ncNeeded = parseInt(parts[3]);

                    const subResult = economy.subtractNhuaCung(userId, ncNeeded);
                    if (!subResult.success) {
                        return buaInt.reply({ content: `❌ ${subResult.message}`, ephemeral: true });
                    }

                    const curNhua = economy.getCurrentNhua(userId);
                    const nhuaToAdd = ncNeeded * 60;
                    const newNhua = Math.min(economy.MAX_NHUA, curNhua.current + nhuaToAdd);
                    economy.db.prepare('UPDATE economy SET nhua = ?, nhua_updated_at = ? WHERE discord_id = ?')
                        .run(newNhua, new Date().toISOString(), userId);

                    const nhuaCost = baseNhua * multiplier;
                    economy.consumeNhua(userId, nhuaCost);

                    const rewards = dungeonSystem.calculateRewards('solo', multiplier, false, multiplier);
                    economy.addHat(userId, rewards.hat);
                    if (rewards.thachAm > 0) economy.addThachAm(userId, rewards.thachAm);
                    economy.addBoxesT1(userId, rewards.boxes);

                    try {
                        economy.updateProgress(userId, 'solo_completed', 1);
                        const { updateQuestProgress, sendQuestNotifications } = require('../../utils/questSystem');
                        const completed = updateQuestProgress(userId, 'solo_completed', 1);
                        if (completed && completed.length > 0) await sendQuestNotifications(message.channel, userId, completed);
                    } catch (e) { }

                    const successEmbed = new EmbedBuilder()
                        .setColor('#22C55E')
                        .setTitle('📜 BÙA KHẮC YÊU - THÀNH CÔNG!')
                        .setDescription(`Dùng **${ncNeeded}** 💊 Nhựa Cứng → **x${multiplier}**`)
                        .addFields(
                            { name: '📦 Hòm', value: `\`+${rewards.boxes}\``, inline: true },
                            { name: '🌾 Hạt', value: `\`+${rewards.hat.toLocaleString()}\``, inline: true },
                            { name: '💧 Nhựa tiêu', value: `\`-${nhuaCost}\``, inline: true }
                        )
                        .setTimestamp();

                    await buaInt.update({ embeds: [successEmbed], components: [] });
                    return buaCollector.stop();
                }

                // Normal multiplier
                const parts = buaInt.customId.split('_');
                const multiplier = parseInt(parts[1]);

                if (multiplier === 0) {
                    await buaInt.update({ content: '⏭️ Đã bỏ qua. Bùa đã dùng!', embeds: [], components: [] });
                    return buaCollector.stop();
                }

                const nhuaCost = baseNhua * multiplier;
                const consumeResult = economy.consumeNhua(userId, nhuaCost);
                if (!consumeResult.success) {
                    return buaInt.reply({ content: `❌ ${consumeResult.message}`, ephemeral: true });
                }

                const rewards = dungeonSystem.calculateRewards('solo', multiplier, false, multiplier);
                economy.addHat(userId, rewards.hat);
                if (rewards.thachAm > 0) economy.addThachAm(userId, rewards.thachAm);
                economy.addBoxesT1(userId, rewards.boxes);

                try {
                    economy.updateProgress(userId, 'solo_completed', 1);
                    const { updateQuestProgress, sendQuestNotifications } = require('../../utils/questSystem');
                    const completed = updateQuestProgress(userId, 'solo_completed', 1);
                    if (completed && completed.length > 0) await sendQuestNotifications(message.channel, userId, completed);
                } catch (e) { }

                const successEmbed = new EmbedBuilder()
                    .setColor('#22C55E')
                    .setTitle('📜 BÙA KHẮC YÊU - THÀNH CÔNG!')
                    .setDescription(`Skip timer thành công!`)
                    .addFields(
                        { name: '📦 Hòm', value: `\`+${rewards.boxes}\``, inline: true },
                        { name: '🌾 Hạt', value: `\`+${rewards.hat.toLocaleString()}\``, inline: true },
                        { name: '💧 Nhựa tiêu', value: `\`-${nhuaCost}\``, inline: true }
                    )
                    .setTimestamp();

                await buaInt.update({ embeds: [successEmbed], components: [] });
                buaCollector.stop();
            });

            buaCollector.on('end', (_, reason) => {
                if (reason === 'time') {
                    reply.edit({ content: '⏱️ Hết thời gian chọn! Bùa đã dùng.', embeds: [], components: [] }).catch(() => { });
                }
            });

            return;
        }

        // === Normal flow - start with timer ===
        if (action === 'solostart') {
            // Bắt đầu dungeon KHÔNG tiêu nhựa
            const endTime = new Date(Date.now() + clearResult.finalTime * 60 * 1000);
            createDungeonSession(userId, 'solo', [{ id: userId, mastery, role: playerClass }], 0, 1, endTime);

            const dungeonInfo = dungeonSystem.DUNGEON_TYPES.solo;
            const progressBar = '░░░░░░░░░░';

            const startEmbed = new EmbedBuilder()
                .setColor('#3B82F6')
                .setTitle('⚔️ ĐANG TRONG BÍ CẢNH')
                .setDescription(`
**${dungeonInfo.dungeonName}** x1

🚶 Đang di chuyển đến Boss...
\`${progressBar}\` **0%**

⏱️ **Còn lại:** ${formatTime(clearResult.finalTime)}
🏁 **Xong lúc:** <t:${Math.floor(endTime.getTime() / 1000)}:T>
                `)
                .setFooter({ text: '🚶 Đang trên đường... • ?huydung để hủy' })
                .setTimestamp();

            await interaction.update({ embeds: [startEmbed], components: [] });
            collector.stop();

            // Schedule completion với choice
            scheduleDungeonChoice(message.channel, userId, 'solo', clearResult.finalTime);
        }
    });
}

// ============== COOP DUNGEON ==============

async function handleCoopDungeon(message, reply, userId, nhuaInfo, mastery, playerClass, buaKhacYeu = 0) {
    const dungeon = dungeonSystem.DUNGEON_TYPES.coop5;

    let buaHint = '';
    if (buaKhacYeu > 0) {
        buaHint = `\n\n📜 **Có ${buaKhacYeu} Bùa Khắc Yêu!** Skip timer cho cả party`;
    }

    const embed = new EmbedBuilder()
        .setColor('#10B981')
        .setTitle('👥 Dungeon Coop 5 Người')
        .setDescription(`Chọn cách tham gia:${buaHint}`)
        .addFields(
            { name: '💧 Nhựa cần', value: `60 / 120 / 180`, inline: true },
            { name: '⏱️ Base time', value: '75 phút', inline: true },
            { name: '💪 Mastery', value: `${mastery.toLocaleString()}`, inline: true }
        )
        .setFooter({ text: buaKhacYeu > 0 ? '📜 Dùng Bùa = Skip timer cho cả nhóm!' : 'Mời người hoặc đi với AI' });

    const buttons = [
        new ButtonBuilder()
            .setCustomId(`coop_invite_${userId}`)
            .setLabel('👥 Mời Người')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`coop_ai_${userId}`)
            .setLabel('🤖 Đi với AI')
            .setStyle(ButtonStyle.Secondary)
    ];

    // Add Bùa AI button if available (instant with AI)
    if (buaKhacYeu > 0) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`coop_buaai_${userId}`)
                .setLabel('📜 Bùa + AI (Skip)')
                .setStyle(ButtonStyle.Success)
        );
    }

    buttons.push(
        new ButtonBuilder()
            .setCustomId(`coop_cancel_${userId}`)
            .setLabel('❌ Hủy')
            .setStyle(ButtonStyle.Danger)
    );

    const row = new ActionRowBuilder().addComponents(buttons);

    await reply.edit({ embeds: [embed], components: [row] });

    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === userId,
        time: 60000
    });

    collector.on('collect', async (interaction) => {
        const [, action] = interaction.customId.split('_');

        if (action === 'cancel') {
            await interaction.update({ content: '❌ Đã hủy.', embeds: [], components: [] });
            return collector.stop();
        }

        // === Bùa + AI: Skip timer, instant reward ===
        if (action === 'buaai') {
            collector.stop();

            // Check Bùa
            const currentEco = economy.getOrCreateEconomy(userId);
            if ((currentEco.bua_khac_yeu || 0) <= 0) {
                return interaction.update({ content: '❌ Không còn Bùa Khắc Yêu!', embeds: [], components: [] });
            }

            // Deduct Bùa
            economy.subtractBuaKhacYeu(userId, 1);

            const baseNhua = dungeon.baseNhua;
            const currentNhua = economy.getCurrentNhua(userId);
            const currentNhuaCung = currentEco.nhua_cung || 0;

            const buaEmbed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('📜 BÙA KHẮC YÊU - COOP AI!')
                .setDescription(`**Coop 5 với 4 AI** hoàn thành tức thì!\n\n💧 **Nhựa:** \`${currentNhua.current}/${currentNhua.max}\`\n💊 **Nhựa Cứng:** \`${currentNhuaCung}\`\n\n⚠️ **-30% hòm do AI penalty**\n\nChọn mức nhựa để nhận thưởng:`)
                .setFooter({ text: 'Chọn trong 60 giây' })
                .setTimestamp();

            // Build multiplier buttons
            const row1 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`buacoop_0_${userId}`)
                        .setLabel('Bỏ qua')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`buacoop_1_${userId}`)
                        .setLabel(`x1 (${baseNhua} nhựa)`)
                        .setStyle(currentNhua.current >= baseNhua ? ButtonStyle.Primary : ButtonStyle.Secondary)
                        .setDisabled(currentNhua.current < baseNhua),
                    new ButtonBuilder()
                        .setCustomId(`buacoop_2_${userId}`)
                        .setLabel(`x2 (${baseNhua * 2} nhựa)`)
                        .setStyle(currentNhua.current >= baseNhua * 2 ? ButtonStyle.Primary : ButtonStyle.Secondary)
                        .setDisabled(currentNhua.current < baseNhua * 2),
                    new ButtonBuilder()
                        .setCustomId(`buacoop_3_${userId}`)
                        .setLabel(`x3 (${baseNhua * 3} nhựa)`)
                        .setStyle(currentNhua.current >= baseNhua * 3 ? ButtonStyle.Primary : ButtonStyle.Secondary)
                        .setDisabled(currentNhua.current < baseNhua * 3)
                );

            const components = [row1];

            // Row 2: NC shortcuts
            if (currentNhuaCung > 0) {
                const row2Buttons = [];
                for (let mult = 1; mult <= 3; mult++) {
                    const targetNhua = baseNhua * mult;
                    const ncNeeded = calcNhuaCungNeeded(currentNhua.current, targetNhua);
                    if (ncNeeded > 0 && ncNeeded <= currentNhuaCung && currentNhua.current < targetNhua) {
                        row2Buttons.push(
                            new ButtonBuilder()
                                .setCustomId(`buacoop_nc_${mult}_${ncNeeded}_${userId}`)
                                .setLabel(`💊${ncNeeded} NC → x${mult}`)
                                .setStyle(ButtonStyle.Success)
                        );
                    }
                }
                if (row2Buttons.length > 0) {
                    components.push(new ActionRowBuilder().addComponents(row2Buttons));
                }
            }

            await interaction.update({ embeds: [buaEmbed], components });

            // Collector for buacoop buttons
            const buaCollector = reply.createMessageComponentCollector({
                filter: i => i.user.id === userId && i.customId.startsWith('buacoop_'),
                time: 60000
            });

            buaCollector.on('collect', async (buaInt) => {
                // Handle NC shortcut
                if (buaInt.customId.startsWith('buacoop_nc_')) {
                    const parts = buaInt.customId.split('_');
                    const multiplier = parseInt(parts[2]);
                    const ncNeeded = parseInt(parts[3]);

                    const subResult = economy.subtractNhuaCung(userId, ncNeeded);
                    if (!subResult.success) {
                        return buaInt.reply({ content: `❌ ${subResult.message}`, ephemeral: true });
                    }

                    const curNhua = economy.getCurrentNhua(userId);
                    const nhuaToAdd = ncNeeded * 60;
                    const newNhua = Math.min(economy.MAX_NHUA, curNhua.current + nhuaToAdd);
                    economy.db.prepare('UPDATE economy SET nhua = ?, nhua_updated_at = ? WHERE discord_id = ?')
                        .run(newNhua, new Date().toISOString(), userId);

                    const nhuaCost = baseNhua * multiplier;
                    economy.consumeNhua(userId, nhuaCost);

                    const rewards = dungeonSystem.calculateRewards('coop5', multiplier, true, multiplier);
                    economy.addHat(userId, rewards.hat);
                    if (rewards.thachAm > 0) economy.addThachAm(userId, rewards.thachAm);
                    economy.addBoxesT1(userId, rewards.boxes);

                    try {
                        economy.updateProgress(userId, 'coop_completed', 1);
                        const { updateQuestProgress, sendQuestNotifications } = require('../../utils/questSystem');
                        const completed = updateQuestProgress(userId, 'coop_completed', 1);
                        if (completed && completed.length > 0) await sendQuestNotifications(message.channel, userId, completed);
                    } catch (e) { }

                    const successEmbed = new EmbedBuilder()
                        .setColor('#22C55E')
                        .setTitle('📜 BÙA + AI - THÀNH CÔNG!')
                        .setDescription(`Dùng **${ncNeeded}** 💊 NC → **x${multiplier}**`)
                        .addFields(
                            { name: '📦 Hòm', value: `\`+${rewards.boxes}\``, inline: true },
                            { name: '🌾 Hạt', value: `\`+${rewards.hat.toLocaleString()}\``, inline: true },
                            { name: '💧 Nhựa tiêu', value: `\`-${nhuaCost}\``, inline: true }
                        )
                        .setTimestamp();

                    await buaInt.update({ embeds: [successEmbed], components: [] });
                    return buaCollector.stop();
                }

                // Normal multiplier
                const parts = buaInt.customId.split('_');
                const multiplier = parseInt(parts[1]);

                if (multiplier === 0) {
                    await buaInt.update({ content: '⏭️ Đã bỏ qua. Bùa đã dùng!', embeds: [], components: [] });
                    return buaCollector.stop();
                }

                const nhuaCost = baseNhua * multiplier;
                const consumeResult = economy.consumeNhua(userId, nhuaCost);
                if (!consumeResult.success) {
                    return buaInt.reply({ content: `❌ ${consumeResult.message}`, ephemeral: true });
                }

                const rewards = dungeonSystem.calculateRewards('coop5', multiplier, true, multiplier);
                economy.addHat(userId, rewards.hat);
                if (rewards.thachAm > 0) economy.addThachAm(userId, rewards.thachAm);
                economy.addBoxesT1(userId, rewards.boxes);

                try {
                    economy.updateProgress(userId, 'coop_completed', 1);
                    const { updateQuestProgress, sendQuestNotifications } = require('../../utils/questSystem');
                    const completed = updateQuestProgress(userId, 'coop_completed', 1);
                    if (completed && completed.length > 0) await sendQuestNotifications(message.channel, userId, completed);
                } catch (e) { }

                const successEmbed = new EmbedBuilder()
                    .setColor('#22C55E')
                    .setTitle('📜 BÙA + AI - THÀNH CÔNG!')
                    .setDescription(`Coop 5 với 4 AI - Skip timer!`)
                    .addFields(
                        { name: '📦 Hòm', value: `\`+${rewards.boxes}\``, inline: true },
                        { name: '🌾 Hạt', value: `\`+${rewards.hat.toLocaleString()}\``, inline: true },
                        { name: '💧 Nhựa tiêu', value: `\`-${nhuaCost}\``, inline: true }
                    )
                    .setTimestamp();

                await buaInt.update({ embeds: [successEmbed], components: [] });
                buaCollector.stop();
            });

            buaCollector.on('end', (_, reason) => {
                if (reason === 'time') {
                    reply.edit({ content: '⏱️ Hết thời gian chọn! Bùa đã dùng.', embeds: [], components: [] }).catch(() => { });
                }
            });

            return;
        }

        if (action === 'ai') {
            await handleCoopWithAI(interaction, userId, nhuaInfo, mastery, playerClass);
            collector.stop();
        } else if (action === 'invite') {
            await interaction.update({
                content: '📝 **Mời người chơi** (tối đa 4 người):\n• Tag @user\n• Nhập username\n• Tag bản thân để đi solo\n\n*Gửi trong 60 giây...*',
                embeds: [],
                components: []
            });

            // Message collector để nhận mentions hoặc username
            const msgCollector = message.channel.createMessageCollector({
                filter: m => m.author.id === userId && m.content.trim().length > 0,
                time: 60000,
                max: 1
            });

            msgCollector.on('collect', async (msg) => {
                const content = msg.content.trim();
                let invitedUsers = new Map();

                // 1. Check mentions first
                if (msg.mentions.users.size > 0) {
                    msg.mentions.users.forEach(u => {
                        if (!u.bot) invitedUsers.set(u.id, u);
                    });
                }

                // 2. Parse usernames/display names from content (nếu không có mention)
                if (invitedUsers.size === 0) {
                    // Split by space or comma
                    const names = content.split(/[\s,]+/).filter(n => n.length > 0);

                    // Fetch all members in guild
                    try {
                        const members = await msg.guild.members.fetch();

                        for (const name of names) {
                            const lowerName = name.toLowerCase();
                            // Find by exact username, display name, or partial match
                            const found = members.find(m =>
                                !m.user.bot && (
                                    m.user.username.toLowerCase() === lowerName ||
                                    m.displayName.toLowerCase() === lowerName ||
                                    m.user.username.toLowerCase().includes(lowerName) ||
                                    m.displayName.toLowerCase().includes(lowerName)
                                )
                            );
                            if (found) {
                                invitedUsers.set(found.id, found.user);
                            }
                        }
                    } catch (e) {
                        console.error('Error fetching members:', e);
                    }
                }

                // 3. Check if user tagged themselves (go solo)
                if (invitedUsers.size === 1 && invitedUsers.has(userId)) {
                    // User invited themselves - start solo coop (party của 1 người)
                    await msg.reply('🎮 Đi solo! Đang bắt đầu với bạn...');

                    // Start coop with just the leader (no AI)
                    const members = [{ id: userId, mastery, role: playerClass }];
                    const clearResult = dungeonSystem.calculateClearTime('coop5', members, 0);
                    const endTime = new Date(Date.now() + clearResult.finalTime * 60 * 1000);

                    const soloEmbed = new EmbedBuilder()
                        .setColor('#10B981')
                        .setTitle('⚔️ SOLO COOP MODE!')
                        .setDescription(`
━━━━━━━━━━━━━━━━━━━━━━
📋 **THÀNH VIÊN** (1/1)
👤 <@${userId}> 👑 • \`${mastery.toLocaleString()}\` Mastery
━━━━━━━━━━━━━━━━━━━━━━

🚶 Đang di chuyển đến Boss...
\`░░░░░░░░░░\` **0%**

⏱️ **Còn lại:** ${formatTime(clearResult.finalTime)}
🏁 **Xong lúc:** <t:${Math.floor(endTime.getTime() / 1000)}:T>
                        `)
                        .setFooter({ text: '⚠️ Solo mode - không có AI hỗ trợ!' })
                        .setTimestamp();

                    createDungeonSession(userId, 'coop5', members, 0, 1, endTime);
                    await msg.channel.send({ embeds: [soloEmbed] });
                    scheduleDungeonChoice(msg.channel, userId, 'coop5', clearResult.finalTime, members);
                    return;
                }

                // 4. Filter out self if also invited others
                if (invitedUsers.size > 1 && invitedUsers.has(userId)) {
                    invitedUsers.delete(userId);
                }

                if (invitedUsers.size === 0) {
                    await msg.reply('❌ Không tìm thấy người chơi! Thử:\n• Tag @user\n• Nhập username\n• Tag bản thân để đi solo');
                    return;
                }

                if (invitedUsers.size > 4) {
                    await msg.reply('❌ Chỉ có thể mời tối đa 4 người (tổng 5 người)!');
                    return;
                }

                // Gửi invite đến từng người
                const inviteEmbed = new EmbedBuilder()
                    .setColor('#10B981')
                    .setTitle('👥 Lời Mời Coop Dungeon')
                    .setDescription(`<@${userId}> mời bạn vào **Thành Cổ Ma Quái** (Coop 5)!\n\nNhấn ✅ để tham gia hoặc ❌ để từ chối.`)
                    .setFooter({ text: 'Hết hạn sau 2 phút' })
                    .setTimestamp();

                const inviteRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`invaccept_${userId}`)
                            .setLabel('✅ Tham gia')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`invdecline_${userId}`)
                            .setLabel('❌ Từ chối')
                            .setStyle(ButtonStyle.Danger)
                    );

                const invitedList = Array.from(invitedUsers.values()).map(u => `<@${u.id}>`).join(', ');
                const inviteMsg = await msg.reply({
                    content: `${invitedList} - Bạn được mời vào Coop!`,
                    embeds: [inviteEmbed],
                    components: [inviteRow]
                });

                // Collect responses
                const acceptedUsers = new Map();
                acceptedUsers.set(userId, { mastery, role: playerClass });

                const inviteCollector = inviteMsg.createMessageComponentCollector({
                    filter: i => invitedUsers.has(i.user.id),
                    time: 120000
                });

                inviteCollector.on('collect', async (i) => {
                    if (i.customId.startsWith('invaccept_')) {
                        // Check xem user có đang trong dungeon khác không
                        const existingDungeon = getActiveDungeon(i.user.id);
                        if (existingDungeon) {
                            return i.reply({
                                content: `❌ Bạn đang trong dungeon **${existingDungeon.dungeon_type}** rồi! Dùng \`?huydung\` để rời trước.`,
                                ephemeral: true
                            });
                        }

                        const memberMastery = dungeonSystem.calculateMasteryFromEquipment(
                            economy.getEquippedItems(i.user.id),
                            getPlayerClass(i.member)
                        );
                        acceptedUsers.set(i.user.id, { mastery: memberMastery, role: getPlayerClass(i.member) });

                        await i.reply({ content: `✅ <@${i.user.id}> đã tham gia! (${acceptedUsers.size}/5)`, ephemeral: false });

                        // Nếu đủ người hoặc đã mời hết
                        if (acceptedUsers.size >= 5 || acceptedUsers.size === invitedUsers.size + 1) {
                            inviteCollector.stop('full');
                        }
                    } else {
                        await i.reply({ content: `❌ <@${i.user.id}> đã từ chối.`, ephemeral: false });
                    }
                });

                inviteCollector.on('end', async (_, reason) => {
                    const members = Array.from(acceptedUsers.entries()).map(([id, data]) => ({
                        id,
                        mastery: data.mastery,
                        role: data.role
                    }));

                    // KHÔNG thêm AI nếu không đủ người
                    if (members.length < 2) {
                        await inviteMsg.edit({
                            content: '❌ Không đủ người tham gia (cần ít nhất 2).',
                            embeds: [],
                            components: []
                        });
                        return;
                    }

                    // Tính thời gian với số người thực tế (KHÔNG có AI)
                    const clearResult = dungeonSystem.calculateClearTime('coop5', members, 0);

                    // Tạo danh sách thành viên đẹp
                    const membersList = members.map((m, i) => {
                        const roleIcon = m.role === 'dps' ? '⚔️' : m.role === 'tanker' ? '🛡️' : m.role === 'healer' ? '💚' : '👤';
                        const isLeader = m.id === userId;
                        return `${roleIcon} <@${m.id}>${isLeader ? ' 👑' : ''} • \`${m.mastery.toLocaleString()}\` Mastery`;
                    }).join('\n');

                    const endTime = new Date(Date.now() + clearResult.finalTime * 60 * 1000);

                    const startEmbed = new EmbedBuilder()
                        .setColor('#10B981')
                        .setTitle('🏰 THÀNH CỔ MA QUÁI')
                        .setDescription(`
━━━━━━━━━━━━━━━━━━━━━━
📋 **THÀNH VIÊN** (${members.length}/5)
${membersList}
━━━━━━━━━━━━━━━━━━━━━━

🚶 Đang di chuyển đến Boss...
\`░░░░░░░░░░\` **0%**

⏱️ **Còn lại:** ${formatTime(clearResult.finalTime)}
🏁 **Xong lúc:** <t:${Math.floor(endTime.getTime() / 1000)}:T>
                        `)
                        .setFooter({ text: '🚶 Đang trên đường... • ?huydung để hủy' })
                        .setTimestamp();

                    // Tạo dungeon session với tất cả members
                    createDungeonSession(userId, 'coop5', members, 0, 1, endTime);

                    await inviteMsg.edit({
                        content: `${members.map(m => `<@${m.id}>`).join(' ')} - Bí cảnh bắt đầu!`,
                        embeds: [startEmbed],
                        components: []
                    });

                    // Schedule completion - mention tất cả members
                    scheduleDungeonChoice(message.channel, userId, 'coop5', clearResult.finalTime, members);
                });
            });

            msgCollector.on('end', (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    message.channel.send(`<@${userId}> ⏱️ Hết thời gian mời người!`).catch(() => { });
                }
            });

            collector.stop();
        }
    });
}

async function handleCoopWithAI(interaction, userId, nhuaInfo, mastery, playerClass) {
    const aiCount = 4;
    const members = [{ id: userId, mastery, role: playerClass }];

    // Tính thời gian với AI (AI có mastery 350)
    const clearResult = dungeonSystem.calculateClearTime('coop5', members, aiCount);

    // AI không có events ThieuTank/ThieuHeal/ThieuDPS
    const event = null;

    // Tạo party display đẹp
    const roleIcon = playerClass === 'dps' ? '⚔️' : playerClass === 'tanker' ? '🛡️' : playerClass === 'healer' ? '💚' : '👤';
    const aiList = Array(aiCount).fill('🤖').map((icon, i) => `${icon} AI ${i + 1}`).join('\n');

    const endTime = new Date(Date.now() + clearResult.finalTime * 60 * 1000);

    const startEmbed = new EmbedBuilder()
        .setColor('#F59E0B')
        .setTitle('🏰 THÀNH CỔ MA QUÁI')
        .setDescription(`
━━━━━━━━━━━━━━━━━━━━━━
📋 **THÀNH VIÊN** (1+${aiCount}AI/5)
${roleIcon} <@${userId}> 👑 • \`${mastery.toLocaleString()}\` Mastery
${aiList}
━━━━━━━━━━━━━━━━━━━━━━
⚠️ *Phần thưởng hòm giảm 30% khi có AI*

🚶 Đang di chuyển đến Boss...
\`░░░░░░░░░░\` **0%**

⏱️ **Còn lại:** ${formatTime(clearResult.finalTime)}
🏁 **Xong lúc:** <t:${Math.floor(endTime.getTime() / 1000)}:T>
        `)
        .setFooter({ text: '🚶 Đang trên đường... • ?huydung để hủy' })
        .setTimestamp();

    if (event) {
        startEmbed.addFields({
            name: `⚠️ CẢNH BÁO: ${event.type}`,
            value: `> 15% tỉ lệ reset tại phút ${event.triggerAt}!`,
            inline: false
        });
    }

    // Bắt đầu dungeon ngay - KHÔNG tiêu nhựa trước
    createDungeonSession(userId, 'coop5', members, aiCount, 1, endTime, event);

    await interaction.update({ embeds: [startEmbed], components: [] });

    // Schedule với event
    if (event) {
        scheduleEventTrigger(interaction.message.channel, userId, event, clearResult.finalTime);
    } else {
        scheduleDungeonChoice(interaction.message.channel, userId, 'coop5', clearResult.finalTime, members);
    }
}

// ============== BOSS DUNGEON ==============

async function handleBossDungeon(message, reply, userId, mastery, playerClass) {
    const bossStatus = economy.canClaimBoss(userId);

    if (!bossStatus.canClaim) {
        const embed = new EmbedBuilder()
            .setColor('#EF4444')
            .setTitle('👑 Boss Tuần')
            .setDescription('❌ Bạn đã đánh đủ Boss tuần này!')
            .addFields({
                name: '🔄 Reset',
                value: `Thứ 2 tuần sau`,
                inline: true
            });

        await reply.edit({ embeds: [embed], components: [] });
        return;
    }

    const embed = new EmbedBuilder()
        .setColor('#DC2626')
        .setTitle('👑 Boss 10 Người')
        .setDescription('Chọn cách tham gia:')
        .addFields(
            { name: '💧 Nhựa', value: 'Miễn phí', inline: true },
            { name: '📅 Còn lại', value: `${bossStatus.bossesRemaining} boss/tuần`, inline: true },
            { name: '⏱️ Base time', value: '24 giờ', inline: true }
        )
        .setFooter({ text: 'Mời 9 người hoặc đi với AI' });

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`boss_invite_${userId}`)
                .setLabel('👥 Mời Người')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`boss_ai_${userId}`)
                .setLabel('🤖 Đi với AI')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`boss_cancel_${userId}`)
                .setLabel('❌ Hủy')
                .setStyle(ButtonStyle.Danger)
        );

    await reply.edit({ embeds: [embed], components: [row] });

    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === userId,
        time: 60000
    });

    collector.on('collect', async (interaction) => {
        const [, action] = interaction.customId.split('_');

        if (action === 'cancel') {
            await interaction.update({ content: '❌ Đã hủy.', embeds: [], components: [] });
            return collector.stop();
        }

        if (action === 'ai') {
            await handleBossWithAI(interaction, userId, mastery, playerClass);
            collector.stop();
        } else if (action === 'invite') {
            await interaction.update({
                content: '📝 **Mời người chơi** (tối đa 9 người):\n• Tag @user\n• Nhập username\n• Tag bản thân để đi solo\n\n*Gửi trong 60 giây...*',
                embeds: [],
                components: []
            });

            // Message collector để nhận mentions hoặc username
            const msgCollector = message.channel.createMessageCollector({
                filter: m => m.author.id === userId && m.content.trim().length > 0,
                time: 60000,
                max: 1
            });

            msgCollector.on('collect', async (msg) => {
                const content = msg.content.trim();
                let invitedUsers = new Map();

                // 1. Check mentions first
                if (msg.mentions.users.size > 0) {
                    msg.mentions.users.forEach(u => {
                        if (!u.bot) invitedUsers.set(u.id, u);
                    });
                }

                // 2. Parse usernames/display names if no mentions
                if (invitedUsers.size === 0) {
                    const names = content.split(/[\s,]+/).filter(n => n.length > 0);
                    try {
                        const members = await msg.guild.members.fetch();
                        for (const name of names) {
                            const lowerName = name.toLowerCase();
                            const found = members.find(m =>
                                !m.user.bot && (
                                    m.user.username.toLowerCase() === lowerName ||
                                    m.displayName.toLowerCase() === lowerName ||
                                    m.user.username.toLowerCase().includes(lowerName) ||
                                    m.displayName.toLowerCase().includes(lowerName)
                                )
                            );
                            if (found) {
                                invitedUsers.set(found.id, found.user);
                            }
                        }
                    } catch (e) {
                        console.error('Error fetching members:', e);
                    }
                }

                // 3. Check if user tagged themselves (go solo)
                if (invitedUsers.size === 1 && invitedUsers.has(userId)) {
                    await msg.reply('🎮 Đi solo Boss! Đang bắt đầu...');

                    const members = [{ id: userId, mastery, role: playerClass }];
                    const aiCount = 9;
                    const clearResult = dungeonSystem.calculateClearTime('boss10', members, aiCount);
                    const endTime = new Date(Date.now() + clearResult.finalTime * 60 * 1000);

                    const soloEmbed = new EmbedBuilder()
                        .setColor('#DC2626')
                        .setTitle('👑 SOLO BOSS MODE!')
                        .setDescription(`
━━━━━━━━━━━━━━━━━━━━━━
📋 **THÀNH VIÊN** (Solo + 9 AI)
👤 <@${userId}> 👑
🤖 AI x9
━━━━━━━━━━━━━━━━━━━━━━

🚶 Đang di chuyển đến Boss...
\`░░░░░░░░░░\` **0%**

⏱️ **Còn lại:** ${formatTime(clearResult.finalTime)}
🏁 **Xong lúc:** <t:${Math.floor(endTime.getTime() / 1000)}:T>
                        `)
                        .setFooter({ text: '⚠️ Solo Boss với AI hỗ trợ!' })
                        .setTimestamp();

                    createDungeonSession(userId, 'boss10', members, aiCount, 1, endTime);
                    await msg.channel.send({ embeds: [soloEmbed] });
                    scheduleBossPhases(msg.channel, userId, clearResult.finalTime, members, true);
                    return;
                }

                // 4. Filter out self if also invited others
                if (invitedUsers.size > 1 && invitedUsers.has(userId)) {
                    invitedUsers.delete(userId);
                }

                if (invitedUsers.size === 0) {
                    await msg.reply('❌ Không tìm thấy người chơi! Thử:\n• Tag @user\n• Nhập username\n• Tag bản thân để đi solo');
                    return;
                }

                if (invitedUsers.size > 9) {
                    await msg.reply('❌ Chỉ có thể mời tối đa 9 người (tổng 10 người)!');
                    return;
                }

                // Gửi invite
                const inviteEmbed = new EmbedBuilder()
                    .setColor('#DC2626')
                    .setTitle('👑 Lời Mời Boss Dungeon')
                    .setDescription(`<@${userId}> mời bạn vào **Boss 10 Người**!\n\nNhấn ✅ để tham gia hoặc ❌ để từ chối.`)
                    .setFooter({ text: 'Hết hạn sau 2 phút' })
                    .setTimestamp();

                const inviteRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`bossaccept_${userId}`)
                            .setLabel('✅ Tham gia')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`bossdecline_${userId}`)
                            .setLabel('❌ Từ chối')
                            .setStyle(ButtonStyle.Danger)
                    );

                const invitedList = Array.from(invitedUsers.values()).map(u => `<@${u.id}>`).join(', ');
                const inviteMsg = await msg.reply({
                    content: `${invitedList} - Bạn được mời vào Boss!`,
                    embeds: [inviteEmbed],
                    components: [inviteRow]
                });

                // Collect responses
                const acceptedUsers = new Map();
                acceptedUsers.set(userId, { mastery, role: playerClass });

                const inviteCollector = inviteMsg.createMessageComponentCollector({
                    filter: i => invitedUsers.has(i.user.id),
                    time: 120000
                });

                inviteCollector.on('collect', async (i) => {
                    if (i.customId.startsWith('bossaccept_')) {
                        // Check xem user có đang trong dungeon khác không
                        const existingDungeon = getActiveDungeon(i.user.id);
                        if (existingDungeon) {
                            return i.reply({
                                content: `❌ Bạn đang trong dungeon **${existingDungeon.dungeon_type}** rồi! Dùng \`?huydung\` để rời trước.`,
                                ephemeral: true
                            });
                        }

                        const memberMastery = dungeonSystem.calculateMasteryFromEquipment(
                            economy.getEquippedItems(i.user.id),
                            getPlayerClass(i.member)
                        );
                        acceptedUsers.set(i.user.id, { mastery: memberMastery, role: getPlayerClass(i.member) });

                        await i.reply({ content: `✅ <@${i.user.id}> đã tham gia! (${acceptedUsers.size}/10)`, ephemeral: false });

                        if (acceptedUsers.size >= 10 || acceptedUsers.size === invitedUsers.size + 1) {
                            inviteCollector.stop('full');
                        }
                    } else {
                        await i.reply({ content: `❌ <@${i.user.id}> đã từ chối.`, ephemeral: false });
                    }
                });

                inviteCollector.on('end', async (_, reason) => {
                    const members = Array.from(acceptedUsers.entries()).map(([id, data]) => ({
                        id,
                        mastery: data.mastery,
                        role: data.role
                    }));

                    if (members.length < 2) {
                        await inviteMsg.edit({
                            content: '❌ Không đủ người tham gia (cần ít nhất 2).',
                            embeds: [],
                            components: []
                        });
                        return;
                    }

                    const clearResult = dungeonSystem.calculateClearTime('boss10', members, 0);

                    const membersList = members.map((m, i) => {
                        const roleIcon = m.role === 'dps' ? '⚔️' : m.role === 'tanker' ? '🛡️' : m.role === 'healer' ? '💚' : '👤';
                        const isLeader = m.id === userId;
                        return `${roleIcon} <@${m.id}>${isLeader ? ' 👑' : ''} • \`${m.mastery.toLocaleString()}\` Mastery`;
                    }).join('\n');

                    const endTime = new Date(Date.now() + clearResult.finalTime * 60 * 1000);

                    const startEmbed = new EmbedBuilder()
                        .setColor('#DC2626')
                        .setTitle('👑 BOSS DUNGEON')
                        .setDescription(`
━━━━━━━━━━━━━━━━━━━━━━
📋 **THÀNH VIÊN** (${members.length}/10)
${membersList}
━━━━━━━━━━━━━━━━━━━━━━

🚶 Đang di chuyển đến Boss...
\`░░░░░░░░░░\` **0%**

⏱️ **Còn lại:** ${formatTime(clearResult.finalTime)}
🏁 **Xong lúc:** <t:${Math.floor(endTime.getTime() / 1000)}:T>
                        `)
                        .setFooter({ text: '🚶 Đang trên đường... • ?huydung để hủy' })
                        .setTimestamp();

                    createDungeonSession(userId, 'boss10', members, 0, 1, endTime);

                    // Boss count sẽ được claim khi nhận thưởng (phase 1 & 2)

                    await inviteMsg.edit({
                        content: `${members.map(m => `<@${m.id}>`).join(' ')} - Boss bắt đầu!`,
                        embeds: [startEmbed],
                        components: []
                    });

                    scheduleBossPhases(message.channel, userId, clearResult.finalTime, members, false);
                });
            });

            msgCollector.on('end', (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    message.channel.send(`<@${userId}> ⏱️ Hết thời gian mời người!`).catch(() => { });
                }
            });

            collector.stop();
        }
    });
}

async function handleBossWithAI(interaction, userId, mastery, playerClass) {
    const members = [{ id: userId, mastery, role: playerClass }];
    const aiCount = 9; // 9 AI to make 10 total

    const clearResult = dungeonSystem.calculateClearTime('boss10', members, aiCount);
    const endTime = new Date(Date.now() + clearResult.finalTime * 60 * 1000);

    // Boss count sẽ được claim khi nhận thưởng (không claim khi start)

    // Tạo danh sách thành viên
    const roleIcon = playerClass === 'dps' ? '⚔️' : playerClass === 'tanker' ? '🛡️' : playerClass === 'healer' ? '💚' : '👤';
    let membersList = `${roleIcon} <@${userId}> 👑 • \`${mastery.toLocaleString()}\` Mastery\n`;
    for (let i = 0; i < aiCount; i++) {
        membersList += `🤖 AI #${i + 1} • \`5,000\` Mastery\n`;
    }

    const startEmbed = new EmbedBuilder()
        .setColor('#DC2626')
        .setTitle('👑 BOSS DUNGEON')
        .setDescription(`
━━━━━━━━━━━━━━━━━━━━━━
📋 **THÀNH VIÊN** (10/10)
${membersList}
━━━━━━━━━━━━━━━━━━━━━━

🚶 Đang di chuyển đến Boss...
\`░░░░░░░░░░\` **0%**

⏱️ **Còn lại:** ${formatTime(clearResult.finalTime)}
🏁 **Xong lúc:** <t:${Math.floor(endTime.getTime() / 1000)}:T>
        `)
        .setFooter({ text: '🤖 Đi cùng 9 AI • ?huydung để hủy' })
        .setTimestamp();

    createDungeonSession(userId, 'boss10', members, aiCount, 1, endTime);

    await interaction.update({
        content: `<@${userId}> - Boss bắt đầu với AI!`,
        embeds: [startEmbed],
        components: []
    });

    scheduleBossPhases(interaction.channel, userId, clearResult.finalTime, members, true);
}

// ============== HELPER FUNCTIONS ==============

function formatTime(minutes) {
    if (minutes < 60) return `${minutes} phút`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours} giờ`;
}

function getActiveDungeon(userId) {
    // Kiểm tra nếu user là leader
    let session = economy.db.prepare(`
        SELECT * FROM dungeon_sessions 
        WHERE leader_id = ? AND status = 'in_progress'
        ORDER BY created_at DESC LIMIT 1
    `).get(userId);

    if (session) return session;

    // Kiểm tra nếu user là member trong party (coop5 hoặc boss10)
    const allSessions = economy.db.prepare(`
        SELECT * FROM dungeon_sessions 
        WHERE status = 'in_progress' AND (dungeon_type = 'coop5' OR dungeon_type = 'boss10')
        ORDER BY created_at DESC
    `).all();

    for (const s of allSessions) {
        const members = JSON.parse(s.members || '[]');
        if (members.some(m => m.id === userId)) {
            return s;
        }
    }

    return null;
}

function createDungeonSession(leaderId, type, members, aiCount, multiplier, endTime, event = null) {
    return economy.db.prepare(`
        INSERT INTO dungeon_sessions 
        (leader_id, dungeon_type, members, ai_count, multiplier, started_at, ends_at, event_trigger_at, event_type, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_progress')
    `).run(
        leaderId,
        type,
        JSON.stringify(members),
        aiCount,
        multiplier,
        new Date().toISOString(),
        endTime.toISOString(),
        event ? new Date(Date.now() + event.triggerAt * 60 * 1000).toISOString() : null,
        event ? event.type : null
    );
}

async function showActiveDungeon(message, session) {
    const endsAt = new Date(session.ends_at);
    const startedAt = new Date(session.started_at);
    const totalDuration = endsAt - startedAt;
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / (1000 * 60)));

    // Progress tổng (0-100%)
    const progress = Math.min(100, Math.floor((elapsed / totalDuration) * 100));

    // Xác định phase và progress bar
    let phaseText, phaseEmoji, barColor, phaseFilled;

    if (progress < 80) {
        phaseEmoji = '🚶';
        phaseText = 'Đang di chuyển đến Boss...';
        barColor = '#3B82F6';
        phaseFilled = Math.floor((progress / 80) * 10);
    } else {
        phaseEmoji = '⚔️';
        phaseText = '**ĐANG ĐÁNH BOSS!**';
        barColor = '#EF4444';
        phaseFilled = Math.floor(((progress - 80) / 20) * 10);
    }

    const progressBar = '█'.repeat(phaseFilled) + '░'.repeat(10 - phaseFilled);

    const dungeonNames = {
        solo: { name: '🗡️ Hang Động U Minh', icon: '🗡️' },
        coop5: { name: '🏰 Thành Cổ Ma Quái', icon: '👥' },
        boss10: { name: '👑 Lãnh Địa Ma Vương', icon: '👑' }
    };

    const dungeonInfo = dungeonNames[session.dungeon_type] || { name: session.dungeon_type, icon: '⚔️' };

    // Parse members từ session
    const members = JSON.parse(session.members || '[]');
    const aiCount = session.ai_count || 0;

    // Tạo party display cho coop
    let partyDisplay = '';
    if (session.dungeon_type === 'coop5' && members.length > 0) {
        const membersList = members.map(m => {
            const roleIcon = m.role === 'dps' ? '⚔️' : m.role === 'tanker' ? '🛡️' : m.role === 'healer' ? '💚' : '👤';
            const isLeader = m.id === session.leader_id;
            return `${roleIcon} <@${m.id}>${isLeader ? ' 👑' : ''}`;
        }).join('\n');

        const aiText = aiCount > 0 ? `\n🤖 AI: ${aiCount}` : '';
        partyDisplay = `\n━━━━━━━━━━━━━━━━━━━━━━\n📋 **THÀNH VIÊN** (${members.length}${aiCount > 0 ? `+${aiCount}AI` : ''}/5)\n${membersList}${aiText}\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    }

    const embed = new EmbedBuilder()
        .setColor(barColor)
        .setTitle(`⚔️ ĐANG TRONG BÍ CẢNH`)
        .setDescription(`
**${dungeonInfo.name}** x${session.multiplier}
${partyDisplay}
${phaseEmoji} ${phaseText}
\`${progressBar}\` **${progress}%**

⏱️ **Còn lại:** ${formatTime(remaining)}
🏁 **Xong lúc:** <t:${Math.floor(endsAt.getTime() / 1000)}:T>
        `)
        .setFooter({ text: progress < 80 ? '🚶 Đang trên đường... • ?huydung để hủy' : '⚔️ Boss fight!' })
        .setTimestamp();

    if (session.event_type && !session.event_triggered) {
        embed.addFields({
            name: `⚠️ CẢNH BÁO: ${session.event_type}`,
            value: '> Sự kiện có thể xảy ra và reset thời gian!',
            inline: false
        });
    }

    await message.reply({ embeds: [embed] });
}

/**
 * Xử lý dungeon đã hết hạn nhưng chưa được xử lý (do bot restart)
 */
async function handleExpiredDungeon(message, session) {
    const userId = message.author.id;

    // IMPORTANT: Fetch FRESH session from DB to get updated members list (after people left)
    const freshSession = economy.db.prepare(`
        SELECT * FROM dungeon_sessions WHERE id = ?
    `).get(session.id);

    if (!freshSession) {
        return message.reply('❌ Session dungeon không tồn tại hoặc đã bị hủy.');
    }

    const type = freshSession.dungeon_type;
    const sessionMembers = JSON.parse(freshSession.members || '[]');
    const hasAI = freshSession.ai_count > 0;

    // Get blessing fire status for display (wrapped in try-catch for safety)
    let blessingText = '';
    let blessingStatus = { active: false };
    try {
        blessingStatus = economy.getBlessingFireStatus(userId) || { active: false };
        if (blessingStatus && blessingStatus.active && blessingStatus.expiresAt) {
            const remaining = Math.ceil((blessingStatus.expiresAt - new Date()) / 1000 / 60);
            const hours = Math.floor(remaining / 60);
            const mins = remaining % 60;
            const timeText = hours > 0 ? `${hours}h${mins}p` : `${mins} phút`;
            const typeName = blessingStatus.type === 'lcpcl' ? 'Lửa Cầu Phúc Cỡ Lớn' : 'Lửa Cầu Phúc';
            blessingText = `\n🔥 **${typeName}** đang đốt! Còn **${timeText}**`;
        }
    } catch (e) { /* Ignore blessing fire errors */ }

    const dungeonType = dungeonSystem.DUNGEON_TYPES[type];
    const baseNhua = dungeonType?.baseNhua || 20;
    const nhuaInfo = economy.getCurrentNhua(userId);

    // Tính mức cao nhất có thể xả
    let maxAffordable = 0;
    if (nhuaInfo.current >= baseNhua * 3) maxAffordable = 3;
    else if (nhuaInfo.current >= baseNhua * 2) maxAffordable = 2;
    else if (nhuaInfo.current >= baseNhua) maxAffordable = 1;

    // Boss10: Auto-complete - use phase rewards
    if (type === 'boss10') {
        // Boss10 uses phase system, calculate combined Phase 1 + 2 rewards
        const phase1Rewards = dungeonSystem.calculateBossPhaseReward(1, hasAI);
        const phase2Rewards = dungeonSystem.calculateBossPhaseReward(2, hasAI);

        if (!phase1Rewards || !phase2Rewards) {
            // Fallback if rewards calculation fails
            economy.db.prepare(`UPDATE dungeon_sessions SET status = 'completed' WHERE id = ?`).run(session.id);
            return message.reply('❌ Lỗi tính thưởng Boss. Session đã được đánh dấu hoàn thành.');
        }

        // Combine rewards
        const rewards = {
            boxes: phase1Rewards.boxes + phase2Rewards.boxes,
            hat: phase1Rewards.hat + phase2Rewards.hat,
            thachAm: phase1Rewards.thachAm + phase2Rewards.thachAm,
            bonusBoxes: phase1Rewards.bonusBoxes + phase2Rewards.bonusBoxes
        };

        economy.db.prepare(`
            UPDATE dungeon_sessions SET status = 'completed', phase1_claimed = 1, phase2_claimed = 1
            WHERE id = ?
        `).run(freshSession.id);

        // Chỉ cho người chơi thật (filter ra AI members nếu có)
        const realMembers = sessionMembers.filter(m => m && m.id && !m.isAI);
        const leaderId = freshSession.leader_id || userId; // fallback to userId
        const allMembers = realMembers.length > 0 ? realMembers : [{ id: leaderId }];

        for (const member of allMembers) {
            if (!member.id) continue; // Skip nếu không có id
            economy.addHat(member.id, rewards.hat);
            if (rewards.thachAm > 0) economy.addThachAm(member.id, rewards.thachAm);
            economy.addBoxesT1(member.id, rewards.boxes);
            // Claim boss count - wrap in try-catch
            try { economy.claimBoss(member.id); } catch (e) { }

            // Quest progress for boss dungeon
            try {
                economy.updateProgress(member.id, 'boss_completed', 1);
                const { updateQuestProgress } = require('../../utils/questSystem');
                updateQuestProgress(member.id, 'boss_completed', 1);
            } catch (e) { /* ignore */ }
        }

        const memberMentions = allMembers.map(m => `<@${m.id}>`).join(' ');
        const embedColor = blessingStatus.active ? (blessingStatus.type === 'lcpcl' ? '#FF4500' : '#FFA07A') : '#22C55E';

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle('🎉 Boss Dungeon Hoàn Thành!')
            .setDescription(`Dungeon **${type}** đã hoàn thành!${blessingText}`)
            .addFields(
                { name: '📦 Hòm', value: `\`${rewards.boxes}\``, inline: true },
                { name: '🌾 Hạt', value: `\`${rewards.hat.toLocaleString()}\``, inline: true },
                { name: '🔮 Thạch Âm', value: `\`${rewards.thachAm}\``, inline: true }
            )
            .setFooter({ text: '💡 ?box để mở hòm • ?inv để xem kho' })
            .setTimestamp();

        return message.reply({ content: memberMentions, embeds: [embed] });
    }

    // COOP5 với thành viên thật hoặc Solo: Hiển thị UI chọn thưởng cho MỖI MEMBER
    // Lấy danh sách real members (không phải AI)
    const realMembers = sessionMembers.filter(m => m && m.id && !m.isAI);
    const membersToProcess = realMembers.length > 0 ? realMembers : [{ id: userId }];

    // Track quest "Đi Bí Cảnh" cho TẤT CẢ members
    try {
        const { updateQuestProgress, sendQuestNotifications } = require('../../utils/questSystem');
        for (const member of membersToProcess) {
            const completedQuests = updateQuestProgress(member.id, 'solo_completed', 1);
            if (completedQuests && completedQuests.length > 0) {
                await sendQuestNotifications(message.channel, member.id, completedQuests);
            }
        }
    } catch (e) { /* ignore */ }

    // Gửi UI cho mỗi member
    for (let i = 0; i < membersToProcess.length; i++) {
        const member = membersToProcess[i];
        const memberId = member.id;
        const memberIdx = i + 1;

        // Lấy thông tin nhựa của member này
        const memberNhuaInfo = economy.getCurrentNhua(memberId);
        const memberEco = economy.getOrCreateEconomy(memberId);
        const memberNhuaCung = memberEco.nhua_cung || 0;

        // Get member blessing status
        let memberBlessingStatus = { active: false };
        let memberBlessingText = '';
        try {
            memberBlessingStatus = economy.getBlessingFireStatus(memberId) || { active: false };
            if (memberBlessingStatus && memberBlessingStatus.active && memberBlessingStatus.expiresAt) {
                const remaining = Math.ceil((memberBlessingStatus.expiresAt - new Date()) / 1000 / 60);
                const hours = Math.floor(remaining / 60);
                const mins = remaining % 60;
                const timeText = hours > 0 ? `${hours}h${mins}p` : `${mins} phút`;
                const typeName = memberBlessingStatus.type === 'lcpcl' ? 'LCP Cỡ Lớn' : 'Lửa Cầu Phúc';
                memberBlessingText = `\n🔥 **${typeName}** đang đốt! Còn **${timeText}**`;
            }
        } catch (e) { }

        const memberEmbedColor = memberBlessingStatus.active ? (memberBlessingStatus.type === 'lcpcl' ? '#FF4500' : '#FFA07A') : '#22C55E';
        const memberEmbed = new EmbedBuilder()
            .setColor(memberEmbedColor)
            .setTitle(`🎉 Dungeon Hoàn Thành! [${memberIdx}/${membersToProcess.length}]`)
            .setDescription(`<@${memberId}> - Dungeon **${type}** đã hoàn thành!${memberBlessingText}\n\n**Chọn mức nhựa để nhận thưởng:**\n💧 Nhựa hiện có: ${memberNhuaInfo.current}/${memberNhuaInfo.max}`)
            .setFooter({ text: `Thành viên ${memberIdx}/${membersToProcess.length} • Chọn trong 60 giây` })
            .setTimestamp();

        // Row 1: Multiplier buttons for this member
        const memberRow1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`expired_0_${memberId}_${session.id}`)
                    .setLabel('Bỏ qua')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`expired_1_${memberId}_${session.id}`)
                    .setLabel(`x1 (${baseNhua} nhựa)`)
                    .setStyle(memberNhuaInfo.current >= baseNhua ? ButtonStyle.Primary : ButtonStyle.Secondary)
                    .setDisabled(memberNhuaInfo.current < baseNhua),
                new ButtonBuilder()
                    .setCustomId(`expired_2_${memberId}_${session.id}`)
                    .setLabel(`x2 (${baseNhua * 2} nhựa)`)
                    .setStyle(memberNhuaInfo.current >= baseNhua * 2 ? ButtonStyle.Primary : ButtonStyle.Secondary)
                    .setDisabled(memberNhuaInfo.current < baseNhua * 2),
                new ButtonBuilder()
                    .setCustomId(`expired_3_${memberId}_${session.id}`)
                    .setLabel(`x3 (${baseNhua * 3} nhựa)`)
                    .setStyle(memberNhuaInfo.current >= baseNhua * 3 ? ButtonStyle.Primary : ButtonStyle.Secondary)
                    .setDisabled(memberNhuaInfo.current < baseNhua * 3)
            );

        const memberComponents = [memberRow1];

        // Row 2: NC shortcuts for this member
        if (memberNhuaCung > 0) {
            const row2Buttons = [];
            for (let mult = 1; mult <= 3; mult++) {
                const targetNhua = baseNhua * mult;
                const ncNeeded = calcNhuaCungNeeded(memberNhuaInfo.current, targetNhua);
                if (ncNeeded > 0 && ncNeeded <= memberNhuaCung && memberNhuaInfo.current < targetNhua) {
                    row2Buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`expired_nc_${mult}_${ncNeeded}_${memberId}_${session.id}`)
                            .setLabel(`💊${ncNeeded} NC → x${mult}`)
                            .setStyle(ButtonStyle.Success)
                    );
                }
            }
            if (row2Buttons.length > 0) {
                memberComponents.push(new ActionRowBuilder().addComponents(row2Buttons));
            }
        }

        const memberReply = await message.channel.send({ content: `<@${memberId}>`, embeds: [memberEmbed], components: memberComponents });

        const memberCollector = memberReply.createMessageComponentCollector({
            filter: inter => inter.user.id === memberId && (inter.customId.startsWith('expired_') || inter.customId.startsWith('expired_nc_')),
            time: 60000
        });

        memberCollector.on('collect', async (interaction) => {
            const targetUserId = memberId; // Use the member's ID from the loop

            // Handle Nhựa Cứng shortcut buttons
            if (interaction.customId.startsWith('expired_nc_')) {
                const parts = interaction.customId.split('_');
                // Format: expired_nc_<mult>_<ncNeeded>_<userId>_<sessionId>
                const multiplier = parseInt(parts[2]);
                const ncNeeded = parseInt(parts[3]);
                const sessionId = parts[5];

                // Deduct Nhựa Cứng
                const subtractResult = economy.subtractNhuaCung(targetUserId, ncNeeded);
                if (!subtractResult.success) {
                    return interaction.reply({ content: `❌ ${subtractResult.message}`, ephemeral: true });
                }

                // Add stamina
                const currentNhuaInfo = economy.getCurrentNhua(targetUserId);
                const nhuaToAdd = ncNeeded * 60;
                const newNhua = Math.min(economy.MAX_NHUA, currentNhuaInfo.current + nhuaToAdd);
                economy.db.prepare('UPDATE economy SET nhua = ?, nhua_updated_at = ? WHERE discord_id = ?')
                    .run(newNhua, new Date().toISOString(), targetUserId);

                // Now consume stamina for the multiplier
                const nhuaCost = baseNhua * multiplier;
                const consumeResult = economy.consumeNhua(targetUserId, nhuaCost);
                if (!consumeResult.success) {
                    return interaction.reply({ content: `❌ ${consumeResult.message}`, ephemeral: true });
                }

                // Calculate and give rewards (same as normal flow)
                const rewards = dungeonSystem.calculateRewards(type, multiplier, hasAI, multiplier);

                economy.addHat(targetUserId, rewards.hat);
                if (rewards.thachAm > 0) economy.addThachAm(targetUserId, rewards.thachAm);
                economy.addBoxesT1(targetUserId, rewards.boxes);

                const successEmbed = new EmbedBuilder()
                    .setColor('#22C55E')
                    .setTitle('✅ Nhận Thưởng Thành Công!')
                    .setDescription(`<@${targetUserId}> - Đã dùng **${ncNeeded}** 💊 Nhựa Cứng và chọn **x${multiplier}**!

**💧 Tiêu hao:**
\`-${nhuaCost}\` Nhựa

**🎁 Phần thưởng:**
📦 \`+${rewards.boxes}\` Hòm T1
🌾 \`+${rewards.hat.toLocaleString()}\` Hạt${rewards.thachAm > 0 ? `\n🔮 \`+${rewards.thachAm}\` Thạch Âm ⭐` : ''}`)
                    .setFooter({ text: '💡 ?box để mở hòm • ?inv để xem kho' })
                    .setTimestamp();

                await interaction.update({ embeds: [successEmbed], components: [] });
                return memberCollector.stop();
            }

            // Normal button handling
            const [, multiplierStr, , sessionId] = interaction.customId.split('_');
            const multiplier = parseInt(multiplierStr);

            if (multiplier === 0) {
                await interaction.update({
                    content: `<@${targetUserId}> ⏭️ Đã bỏ qua dungeon.`,
                    embeds: [],
                    components: []
                });
                return memberCollector.stop();
            }

            const nhuaCost = baseNhua * multiplier;
            const consumeResult = economy.consumeNhua(targetUserId, nhuaCost);
            if (!consumeResult.success) {
                await interaction.reply({ content: `❌ ${consumeResult.message}`, ephemeral: true });
                return;
            }

            const rewards = dungeonSystem.calculateRewards(type, multiplier, hasAI, multiplier);

            economy.addHat(targetUserId, rewards.hat);
            if (rewards.thachAm > 0) economy.addThachAm(targetUserId, rewards.thachAm);
            economy.addBoxesT1(targetUserId, rewards.boxes);

            const successEmbed = new EmbedBuilder()
                .setColor('#22C55E')
                .setTitle('✅ Nhận Thưởng Thành Công!')
                .setDescription(`<@${targetUserId}> - Đã chọn **x${multiplier}** và nhận thưởng!

**💧 Tiêu hao:**
\`-${nhuaCost}\` Nhựa

**🎁 Phần thưởng:**
📦 \`+${rewards.boxes}\` Hòm T1
🌾 \`+${rewards.hat.toLocaleString()}\` Hạt${rewards.thachAm > 0 ? `\n🔮 \`+${rewards.thachAm}\` Thạch Âm ⭐` : ''}`)
                .setFooter({ text: '💡 ?box để mở hòm • ?inv để xem kho' })
                .setTimestamp();

            await interaction.update({ embeds: [successEmbed], components: [] });
            memberCollector.stop();
        });

        memberCollector.on('end', async (_, reason) => {
            if (reason === 'time') {
                // Lấy thông tin nhựa hiện tại của member
                const currentMemberNhua = economy.getCurrentNhua(memberId);
                let memberMaxAffordable = 0;
                if (currentMemberNhua.current >= baseNhua * 3) memberMaxAffordable = 3;
                else if (currentMemberNhua.current >= baseNhua * 2) memberMaxAffordable = 2;
                else if (currentMemberNhua.current >= baseNhua) memberMaxAffordable = 1;

                if (memberMaxAffordable > 0) {
                    const nhuaCost = baseNhua * memberMaxAffordable;
                    economy.consumeNhua(memberId, nhuaCost);
                    const rewards = dungeonSystem.calculateRewards(type, memberMaxAffordable, hasAI, memberMaxAffordable);

                    economy.addHat(memberId, rewards.hat);
                    if (rewards.thachAm > 0) economy.addThachAm(memberId, rewards.thachAm);
                    economy.addBoxesT1(memberId, rewards.boxes);

                    await memberReply.edit({
                        content: `<@${memberId}> ⏱️ Hết giờ! Đã tự động chọn **x${memberMaxAffordable}** và nhận thưởng: +${rewards.boxes} Box, +${rewards.hat} Hạt, -${nhuaCost} nhựa`,
                        embeds: [],
                        components: []
                    }).catch(() => { });
                } else {
                    await memberReply.edit({
                        content: `<@${memberId}> ⏱️ Hết giờ! Không đủ nhựa, dungeon đã bị bỏ qua.`,
                        embeds: [],
                        components: []
                    }).catch(() => { });
                }
            }
        });
    } // End of member loop
}

function scheduleDungeonChoice(channel, userId, type, delayMinutes, members = null) {
    // Trong production, nên dùng job scheduler như bull/agenda
    setTimeout(async () => {
        try {
            // Get session info
            const session = economy.db.prepare(`
                SELECT * FROM dungeon_sessions 
                WHERE leader_id = ? AND status = 'in_progress'
                ORDER BY created_at DESC LIMIT 1
            `).get(userId);

            if (!session) return;

            // Update to awaiting_choice
            economy.db.prepare(`
                UPDATE dungeon_sessions SET status = 'awaiting_choice'
                WHERE id = ?
            `).run(session.id);

            // Get dungeon info
            const dungeonType = dungeonSystem.DUNGEON_TYPES[type];
            const baseNhua = dungeonType?.baseNhua || 20;
            const nhuaInfo = economy.getCurrentNhua(userId);

            // ALWAYS get fresh members from session DB, ignore stale members param
            const sessionMembers = JSON.parse(session.members || '[]');
            const allMentions = sessionMembers.length > 0
                ? sessionMembers.map(m => `<@${m.id}>`).join(' ')
                : `<@${userId}>`;

            const membersList = sessionMembers.length > 1
                ? `\n👥 **Đội:** ${sessionMembers.map(m => `<@${m.id}>`).join(', ')}`
                : '';

            // Tính mức cao nhất có thể xả
            let maxAffordable = 0;
            if (nhuaInfo.current >= baseNhua * 3) maxAffordable = 3;
            else if (nhuaInfo.current >= baseNhua * 2) maxAffordable = 2;
            else if (nhuaInfo.current >= baseNhua) maxAffordable = 1;

            // Boss10 đặc biệt: Không chọn multiplier, tự động x1 và phát thưởng ngay
            if (type === 'boss10') {
                const multiplier = 1;
                const hasAI = session.ai_count > 0;
                const rewards = dungeonSystem.calculateRewards('boss10', multiplier, hasAI, multiplier);

                // Update session
                economy.db.prepare(`
                    UPDATE dungeon_sessions SET status = 'completed', multiplier = ?
                    WHERE id = ?
                `).run(multiplier, session.id);

                // Phát thưởng cho tất cả members
                const allMembers = sessionMembers.length > 0 ? sessionMembers : [{ id: userId }];
                for (const member of allMembers) {
                    economy.addHat(member.id, rewards.hat);
                    if (rewards.thachAm > 0) {
                        economy.addThachAm(member.id, rewards.thachAm);
                    }
                    economy.addBoxesT1(member.id, rewards.boxes);
                }

                const rewardEmbed = new EmbedBuilder()
                    .setColor('#DC2626')
                    .setTitle('🎉 BÍ CẢNH HOÀN THÀNH!')
                    .setDescription(`${allMentions} đã hoàn thành **boss10** x${multiplier}!`)
                    .addFields(
                        { name: '📦 Hòm T1', value: `\`${rewards.boxes}\``, inline: true },
                        { name: '🌾 Hạt', value: `\`${rewards.hat.toLocaleString()}\``, inline: true },
                        { name: '🔮 Thạch Âm', value: `\`${rewards.thachAm}\``, inline: true }
                    )
                    .addFields({
                        name: '💧 Nhựa tiêu',
                        value: `\`0\` (Miễn phí)`,
                        inline: true
                    })
                    .setFooter({ text: '💡 Dùng ?buy 1 để mở box • ?tuido để xem kho đồ' })
                    .setTimestamp();

                // Show box opening UI
                const { createBoxOpenUI } = require('../../utils/boxOpening');
                const eco = economy.getOrCreateEconomy(userId);
                const { embed: boxEmbed, row: boxRow } = createBoxOpenUI(userId, eco.boxes_t1 || 0);

                await channel.send({
                    content: allMentions,
                    embeds: [rewardEmbed],
                    components: []
                });

                // Send box UI separately if has boxes
                if (boxRow) {
                    await channel.send({
                        content: `<@${userId}>`,
                        embeds: [boxEmbed],
                        components: [boxRow]
                    });
                }

                return;
            }

            // ========== COOP5: Parallel choice - Mỗi người chọn riêng ==========
            if (type === 'coop5' && sessionMembers.length > 1) {
                const hasAI = session.ai_count > 0;

                // Track ai đã chọn
                const memberChoices = new Map();

                // Tạo danh sách nhựa mỗi người
                let memberNhuaList = '';
                const memberMaxAffordable = new Map();
                for (const m of sessionMembers) {
                    const mNhua = economy.getCurrentNhua(m.id);
                    let mMax = 0;
                    if (mNhua.current >= baseNhua * 3) mMax = 3;
                    else if (mNhua.current >= baseNhua * 2) mMax = 2;
                    else if (mNhua.current >= baseNhua) mMax = 1;
                    memberMaxAffordable.set(m.id, mMax);
                    memberNhuaList += `<@${m.id}>: ${mNhua.current}/${mNhua.max} (max x${mMax})\n`;
                }

                const coopEmbed = new EmbedBuilder()
                    .setColor('#F59E0B')
                    .setTitle('🎉 COOP5 Hoàn Thành!')
                    .setDescription(`
━━━━━━━━━━━━━━━━━━━━━━
**${type.toUpperCase()}** hoàn thành!
━━━━━━━━━━━━━━━━━━━━━━

**Mỗi người chọn số nhựa muốn xả:**
${memberNhuaList}
⏱️ *Hết 60s → auto chọn mức cao nhất*
                    `)
                    .addFields(
                        { name: '💧 Nhựa/lần', value: `x1=${baseNhua} | x2=${baseNhua * 2} | x3=${baseNhua * 3}`, inline: false }
                    )
                    .setFooter({ text: 'Mỗi người nhấn button để chọn • Auto sau 60s' })
                    .setTimestamp();

                // Buttons cho mọi người (không giới hạn user ID)
                const coopRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`coop5choice_0_${session.id}`)
                            .setLabel('Bỏ qua')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId(`coop5choice_1_${session.id}`)
                            .setLabel(`x1 (${baseNhua} nhựa)`)
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`coop5choice_2_${session.id}`)
                            .setLabel(`x2 (${baseNhua * 2} nhựa)`)
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`coop5choice_3_${session.id}`)
                            .setLabel(`x3 (${baseNhua * 3} nhựa)`)
                            .setStyle(ButtonStyle.Primary)
                    );

                const coopMsg = await channel.send({ content: allMentions, embeds: [coopEmbed], components: [coopRow] });

                // Collector cho tất cả members
                const coopCollector = coopMsg.createMessageComponentCollector({
                    filter: i => sessionMembers.some(m => m.id === i.user.id) && i.customId.startsWith('coop5choice_'),
                    time: 60000
                });

                coopCollector.on('collect', async (interaction) => {
                    const clickerId = interaction.user.id;

                    // Đã chọn rồi?
                    if (memberChoices.has(clickerId)) {
                        return interaction.reply({ content: '❌ Bạn đã chọn rồi!', ephemeral: true });
                    }

                    const [, multiplierStr] = interaction.customId.split('_');
                    const multiplier = parseInt(multiplierStr);
                    const nhuaCost = baseNhua * multiplier;

                    // Check đủ nhựa
                    const clickerNhua = economy.getCurrentNhua(clickerId);
                    if (multiplier > 0 && clickerNhua.current < nhuaCost) {
                        return interaction.reply({ content: `❌ Bạn không đủ nhựa! (Cần ${nhuaCost}, có ${clickerNhua.current})`, ephemeral: true });
                    }

                    // Ghi nhận lựa chọn
                    memberChoices.set(clickerId, multiplier);

                    // Xử lý thưởng
                    if (multiplier === 0) {
                        await interaction.reply({ content: `⏭️ <@${clickerId}> đã bỏ qua (không nhận thưởng).`, ephemeral: false });
                    } else {
                        // Tiêu nhựa và phát thưởng
                        economy.consumeNhua(clickerId, nhuaCost);
                        const rewards = dungeonSystem.calculateRewards(type, multiplier, hasAI, multiplier);
                        economy.addHat(clickerId, rewards.hat);
                        if (rewards.thachAm > 0) economy.addThachAm(clickerId, rewards.thachAm);
                        economy.addBoxesT1(clickerId, rewards.boxes);

                        // Quest progress for coop5
                        try {
                            economy.updateProgress(clickerId, 'coop_completed', 1);
                            const { updateQuestProgress } = require('../../utils/questSystem');
                            updateQuestProgress(clickerId, 'coop_completed', 1);
                        } catch (e) { /* ignore */ }

                        await interaction.reply({
                            content: `✅ <@${clickerId}> chọn **x${multiplier}**: +${rewards.boxes} Box, +${rewards.hat} Hạt, -${nhuaCost} nhựa`,
                            ephemeral: false
                        });
                    }

                    // Cập nhật footer
                    const remaining = sessionMembers.filter(m => !memberChoices.has(m.id));
                    if (remaining.length === 0) {
                        coopCollector.stop('all_chosen');
                    }
                });

                coopCollector.on('end', async (_, reason) => {
                    // Auto cho ai chưa chọn
                    const notChosen = sessionMembers.filter(m => !memberChoices.has(m.id));

                    for (const m of notChosen) {
                        const maxMult = memberMaxAffordable.get(m.id) || 0;
                        if (maxMult > 0) {
                            const nhuaCost = baseNhua * maxMult;
                            economy.consumeNhua(m.id, nhuaCost);
                            const rewards = dungeonSystem.calculateRewards(type, maxMult, hasAI, maxMult);
                            economy.addHat(m.id, rewards.hat);
                            if (rewards.thachAm > 0) economy.addThachAm(m.id, rewards.thachAm);
                            economy.addBoxesT1(m.id, rewards.boxes);
                            memberChoices.set(m.id, maxMult);

                            // Quest progress for auto-complete coop5
                            try {
                                economy.updateProgress(m.id, 'coop_completed', 1);
                                const { updateQuestProgress } = require('../../utils/questSystem');
                                updateQuestProgress(m.id, 'coop_completed', 1);
                            } catch (e) { /* ignore */ }
                        } else {
                            memberChoices.set(m.id, 0); // Bỏ qua
                        }
                    }

                    // Update session
                    economy.db.prepare(`
                        UPDATE dungeon_sessions SET status = 'completed'
                        WHERE id = ?
                    `).run(session.id);

                    // Tạo summary
                    let summary = '';
                    for (const [mId, mult] of memberChoices) {
                        const autoTag = notChosen.some(n => n.id === mId) ? ' *(auto)*' : '';
                        summary += `<@${mId}>: x${mult}${autoTag}\n`;
                    }

                    const finalEmbed = new EmbedBuilder()
                        .setColor('#10B981')
                        .setTitle('✅ COOP5 Kết Thúc!')
                        .setDescription(`**Kết quả lựa chọn:**\n${summary}`)
                        .setFooter({ text: '💡 ?box để mở hòm • ?inv để xem kho' })
                        .setTimestamp();

                    await coopMsg.edit({ embeds: [finalEmbed], components: [] });
                });

                return;
            }

            // ========== SOLO: Leader chọn ==========
            const embed = new EmbedBuilder()
                .setColor('#22C55E')
                .setTitle('🎉 Dungeon Hoàn Thành!')
                .setDescription(`Đội đã hoàn thành dungeon **${type}**!${membersList}\n\n**<@${userId}>** chọn mức nhựa để nhận thưởng:\n${maxAffordable > 0 ? `⏱️ *Hết 60s sẽ tự động chọn x${maxAffordable}*` : '⚠️ *Không đủ nhựa, sẽ tự bỏ qua*'}`)
                .addFields(
                    { name: '💧 Nhựa hiện có', value: `${nhuaInfo.current}/${nhuaInfo.max}`, inline: true }
                )
                .setFooter({ text: 'Chọn trong 60 giây • Hết giờ = auto chọn cao nhất' })
                .setTimestamp();

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`dungchoice_0_${userId}_${session.id}`)
                        .setLabel('Bỏ qua')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`dungchoice_1_${userId}_${session.id}`)
                        .setLabel(`x1 (${baseNhua} nhựa)`)
                        .setStyle(nhuaInfo.current >= baseNhua ? ButtonStyle.Primary : ButtonStyle.Secondary)
                        .setDisabled(nhuaInfo.current < baseNhua),
                    new ButtonBuilder()
                        .setCustomId(`dungchoice_2_${userId}_${session.id}`)
                        .setLabel(`x2 (${baseNhua * 2} nhựa)`)
                        .setStyle(nhuaInfo.current >= baseNhua * 2 ? ButtonStyle.Primary : ButtonStyle.Secondary)
                        .setDisabled(nhuaInfo.current < baseNhua * 2),
                    new ButtonBuilder()
                        .setCustomId(`dungchoice_3_${userId}_${session.id}`)
                        .setLabel(`x3 (${baseNhua * 3} nhựa)`)
                        .setStyle(nhuaInfo.current >= baseNhua * 3 ? ButtonStyle.Primary : ButtonStyle.Secondary)
                        .setDisabled(nhuaInfo.current < baseNhua * 3)
                );

            const msg = await channel.send({ content: allMentions, embeds: [embed], components: [row] });

            // Collector
            const collector = msg.createMessageComponentCollector({
                filter: i => i.user.id === userId && i.customId.startsWith('dungchoice_'),
                time: 60000
            });

            collector.on('collect', async (interaction) => {
                const [, multiplierStr, , sessionId] = interaction.customId.split('_');
                const multiplier = parseInt(multiplierStr);

                // Handle x0 - bỏ qua
                if (multiplier === 0) {
                    economy.db.prepare(`
                        UPDATE dungeon_sessions SET status = 'skipped', multiplier = 0
                        WHERE id = ?
                    `).run(sessionId);

                    await interaction.update({
                        content: `⏭️ <@${userId}> đã bỏ qua dungeon (không xả nhựa, không nhận thưởng).`,
                        embeds: [],
                        components: []
                    });
                    return collector.stop();
                }

                const nhuaCost = baseNhua * multiplier;

                // Tiêu nhựa
                const consumeResult = economy.consumeNhua(userId, nhuaCost);
                if (!consumeResult.success) {
                    await interaction.reply({ content: `❌ ${consumeResult.message}`, ephemeral: true });
                    return;
                }

                // Tính rewards
                const hasAI = session.ai_count > 0;
                const rewards = dungeonSystem.calculateRewards(type, multiplier, hasAI, multiplier);

                // Update session
                economy.db.prepare(`
                    UPDATE dungeon_sessions SET status = 'completed', multiplier = ?
                    WHERE id = ?
                `).run(multiplier, sessionId);

                // Phát thưởng cho tất cả members trong party
                const isCoop = type === 'coop5' && sessionMembers.length > 1;
                const allRewardMembers = isCoop ? sessionMembers : [{ id: userId }];

                for (const member of allRewardMembers) {
                    economy.addHat(member.id, rewards.hat);
                    if (rewards.thachAm > 0) {
                        economy.addThachAm(member.id, rewards.thachAm);
                    }
                    economy.addBoxesT1(member.id, rewards.boxes);
                }

                // Tạo danh sách members đã nhận thưởng
                const memberRewardList = allRewardMembers.map(m => `<@${m.id}>`).join(', ');

                const rewardEmbed = new EmbedBuilder()
                    .setColor('#10B981')
                    .setTitle('🎉 BÍ CẢNH HOÀN THÀNH!')
                    .setDescription(`
━━━━━━━━━━━━━━━━━━━━━━
**${type.toUpperCase()}** x${multiplier} hoàn thành!
━━━━━━━━━━━━━━━━━━━━━━

👥 **Thành viên nhận thưởng:**
${memberRewardList}
                    `)
                    .addFields(
                        { name: '📦 Hòm T1', value: `\`${rewards.boxes}\`/người`, inline: true },
                        { name: '🌾 Hạt', value: `\`${rewards.hat.toLocaleString()}\`/người`, inline: true },
                        { name: '🔮 Thạch Âm', value: `\`${rewards.thachAm}\`/người`, inline: true }
                    )
                    .addFields(
                        { name: '💧 Nhựa tiêu', value: `\`${nhuaCost}\` (bởi <@${userId}>)`, inline: false }
                    )
                    .setFooter({ text: '💡 ?box để mở hòm • ?inv để xem kho' })
                    .setTimestamp();

                // Quest progress for dungeon
                try {
                    for (const member of allRewardMembers) {
                        economy.updateProgress(member.id, 'coop_completed', 1);
                        const { updateQuestProgress, sendQuestNotifications } = require('../../utils/questSystem');
                        const completedQuests = updateQuestProgress(member.id, 'coop_completed', 1);
                        if (completedQuests && completedQuests.length > 0) {
                            await sendQuestNotifications(interaction.channel, member.id, completedQuests);
                        }
                    }
                } catch (e) { console.error('Quest progress error:', e); }

                await interaction.update({ embeds: [rewardEmbed], components: [] });

                collector.stop();
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    // Auto-select mức cao nhất có thể xả
                    if (maxAffordable > 0) {
                        const autoMultiplier = maxAffordable;
                        const autoNhuaCost = baseNhua * autoMultiplier;

                        const consumeResult = economy.consumeNhua(userId, autoNhuaCost);
                        if (consumeResult.success) {
                            const hasAI = session.ai_count > 0;
                            const rewards = dungeonSystem.calculateRewards(type, autoMultiplier, hasAI, autoMultiplier);

                            economy.db.prepare(`
                                UPDATE dungeon_sessions SET status = 'completed', multiplier = ?
                                WHERE id = ?
                            `).run(autoMultiplier, session.id);

                            // Phát thưởng cho tất cả members
                            const isCoop = type === 'coop5' && sessionMembers.length > 1;
                            const allRewardMembers = isCoop ? sessionMembers : [{ id: userId }];

                            for (const member of allRewardMembers) {
                                economy.addHat(member.id, rewards.hat);
                                if (rewards.thachAm > 0) {
                                    economy.addThachAm(member.id, rewards.thachAm);
                                }
                                economy.addBoxesT1(member.id, rewards.boxes);
                            }

                            // Quest progress for auto-complete dungeon
                            try {
                                const { updateQuestProgress } = require('../../utils/questSystem');
                                for (const member of allRewardMembers) {
                                    economy.updateProgress(member.id, 'coop_completed', 1);
                                    updateQuestProgress(member.id, 'coop_completed', 1);
                                }
                            } catch (e) { console.error('Quest progress error:', e); }

                            const memberRewardList = allRewardMembers.map(m => `<@${m.id}>`).join(', ');

                            const autoEmbed = new EmbedBuilder()
                                .setColor('#F59E0B')
                                .setTitle('⏱️ Tự động xả nhựa!')
                                .setDescription(`<@${userId}> không chọn trong 60 giây.\n**Đã tự động chọn x${autoMultiplier}!**\n\n👥 **Thành viên nhận thưởng:**\n${memberRewardList}`)
                                .addFields(
                                    { name: '📦 Hòm T1', value: `\`${rewards.boxes}\`/người`, inline: true },
                                    { name: '💰 Hạt', value: `\`${rewards.hat.toLocaleString()}\`/người`, inline: true },
                                    { name: '💧 Nhựa tiêu', value: `\`${autoNhuaCost}\``, inline: true }
                                )
                                .setFooter({ text: '💡 ?box để mở hòm • ?inv để xem kho' })
                                .setTimestamp();

                            await msg.edit({ embeds: [autoEmbed], components: [] });
                        }
                    } else {
                        // Không đủ nhựa - skip
                        economy.db.prepare(`
                            UPDATE dungeon_sessions SET status = 'skipped', multiplier = 0
                            WHERE id = ?
                        `).run(session.id);

                        await msg.edit({
                            content: `⏱️ <@${userId}> không đủ nhựa và không chọn. Dungeon đã bỏ qua.`,
                            embeds: [],
                            components: []
                        });
                    }
                }
            });

        } catch (e) {
            console.error('Dungeon choice error:', e);
        }
    }, delayMinutes * 60 * 1000);
}

function scheduleEventTrigger(channel, userId, event, totalMinutes) {
    // Schedule event trigger
    setTimeout(async () => {
        try {
            const session = getActiveDungeon(userId);
            if (!session || session.event_triggered) return;

            // Mark event as triggered
            economy.db.prepare(`
                UPDATE dungeon_sessions SET event_triggered = 1, ends_at = ?
                WHERE id = ?
            `).run(
                new Date(Date.now() + totalMinutes * 60 * 1000).toISOString(),
                session.id
            );

            // Send event message
            const members = JSON.parse(session.members || '[]');
            const mentions = members.map(m => `<@${m.id}>`).join(' ');

            await channel.send({
                content: `${mentions}\n\n${event.message}\n\n⏱️ **Thời gian đã reset!** Còn ${formatTime(totalMinutes)} nữa...`
            });

        } catch (e) {
            console.error('Event trigger error:', e);
        }
    }, event.triggerAt * 60 * 1000);
}

/**
 * Schedule phát thưởng Boss 10 theo 2 phase
 * Phase 1: 50% tiến độ - phát thưởng P1
 * Phase 2: 100% tiến độ - phát thưởng P2
 */
function scheduleBossPhases(channel, userId, totalMinutes, members, hasAI) {
    // Phase 1 at 50% time, Phase 2 at 100% - keep decimal for short test durations
    const phase1Time = totalMinutes * 0.5; // 50% (không dùng Math.floor để giữ decimal)
    const phase2Time = totalMinutes; // 100%

    const allMentions = members.map(m => `<@${m.id}>`).join(' ');

    // ========== PHASE 1 - 50% ==========
    setTimeout(async () => {
        try {
            const session = getActiveDungeon(userId);
            if (!session || session.status !== 'in_progress') return;

            // Tính thưởng Phase 1
            const rewards = dungeonSystem.calculateBossPhaseReward(1, hasAI);
            if (!rewards) return;

            // Phát thưởng cho tất cả members và claim boss count
            for (const member of members) {
                economy.addHat(member.id, rewards.hat);
                economy.addThachAm(member.id, rewards.thachAm);
                economy.addBoxesT1(member.id, rewards.boxes);
                economy.claimBoss(member.id); // Claim 1 boss count khi nhận Phase 1

                // Quest progress for boss phase 1
                try {
                    economy.updateProgress(member.id, 'solo_completed', 1); // All dungeons count as "Đi Bí Cảnh"
                    const { updateQuestProgress } = require('../../utils/questSystem');
                    updateQuestProgress(member.id, 'solo_completed', 1);
                } catch (e) { /* ignore */ }
            }

            // Update session - đánh dấu đã nhận phase 1
            economy.db.prepare(`
                UPDATE dungeon_sessions SET phase1_claimed = 1
                WHERE id = ?
            `).run(session.id);

            // Bonus text
            const bonusText = rewards.bonusBoxes > 0
                ? `\n🎰 **BONUS!** +${rewards.bonusBoxes} Box`
                : '';

            const phaseEmbed = new EmbedBuilder()
                .setColor('#F59E0B')
                .setTitle('⚔️ PHASE 1 HOÀN THÀNH!')
                .setDescription(`
━━━━━━━━━━━━━━━━━━━━━━
${allMentions} đã vượt qua **50%** Boss!
━━━━━━━━━━━━━━━━━━━━━━

🎁 **Phần thưởng Phase 1:**${bonusText}
                `)
                .addFields(
                    { name: '📦 Hòm T1', value: `\`${rewards.boxes}\``, inline: true },
                    { name: '🌾 Hạt', value: `\`${rewards.hat.toLocaleString()}\``, inline: true },
                    { name: '🔮 Thạch Âm', value: `\`${rewards.thachAm}\``, inline: true }
                )
                .setFooter({ text: '⏳ Phase 2 đang tiếp tục... • ?huydung để rời (mất Phase 2)' })
                .setTimestamp();

            await channel.send({ content: allMentions, embeds: [phaseEmbed] });

        } catch (e) {
            console.error('Boss Phase 1 error:', e);
        }
    }, phase1Time * 60 * 1000);

    // ========== PHASE 2 - 100% ==========
    setTimeout(async () => {
        try {
            const session = economy.db.prepare(`
                SELECT * FROM dungeon_sessions 
                WHERE leader_id = ? AND dungeon_type = 'boss10' AND status = 'in_progress'
                ORDER BY created_at DESC LIMIT 1
            `).get(userId);

            if (!session) return;

            // Lấy members còn lại (những ai chưa rời)
            const remainingMembers = JSON.parse(session.members || '[]');
            if (remainingMembers.length === 0) return;

            // Tính thưởng Phase 2
            const rewards = dungeonSystem.calculateBossPhaseReward(2, hasAI);
            if (!rewards) return;

            // Phát thưởng cho members còn lại
            for (const member of remainingMembers) {
                economy.addHat(member.id, rewards.hat);
                economy.addThachAm(member.id, rewards.thachAm);
                economy.addBoxesT1(member.id, rewards.boxes);

                // Note: boss_completed quest already tracked in Phase 1, không track lại
            }

            // Update session hoàn thành
            economy.db.prepare(`
                UPDATE dungeon_sessions SET status = 'completed', phase2_claimed = 1
                WHERE id = ?
            `).run(session.id);

            const remainingMentions = remainingMembers.map(m => `<@${m.id}>`).join(' ');

            // Bonus text
            const bonusText = rewards.bonusBoxes > 0
                ? `\n🎰 **BONUS!** +${rewards.bonusBoxes} Box`
                : '';

            const finalEmbed = new EmbedBuilder()
                .setColor('#10B981')
                .setTitle('🎉 BOSS HOÀN THÀNH!')
                .setDescription(`
━━━━━━━━━━━━━━━━━━━━━━
${remainingMentions} đã đánh bại **Boss 10**!
━━━━━━━━━━━━━━━━━━━━━━

🎁 **Phần thưởng Phase 2:**${bonusText}
                `)
                .addFields(
                    { name: '📦 Hòm T1', value: `\`${rewards.boxes}\``, inline: true },
                    { name: '🌾 Hạt', value: `\`${rewards.hat.toLocaleString()}\``, inline: true },
                    { name: '🔮 Thạch Âm', value: `\`${rewards.thachAm}\``, inline: true }
                )
                .addFields({
                    name: '📊 Tổng cộng (2 Phase)',
                    value: `📦 \`50\` Box • 🌾 \`5,000\` Hạt • 🔮 \`2\` Thạch Âm`,
                    inline: false
                })
                .setFooter({ text: '💡 ?box để mở hòm • ?inv để xem kho' })
                .setTimestamp();

            await channel.send({ content: remainingMentions, embeds: [finalEmbed] });

            // Show box opening UI cho leader
            const { createBoxOpenUI } = require('../../utils/boxOpening');
            const eco = economy.getOrCreateEconomy(userId);
            const { embed: boxEmbed, row: boxRow } = createBoxOpenUI(userId, eco.boxes_t1 || 0);

            if (boxRow) {
                await channel.send({
                    content: `<@${userId}>`,
                    embeds: [boxEmbed],
                    components: [boxRow]
                });
            }

        } catch (e) {
            console.error('Boss Phase 2 error:', e);
        }
    }, phase2Time * 60 * 1000);
}



