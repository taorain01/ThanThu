/**
 * ═══════════════════════════════════════════════════════════════════════════
 * quanlyHandlers.js - Handlers cho các nút Quản Lý Thành Viên
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Handlers:
 *   - listmem_*         : Pagination/random danh sách thành viên
 *   - listid_*          : Pagination danh sách ID
 *   - listallmem_*      : Pagination/random tất cả thành viên
 *   - confirmdeleteall_ : Xác nhận xóa tất cả thành viên
 *   - canceldeleteall_  : Hủy xóa tất cả thành viên
 *   - addid_confirm_    : Xác nhận thêm ID
 *   - addid_cancel_     : Hủy thêm ID
 *   - locmem_*          : Lọc member (prev, next, confirm, cancel)
 * 
 * Được import vào: src/events/client/interactionCreate.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

const { MessageFlags } = require('discord.js');

// Lazy load commands để tránh circular dependency
const getListmemCommand = () => require('../commands/quanly/listmem');
const getListidCommand = () => require('../commands/quanly/listid');
const getListallmemCommand = () => require('../commands/quanly/listallmem');
const getXoaAllCommand = () => require('../commands/quanly/xoatoanbodanhsachthanhvien');
const getAddidCommand = () => require('../commands/quanly/addid');
const getLocmemCommand = () => require('../commands/quanly/locmem');

/**
 * Xử lý tất cả button interactions liên quan đến quản lý thành viên
 * @param {ButtonInteraction} interaction 
 * @param {Client} client 
 * @returns {boolean} true nếu đã xử lý, false nếu không phải handler này
 */
async function handleButton(interaction, client) {
    const customId = interaction.customId;

    try {
        // ═══════════════════════════════════════════════════════════════
        // Xử lý listmem pagination/random buttons
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('listmem_')) {
            await getListmemCommand().handleButton(interaction);
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý listid pagination buttons
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('listid_')) {
            await getListidCommand().handleButton(interaction);
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý listallmem pagination/random buttons
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('listallmem_')) {
            await getListallmemCommand().handleButton(interaction);
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý xoatoanbodanhsachthanhvien confirm/cancel buttons
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('confirmdeleteall_') || customId.startsWith('canceldeleteall_')) {
            await getXoaAllCommand().handleButton(interaction);
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý addid confirmation buttons
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('addid_confirm_') || customId.startsWith('addid_cancel_')) {
            await getAddidCommand().handleConfirmation(interaction);
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý locmem buttons (prev, next, confirm, cancel)
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('locmem_prev_') || customId.startsWith('locmem_next_') ||
            customId.startsWith('locmem_confirm_') || customId.startsWith('locmem_cancel_')) {
            await getLocmemCommand().handleInteraction(interaction);
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // Xử lý listbc_view buttons (xem chi tiết T7/CN)
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('listbc_view_sat_') || customId.startsWith('listbc_view_sun_')) {
            const day = customId.includes('_sat_') ? 'sat' : 'sun';
            const guildId = interaction.guild.id;
            const db = require('../database/db');
            const { DAY_CONFIG, listbcDetailMessages } = require('./bangchienState');
            const listbcCommand = require('../commands/bangchien/listbangchien');

            const session = db.getActiveBangchienByDay(guildId, day);
            if (!session) {
                await interaction.reply({
                    content: `📭 Chưa có phiên BC ${DAY_CONFIG[day].name} đang chạy!`,
                    flags: MessageFlags.Ephemeral
                });
                return true;
            }

            // Tạo một fake message object để showDetailedSession sử dụng
            // vì hàm đó dùng message.reply()
            let sentMessage = null;
            const fakeMessage = {
                guild: interaction.guild,
                channel: interaction.channel,
                reply: async (options) => {
                    // Đối với button interaction, dùng reply thay vì message.reply
                    sentMessage = await interaction.reply({ ...options, fetchReply: true });
                    return sentMessage;
                }
            };

            await listbcCommand.showDetailedSession(fakeMessage, session, true, day, true);

            // Lưu message reference để có thể refresh sau này
            if (sentMessage) {
                const listbcKey = `${guildId}_${day}`;
                listbcDetailMessages.set(listbcKey, {
                    message: sentMessage,
                    messageId: sentMessage.id,
                    channelId: interaction.channel.id
                });
                console.log(`[quanlyHandlers] Saved listbc detail message for ${listbcKey}`);
            }
            return true;
        }

        // Không phải handler của file này
        return false;

    } catch (error) {
        console.error('[quanlyHandlers] Error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '❌ Có lỗi xảy ra khi xử lý yêu cầu!',
                flags: MessageFlags.Ephemeral
            });
        }
        return true; // Đã xử lý lỗi
    }
}

/**
 * Xử lý modal submit interactions liên quan đến quản lý thành viên
 * @param {ModalSubmitInteraction} interaction 
 * @returns {boolean} true nếu đã xử lý, false nếu không phải handler này
 */
async function handleModalSubmit(interaction) {
    const customId = interaction.customId;

    try {
        // ═══════════════════════════════════════════════════════════════
        // Xử lý listmem search modal
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('listmem_modal_')) {
            await getListmemCommand().handleModalSubmit(interaction);
            return true;
        }

        // Không phải handler của file này
        return false;

    } catch (error) {
        console.error('[quanlyHandlers] Modal Error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '❌ Có lỗi xảy ra khi xử lý tìm kiếm!',
                flags: MessageFlags.Ephemeral
            });
        }
        return true;
    }
}

module.exports = {
    handleButton,
    handleModalSubmit
};
