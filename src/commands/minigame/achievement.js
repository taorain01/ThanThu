/**
 * ?thanhtuu, ?achievements - Xem thành tựu
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const economyDb = require('../../database/economy');
const { ACHIEVEMENTS, getPlayerAchievements, getAchievementStats, getPlayerProgress } = require('../../utils/achievementSystem');

const ITEMS_PER_PAGE = 10;

async function execute(message, args) {
    const userId = message.author.id;
    const page = parseInt(args[0]) || 1;

    const unlockedIds = getPlayerAchievements(userId);
    const progress = getPlayerProgress(userId);
    const stats = getAchievementStats(userId);

    const totalPages = Math.ceil(ACHIEVEMENTS.length / ITEMS_PER_PAGE);
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;

    const pageAchievements = ACHIEVEMENTS.slice(startIndex, endIndex);

    // Define achievement groups
    const groups = [
        { name: '🌱 Mới Bắt Đầu', range: [1, 5] },
        { name: '⛏️ Farming T1', range: [6, 10] },
        { name: '⚔️ Dungeon', range: [11, 15] },
        { name: '⚙️ Tune T1', range: [16, 20] },
        { name: '🎒 Trang Bị T1', range: [21, 25] },
        { name: '🏆 Mastery T1', range: [26, 30] },
        { name: '🌑 Đá Đen & Truyền Dòng', range: [31, 35] },
        { name: '📦 Kho Đồ', range: [36, 40] }
    ];

    let description = '';
    let currentGroup = null;

    for (const a of pageAchievements) {
        // Check if we need to add a group header
        const group = groups.find(g => a.id >= g.range[0] && a.id <= g.range[1]);
        if (group && group !== currentGroup) {
            if (currentGroup !== null) {
                description += '\n─────────────────\n\n';
            }
            description += `**${group.name}**\n\n`;
            currentGroup = group;
        }

        const unlocked = unlockedIds.includes(a.id);
        const icon = unlocked ? '✅' : '⬜';
        const rewardText = formatReward(a.reward);
        const currentProgress = getProgressValue(a.type, progress, userId);
        const progressText = unlocked ? '' : ` \`(${currentProgress}/${a.target})\``;
        description += `${icon} **${a.id}.** ${a.name}${progressText}\n└ ${a.desc} → ${rewardText}\n\n`;
    }

    const embed = new EmbedBuilder()
        .setColor(0xEAB308)
        .setTitle(`🏆 THÀNH TỰU TIER 1`)
        .setDescription(description.trim())
        .addFields({
            name: '📊 Tiến độ',
            value: `**${stats.unlocked}/${stats.total}** (${stats.percentage}%)`,
            inline: true
        })
        .setFooter({ text: `Trang ${currentPage}/${totalPages} • ?thanhtuu <số trang>` })
        .setTimestamp();

    // Navigation buttons if more than 1 page
    if (totalPages > 1) {
        const buttons = [];
        if (currentPage > 1) {
            buttons.push(
                new ButtonBuilder()
                    .setCustomId(`ach_prev_${userId}_${currentPage}`)
                    .setLabel('◀️ Trước')
                    .setStyle(ButtonStyle.Secondary)
            );
        }
        if (currentPage < totalPages) {
            buttons.push(
                new ButtonBuilder()
                    .setCustomId(`ach_next_${userId}_${currentPage}`)
                    .setLabel('Sau ▶️')
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        const row = new ActionRowBuilder().addComponents(buttons);

        const reply = await message.reply({ embeds: [embed], components: [row] });

        // Setup collector for pagination
        const collector = reply.createMessageComponentCollector({
            filter: (i) => i.user.id === userId,
            time: 60000
        });

        collector.on('collect', async (interaction) => {
            try {
                const [, action, , pageStr] = interaction.customId.split('_');
                const oldPage = parseInt(pageStr);
                const newPage = action === 'prev' ? oldPage - 1 : oldPage + 1;

                if (newPage < 1 || newPage > totalPages) {
                    return interaction.deferUpdate();
                }

                const newStartIndex = (newPage - 1) * ITEMS_PER_PAGE;
                const newEndIndex = newStartIndex + ITEMS_PER_PAGE;
                const newPageAchievements = ACHIEVEMENTS.slice(newStartIndex, newEndIndex);

                // Define achievement groups
                const groups = [
                    { name: '🌱 Mới Bắt Đầu', range: [1, 5] },
                    { name: '⛏️ Farming T1', range: [6, 10] },
                    { name: '⚔️ Dungeon', range: [11, 15] },
                    { name: '⚙️ Tune T1', range: [16, 20] },
                    { name: '🎒 Trang Bị T1', range: [21, 25] },
                    { name: '🏆 Mastery T1', range: [26, 30] },
                    { name: '🌑 Đá Đen & Truyền Dòng', range: [31, 35] },
                    { name: '📦 Kho Đồ', range: [36, 40] }
                ];

                let newDescription = '';
                let currentGroup = null;

                for (const a of newPageAchievements) {
                    // Check if we need to add a group header
                    const group = groups.find(g => a.id >= g.range[0] && a.id <= g.range[1]);
                    if (group && group !== currentGroup) {
                        if (currentGroup !== null) {
                            newDescription += '\n─────────────────\n\n';
                        }
                        newDescription += `**${group.name}**\n\n`;
                        currentGroup = group;
                    }

                    const unlocked = unlockedIds.includes(a.id);
                    const icon = unlocked ? '✅' : '⬜';
                    const rewardText = formatReward(a.reward);
                    const currentProgress = getProgressValue(a.type, progress, userId);
                    const progressText = unlocked ? '' : ` \`(${currentProgress}/${a.target})\``;
                    newDescription += `${icon} **${a.id}.** ${a.name}${progressText}\n└ ${a.desc} → ${rewardText}\n\n`;
                }

                const newEmbed = new EmbedBuilder()
                    .setColor(0xEAB308)
                    .setTitle(`🏆 THÀNH TỰU TIER 1`)
                    .setDescription(newDescription.trim())
                    .addFields({
                        name: '📊 Tiến độ',
                        value: `**${stats.unlocked}/${stats.total}** (${stats.percentage}%)`,
                        inline: true
                    })
                    .setFooter({ text: `Trang ${newPage}/${totalPages} • ?thanhtuu <số trang>` })
                    .setTimestamp();

                // Only show buttons that are needed
                const buttons = [];
                if (newPage > 1) {
                    buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`ach_prev_${userId}_${newPage}`)
                            .setLabel('◀️ Trước')
                            .setStyle(ButtonStyle.Secondary)
                    );
                }
                if (newPage < totalPages) {
                    buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`ach_next_${userId}_${newPage}`)
                            .setLabel('Sau ▶️')
                            .setStyle(ButtonStyle.Secondary)
                    );
                }

                const newRow = buttons.length > 0 ? new ActionRowBuilder().addComponents(buttons) : null;

                await interaction.update({
                    embeds: [newEmbed],
                    components: newRow ? [newRow] : []
                });
            } catch (error) {
                if (error.code === 10062 || error.code === 40060) {
                    try { await reply.edit({ components: [] }); } catch (e) { }
                } else {
                    console.error('[achievement] Lỗi xử lý nút:', error.message);
                }
            }
        });

        collector.on('end', async () => {
            try {
                await reply.edit({ components: [] });
            } catch (e) { }
        });
    } else {
        await message.reply({ embeds: [embed] });
    }
}

function formatReward(reward) {
    const parts = [];
    if (reward.hat) parts.push(`🌾${reward.hat.toLocaleString()}`);
    if (reward.thachAm) parts.push(`🔮${reward.thachAm}`);
    if (reward.daT1) parts.push(`💎${reward.daT1}`);
    if (reward.boxes) parts.push(`📦${reward.boxes}`);
    if (reward.title) parts.push(`🏷️"${reward.title}"`);
    return parts.join(' ') || '?';
}

// Get current progress value for achievement type
function getProgressValue(type, progress, userId) {
    const economy = require('../../database/economy');
    switch (type) {
        case 'boxes_opened': return progress.boxes_opened || 0;
        case 'solo_completed': return progress.solo_completed || 0;
        case 'coop_completed': return progress.coop_completed || 0;
        case 'boss_completed': return progress.boss_completed || 0;
        case 'tune_count': return progress.tune_count || 0;
        case 'transfer_success': return progress.transfer_success || 0;
        case 'daden_used': return progress.daden_used || 0;
        case 'items_equipped': return economy.getEquippedItems(userId).length || 0;
        case 'gold_owned': return economy.countUserGoldItems(userId) || 0;
        case 'hat_owned': return economy.getOrCreateEconomy(userId).hat || 0;
        case 'inv_slots': return economy.getInvSlots(userId) || 500;
        case 'equipment_count': return economy.countUserEquipment(userId) || 0;
        case 'slot_purchased': return economy.getSlotPurchaseCount?.(userId) || 0;
        case 'slots_filled': return economy.getEquippedItems(userId).length || 0;
        default: return progress[type] || 0;
    }
}

module.exports = { execute };


