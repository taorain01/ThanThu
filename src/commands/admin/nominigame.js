/**
 * ?nominigame @bot - Chặn/bỏ chặn minigame trong kênh này
 * Khi tag bot, kênh đó sẽ không phản hồi lệnh minigame
 */

const { EmbedBuilder } = require('discord.js');
const economyDb = require('../../database/economy');

const OWNER_ID = '395151484179841024';

async function execute(message, args) {
    // Chỉ owner mới dùng được
    if (message.author.id !== OWNER_ID) {
        return message.reply('❌ Bạn không có quyền thực hiện lệnh này!');
    }

    // Phải tag bot mới hoạt động
    const botMentioned = message.mentions.users.has(message.client.user.id);
    if (!botMentioned) {
        return message.reply('❌ Phải tag bot để dùng lệnh này!\nVí dụ: `?nominigame @Bot`');
    }

    const channelId = message.channel.id;
    const guildId = message.guild?.id;

    if (!guildId) {
        return message.reply('❌ Lệnh này chỉ dùng trong server!');
    }

    // Toggle trạng thái
    const isBlocked = isChannelBlocked(channelId);

    if (isBlocked) {
        // Bỏ chặn
        removeBlockedChannel(channelId);

        const embed = new EmbedBuilder()
            .setColor('#22C55E')
            .setTitle('✅ Đã BỎ CHẶN Minigame')
            .setDescription(`Kênh <#${channelId}> đã được **mở lại** cho minigame!`)
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    } else {
        // Chặn
        addBlockedChannel(channelId, guildId);

        const embed = new EmbedBuilder()
            .setColor('#EF4444')
            .setTitle('🚫 Đã CHẶN Minigame')
            .setDescription(`Kênh <#${channelId}> sẽ **không phản hồi** lệnh minigame!`)
            .addFields(
                { name: '💡 Ghi chú', value: 'Dùng `?nominigame` lần nữa để bỏ chặn', inline: false }
            )
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    }
}

// ============== HELPER FUNCTIONS ==============

// In-memory cache (sẽ được load từ database)
let blockedChannels = new Set();

function loadBlockedChannels() {
    try {
        if (!economyDb.db) {
            // DB chưa khởi tạo, sẽ load sau
            blockedChannels = new Set();
            return;
        }
        const rows = economyDb.db.prepare('SELECT channel_id FROM blocked_minigame_channels').all();
        blockedChannels = new Set(rows.map(r => r.channel_id));
        console.log(`✅ Loaded ${blockedChannels.size} blocked minigame channels`);
    } catch (e) {
        // Table không tồn tại, tạo mới
        try {
            economyDb.db.prepare(`
                CREATE TABLE IF NOT EXISTS blocked_minigame_channels (
                    channel_id TEXT PRIMARY KEY,
                    guild_id TEXT,
                    blocked_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `).run();
        } catch (e2) { }
        blockedChannels = new Set();
    }
}

function isChannelBlocked(channelId) {
    return blockedChannels.has(channelId);
}

function addBlockedChannel(channelId, guildId) {
    economyDb.db.prepare(`
        INSERT OR REPLACE INTO blocked_minigame_channels (channel_id, guild_id)
        VALUES (?, ?)
    `).run(channelId, guildId);
    blockedChannels.add(channelId);
}

function removeBlockedChannel(channelId) {
    economyDb.db.prepare('DELETE FROM blocked_minigame_channels WHERE channel_id = ?').run(channelId);
    blockedChannels.delete(channelId);
}

// Load khi module được require
loadBlockedChannels();

module.exports = { execute, isChannelBlocked, loadBlockedChannels };


