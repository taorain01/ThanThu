/**
 * ?nv, ?q, ?quest, ?nhiemvu - Xem nhiệm vụ ngày/tuần
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const economyDb = require('../../database/economy');
const questSystem = require('../../utils/questSystem');

async function execute(message, args) {
    const userId = message.author.id;

    // Lấy nhiệm vụ
    const dailyResult = questSystem.getOrGenerateDailyQuests(userId);
    const weeklyResult = questSystem.getOrGenerateWeeklyQuests(userId);

    const dailyQuests = dailyResult.quests || dailyResult;
    const weeklyQuests = weeklyResult.quests || weeklyResult;

    // Send notifications for auto-completed quests
    const allSyncedQuests = [...(dailyResult.syncedQuests || []), ...(weeklyResult.syncedQuests || [])];
    if (allSyncedQuests.length > 0) {
        await questSystem.sendQuestNotifications(message.channel, userId, allSyncedQuests);
    }

    // Build embed
    const embed = new EmbedBuilder()
        .setColor(0xF59E0B)
        .setTitle('📋 NHIỆM VỤ')
        .setDescription('💫 Hoàn thành nhiệm vụ → **Tự động nhận thưởng!**')
        .setTimestamp();

    // Daily quests
    let dailyText = '';
    for (let i = 0; i < dailyQuests.length; i++) {
        const q = dailyQuests[i];
        const status = q.claimed ? '✅' : '⬜';
        const progress = `${q.progress}/${q.target}`;
        const rewardDetail = formatExactReward(q.exactReward || {});

        dailyText += `${status} **${i + 1}.** ${q.name}\n`;
        dailyText += `   └ **Tiến độ:** ${progress} | **Thưởng:** ${rewardDetail}\n`;

        if (i < dailyQuests.length - 1) {
            dailyText += '\n';
        }
    }

    embed.addFields({
        name: '☀️ Nhiệm Vụ Ngày',
        value: dailyText || 'Không có',
        inline: false
    });

    // Separator
    embed.addFields({
        name: '\u200b',
        value: '─────────────────────────',
        inline: false
    });

    // Weekly quests
    let weeklyText = '';
    for (let i = 0; i < weeklyQuests.length; i++) {
        const q = weeklyQuests[i];
        const status = q.claimed ? '✅' : '⬜';
        const progress = `${q.progress}/${q.target}`;
        const rewardDetail = formatExactReward(q.exactReward || {});

        weeklyText += `${status} **NV${i + 1}.** ${q.name}\n`;
        weeklyText += `   └ **Tiến độ:** ${progress} | **Thưởng:** ${rewardDetail}\n`;

        if (i < weeklyQuests.length - 1) {
            weeklyText += '\n';
        }
    }

    embed.addFields({
        name: '🌙 Nhiệm Vụ Tuần',
        value: weeklyText || 'Không có',
        inline: false
    });

    // Separator
    embed.addFields({
        name: '\u200b',
        value: '─────────────────────────',
        inline: false
    });

    // Legend
    embed.addFields({
        name: '📖 Chú thích',
        value: '⬜ Đang làm • ✅ Hoàn thành\n💡 Phần thưởng **tự động nhận** khi đạt mục tiêu!',
        inline: false
    });

    embed.setFooter({ text: '💰 Phần thưởng ngày random mỗi slot!' });

    await message.reply({ embeds: [embed] });
}

function formatExactReward(reward) {
    const parts = [];
    if (reward.hat) parts.push(`🌾 ${reward.hat.toLocaleString()} Hạt`);
    if (reward.thachAm) parts.push(`🔮 ${reward.thachAm} Thạch Âm`);
    if (reward.daT1) parts.push(`💎 ${reward.daT1} Đá T1`);
    if (reward.boxes) parts.push(`📦 ${reward.boxes} Box T1`);
    if (reward.nhuaCung) parts.push(`💊 ${reward.nhuaCung} Nhựa Cứng`);
    if (reward.daT1KhacAn) parts.push(`💠 ${reward.daT1KhacAn} Đá T1 Khắc Ấn`);
    if (reward.thachAmKhacAn) parts.push(`🔷 ${reward.thachAmKhacAn} Thạch Âm Khắc Ấn`);
    return parts.join(' • ') || '?';
}

function getSlotIcon(slot) {
    switch (slot) {
        case 1: return '🌾';
        case 2: return '🌾+🔮';
        case 3: return '🌾+💎';
        case 4: return '🌾🌾';
        case 5: return '📦';
        default: return '?';
    }
}

async function handleClaim(message, indexStr, dailyQuests, weeklyQuests) {
    const userId = message.author.id;
    const index = parseInt(indexStr) - 1;

    // Try daily first
    if (index >= 0 && index < dailyQuests.length) {
        const result = questSystem.claimQuestReward(userId, index, true);

        if (!result.success) {
            return message.reply(`❌ ${result.message}`);
        }

        // Give rewards
        const rewards = result.rewards;
        if (rewards.hat) economyDb.addHat(userId, rewards.hat);
        if (rewards.thachAm) economyDb.addThachAm(userId, rewards.thachAm);
        if (rewards.daT1) economyDb.addEnhancementStoneT1(userId, rewards.daT1);
        if (rewards.boxes) economyDb.addBoxesT1(userId, rewards.boxes);

        const rewardText = formatRewards(rewards);

        const embed = new EmbedBuilder()
            .setColor(0x22C55E)
            .setTitle('🎁 Nhận Thưởng NV Ngày!')
            .setDescription(`**${result.quest.name}**\n\n${rewardText}`)
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    return message.reply('❌ Số nhiệm vụ không hợp lệ!');
}

function formatRewards(rewards) {
    const parts = [];
    if (rewards.hat) parts.push(`🌾 **${rewards.hat.toLocaleString()}** Hạt`);
    if (rewards.thachAm) parts.push(`🔮 **${rewards.thachAm}** Thạch Âm`);
    if (rewards.daT1) parts.push(`💎 **${rewards.daT1}** Đá T1`);
    if (rewards.boxes) parts.push(`📦 **${rewards.boxes}** Box T1`);
    return parts.join('\n') || 'Không có';
}

module.exports = { execute };


