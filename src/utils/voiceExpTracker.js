/**
 * Voice EXP Tracker Module
 * Theo dõi thời gian voice chat và cộng EXP tự động mỗi 60s
 */

const { addVoiceExp, getLevelReward, addHat } = require('../database/economy');
const { EmbedBuilder } = require('discord.js');

// Map lưu thời gian join voice: { odiscordId: { channelId, joinedAt } }
const voiceUsers = new Map();

// Lưu reference để gửi thông báo level up
let clientRef = null;

/**
 * Khởi tạo voice EXP tracker
 * @param {Client} client - Discord client
 */
function initVoiceExpTracker(client) {
    clientRef = client;

    // Quét mỗi 60 giây, cộng EXP cho user đang ở voice
    setInterval(() => {
        processVoiceExp();
    }, 60 * 1000); // 60s

    console.log('🎤 Voice EXP Tracker đã khởi tạo (quét mỗi 60s)');
}

/**
 * Xử lý cộng EXP cho tất cả user đang voice
 */
async function processVoiceExp() {
    if (!clientRef) return;

    for (const guild of clientRef.guilds.cache.values()) {
        // Duyệt tất cả voice channels
        for (const channel of guild.channels.cache.values()) {
            if (!channel.isVoiceBased()) continue;

            // Lấy members trong voice (không phải bot)
            const members = channel.members.filter(m => !m.user.bot);

            // Chỉ tính EXP nếu có ≥2 người
            if (members.size < 2) continue;

            for (const [memberId, member] of members) {
                // Bỏ qua user bị tự mute + deafen (AFK hoàn toàn)
                if (member.voice.selfMute && member.voice.selfDeaf) continue;

                try {
                    // Phân biệt mic mở vs mic tắt (tính điểm ẩn)
                    const isMuted = member.voice.selfMute || member.voice.serverMute;
                    const result = addVoiceExp(memberId, 1, isMuted);

                    if (result.levelUp) {
                        await handleLevelUp(memberId, result, channel);
                    }
                } catch (e) {
                    console.error(`[voiceExpTracker] Lỗi cộng EXP cho ${memberId}:`, e.message);
                }
            }
        }
    }
}

/**
 * Xử lý thông báo level up - gửi vào kênh đã set, embed đẹp, không tag user
 */
async function handleLevelUp(discordId, result, channel) {
    try {
        const guild = channel.guild;
        const member = guild.members.cache.get(discordId);
        if (!member) return;

        const reward = getLevelReward(result.newLevel);

        // Thưởng Hạt nếu có
        if (reward) {
            addHat(discordId, reward.hat);

            // Tự động gán role thưởng
            try {
                let role = guild.roles.cache.find(r => r.name === reward.roleName);
                if (!role) {
                    // Tạo role nếu chưa có
                    role = await guild.roles.create({
                        name: reward.roleName,
                        reason: `EXP Level ${result.newLevel} reward`
                    });
                }
                await member.roles.add(role);
            } catch (e) {
                console.error(`[voiceExpTracker] Lỗi gán role:`, e.message);
            }
        }

        // Gửi thông báo vào kênh đã set (nếu có)
        const db = require('../database/db');
        const levelUpChannelId = db.getLevelUpChannelId();
        if (!levelUpChannelId) return; // Chưa set kênh → bỏ qua

        try {
            const levelUpChannel = await clientRef.channels.fetch(levelUpChannelId);
            if (!levelUpChannel) return;

            const levelEmojis = ['🌱', '⚔️', '🗡️', '🛡️', '👑', '🌟', '💎', '🔥'];
            const emoji = levelEmojis[Math.min(Math.floor(result.newLevel / 10), levelEmojis.length - 1)];
            const displayName = member.displayName || member.user.username;

            const embed = new EmbedBuilder()
                .setColor(0x9C27B0)
                .setAuthor({
                    name: displayName,
                    iconURL: member.user.displayAvatarURL({ size: 64 })
                })
                .setTitle(`${emoji} Lên Cấp!`)
                .setDescription(`**${displayName}** đã đạt **Level ${result.newLevel}**! 🎉`)
                .addFields(
                    { name: '📊 Level', value: `${result.oldLevel} → **${result.newLevel}**`, inline: true },
                    { name: '🏷️ Loại', value: '🎤 Voice', inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'Lang Gia Các • Hệ thống EXP' });

            if (reward) {
                embed.addFields({
                    name: '🎁 Phần thưởng',
                    value: `+**${reward.hat.toLocaleString()} Hạt** + Role **${reward.roleName}**`,
                    inline: false
                });
                embed.setColor(0xFFD700); // Vàng cho milestone
            }

            await levelUpChannel.send({ embeds: [embed] });
        } catch (e) {
            console.error('[voiceExpTracker] Lỗi gửi thông báo level up:', e.message);
        }
    } catch (e) {
        console.error('[voiceExpTracker] Lỗi handleLevelUp:', e.message);
    }
}

/**
 * Ghi nhận user vào voice
 */
function trackVoiceJoin(userId, channelId) {
    voiceUsers.set(userId, { channelId, joinedAt: Date.now() });
}

/**
 * Ghi nhận user rời voice
 */
function trackVoiceLeave(userId) {
    voiceUsers.delete(userId);
}

module.exports = {
    initVoiceExpTracker,
    trackVoiceJoin,
    trackVoiceLeave,
    voiceUsers
};
