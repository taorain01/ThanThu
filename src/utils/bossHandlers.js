/**
 * ═══════════════════════════════════════════════════════════════════════════
 * bossHandlers.js - Handlers cho Boss Guild Party
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Handlers:
 *   - boss_join_*     : Tham gia Boss party
 *   - boss_leave_*    : Hủy đăng ký Boss party
 *   - boss_finalize_* : Chốt danh sách Boss party
 * 
 * Được import vào: src/events/client/interactionCreate.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

const { EmbedBuilder, MessageFlags } = require('discord.js');
const { bossNotifications, bossRegistrations, getUserRegisteredParty, finalizedParties, clearPreRegistrations } = require('./bossState');
const { createScheduleOnlyEmbed, createBossEmbed, createButtons } = require('../commands/thongbao/bossguild');

/**
 * Xử lý tất cả button interactions liên quan đến Boss Guild
 * @param {ButtonInteraction} interaction 
 * @param {Client} client 
 * @returns {boolean} true nếu đã xử lý, false nếu không phải handler này
 */
async function handleButton(interaction, client) {
    const customId = interaction.customId;

    try {
        // ═══════════════════════════════════════════════════════════════
        // Xử lý nút Tham gia Boss
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('boss_join_')) {
            const partyKey = customId.replace('boss_join_', '');
            const guildId = interaction.guild.id;

            if (!bossNotifications.has(partyKey)) {
                return interaction.reply({
                    content: '❌ Party này không còn hoạt động!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Kiểm tra user đã đăng ký party khác chưa
            const existingParty = getUserRegisteredParty(guildId, interaction.user.id);
            if (existingParty && existingParty !== partyKey) {
                return interaction.reply({
                    content: '⚠️ Bạn đã đăng ký party khác! Hủy đăng ký party đó trước.',
                    flags: MessageFlags.Ephemeral
                });
            }

            let registrations = bossRegistrations.get(partyKey) || [];

            // Kiểm tra đã đăng ký party này chưa
            if (registrations.some(r => r.id === interaction.user.id)) {
                return interaction.reply({
                    content: '⚠️ Bạn đã đăng ký party này rồi!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Thêm vào danh sách
            registrations.push({
                id: interaction.user.id,
                username: interaction.user.username,
                joinedAt: Date.now(),
                isLeader: false
            });
            bossRegistrations.set(partyKey, registrations);

            await interaction.reply({
                content: `✅ Đã đăng ký tham gia! (${registrations.length} người)`,
                flags: MessageFlags.Ephemeral
            });

            // Cập nhật embed ngay lập tức
            const joinNotifData = bossNotifications.get(partyKey);
            if (joinNotifData && joinNotifData.message) {
                try {
                    const newEmbed = createBossEmbed(partyKey, joinNotifData.leaderName);
                    const newRow = createButtons(partyKey);
                    await joinNotifData.message.edit({ embeds: [newEmbed], components: [newRow] });
                } catch (e) {
                    console.error('[bossHandlers] Error editing embed after join:', e.message);
                }
            }
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý nút Hủy đăng ký Boss
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('boss_leave_')) {
            const partyKey = customId.replace('boss_leave_', '');

            if (!bossNotifications.has(partyKey)) {
                return interaction.reply({
                    content: '❌ Party này không còn hoạt động!',
                    flags: MessageFlags.Ephemeral
                });
            }

            let registrations = bossRegistrations.get(partyKey) || [];
            const user = registrations.find(r => r.id === interaction.user.id);

            if (!user) {
                return interaction.reply({
                    content: '⚠️ Bạn chưa đăng ký party này!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Leader không được hủy đăng ký
            if (user.isLeader) {
                return interaction.reply({
                    content: '❌ Leader không thể hủy đăng ký! Chốt danh sách để kết thúc.',
                    flags: MessageFlags.Ephemeral
                });
            }

            registrations = registrations.filter(r => r.id !== interaction.user.id);
            bossRegistrations.set(partyKey, registrations);

            await interaction.reply({
                content: `✅ Đã hủy đăng ký! (${registrations.length} người còn lại)`,
                flags: MessageFlags.Ephemeral
            });

            // Cập nhật embed ngay lập tức
            const leaveNotifData = bossNotifications.get(partyKey);
            if (leaveNotifData && leaveNotifData.message) {
                try {
                    const newEmbed = createBossEmbed(partyKey, leaveNotifData.leaderName);
                    const newRow = createButtons(partyKey);
                    await leaveNotifData.message.edit({ embeds: [newEmbed], components: [newRow] });
                } catch (e) {
                    console.error('[bossHandlers] Error editing embed after leave:', e.message);
                }
            }
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý nút Chốt danh sách Boss
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('boss_finalize_')) {
            const partyKey = customId.replace('boss_finalize_', '');

            const notifData = bossNotifications.get(partyKey);
            if (!notifData) {
                return interaction.reply({
                    content: '❌ Party này không còn hoạt động!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Chỉ leader mới chốt được
            if (interaction.user.id !== notifData.leaderId) {
                return interaction.reply({
                    content: '❌ Chỉ Leader mới có thể chốt danh sách!',
                    flags: MessageFlags.Ephemeral
                });
            }

            const registrations = bossRegistrations.get(partyKey) || [];

            if (registrations.length === 0) {
                return interaction.reply({
                    content: '⚠️ Chưa có ai đăng ký!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Dừng interval
            clearInterval(notifData.intervalId);

            // Lookup tên in-game
            const db = require('../database/db');
            const participantList = registrations.map((r, i) => {
                const userData = db.getUserByDiscordId(r.id);
                const gameName = userData?.game_username || null;
                const nameDisplay = gameName ? `<@${r.id}> (${gameName})` : `<@${r.id}>`;
                return `${i + 1}. ${nameDisplay}${r.isLeader ? ' 👑' : ''}`;
            }).join('\n');

            // Tạo embed chốt danh sách (KHÔNG tag ngay)
            const finalEmbed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('🏁 CHỐT DANH SÁCH ĐI BOSS!')
                .setDescription(`**Danh sách tham gia (${registrations.length} người):**\n` + participantList)
                .setFooter({ text: '💡 Leader reply tin này để tag • ?lichboss để xem lịch' })
                .setTimestamp();

            // Gửi thông báo chốt danh sách (KHÔNG tag)
            const finalMessage = await interaction.channel.send({
                embeds: [finalEmbed]
            });

            // Lưu danh sách để reply tag sau
            finalizedParties.set(finalMessage.id, {
                leaderId: notifData.leaderId,
                participants: registrations.map(r => ({ id: r.id, username: r.username })),
                guildId: interaction.guild.id,
                channelId: interaction.channel.id,
                createdAt: Date.now()
            });

            // Xóa tin nhắn cũ (embed đăng ký)
            try {
                if (notifData.message) await notifData.message.delete();
            } catch (e) { }

            // Gửi embed chỉ có lịch (sau khi chốt)
            const scheduleEmbed = createScheduleOnlyEmbed();
            await interaction.channel.send({ embeds: [scheduleEmbed] });

            // Xóa dữ liệu party
            bossNotifications.delete(partyKey);
            bossRegistrations.delete(partyKey);

            // Xóa danh sách đăng ký trước (+1) vì đã chốt party
            clearPreRegistrations(interaction.guild.id);

            await interaction.reply({
                content: `✅ Đã chốt danh sách ${registrations.length} người! Reply tin chốt danh sách để tag.`,
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        // Không phải handler của file này
        return false;

    } catch (error) {
        console.error('[bossHandlers] Error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '❌ Có lỗi xảy ra khi xử lý Boss party!',
                flags: MessageFlags.Ephemeral
            });
        }
        return true; // Đã xử lý lỗi
    }
}

module.exports = {
    handleButton
};
