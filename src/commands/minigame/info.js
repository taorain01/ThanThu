/**
 * ?info, ?i, ?thongtin - Xem thông tin người chơi
 */

const { EmbedBuilder } = require('discord.js');
const economyDb = require('../../database/economy');
const { getPlayerClass, SLOTS } = require('../../utils/classSystem');
const { calculateEquipmentMastery } = require('../../utils/tuneSystem');
const { getAchievementStats } = require('../../utils/achievementSystem');
const { getOrGenerateDailyQuests } = require('../../utils/questSystem');

async function execute(message, args) {
    // Chỉ xem thông tin của bản thân
    const targetUser = message.author;
    const targetMember = message.member;

    const userId = targetUser.id;
    const eco = economyDb.getOrCreateEconomy(userId);
    const equippedItems = economyDb.getEquippedItems(userId);
    const playerClass = targetMember ? getPlayerClass(targetMember) : 'dps';

    // Calculate total mastery
    let totalMastery = 0;
    for (const item of equippedItems) {
        totalMastery += calculateEquipmentMastery(item, playerClass);
    }

    // Get achievement stats
    let achievementStats = { unlocked: 0, total: 30, percentage: 0 };
    try {
        achievementStats = getAchievementStats(userId);
    } catch (e) { /* ignore */ }

    // Get daily quest completion
    let dailyCompleted = 0;
    try {
        const dailyResult = getOrGenerateDailyQuests(userId);
        const weeklyResult = getOrGenerateWeeklyQuests(userId);
        const dailyQuests = dailyResult.quests || dailyResult;
        const weeklyQuests = weeklyResult.quests || weeklyResult;
        dailyCompleted = dailyQuests.filter(q => q.claimed).length;
    } catch (e) { /* ignore */ }

    // Get nhua
    const nhuaInfo = economyDb.getCurrentNhua(userId);

    // Build class icon
    const classIcon = playerClass === 'dps' ? '⚔️' : playerClass === 'tanker' ? '🛡️' : playerClass === 'healer' ? '💚' : '👤';
    const className = playerClass === 'dps' ? 'DPS' : playerClass === 'tanker' ? 'Tanker' : playerClass === 'healer' ? 'Healer' : 'Chưa chọn';

    // Title
    const titleDisplay = eco.active_title ? `*${eco.active_title}*` : '';

    const embed = new EmbedBuilder()
        .setColor(0x3B82F6)
        .setTitle(`👤 ${targetUser.username} ${titleDisplay}`)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .addFields(
            {
                name: '📊 Thông tin',
                value: `${classIcon} **${className}**\n⚔️ Mastery: **${totalMastery.toLocaleString()}**`,
                inline: true
            },
            {
                name: '💰 Tài nguyên',
                value: `🌾 **${eco.hat.toLocaleString()}**\n💎 **${eco.enhancement_stone_t1}**\n🔮 **${eco.thach_am}**\n💧 **${nhuaInfo.current}/${nhuaInfo.max}**`,
                inline: true
            },
            {
                name: '📦 Kho đồ',
                value: `📦 Box: **${eco.boxes_t1 || 0}**\n🎒 Items: **${economyDb.countUserEquipment(userId)}**`,
                inline: true
            }
        );

    // Equipped items
    if (equippedItems.length > 0) {
        let equippedText = '';
        for (const item of equippedItems) {
            const slot = SLOTS[item.slot];
            const mastery = calculateEquipmentMastery(item, playerClass);
            equippedText += `${slot.icon} **${item.name}** (${slot.shortName}) \`${mastery}\`\n`;
        }
        embed.addFields({
            name: `🎽 Trang bị (${equippedItems.length}/8)`,
            value: equippedText,
            inline: false
        });
    }

    // Progress
    embed.addFields({
        name: '📈 Tiến độ',
        value: `🏆 Thành tựu: **${achievementStats.unlocked}/${achievementStats.total}** (${achievementStats.percentage}%)\n📋 NV hôm nay: **${dailyCompleted}/5**`,
        inline: false
    });

    embed.setFooter({ text: '?nv để xem nhiệm vụ • ?thanhtuu để xem thành tựu' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

module.exports = { execute };


