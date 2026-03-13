/**
 * ═══════════════════════════════════════════════════════════════════════════
 * selectMenuHandlers.js - Handlers cho String Select Menu
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Handlers:
 *   - event_role_select           : Chọn role sự kiện (Boss Solo, PvP Solo, Yến Tiệc)
 *   - bangchien_kick_select_*     : Kick members khỏi BC party
 *   - bangchien_priority_select_* : Ưu tiên members từ danh sách chờ
 * 
 * Được import vào: src/events/client/interactionCreate.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

const { MessageFlags } = require('discord.js');
const { bangchienNotifications, bangchienRegistrations } = require('./bangchienState');
const { assignEventRole, removeEventRole } = require('./roleManager');
const { createBangchienEmbed, createBangchienButtons } = require('../commands/bangchien/bangchien');

/**
 * Xử lý tất cả string select menu interactions
 * @param {StringSelectMenuInteraction} interaction 
 * @param {Client} client 
 * @returns {boolean} true nếu đã xử lý, false nếu không phải handler này
 */
async function handleSelectMenu(interaction, client) {
    const customId = interaction.customId;

    try {
        // ═══════════════════════════════════════════════════════════════
        // Xử lý event role select menu
        // ═══════════════════════════════════════════════════════════════
        if (customId === 'event_role_select') {
            const selectedValue = interaction.values[0]; // 'BossSolo', 'PvpSolo', 'YenTiec', 'AllEvents', 'RemoveAll'
            const member = interaction.member;

            let result;

            // Kiểm tra nếu chọn RemoveAll
            if (selectedValue === 'RemoveAll') {
                // Xóa tất cả roles
                result = await removeEventRole(member, 'AllEvents');
            } else {
                // Cấp role cho user
                result = await assignEventRole(member, selectedValue);
            }

            // Reply cho user
            await interaction.reply({
                content: result.message,
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // show_role_select_ → Đã chuyển sang collector trong show.js
        // Collector xử lý trực tiếp, không cần handler ở đây nữa
        // ═══════════════════════════════════════════════════════════════

        // ═══════════════════════════════════════════════════════════════
        // Xử lý bangchien kick select menu
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('bangchien_kick_select_')) {
            const partyKey = customId.replace('bangchien_kick_select_', '');
            const selectedUserIds = interaction.values;

            const notifData = bangchienNotifications.get(partyKey);
            if (!notifData) {
                return interaction.update({
                    content: '❌ Party này không còn hoạt động!',
                    components: []
                });
            }

            let registrations = bangchienRegistrations.get(partyKey) || [];

            // Đưa những người được chọn xuống cuối danh sách (hàng chờ)
            const demotedUsers = [];
            const remainingUsers = [];
            const demotedToEnd = [];

            for (const r of registrations) {
                if (selectedUserIds.includes(r.id) && !r.isLeader) {
                    demotedUsers.push(r.username);
                    demotedToEnd.push(r);
                } else {
                    remainingUsers.push(r);
                }
            }

            // Sắp xếp lại: những người còn lại trước, người bị đưa xuống ở cuối
            registrations = [...remainingUsers, ...demotedToEnd];

            bangchienRegistrations.set(partyKey, registrations);

            // SYNC TO DATABASE - Chia lại thành 2 team và waiting list
            const db = require('../database/db');
            const teamDefense = [];
            const teamOffense = [];
            const waitingList = [];
            registrations.forEach((r, i) => {
                if (i < 15) teamDefense.push(r);
                else if (i < 30) teamOffense.push(r);
                else waitingList.push(r);
            });
            db.updateActiveBangchien(partyKey, {
                team_defense: teamDefense,
                team_offense: teamOffense,
                waiting_list: waitingList
            });

            // Cập nhật embed
            try {
                if (notifData.message) await notifData.message.delete();
            } catch (e) { }

            const newEmbed = createBangchienEmbed(partyKey, notifData.leaderName, interaction.guild);
            const newRow = createBangchienButtons(partyKey);
            const newMessage = await interaction.channel.send({ embeds: [newEmbed], components: [newRow] });

            notifData.message = newMessage;
            notifData.messageId = newMessage.id;

            await interaction.update({
                content: `✅ Đã đưa ${demotedUsers.length} thành viên xuống hàng chờ: ${demotedUsers.join(', ')}`,
                components: []
            });
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý bangchien priority select menu
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('bangchien_priority_select_')) {
            const partyKey = customId.replace('bangchien_priority_select_', '');
            const selectedUserIds = interaction.values;

            const notifData = bangchienNotifications.get(partyKey);
            if (!notifData) {
                return interaction.update({
                    content: '❌ Party này không còn hoạt động!',
                    components: []
                });
            }

            let registrations = bangchienRegistrations.get(partyKey) || [];

            // Logic ưu tiên: Đưa người từ danh sách chờ vào danh sách chính
            // Bằng cách chèn họ vào vị trí thứ 2 (sau leader)

            const prioritizedUsers = [];
            const otherUsers = [];

            // Tách những người được ưu tiên ra và đánh dấu isPrioritized
            for (const user of registrations) {
                if (selectedUserIds.includes(user.id) && !user.isLeader) {
                    user.isPrioritized = true; // Đánh dấu để bypass giới hạn MAX_MEMBERS
                    prioritizedUsers.push(user);
                } else {
                    otherUsers.push(user);
                }
            }

            // Tìm leader (luôn ở đầu)
            const leader = otherUsers.find(r => r.isLeader);
            const nonLeaderOthers = otherUsers.filter(r => !r.isLeader);

            // Sắp xếp lại: Leader -> Prioritized Users -> Còn lại
            // Như vậy người được ưu tiên sẽ ở vị trí 2, 3, ... (trong danh sách chính)
            registrations = [leader, ...prioritizedUsers, ...nonLeaderOthers];

            bangchienRegistrations.set(partyKey, registrations);

            // SYNC TO DATABASE - Chia lại thành 2 team và waiting list
            const db = require('../database/db');
            const teamDefense = [];
            const teamOffense = [];
            const waitingList = [];
            registrations.forEach((r, i) => {
                if (i < 15) teamDefense.push(r);
                else if (i < 30) teamOffense.push(r);
                else waitingList.push(r);
            });
            db.updateActiveBangchien(partyKey, {
                team_defense: teamDefense,
                team_offense: teamOffense,
                waiting_list: waitingList
            });

            // Cập nhật embed
            try {
                if (notifData.message) await notifData.message.delete();
            } catch (e) { }

            const newEmbed = createBangchienEmbed(partyKey, notifData.leaderName, interaction.guild);
            const newRow = createBangchienButtons(partyKey);
            const newMessage = await interaction.channel.send({ embeds: [newEmbed], components: [newRow] });

            notifData.message = newMessage;
            notifData.messageId = newMessage.id;

            // Người được ưu tiên sẽ LUÔN vào danh sách chính (bypass MAX_MEMBERS)
            await interaction.update({
                content: `✅ Đã ưu tiên ${prioritizedUsers.length} thành viên lên danh sách chính: ${prioritizedUsers.map(u => u.username).join(', ')}`,
                components: []
            });
            return true;
        }

        // Không phải handler của file này
        return false;

    } catch (error) {
        console.error('[selectMenuHandlers] Error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '❌ Có lỗi xảy ra khi xử lý menu!',
                flags: MessageFlags.Ephemeral
            });
        }
        return true; // Đã xử lý lỗi
    }
}

module.exports = {
    handleSelectMenu
};
