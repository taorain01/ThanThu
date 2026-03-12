/**
 * ?muteall @bot - Chặn/bỏ chặn TẤT CẢ lệnh trong kênh này
 * Khi tag bot, kênh đó sẽ không phản hồi bất kỳ lệnh nào
 */

const { EmbedBuilder } = require('discord.js');
const economyDb = require('../../database/economy');

const OWNER_ID = '395151484179841024';

async function execute(message, args) {
    // Chỉ owner mới dùng được
    if (message.author.id !== OWNER_ID) {
        return message.reply('❌ Bạn không có quyền thực hiện lệnh này!');
    }

    // Phải tag đúng bot này mới hoạt động (không phải bot khác)
    const botMentioned = message.mentions.users.has(message.client.user.id);
    if (!botMentioned) {
        return message.reply('❌ Phải tag **bot này** để dùng lệnh này!\nVí dụ: `?muteall @' + message.client.user.username + '`');
    }

    // Kiểm tra nếu user tag bot khác (không phải bot này)
    const firstMentionedUser = message.mentions.users.first();
    if (firstMentionedUser && firstMentionedUser.id !== message.client.user.id) {
        return message.reply('❌ Bạn phải tag **bot này**, không phải bot khác!');
    }

    const channelId = message.channel.id;
    const guildId = message.guild?.id;

    if (!guildId) {
        return message.reply('❌ Lệnh này chỉ dùng trong server!');
    }

    // Toggle trạng thái
    const isMuted = isChannelMuted(channelId);

    if (isMuted) {
        // Bỏ mute
        removeMutedChannel(channelId);

        const embed = new EmbedBuilder()
            .setColor('#22C55E')
            .setTitle('✅ Đã BỎ MUTE Kênh')
            .setDescription(`Kênh <#${channelId}> đã được **mở lại** cho tất cả lệnh!`)
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    } else {
        // Mute
        addMutedChannel(channelId, guildId);

        const embed = new EmbedBuilder()
            .setColor('#EF4444')
            .setTitle('🔇 Đã MUTE Kênh')
            .setDescription(`Kênh <#${channelId}> sẽ **không phản hồi** bất kỳ lệnh nào!`)
            .addFields(
                { name: '💡 Ghi chú', value: 'Dùng `?muteall @Bot` lần nữa để bỏ mute', inline: false }
            )
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    }
}

// ============== HELPER FUNCTIONS ==============

// In-memory cache (sẽ được load từ database)
let mutedChannels = new Set();

function loadMutedChannels() {
    try {
        if (!economyDb.db) {
            // DB chưa khởi tạo, sẽ load sau
            mutedChannels = new Set();
            return;
        }

        // Tạo table nếu chưa có
        economyDb.db.prepare(`
            CREATE TABLE IF NOT EXISTS muted_channels (
                channel_id TEXT PRIMARY KEY,
                guild_id TEXT,
                muted_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `).run();

        const rows = economyDb.db.prepare('SELECT channel_id FROM muted_channels').all();
        mutedChannels = new Set(rows.map(r => r.channel_id));
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
    economyDb.db.prepare(`
        INSERT OR REPLACE INTO muted_channels (channel_id, guild_id)
        VALUES (?, ?)
    `).run(channelId, guildId);
    mutedChannels.add(channelId);
}

function removeMutedChannel(channelId) {
    economyDb.db.prepare('DELETE FROM muted_channels WHERE channel_id = ?').run(channelId);
    mutedChannels.delete(channelId);
}

// Load khi module được require
loadMutedChannels();

module.exports = { execute, isChannelMuted, loadMutedChannels };
