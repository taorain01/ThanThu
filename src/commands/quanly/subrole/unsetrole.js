/**
 * ?unsetrole - Remove sub-roles (Admin command)
 * Usage:
 *   ?unsetrole <mã> @user - Xóa role cụ thể của người được chỉ định
 *   ?unsetrole <mã> <username/id> - Xóa role cụ thể (dùng username hoặc ID)
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../../database/db');
const { getRoleMappings } = require('./addrole');
const { removeAllDisplayRoles } = require('./setrole');

function hasRole(member, roleName) {
    return member.roles.cache.some(role => role.name === roleName);
}

function hasKcOrAbove(member) {
    return ['Bang Chủ', 'Phó Bang Chủ', 'Kỳ Cựu'].some(r => hasRole(member, r));
}

async function findMember(guild, identifier) {
    // Try mention first
    const mentionMatch = identifier.match(/^<@!?(\d+)>$/);
    if (mentionMatch) {
        try {
            return await guild.members.fetch(mentionMatch[1]);
        } catch { return null; }
    }

    // Try ID
    if (/^\d{17,19}$/.test(identifier)) {
        try {
            return await guild.members.fetch(identifier);
        } catch { return null; }
    }

    // Try username (search với limit để tránh rate limit)
    try {
        const members = await guild.members.fetch({ query: identifier, limit: 10 });
        const lowerIdentifier = identifier.toLowerCase();
        return members.find(m =>
            m.user.username.toLowerCase() === lowerIdentifier ||
            m.displayName.toLowerCase() === lowerIdentifier
        ) || null;
    } catch (e) {
        console.error('[unsetrole] Error searching member:', e.message);
        return null;
    }
}

async function execute(message, args) {
    // Check permission
    if (!hasKcOrAbove(message.member)) {
        return message.channel.send('❌ Chỉ **Kỳ Cựu** trở lên mới được sử dụng lệnh này!');
    }

    if (args.length < 2) {
        return message.channel.send('❌ Cách dùng: `?unsetrole <mã> @user` hoặc `?unsetrole <mã> <username/id>`');
    }

    // Parse: first arg is code, rest is user identifier
    const code = args[0].toLowerCase();
    const userIdentifier = args.slice(1).join(' ').replace(/^<@!?(\d+)>$/, '<@$1>');

    // Find target member
    let targetMember = message.mentions.members.first();
    if (!targetMember) {
        targetMember = await findMember(message.guild, args.slice(1).join(' '));
    }

    if (!targetMember) {
        return message.channel.send('❌ Không tìm thấy user! Dùng mention, username hoặc ID.');
    }

    // Check if only Bang Chủ can modify others
    if (targetMember.id !== message.author.id && !hasRole(message.member, 'Bang Chủ')) {
        return message.channel.send('❌ Chỉ **Bang Chủ** mới có thể xóa role của người khác!');
    }

    const mappings = getRoleMappings();
    const entry = mappings[code];

    if (!entry) {
        return message.channel.send(`❌ Không tìm thấy mã role \`${code}\`!`);
    }

    const roleName = typeof entry === 'string' ? entry : entry.name;
    const role = message.guild.roles.cache.find(r => r.name === roleName);

    if (!role) {
        return message.channel.send(`❌ Role \`${roleName}\` không tồn tại trong server!`);
    }

    if (!targetMember.roles.cache.has(role.id)) {
        return message.channel.send(`❌ ${targetMember} không có role \`${roleName}\`!`);
    }

    // Remove the specific role
    try {
        await targetMember.roles.remove(role);
    } catch (e) {
        console.error('[unsetrole] Error:', e.message);
        return message.channel.send('❌ Không thể xóa role! Kiểm tra quyền bot.');
    }

    // Clear sub_role in DB if it matches
    const userData = db.getUserByDiscordId(targetMember.id);
    if (userData && userData.sub_role === code) {
        db.setUserSubRole(targetMember.id, null);
    }

    // Also remove display role and clear display in DB
    await removeAllDisplayRoles(targetMember);
    db.clearUserDisplay(targetMember.id);

    const embed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle('🗑️ Đã xóa Role phụ!')
        .setDescription(
            `**User:** ${targetMember}\n` +
            `**Đã xóa role:** ${roleName}\n` +
            `**Mã:** \`${code}\`\n` +
            `**Display icon:** ✅ Đã ẩn`
        )
        .setFooter({ text: `Bởi ${message.author.username}` })
        .setTimestamp();

    await message.channel.send({ embeds: [embed] });
}

module.exports = { execute };
