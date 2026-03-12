/**
 * ?hideicon - Ẩn display icon
 * Usage: ?hideicon
 * 
 * Xóa display role và ẩn icon cạnh tên user
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../../database/db');
const { DISPLAY_ROLE_NAME } = require('./addrole');
const { removeAllDisplayRoles } = require('./setrole');

async function execute(message, args) {
    try {
        // Xóa tất cả display roles
        await removeAllDisplayRoles(message.member);

        // Clear trong DB
        db.clearUserDisplay(message.author.id);

        const embed = new EmbedBuilder()
            .setColor(0x95A5A6)
            .setTitle('✅ Đã ẩn icon!')
            .setDescription(
                `Icon bên cạnh tên của bạn đã được ẩn.\n\n` +
                `Dùng \`?show <mã>\` để hiển thị lại.`
            )
            .setFooter({ text: message.author.username })
            .setTimestamp();

        return message.channel.send({ embeds: [embed] });

    } catch (error) {
        console.error('[hideicon] Error:', error);
        return message.channel.send('❌ Đã xảy ra lỗi!');
    }
}

module.exports = { execute };
