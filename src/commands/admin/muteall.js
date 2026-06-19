/**
 * ?muteall @bot - Chặn/bỏ chặn TẤT CẢ lệnh trong kênh này.
 * Khi tag bot, kênh đó sẽ không phản hồi bất kỳ lệnh nào.
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');

const OWNER_ID = '395151484179841024';

async function execute(message) {
    if (message.author.id !== OWNER_ID) {
        return message.reply('❌ Bạn không có quyền thực hiện lệnh này!');
    }

    const botMentioned = message.mentions.users.has(message.client.user.id);
    if (!botMentioned) {
        return message.reply(`❌ Phải tag **bot này** để dùng lệnh này!\nVí dụ: \`?muteall @${message.client.user.username}\``);
    }

    const firstMentionedUser = message.mentions.users.first();
    if (firstMentionedUser && firstMentionedUser.id !== message.client.user.id) {
        return message.reply('❌ Bạn phải tag **bot này**, không phải bot khác!');
    }

    const channelId = message.channel.id;
    const guildId = message.guild?.id;

    if (!guildId) {
        return message.reply('❌ Lệnh này chỉ dùng trong server!');
    }

    if (isChannelMuted(channelId)) {
        removeMutedChannel(channelId);

        const embed = new EmbedBuilder()
            .setColor('#22C55E')
            .setTitle('✅ Đã BỎ MUTE Kênh')
            .setDescription(`Kênh <#${channelId}> đã được **mở lại** cho tất cả lệnh!`)
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    addMutedChannel(channelId, guildId);

    const embed = new EmbedBuilder()
        .setColor('#EF4444')
        .setTitle('🔇 Đã MUTE Kênh')
        .setDescription(`Kênh <#${channelId}> sẽ **không phản hồi** bất kỳ lệnh nào!`)
        .addFields({
            name: '💡 Ghi chú',
            value: 'Dùng `?muteall @Bot` lần nữa để bỏ mute',
            inline: false
        })
        .setTimestamp();

    return message.reply({ embeds: [embed] });
}

let mutedChannels = new Set();

function loadMutedChannels() {
    try {
        mutedChannels = new Set(db.getMutedChannels());
        console.log(`✅ Loaded ${mutedChannels.size} muted channels`);
    } catch (e) {
        console.error('[muteall] Error loading muted channels:', e.message);
        mutedChannels = new Set();
    }
}

function isChannelMuted(channelId) {
    return mutedChannels.has(channelId);
}

function addMutedChannel(channelId, guildId) {
    db.addMutedChannel(channelId, guildId);
    mutedChannels.add(channelId);
}

function removeMutedChannel(channelId) {
    db.removeMutedChannel(channelId);
    mutedChannels.delete(channelId);
}

loadMutedChannels();

module.exports = { execute, isChannelMuted, loadMutedChannels };
