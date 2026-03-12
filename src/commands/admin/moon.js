/**
 * ?moon <@user|id|name> - Cho phép user thấy và kết nối vào voice channel
 * ?xmoon <@user|id|name> - Xóa quyền thấy và kết nối voice channel
 * Chỉ user ID 1380596282246037504 được sử dụng
 */

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const ALLOWED_USER_ID = '1380596282246037504';
const VOICE_CHANNEL_ID = '1463941874531303526';

async function executeMoon(message, args) {
    // Kiểm tra quyền - cho phép ALLOWED_USER_ID hoặc Quản Lý
    const quanLyRole = message.guild.roles.cache.find(r => r.name === 'Quản Lý');
    const isQuanLy = quanLyRole && message.member.roles.cache.has(quanLyRole.id);

    if (message.author.id !== ALLOWED_USER_ID && !isQuanLy) {
        return message.reply('❌ Bạn không có quyền sử dụng lệnh này!');
    }

    if (args.length === 0) {
        return message.reply('❌ Vui lòng chỉ định user!\n**Cách dùng:** `?moon @user` hoặc `?moon <tên>` hoặc `?moon <id>`\n**Ví dụ:** `?moon rain`');
    }

    // Tìm user
    const targetUser = await findUser(message, args[0]);
    if (!targetUser) {
        return message.reply('❌ Không tìm thấy user!');
    }

    // Lấy voice channel
    const voiceChannel = message.guild.channels.cache.get(VOICE_CHANNEL_ID);
    if (!voiceChannel) {
        return message.reply('❌ Không tìm thấy voice channel!');
    }

    try {
        // Thêm quyền cho user
        await voiceChannel.permissionOverwrites.edit(targetUser.id, {
            ViewChannel: true,
            Connect: true
        });

        const embed = new EmbedBuilder()
            .setColor('#22C55E')
            .setTitle('🌑 Đã cấp quyền Moon')
            .setDescription(`**${targetUser.user?.tag || targetUser.displayName}** giờ có thể thấy và kết nối vào <#${VOICE_CHANNEL_ID}>`)
            .setTimestamp();

        return message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Moon error:', error);
        return message.reply('❌ Không thể cấp quyền! Kiểm tra quyền của bot.');
    }
}

async function executeXMoon(message, args) {
    // Kiểm tra quyền - cho phép ALLOWED_USER_ID hoặc Quản Lý
    const quanLyRole = message.guild.roles.cache.find(r => r.name === 'Quản Lý');
    const isQuanLy = quanLyRole && message.member.roles.cache.has(quanLyRole.id);

    if (message.author.id !== ALLOWED_USER_ID && !isQuanLy) {
        return message.reply('❌ Bạn không có quyền sử dụng lệnh này!');
    }

    if (args.length === 0) {
        return message.reply('❌ Vui lòng chỉ định user!\n**Cách dùng:** `?xmoon @user` hoặc `?xmoon <tên>` hoặc `?xmoon <id>`\n**Ví dụ:** `?xmoon rain`');
    }

    // Tìm user
    const targetUser = await findUser(message, args[0]);
    if (!targetUser) {
        return message.reply('❌ Không tìm thấy user!');
    }

    // Lấy voice channel
    const voiceChannel = message.guild.channels.cache.get(VOICE_CHANNEL_ID);
    if (!voiceChannel) {
        return message.reply('❌ Không tìm thấy voice channel!');
    }

    try {
        // Xóa quyền của user
        await voiceChannel.permissionOverwrites.edit(targetUser.id, {
            ViewChannel: false,
            Connect: false
        });

        const embed = new EmbedBuilder()
            .setColor('#EF4444')
            .setTitle('🌑 Đã xóa quyền Moon')
            .setDescription(`**${targetUser.user?.tag || targetUser.displayName}** không còn thấy được <#${VOICE_CHANNEL_ID}>`)
            .setTimestamp();

        return message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('XMoon error:', error);
        return message.reply('❌ Không thể xóa quyền! Kiểm tra quyền của bot.');
    }
}

/**
 * Tìm user từ mention, ID hoặc tên
 */
async function findUser(message, input) {
    // Mention
    const mentionMatch = input.match(/^<@!?(\d+)>$/);
    if (mentionMatch) {
        return message.guild.members.cache.get(mentionMatch[1]) ||
            await message.guild.members.fetch(mentionMatch[1]).catch(() => null);
    }

    // ID
    if (/^\d+$/.test(input)) {
        return message.guild.members.cache.get(input) ||
            await message.guild.members.fetch(input).catch(() => null);
    }

    // Tên
    const lowerInput = input.toLowerCase();
    return message.guild.members.cache.find(m =>
        m.user.username.toLowerCase().includes(lowerInput) ||
        m.displayName.toLowerCase().includes(lowerInput)
    );
}

module.exports = { executeMoon, executeXMoon };
