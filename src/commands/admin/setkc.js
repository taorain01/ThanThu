/**
 * ?setkc @user - Grant "Kỳ Cựu" role (Owner only)
 * Only user ID 395151484179841024 can use this
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');

const OWNER_ID = '395151484179841024';

function findRole(guild, roleName) {
    return guild.roles.cache.find(r => r.name === roleName) || null;
}

async function execute(message, args) {
    // Only owner can use this
    if (message.author.id !== OWNER_ID) {
        return message.channel.send('❌ Chỉ **Chủ sở hữu** mới có thể sử dụng lệnh này!');
    }

    const mentionedUser = message.mentions.members.first();
    if (!mentionedUser) {
        return message.channel.send('❌ Cách dùng: `?setkc @user` - Cấp role Kỳ Cựu');
    }

    // Find KC role
    const kcRole = findRole(message.guild, 'Kỳ Cựu');
    if (!kcRole) {
        return message.channel.send('❌ Role **Kỳ Cựu** không tồn tại trên server!');
    }

    // Check if already has
    if (mentionedUser.roles.cache.has(kcRole.id)) {
        return message.channel.send(`⚠️ ${mentionedUser.displayName} đã có role **Kỳ Cựu** rồi!`);
    }

    try {
        await mentionedUser.roles.add(kcRole);

        // Update database
        const userData = db.getUserByDiscordId(mentionedUser.id);
        if (userData) {
            db.updateUserPosition(mentionedUser.id, 'kc');
        }

        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('🏆 Đã cấp Kỳ Cựu!')
            .setDescription(
                `✅ Đã cấp role **Kỳ Cựu** cho ${mentionedUser}\n\n` +
                `${mentionedUser.displayName} có thể dùng \`?setrole <mã>\` để chọn role phụ.`
            )
            .setFooter({ text: `Cấp bởi ${message.author.username}` })
            .setTimestamp();

        return message.channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('[setkc] Error:', error.message);
        return message.channel.send(`❌ Lỗi: ${error.message}`);
    }
}

module.exports = { execute };
