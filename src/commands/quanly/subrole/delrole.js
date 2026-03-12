/**
 * ?delrole - Delete a sub-role completely
 * Usage: ?delrole <mã>
 * Bang Chủ only
 * 
 * Display Role System:
 *   - Xóa cả role gốc và display role
 *   - Cleanup user_display trong DB
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../../database/db');
const { getRoleMappings, saveRoleMappings, DISPLAY_ROLE_NAME } = require('./addrole');
const fs = require('fs');

function hasRole(member, roleName) {
    return member.roles.cache.some(role => role.name === roleName);
}

const OWNER_ID = '395151484179841024';

async function execute(message, args) {
    const isOwner = message.author.id === OWNER_ID;
    if (!isOwner && !hasRole(message.member, 'Bang Chủ')) {
        return message.channel.send('❌ Chỉ **Bang Chủ** mới được sử dụng lệnh này!');
    }

    if (args.length < 1) {
        return message.channel.send('❌ Thiếu mã! Cách dùng: `?delrole <mã>`');
    }

    const code = args[0].toLowerCase();
    const mappings = getRoleMappings();

    if (!mappings[code]) {
        return message.channel.send(`❌ Không tìm thấy mã \`${code}\`!`);
    }

    const entry = mappings[code];
    const roleName = typeof entry === 'string' ? entry : entry.name;
    const iconPath = typeof entry === 'object' ? entry.icon : null;

    // Delete icon file
    if (iconPath && fs.existsSync(iconPath)) {
        try { fs.unlinkSync(iconPath); } catch (e) { }
    }

    // Remove from mappings
    delete mappings[code];
    saveRoleMappings(mappings);

    // Delete Discord source role
    let roleDeleted = false;
    const discordRole = message.guild.roles.cache.find(r => r.name === roleName);
    if (discordRole) {
        try {
            await discordRole.delete(`Xóa bởi ${message.author.username}`);
            roleDeleted = true;
        } catch (e) {
            console.error('[delrole] Error deleting source role:', e.message);
        }
    }

    // === DELETE DISPLAY ROLE ===
    let displayRoleDeleted = false;
    const displayRoleData = db.getDisplayRole(message.guild.id, code);
    if (displayRoleData && displayRoleData.display_role_id) {
        const displayRole = message.guild.roles.cache.get(displayRoleData.display_role_id);
        if (displayRole) {
            try {
                await displayRole.delete(`Display role cho ${code} - xóa bởi ${message.author.username}`);
                displayRoleDeleted = true;
            } catch (e) {
                console.error('[delrole] Error deleting display role:', e.message);
            }
        }
    }

    // Delete from display_roles table
    db.deleteDisplayRole(message.guild.id, code);

    // === CLEANUP USER_DISPLAY ===
    // Tìm tất cả users đang show code này và clear
    const affectedUsers = db.getUsersByDisplayCode(code);
    const affectedCount = affectedUsers.length;
    db.clearDisplayCodeForAll(code);

    const embed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle('🗑️ Đã xóa Role!')
        .setDescription(
            `**Mã:** \`${code}\`\n` +
            `**Tên:** ${roleName}\n` +
            `**Icon:** ${iconPath ? '✅ Đã xóa' : '❌ Không có'}\n` +
            `**Discord role:** ${roleDeleted ? '✅ Đã xóa' : '⚠️ Không xóa được'}\n` +
            `**Display role:** ${displayRoleDeleted ? '✅ Đã xóa' : '⚠️ Không tìm thấy'}\n` +
            `**Users affected:** ${affectedCount > 0 ? `${affectedCount} người đã bị clear display` : 'Không có'}`
        )
        .setFooter({ text: `Bởi ${message.author.username}` })
        .setTimestamp();

    await message.channel.send({ embeds: [embed] });
}

module.exports = { execute };
