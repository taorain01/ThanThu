/**
 * Lệnh ?top - Bảng xếp hạng EXP
 * Hiển thị embed đẹp với top 15 members
 */

const { EmbedBuilder } = require('discord.js');
const { getExpLeaderboard, getExpUserCount, getExpInfo } = require('../../database/economy');

module.exports = {
    name: 'top',
    aliases: ['leaderboard', 'lb', 'bxh'],
    description: 'Xem bảng xếp hạng EXP',
    category: 'exp',

    async execute(message, args) {
        // Xác định loại bảng xếp hạng
        let type = 'total';
        let typeLabel = '🏆 Tổng EXP';
        let typeEmoji = '✨';
        let color = 0x667eea;

        if (args[0]) {
            const arg = args[0].toLowerCase();
            if (['voice', 'vc', 'v'].includes(arg)) {
                type = 'voice';
                typeLabel = '🔊 Voice EXP';
                typeEmoji = '🎤';
                color = 0x43b581;
            } else if (['text', 'chat', 't', 'msg'].includes(arg)) {
                type = 'text';
                typeLabel = '💬 Text EXP';
                typeEmoji = '📝';
                color = 0xfaa61a;
            }
        }

        const leaderboard = getExpLeaderboard(type, 15);
        const totalUsers = getExpUserCount();
        const myInfo = getExpInfo(message.author.id);

        if (leaderboard.length === 0) {
            return message.reply('📭 Chưa có ai có EXP! Hãy bắt đầu trò chuyện để kiếm EXP nhé.');
        }

        // Tạo danh sách top
        const lines = [];
        const medals = ['🥇', '🥈', '🥉'];
        const tierColors = ['🟡', '🟠', '🔴', '🟣', '🔵', '🟢', '⚪'];

        for (let i = 0; i < leaderboard.length; i++) {
            const entry = leaderboard[i];
            const rank = i + 1;

            // Lấy tên hiển thị
            let displayName = '???';
            try {
                const member = message.guild.members.cache.get(entry.discord_id);
                if (member) {
                    displayName = member.displayName;
                } else {
                    const user = await message.client.users.fetch(entry.discord_id).catch(() => null);
                    displayName = user ? user.username : '???';
                }
            } catch (e) {
                displayName = '???';
            }

            // Truncate tên dài
            if (displayName.length > 16) {
                displayName = displayName.substring(0, 16) + '…';
            }

            // Medal hoặc số thứ tự
            let rankDisplay;
            if (rank <= 3) {
                rankDisplay = medals[rank - 1];
            } else {
                rankDisplay = `\`${String(rank).padStart(2, ' ')}.\``;
            }

            // EXP value theo loại
            let expValue;
            if (type === 'text') expValue = entry.text_exp;
            else if (type === 'voice') expValue = entry.voice_exp;
            else expValue = entry.total_exp;

            // Level badge
            const levelBadge = `\`Lv${String(entry.level).padStart(3, ' ')}\``;

            // Format line
            const expStr = formatNumber(expValue);
            const isMe = entry.discord_id === message.author.id;
            const highlight = isMe ? ' ◀️' : '';

            lines.push(`${rankDisplay} ${levelBadge} **${displayName}** — ${typeEmoji} ${expStr}${highlight}`);
        }

        // Tạo embed đẹp
        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`${typeLabel} — Bảng Xếp Hạng`)
            .setDescription(lines.join('\n'))
            .setFooter({
                text: `📊 Hạng của bạn: #${myInfo.rank}/${totalUsers} | Level ${myInfo.level} | ${formatNumber(myInfo.totalExp)} EXP`,
                iconURL: message.author.displayAvatarURL({ size: 32 })
            })
            .setTimestamp();

        // Thêm thumbnail nếu có top 1
        try {
            if (leaderboard.length > 0) {
                const topUser = await message.client.users.fetch(leaderboard[0].discord_id).catch(() => null);
                if (topUser) {
                    embed.setThumbnail(topUser.displayAvatarURL({ size: 128 }));
                }
            }
        } catch (e) { }

        // Hướng dẫn sử dụng
        const footer = [];
        if (type === 'total') {
            footer.push('💡 `?top voice` — xem top voice | `?top text` — xem top text');
        } else {
            footer.push('💡 `?top` — xem top tổng');
        }

        await message.reply({
            embeds: [embed],
            content: footer.join('\n')
        });
    }
};

/**
 * Format số đẹp
 */
function formatNumber(num) {
    if (!num) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
}
