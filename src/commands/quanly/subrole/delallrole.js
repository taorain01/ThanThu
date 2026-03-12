/**
 * ?delallrole - Xóa TẤT CẢ sub-roles đã tạo qua ?addrole
 * CHỈ OWNER mới được sử dụng
 * 
 * CẢNH BÁO: Lệnh này sẽ:
 * 1. Xóa tất cả roles Discord được tạo qua ?addrole
 * 2. Xóa tất cả display roles (".") tương ứng
 * 3. Clear tất cả user_display trong DB
 * 4. Xóa toàn bộ role mappings
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../../database/db');
const { getRoleMappings, saveRoleMappings, DISPLAY_ROLE_NAME } = require('./addrole');
const fs = require('fs');

const OWNER_ID = '395151484179841024';

async function execute(message, args) {
    // CHỈ OWNER mới được dùng
    if (message.author.id !== OWNER_ID) {
        return; // Không phản hồi gì cả
    }

    // Xác nhận
    if (!args[0] || args[0].toLowerCase() !== 'confirm') {
        const mappings = getRoleMappings();
        const roleCount = Object.keys(mappings).length;

        if (roleCount === 0) {
            return message.channel.send('ℹ️ Không có sub-role nào để xóa.');
        }

        const roles = Object.entries(mappings).map(([code, entry]) => {
            const name = typeof entry === 'string' ? entry : entry.name;
            return `• \`${code}\` → **${name}**`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('⚠️ XÁC NHẬN XÓA TẤT CẢ SUB-ROLES')
            .setDescription(
                `Bạn sắp xóa **${roleCount}** sub-roles:\n\n${roles}\n\n` +
                `**Cảnh báo:**\n` +
                `• Xóa tất cả Discord roles đã tạo\n` +
                `• Xóa tất cả display roles (.)\n` +
                `• Clear user_display của tất cả users\n` +
                `• Xóa icon files\n\n` +
                `Gõ \`?delallrole confirm\` để xác nhận.`
            )
            .setFooter({ text: 'Chỉ OWNER mới thấy tin nhắn này' })
            .setTimestamp();

        return message.channel.send({ embeds: [embed] });
    }

    // Thực hiện xóa
    const mappings = getRoleMappings();
    const codes = Object.keys(mappings);

    if (codes.length === 0) {
        return message.channel.send('ℹ️ Không có sub-role nào để xóa.');
    }

    let deletedRoles = 0;
    let deletedDisplayRoles = 0;
    let deletedIcons = 0;
    let errors = [];

    for (const code of codes) {
        const entry = mappings[code];
        const roleName = typeof entry === 'string' ? entry : entry.name;
        const iconPath = typeof entry === 'object' ? entry.icon : null;

        // 1. Xóa icon file
        if (iconPath && fs.existsSync(iconPath)) {
            try {
                fs.unlinkSync(iconPath);
                deletedIcons++;
            } catch (e) { }
        }

        // 2. Xóa Discord source role
        const discordRole = message.guild.roles.cache.find(r => r.name === roleName);
        if (discordRole) {
            try {
                await discordRole.delete('Xóa bởi ?delallrole');
                deletedRoles++;
            } catch (e) {
                errors.push(`Role ${roleName}: ${e.message}`);
            }
        }

        // 3. Xóa display role
        const displayRoleData = db.getDisplayRole(message.guild.id, code);
        if (displayRoleData && displayRoleData.display_role_id) {
            const displayRole = message.guild.roles.cache.get(displayRoleData.display_role_id);
            if (displayRole) {
                try {
                    await displayRole.delete(`Display role cho ${code} - xóa bởi ?delallrole`);
                    deletedDisplayRoles++;
                } catch (e) { }
            }
        }

        // 4. Xóa từ display_roles table
        db.deleteDisplayRole(message.guild.id, code);
    }

    // 5. Clear tất cả user_display
    for (const code of codes) {
        db.clearDisplayCodeForAll(code);
    }

    // 6. Xóa toàn bộ mappings
    saveRoleMappings({});

    const embed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle('🗑️ Đã xóa tất cả Sub-roles!')
        .setDescription(
            `**Kết quả:**\n` +
            `• Discord roles xóa: ${deletedRoles}\n` +
            `• Display roles xóa: ${deletedDisplayRoles}\n` +
            `• Icon files xóa: ${deletedIcons}\n` +
            `• Total codes xóa: ${codes.length}\n` +
            (errors.length > 0 ? `\n**Lỗi:**\n${errors.slice(0, 5).join('\n')}` : '')
        )
        .setFooter({ text: `Bởi ${message.author.username}` })
        .setTimestamp();

    await message.channel.send({ embeds: [embed] });
}

module.exports = { execute };
