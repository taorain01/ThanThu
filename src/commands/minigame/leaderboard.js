/**
 * ?top / ?leaderboard - Bảng xếp hạng Mastery
 */

const { EmbedBuilder } = require('discord.js');
const economyDb = require('../../database/economy');
const { getPlayerClass, getClassInfo } = require('../../utils/classSystem');
const { calculateTotalMastery } = require('../../utils/tuneSystem');

async function execute(message, args) {
    const guild = message.guild;

    // Lấy tất cả members có equipment
    const allUsers = economyDb.db.prepare('SELECT DISTINCT discord_id FROM equipment WHERE is_equipped = 1').all();

    if (allUsers.length === 0) {
        return message.reply('❌ Chưa có ai trong bảng xếp hạng!\nMặc đồ bằng `?equip` để tham gia.');
    }

    // Tính mastery cho từng user
    const leaderboard = [];

    for (const user of allUsers) {
        try {
            const member = await guild.members.fetch(user.discord_id).catch(() => null);
            if (!member) continue;

            const playerClass = getPlayerClass(member);
            const equippedItems = economyDb.getEquippedItems(user.discord_id);
            const totalMastery = calculateTotalMastery(equippedItems, playerClass);

            leaderboard.push({
                discordId: user.discord_id,
                username: member.user.username,
                class: playerClass,
                mastery: totalMastery,
                items: equippedItems.length
            });
        } catch (e) {
            // Skip if can't fetch member
        }
    }

    // Sắp xếp theo mastery
    leaderboard.sort((a, b) => b.mastery - a.mastery);

    // Top 10
    const top10 = leaderboard.slice(0, 10);

    // Format
    const medals = ['🥇', '🥈', '🥉'];
    const leaderboardText = top10.map((entry, i) => {
        const rank = medals[i] || `**${i + 1}.**`;
        const classInfo = getClassInfo(entry.class);
        const classIcon = classInfo ? classInfo.icon : '❓';
        return `${rank} ${classIcon} **${entry.username}** - ${entry.mastery.toLocaleString()} pts (${entry.items}/8)`;
    }).join('\n');

    // Tìm vị trí của người dùng
    const userRank = leaderboard.findIndex(e => e.discordId === message.author.id) + 1;
    const userData = leaderboard.find(e => e.discordId === message.author.id);

    const embed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('🏆 Bảng Xếp Hạng Mastery')
        .setDescription(leaderboardText || 'Chưa có dữ liệu')
        .setFooter({
            text: userData
                ? `Hạng của bạn: #${userRank} (${userData.mastery} pts)`
                : 'Mặc đồ để tham gia xếp hạng!'
        })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

module.exports = { execute };


