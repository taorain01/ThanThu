/**
 * ═══════════════════════════════════════════════════════════════════════════
 * bccusHandlers.js - Handlers cho buttons BC Custom (Tự Do)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Handlers:
 *   - bccus_join_*  : Tham gia BC Custom
 *   - bccus_leave_* : Hủy đăng ký BC Custom
 * 
 * Khác với bangchienJoinLeaveHandlers.js:
 *   - KHÔNG gọi refreshOverviewEmbed() (custom không có overview)
 *   - Edit trực tiếp embed message gốc
 * 
 * Được import vào: src/events/client/interactionCreate.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

const { MessageFlags } = require('discord.js');
const { bangchienNotifications, bangchienRegistrations } = require('./bangchienState');

const BC_ROLE_NAME = 'bc';

/**
 * Cập nhật embed BC Custom trên message gốc
 * @param {string} partyKey - Party key
 * @param {Client} client - Discord client
 */
async function refreshCustomEmbed(partyKey, client) {
    const notifData = bangchienNotifications.get(partyKey);
    if (!notifData || !notifData.message) return;

    try {
        const { createBangchienEmbed, createBangchienButtons } = require('../commands/bangchien/bangchien');
        const channel = await client.channels.fetch(notifData.channelId).catch(() => null);
        if (!channel) return;

        const guild = channel.guild;
        const newEmbed = createBangchienEmbed(partyKey, notifData.leaderName, guild);

        // Tạo buttons cho BC Custom
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`bccus_join_${partyKey}`)
                    .setLabel('✅ Tham gia')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`bccus_leave_${partyKey}`)
                    .setLabel('❌ Hủy đăng ký')
                    .setStyle(ButtonStyle.Secondary)
            );

        await notifData.message.edit({ embeds: [newEmbed], components: [row] });
    } catch (e) {
        console.error('[bccus] Error refreshing custom embed:', e.message);
    }
}

/**
 * Xử lý button interactions cho BC Custom
 * @param {ButtonInteraction} interaction 
 * @param {Client} client 
 * @returns {boolean} true nếu đã xử lý
 */
async function handleButton(interaction, client) {
    const customId = interaction.customId;

    try {
        // ═══════════════════════════════════════════════════════════════
        // Nút Tham gia BC Custom
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('bccus_join_')) {
            const partyKey = customId.replace('bccus_join_', '');
            const db = require('../database/db');

            // Kiểm tra session còn hoạt động không
            const activeSession = db.getActiveBangchien(partyKey);
            if (!activeSession) {
                return interaction.reply({
                    content: '❌ Phiên BC Tự Do này không còn hoạt động!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Detect user role (DPS/Healer/Tanker) từ Discord roles
            let userRole = 'DPS';
            const member = interaction.member;
            const dpsSubTypeRoles = ['Quạt Dù', 'Vô Danh', 'Song Đao', 'Cửu Kiếm'];

            // Check Healer trước
            const healerRole = interaction.guild.roles.cache.find(r => r.name === 'Healer');
            if (healerRole && member.roles.cache.has(healerRole.id)) userRole = 'Healer';

            // Check Tanker
            const tankerRole = interaction.guild.roles.cache.find(r => r.name === 'Tanker');
            if (tankerRole && member.roles.cache.has(tankerRole.id)) userRole = 'Tanker';

            // Check DPS sub-types
            for (const subTypeName of dpsSubTypeRoles) {
                const subRole = interaction.guild.roles.cache.find(r => r.name === subTypeName);
                if (subRole && member.roles.cache.has(subRole.id)) { userRole = 'DPS'; break; }
            }

            // Check DPS main role
            const dpsRole = interaction.guild.roles.cache.find(r => r.name === 'DPS');
            if (dpsRole && member.roles.cache.has(dpsRole.id)) userRole = 'DPS';

            // Thêm vào DB (KHÔNG truyền guildId → không check preset)
            const result = db.addBangchienParticipant(partyKey, {
                id: interaction.user.id,
                username: interaction.user.username,
                role: userRole
            });

            if (!result.success) {
                return interaction.reply({
                    content: result.error === 'Already registered' ? '⚠️ Bạn đã đăng ký rồi!' : `❌ ${result.error}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            // Cập nhật memory
            let registrations = bangchienRegistrations.get(partyKey) || [];
            if (!registrations.some(r => r.id === interaction.user.id)) {
                registrations.push({ id: interaction.user.id, username: interaction.user.username, joinedAt: Date.now(), isLeader: false });
                bangchienRegistrations.set(partyKey, registrations);
            }

            // Cấp role BC
            try {
                let bcRole = interaction.guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
                if (!bcRole) {
                    bcRole = await interaction.guild.roles.create({ name: BC_ROLE_NAME, color: 0xE74C3C, reason: 'BC role' });
                }
                if (bcRole && !interaction.member.roles.cache.has(bcRole.id)) {
                    await interaction.member.roles.add(bcRole);
                }
            } catch (e) {
                console.error('[bccus] Lỗi cấp role BC:', e.message);
            }

            // Refresh embed trên message gốc
            await refreshCustomEmbed(partyKey, client);

            // Reply ephemeral
            const teamEmojis = { attack1: '⚔️ Công 1', attack2: '🗡️ Công 2', defense: '🛡️ Thủ', forest: '🌲 Rừng', waiting: '⏳ Chờ' };
            const teamDisplay = teamEmojis[result.team] || result.team;
            await interaction.reply({
                content: `✅ Đã vào ${teamDisplay}! (Công1: ${result.counts.attack1} | Công2: ${result.counts.attack2} | Thủ: ${result.counts.defense} | Rừng: ${result.counts.forest})`,
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Nút Hủy đăng ký BC Custom
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('bccus_leave_')) {
            const partyKey = customId.replace('bccus_leave_', '');
            const db = require('../database/db');

            // Kiểm tra session còn hoạt động không
            const activeSession = db.getActiveBangchien(partyKey);
            if (!activeSession) {
                return interaction.reply({
                    content: '❌ Phiên BC Tự Do này không còn hoạt động!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Xóa khỏi DB
            const result = db.removeBangchienParticipant(partyKey, interaction.user.id);

            if (!result.success) {
                if (result.error === 'Leader cannot leave') {
                    return interaction.reply({
                        content: '❌ Leader không thể hủy! Dùng `?bccus huy` để hủy phiên.',
                        flags: MessageFlags.Ephemeral
                    });
                }
                return interaction.reply({
                    content: result.error === 'Not found in session' ? '⚠️ Bạn chưa đăng ký!' : `❌ ${result.error}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            // Cập nhật memory
            let registrations = bangchienRegistrations.get(partyKey) || [];
            registrations = registrations.filter(r => r.id !== interaction.user.id);
            bangchienRegistrations.set(partyKey, registrations);

            // Xóa role BC
            try {
                const bcRole = interaction.guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
                if (bcRole && interaction.member.roles.cache.has(bcRole.id)) {
                    await interaction.member.roles.remove(bcRole);
                }
            } catch (e) {
                console.error('[bccus] Lỗi xóa role BC:', e.message);
            }

            // Refresh embed trên message gốc
            await refreshCustomEmbed(partyKey, client);

            // Reply ephemeral
            await interaction.reply({
                content: `✅ Đã hủy đăng ký BC Tự Do!`,
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        return false;

    } catch (error) {
        console.error('[bccusHandlers] Error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '❌ Có lỗi xảy ra!',
                flags: MessageFlags.Ephemeral
            });
        }
        return true;
    }
}

module.exports = {
    handleButton,
    refreshCustomEmbed
};
