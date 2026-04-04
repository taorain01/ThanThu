/**
 * ═══════════════════════════════════════════════════════════════════════════
 * bangchienJoinLeaveHandlers.js - Handlers cho Tham gia/Hủy Bang Chiến
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Handlers:
 *   - bangchien_join_*  : Tham gia Bang Chiến party
 *   - bangchien_leave_* : Hủy đăng ký Bang Chiến party
 * 
 * Được import vào: src/events/client/interactionCreate.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

const { MessageFlags } = require('discord.js');
const { bangchienNotifications, bangchienRegistrations, refreshOverviewEmbed } = require('./bangchienState');
const { createBangchienEmbed, createBangchienButtons } = require('../commands/bangchien/bangchien');
const { syncBCSession, formatActiveSession } = require('./supabaseSync');

const BC_ROLE_NAME = 'bc';

/**
 * Xử lý button interactions cho Tham gia và Hủy Bang Chiến
 * @param {ButtonInteraction} interaction 
 * @param {Client} client 
 * @returns {boolean} true nếu đã xử lý, false nếu không phải handler này
 */
async function handleButton(interaction, client) {
    const customId = interaction.customId;

    try {
        // ═══════════════════════════════════════════════════════════════
        // Xử lý nút Tham gia Bang Chiến
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('bangchien_join_')) {
            const partyKey = customId.replace('bangchien_join_', '');
            const db = require('../database/db');

            // Kiểm tra session còn hoạt động không (DB hoặc memory)
            const activeSession = db.getActiveBangchien(partyKey);
            if (!activeSession && !bangchienNotifications.has(partyKey)) {
                return interaction.reply({
                    content: '❌ Party này không còn hoạt động!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Detect user role (DPS/Healer/Tanker) từ Discord roles
            // Thứ tự ưu tiên: Healer > Tanker > DPS sub-type > DPS > fallback
            // Dùng guard !userRole để mỗi bước chỉ chạy khi chưa detect được role cao hơn
            let userRole = null;
            let subRoleName = ''; // Phái (Quạt Dù, Vô Danh,...)
            const member = interaction.member;
            const dpsSubTypeRoles = ['Quạt Dù', 'Vô Danh', 'Song Đao', 'Cửu Kiếm', 'Dù Roi', 'Hoành Đao/Mđ'];

            // 1. Healer - ưu tiên cao nhất
            const healerRole = interaction.guild.roles.cache.find(r => r.name === 'Healer');
            if (healerRole && member.roles.cache.has(healerRole.id)) {
                userRole = 'Healer';
            }
            // 2. Tanker (chỉ check nếu chưa là Healer)
            if (!userRole) {
                const tankerRole = interaction.guild.roles.cache.find(r => r.name === 'Tanker');
                if (tankerRole && member.roles.cache.has(tankerRole.id)) {
                    userRole = 'Tanker';
                }
            }
            // 3. DPS sub-types (chỉ check nếu chưa detect được)
            if (!userRole) {
                for (const subTypeName of dpsSubTypeRoles) {
                    const subRole = interaction.guild.roles.cache.find(r => r.name === subTypeName);
                    if (subRole && member.roles.cache.has(subRole.id)) {
                        userRole = 'DPS';
                        subRoleName = subTypeName;
                        break;
                    }
                }
            }
            // 4. DPS main role (chỉ check nếu chưa detect được)
            if (!userRole) {
                const dpsRole = interaction.guild.roles.cache.find(r => r.name === 'DPS');
                if (dpsRole && member.roles.cache.has(dpsRole.id)) {
                    userRole = 'DPS';
                }
            }
            // 5. Fallback nếu không có role nào
            userRole = userRole || 'DPS';

            // Lấy game_username từ DB users
            const userInfo = db.getUserByDiscordId(interaction.user.id);
            const gameName = userInfo ? userInfo.game_username : '';

            // Thêm vào DB với auto-team assignment (4-TEAM SYSTEM + ROLE BALANCE)
            const result = db.addBangchienParticipant(partyKey, {
                id: interaction.user.id,
                username: interaction.user.username,
                gn: gameName, // Tên in-game
                role: userRole, // DPS/Healer/Tanker
                sub: subRoleName // Phái (Quạt Dù, Vô Danh,...)
            }, interaction.guild.id); // Pass guildId for preset checking

            if (!result.success) {
                return interaction.reply({
                    content: result.error === 'Already registered' ? '⚠️ Bạn đã đăng ký party này rồi!' : `❌ ${result.error}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            // Cập nhật memory cho backward compatibility
            let registrations = bangchienRegistrations.get(partyKey) || [];
            if (!registrations.some(r => r.id === interaction.user.id)) {
                registrations.push({ id: interaction.user.id, username: interaction.user.username, joinedAt: Date.now(), isLeader: false });
                bangchienRegistrations.set(partyKey, registrations);
            }

            // Cấp role Bang Chiến 30vs30 ngay khi tham gia
            try {
                let bcRole = interaction.guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
                if (!bcRole) {
                    bcRole = await interaction.guild.roles.create({ name: BC_ROLE_NAME, color: 0xE74C3C, reason: 'Tạo role cho hệ thống Bang Chiến' });
                }
                if (bcRole && !interaction.member.roles.cache.has(bcRole.id)) {
                    await interaction.member.roles.add(bcRole);
                }
            } catch (e) {
                console.error('[bangchienJoin] Lỗi cấp role BC:', e.message);
            }

            // Auto-refresh overview embed
            await refreshOverviewEmbed(interaction.client, interaction.guild.id);

            // Sync lên Supabase để Web cập nhật realtime
            try {
                const updatedSession = db.getActiveBangchien(partyKey);
                if (updatedSession) {
                    const sessionData = formatActiveSession(updatedSession, db, interaction.guild);
                    if (sessionData) {
                        await syncBCSession(interaction.guild.id, updatedSession.day || 'sat', sessionData);
                    }
                }
            } catch (syncErr) {
                console.error('[bangchienJoin] Lỗi sync Supabase:', syncErr.message);
            }

            // 4-TEAM: Display team names correctly
            const _tn = db.getTeamNames ? db.getTeamNames() : { attack1: 'Công 1', attack2: 'Công 2', defense: 'Thủ', forest: 'Rừng' };
            const teamEmojis = { attack1: `⚔️ ${_tn.attack1}`, attack2: `🗡️ ${_tn.attack2}`, defense: `🛡️ ${_tn.defense}`, forest: `🌲 ${_tn.forest}`, waiting: '⏳ Chờ' };
            const teamDisplay = teamEmojis[result.team] || result.team;
            const total = result.counts.attack1 + result.counts.attack2 + result.counts.defense + result.counts.forest + result.counts.waiting;
            await interaction.reply({
                content: `✅ Đã vào ${teamDisplay}! (${_tn.attack1}: ${result.counts.attack1} | ${_tn.attack2}: ${result.counts.attack2} | ${_tn.defense}: ${result.counts.defense} | ${_tn.forest}: ${result.counts.forest} | Chờ: ${result.counts.waiting})`,
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý nút Hủy đăng ký Bang Chiến
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('bangchien_leave_')) {
            const partyKey = customId.replace('bangchien_leave_', '');
            const db = require('../database/db');

            // Kiểm tra session còn hoạt động không
            const activeSession = db.getActiveBangchien(partyKey);
            if (!activeSession && !bangchienNotifications.has(partyKey)) {
                return interaction.reply({
                    content: '❌ Party này không còn hoạt động!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Xóa khỏi DB
            const result = db.removeBangchienParticipant(partyKey, interaction.user.id);

            if (!result.success) {
                if (result.error === 'Leader cannot leave') {
                    return interaction.reply({
                        content: '❌ Leader không thể hủy đăng ký! Dùng ?huybc để hủy.',
                        flags: MessageFlags.Ephemeral
                    });
                }
                return interaction.reply({
                    content: result.error === 'Not found in session' ? '⚠️ Bạn chưa đăng ký party này!' : `❌ ${result.error}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            // Cập nhật memory cho backward compatibility
            let registrations = bangchienRegistrations.get(partyKey) || [];
            registrations = registrations.filter(r => r.id !== interaction.user.id);
            bangchienRegistrations.set(partyKey, registrations);

            // Xóa role Bang Chiến 30vs30 khi hủy đăng ký
            try {
                const bcRole = interaction.guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
                if (bcRole && interaction.member.roles.cache.has(bcRole.id)) {
                    await interaction.member.roles.remove(bcRole);
                }
            } catch (e) {
                console.error('[bangchienLeave] Lỗi xóa role BC:', e.message);
            }

            // Auto-refresh overview embed
            await refreshOverviewEmbed(interaction.client, interaction.guild.id);

            // Sync lên Supabase để Web cập nhật realtime
            try {
                const updatedSession = db.getActiveBangchien(partyKey);
                if (updatedSession) {
                    const sessionData = formatActiveSession(updatedSession, db, interaction.guild);
                    if (sessionData) {
                        await syncBCSession(interaction.guild.id, updatedSession.day || 'sat', sessionData);
                    }
                }
            } catch (syncErr) {
                console.error('[bangchienLeave] Lỗi sync Supabase:', syncErr.message);
            }

            // 4-TEAM: Display counts correctly
            const _tn2 = db.getTeamNames ? db.getTeamNames() : { attack1: 'Công 1', attack2: 'Công 2', defense: 'Thủ', forest: 'Rừng' };
            const total = result.counts.attack1 + result.counts.attack2 + result.counts.defense + result.counts.forest + result.counts.waiting;
            await interaction.reply({
                content: `✅ Đã hủy đăng ký! (${_tn2.attack1}: ${result.counts.attack1} | ${_tn2.attack2}: ${result.counts.attack2} | ${_tn2.defense}: ${result.counts.defense} | ${_tn2.forest}: ${result.counts.forest} | Chờ: ${result.counts.waiting})`,
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        // Không phải handler của file này
        return false;

    } catch (error) {
        console.error('[bangchienJoinLeaveHandlers] Error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '❌ Có lỗi xảy ra khi xử lý Bang Chiến!',
                flags: MessageFlags.Ephemeral
            });
        }
        return true; // Đã xử lý lỗi
    }
}

module.exports = {
    handleButton
};
