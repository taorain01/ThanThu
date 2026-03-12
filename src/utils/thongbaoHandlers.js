/**
 * ═══════════════════════════════════════════════════════════════════════════
 * thongbaoHandlers.js - Handlers cho các nút liên quan đến Thông Báo
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Handlers:
 *   - confirm_edit_* : Xác nhận sửa thông báo
 *   - cancel_edit_*  : Hủy sửa thông báo
 *   - edit_confirm_* : Xác nhận sửa thông tin thành viên
 *   - edit_cancel_*  : Hủy sửa thông tin thành viên
 *   - delguild_*     : Xóa thông báo guild
 *   - confirm_delete_all_* : Xác nhận xóa tất cả thông báo
 *   - cancel_delete_all_*  : Hủy xóa tất cả thông báo
 *   - yentiec_time_confirm_* : Xác nhận thay đổi giờ Yến Tiệc
 *   - lenhquanly_*   : Pagination lệnh quản lý
 * 
 * Được import vào: src/events/client/interactionCreate.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

const { EmbedBuilder, MessageFlags } = require('discord.js');
const thongbao = require('../commands/thongbao/thongbao');
const thongbaoguild = require('../commands/thongbao/thongbaoguild');
const { handleConfirmButton: handleYentiecConfirm } = require('./yentiecReminder');

/**
 * Xử lý tất cả button interactions liên quan đến thông báo
 * @param {ButtonInteraction} interaction 
 * @param {Client} client 
 * @returns {boolean} true nếu đã xử lý, false nếu không phải handler này
 */
async function handleButton(interaction, client) {
    const customId = interaction.customId;

    try {
        // ═══════════════════════════════════════════════════════════════
        // Xử lý xác nhận sửa thông báo
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('confirm_edit_')) {
            const editId = customId.replace('confirm_edit_', '');
            const pendingEdit = client.pendingEdits.get(editId);

            if (!pendingEdit) {
                return interaction.reply({
                    content: '❌ Yêu cầu sửa đã hết hạn! Vui lòng thử lại.',
                    ephemeral: true
                });
            }

            // Kiểm tra người dùng
            if (pendingEdit.userId !== interaction.user.id) {
                return interaction.reply({
                    content: '❌ Bạn không có quyền thực hiện thao tác này!',
                    ephemeral: true
                });
            }

            // Thực hiện cập nhật
            const channel = await client.channels.fetch(pendingEdit.channelId);
            const success = thongbao.updateNotification(
                pendingEdit.notificationId,
                pendingEdit.newData,
                channel
            );

            // Xóa pending edit
            client.pendingEdits.delete(editId);

            if (success) {
                const newTimeStr = `${pendingEdit.newData.hours.toString().padStart(2, '0')}h${pendingEdit.newData.minutes.toString().padStart(2, '0')}`;

                const successEmbed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('✅ Đã sửa thông báo thành công!')
                    .addFields(
                        { name: '📌 Tiêu đề mới', value: pendingEdit.newData.title, inline: false },
                        { name: '📝 Nội dung mới', value: pendingEdit.newData.message, inline: false },
                        { name: '📅 Lịch gửi mới', value: `${thongbao.dayNames[pendingEdit.newData.thu]} lúc ${newTimeStr}`, inline: true }
                    )
                    .setTimestamp();

                await interaction.update({ embeds: [successEmbed], components: [] });
            } else {
                await interaction.reply({
                    content: '❌ Có lỗi xảy ra khi sửa thông báo!',
                    ephemeral: true
                });
            }
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý hủy sửa thông báo
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('cancel_edit_')) {
            const editId = customId.replace('cancel_edit_', '');
            const pendingEdit = client.pendingEdits.get(editId);

            if (pendingEdit && pendingEdit.userId === interaction.user.id) {
                client.pendingEdits.delete(editId);
            }

            const cancelEmbed = new EmbedBuilder()
                .setColor(0x808080)
                .setTitle('❌ Đã hủy sửa thông báo')
                .setDescription('Thông báo vẫn giữ nguyên như cũ.')
                .setTimestamp();

            await interaction.update({ embeds: [cancelEmbed], components: [] });
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý xác nhận chỉnh sửa thông tin thành viên
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('edit_confirm_')) {
            const db = require('../database/db');
            const parts = customId.split('_');
            const targetUserId = parts[2];
            const authorizedUserId = parts[3];

            // Check permission
            if (interaction.user.id !== authorizedUserId) {
                return interaction.reply({
                    content: '❌ Chỉ người tạo yêu cầu mới có thể xác nhận!',
                    flags: MessageFlags.Ephemeral
                });
            }

            const key = `${targetUserId}_${authorizedUserId}`;
            const pendingEdit = client.pendingEdits?.get(key);

            if (!pendingEdit) {
                return interaction.reply({
                    content: '❌ Yêu cầu chỉnh sửa đã hết hạn! Vui lòng thử lại.',
                    ephemeral: true
                });
            }

            // Apply updates to database
            try {
                const existingUser = db.getUserByDiscordId(targetUserId);
                if (!existingUser) {
                    return interaction.reply({
                        content: '❌ Không tìm thấy thành viên!',
                        ephemeral: true
                    });
                }

                // Prepare update data - GIỮ LẠI TẤT CẢ DỮ LIỆU CŨ
                const updateData = {
                    discordId: targetUserId,
                    discordName: existingUser.discord_name,
                    // Giữ lại dữ liệu cũ
                    gameUid: existingUser.game_uid,
                    gameUsername: existingUser.game_username,
                    position: existingUser.position,
                    joinedAt: existingUser.joined_at
                };

                // Chỉ ghi đè fields được update
                if (pendingEdit.updates.gameUid) updateData.gameUid = pendingEdit.updates.gameUid;
                if (pendingEdit.updates.gameUsername) updateData.gameUsername = pendingEdit.updates.gameUsername;
                if (pendingEdit.updates.joinedAt) updateData.joinedAt = pendingEdit.updates.joinedAt;
                if (pendingEdit.updates.position) updateData.position = pendingEdit.updates.position;

                // Update in database
                db.upsertUser(updateData);

                // Remove pending edit
                client.pendingEdits.delete(key);

                // Success embed
                const successEmbed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('✅ Đã cập nhật thông tin thành công!')
                    .setDescription(`Thông tin của <@${targetUserId}> đã được cập nhật.`)
                    .setTimestamp();

                await interaction.update({ embeds: [successEmbed], components: [] });
            } catch (error) {
                console.error('[thongbaoHandlers] Error updating member:', error);
                await interaction.reply({
                    content: '❌ Có lỗi xảy ra khi cập nhật thông tin!',
                    ephemeral: true
                });
            }
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý hủy chỉnh sửa thông tin thành viên
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('edit_cancel_')) {
            const authorizedUserId = customId.split('_')[2];

            if (interaction.user.id !== authorizedUserId) {
                return interaction.reply({
                    content: '❌ Chỉ người tạo yêu cầu mới có thể hủy!',
                    flags: MessageFlags.Ephemeral
                });
            }

            const cancelEmbed = new EmbedBuilder()
                .setColor(0x808080)
                .setTitle('❌ Đã hủy chỉnh sửa')
                .setDescription('Thông tin thành viên vẫn giữ nguyên.')
                .setTimestamp();

            await interaction.update({ embeds: [cancelEmbed], components: [] });
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý xóa thông báo Guild (customId: delguild_TYPE_INDEX_USERID)
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('delguild_')) {
            const parts = customId.split('_');
            const missionType = parts[1];
            const index = parseInt(parts[2], 10);
            const authorizedUserId = parts[3]; // User ID của người tạo yêu cầu

            // Kiểm tra quyền: Chỉ người dùng lệnh mới được xóa
            if (interaction.user.id !== authorizedUserId) {
                return interaction.reply({
                    content: '❌ Chỉ người tạo yêu cầu mới có thể xóa thông báo này!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Tìm và SORT notifications để đảm bảo index đúng
            const matchingNotifications = Array.from(thongbao.weeklyNotifications.values())
                .filter(n => n.isGuildMission && n.missionType === missionType && n.guildId === interaction.guild.id)
                .sort((a, b) => {
                    // Sort theo thời gian tạo (từ id)
                    const timeA = parseInt((a.id || a.notificationId).split('_')[1]);
                    const timeB = parseInt((b.id || b.notificationId).split('_')[1]);
                    return timeA - timeB;
                });

            if (matchingNotifications[index]) {
                const notificationId = matchingNotifications[index].id || matchingNotifications[index].notificationId;
                const success = thongbao.cancelNotification(notificationId);

                if (success) {
                    // Kiểm tra xem có pending create params không
                    const key = `${interaction.guild.id}_${missionType}_${interaction.user.id}`;
                    const pendingParams = interaction.client.pendingGuildCreate?.get(key);

                    if (pendingParams) {
                        // Tự động tạo notification mới
                        interaction.client.pendingGuildCreate.delete(key);

                        const template = thongbaoguild.guildTemplates[missionType];
                        const channel = await interaction.client.channels.fetch(pendingParams.channelId);

                        // Tạo fake interaction object để gọi createGuildNotification
                        const fakeInteraction = {
                            user: { id: pendingParams.userId },
                            guild: { id: pendingParams.guildId },
                            reply: async (options) => {
                                // Luôn xóa components (buttons) khi update
                                await interaction.update({ ...options, components: [] });
                            }
                        };

                        await thongbaoguild.createGuildNotification(
                            fakeInteraction,
                            pendingParams.missionType,
                            pendingParams.hours,
                            pendingParams.minutes,
                            pendingParams.thu,
                            channel,
                            template
                        );
                    } else {
                        // Không có pending params - chỉ hiển thị thông báo xóa thành công
                        const remainingNotifications = Array.from(thongbao.weeklyNotifications.values())
                            .filter(n => n.isGuildMission && n.missionType === missionType && n.guildId === interaction.guild.id)
                            .sort((a, b) => {
                                const timeA = parseInt((a.id || a.notificationId).split('_')[1]);
                                const timeB = parseInt((b.id || b.notificationId).split('_')[1]);
                                return timeA - timeB;
                            });

                        const embed = new EmbedBuilder()
                            .setColor(0x00FF00)
                            .setTitle(`✅ Đã xóa thông báo ${missionType}!`)
                            .setDescription(remainingNotifications.length > 0
                                ? `Còn lại **${remainingNotifications.length}** thông báo ${missionType}:`
                                : 'Bây giờ bạn có thể tạo thông báo mới bằng `/thongbaoguild`')
                            .setTimestamp();

                        // Hiển thị danh sách còn lại
                        if (remainingNotifications.length > 0) {
                            remainingNotifications.forEach((notif, idx) => {
                                const timeStr = `${notif.hours.toString().padStart(2, '0')}h${notif.minutes.toString().padStart(2, '0')}`;
                                const scheduleStr = notif.isDaily ? `Mỗi ngày lúc ${timeStr}` : `${thongbao.dayNames[notif.thu]} lúc ${timeStr}`;

                                embed.addFields({
                                    name: `Thông báo ${idx + 1}`,
                                    value: scheduleStr,
                                    inline: true
                                });
                            });
                        }

                        await interaction.update({ embeds: [embed], components: [] });
                    }
                } else {
                    await interaction.update({
                        content: '❌ Không thể xóa thông báo!',
                        components: []
                    });
                }
            } else {
                await interaction.update({
                    content: '❌ Không tìm thấy thông báo! Có thể đã bị xóa.',
                    components: []
                });
            }
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý xác nhận xóa tất cả thông báo
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('confirm_delete_all')) {
            // Kiểm tra quyền: Chỉ người dùng lệnh mới được xóa
            const parts = customId.split('_');
            const authorizedUserId = parts[3]; // userId từ customId

            if (authorizedUserId && interaction.user.id !== authorizedUserId) {
                return interaction.reply({
                    content: '❌ Chỉ người tạo yêu cầu mới có thể xóa!',
                    flags: MessageFlags.Ephemeral
                });
            }

            const allNotifications = thongbao.getUserNotifications(null, interaction.guild.id);
            let deletedCount = 0;

            for (const notif of allNotifications) {
                const notifId = notif.id || notif.notificationId;
                if (thongbao.cancelNotification(notifId)) {
                    deletedCount++;
                }
            }

            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Đã xóa tất cả thông báo!')
                .setDescription(`Đã xóa **${deletedCount}** thông báo của server.`)
                .setTimestamp();

            await interaction.update({ embeds: [embed], components: [] });
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý hủy xóa tất cả
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('cancel_delete_all')) {
            // Kiểm tra quyền: Chỉ người dùng lệnh mới được hủy
            const parts = customId.split('_');
            const authorizedUserId = parts[3]; // userId từ customId

            if (authorizedUserId && interaction.user.id !== authorizedUserId) {
                return interaction.reply({
                    content: '❌ Chỉ người tạo yêu cầu mới có thể hủy!',
                    flags: MessageFlags.Ephemeral
                });
            }

            const embed = new EmbedBuilder()
                .setColor(0x808080)
                .setTitle('❌ Đã hủy')
                .setDescription('Không có thông báo nào bị xóa.')
                .setTimestamp();

            await interaction.update({ embeds: [embed], components: [] });
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý YenTiec Time Change Confirm Button
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('yentiec_time_confirm_') ||
            customId.startsWith('yentiec_weekend_19_') ||
            customId.startsWith('yentiec_weekend_2230_') ||
            customId.startsWith('yentiec_weekday_confirm_')) {
            const handled = await handleYentiecConfirm(interaction);
            if (handled) return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý lenhquanly pagination buttons
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('lenhquanly_')) {
            const lenhquanlyCommand = require('../commands/quanly/lenhquanly');
            await lenhquanlyCommand.handleButton(interaction);
            return true;
        }

        // Không phải handler của file này
        return false;

    } catch (error) {
        console.error('[thongbaoHandlers] Error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '❌ Có lỗi xảy ra khi xử lý yêu cầu!',
                flags: MessageFlags.Ephemeral
            });
        }
        return true; // Đã xử lý lỗi
    }
}

module.exports = {
    handleButton
};
