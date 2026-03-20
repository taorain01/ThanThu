/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 📌 HƯỚNG DẪN THÊM HANDLER MỚI
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * ⚠️ KHÔNG thêm code handler trực tiếp vào file này!
 * 
 * Thay vào đó, tạo file mới trong src/utils/:
 *   1. Tạo file: src/utils/[tên]Handlers.js
 *   2. Export hàm: handleButton(interaction, client) hoặc handleSelectMenu(...)
 *   3. Import vào file này và route theo prefix customId
 * 
 * Ví dụ đã có:
 *   - src/utils/thongbaoHandlers.js
 *   - src/utils/pickroleHandlers.js
 *   - src/utils/bcqlHandlers.js
 * 
 * Xem kế hoạch chi tiết: kehoach/refactor_interactionCreate.md
 * ═══════════════════════════════════════════════════════════════════════════
 */

const { InteractionType, MessageFlags } = require("discord.js");

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER IMPORTS
// ═══════════════════════════════════════════════════════════════════════════
const { handleBcqlButton, handleBcqlSelect, handleBcqlModal } = require('../../utils/bcqlHandlers');
const thongbaoHandlers = require('../../utils/thongbaoHandlers');
const pickroleHandlers = require('../../utils/pickroleHandlers');
const quanlyHandlers = require('../../utils/quanlyHandlers');
const voteHandlers = require('../../utils/voteHandlers');
const bossHandlers = require('../../utils/bossHandlers');
const bangchienJoinLeaveHandlers = require('../../utils/bangchienJoinLeaveHandlers');
const bangchienManageHandlers = require('../../utils/bangchienManageHandlers');
const bcMenuHandlers = require('../../utils/bcMenuHandlers');
const selectMenuHandlers = require('../../utils/selectMenuHandlers');
const albumHandlers = require('../../utils/albumHandlers');
const lotoHandlers = require('../../utils/lotoHandlers');
const boosterVoiceHandlers = require('../../utils/boosterVoiceHandlers');
const nlListHandlers = require('../../utils/nlListHandlers');

// Load allowed guild ID from environment
const ALLOWED_GUILD_ID = process.env.guildId;

module.exports = {
  name: "interactionCreate",
  async execute(interaction, client) {
    // ═══════════════════════════════════════════════════════════════════════
    // GUILD VALIDATION (chỉ chặn slash commands, cho phép button/select/modal
    // vì bot đã tự gửi message có component ở guild đó rồi)
    // ═══════════════════════════════════════════════════════════════════════
    if (ALLOWED_GUILD_ID && interaction.guildId !== ALLOWED_GUILD_ID) {
      if (interaction.isCommand()) {
        return interaction.reply({
          content: '❌ Bot chỉ hoạt động trên server được cấu hình!',
          flags: MessageFlags.Ephemeral
        });
      }
      // Không chặn button/select/modal — cho phép hoạt động ở mọi guild
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SLASH COMMANDS
    // ═══════════════════════════════════════════════════════════════════════
    if (interaction.isCommand()) {
      if (interaction.type === InteractionType.ApplicationCommand) {
        if (interaction.user.bot) return;
      }

      try {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        await command.execute(interaction, client);
      } catch (error) {
        console.error('Lỗi khi thực thi command:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Đã xảy ra lỗi!', flags: MessageFlags.Ephemeral });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // BUTTON INTERACTIONS
    // ═══════════════════════════════════════════════════════════════════════
    if (interaction.isButton()) {
      try {
        const customId = interaction.customId;
        console.log('[interactionCreate] BUTTON nhận được, customId:', customId);

        // ROUTE 1: Thông báo handlers
        if (customId.startsWith('confirm_edit_') || customId.startsWith('cancel_edit_') ||
          customId.startsWith('edit_confirm_') || customId.startsWith('edit_cancel_') ||
          customId.startsWith('delguild_') || customId.startsWith('confirm_delete_all') ||
          customId.startsWith('cancel_delete_all') || customId.startsWith('yentiec_time_confirm_') ||
          customId.startsWith('yentiec_weekend_') || customId.startsWith('yentiec_weekday_') ||
          customId.startsWith('lenhquanly_')) {
          const handled = await thongbaoHandlers.handleButton(interaction, client);
          if (handled) return;
        }

        // ROUTE 2: Pickrole handlers
        if (customId.startsWith('pickrole_')) {
          const handled = await pickroleHandlers.handleButton(interaction, client);
          if (handled) return;
        }

        // ROUTE 3: Quản lý handlers
        if (customId.startsWith('listmem_') || customId.startsWith('listid_') ||
          customId.startsWith('listallmem_') || customId.startsWith('confirmdeleteall_') ||
          customId.startsWith('canceldeleteall_') || customId.startsWith('addid_confirm_') ||
          customId.startsWith('addid_cancel_') || customId.startsWith('addid_reset_') ||
          customId.startsWith('addid_rejoin_') || customId.startsWith('addid_resetcancel_') ||
          customId.startsWith('locmem_') ||
          customId.startsWith('listbc_view_')) {
          const handled = await quanlyHandlers.handleButton(interaction, client);
          if (handled) return;
        }

        // ROUTE 4: Vote handlers
        if (customId.startsWith('vote')) {
          const handled = await voteHandlers.handleButton(interaction, client);
          if (handled) return;
        }

        // ROUTE 5: Boss handlers
        if (customId.startsWith('boss_')) {
          const handled = await bossHandlers.handleButton(interaction, client);
          if (handled) return;
        }

        // ROUTE 6: Bang Chien Join/Leave handlers
        if (customId.startsWith('bangchien_join_') || customId.startsWith('bangchien_leave_')) {
          const handled = await bangchienJoinLeaveHandlers.handleButton(interaction, client);
          if (handled) return;
        }

        // ROUTE 7: Bang Chien Manage handlers
        if (customId.startsWith('bangchien_regular_') || customId.startsWith('bangchien_kick_') ||
          customId.startsWith('bangchien_priority_') || customId.startsWith('bangchien_finalize_')) {
          const handled = await bangchienManageHandlers.handleButton(interaction, client);
          if (handled) return;
        }

        // ROUTE 8: BCQL handlers (Panel quản lý BC)
        if (customId.startsWith('bcql_')) {
          const handled = await handleBcqlButton(interaction);
          if (handled) return;
        }

        // ROUTE 9: BC Menu handlers (Ephemeral menu đăng ký multi-day + xem chi tiết)
        if (customId.startsWith('bc_menu_') || customId.startsWith('bcmenu_') ||
          customId.startsWith('bc_viewdetail_') || customId.startsWith('bc_viewlist_') ||
          customId.startsWith('bc_regular_')) {
          const handled = await bcMenuHandlers.handleBcMenuButton(interaction);
          if (handled) return;
        }

        // ROUTE 10: Album handlers
        if (customId.startsWith('album_')) {
          const handled = await albumHandlers.handleAlbumButton(interaction);
          if (handled) return;
        }

        // ROUTE 11: Serverbot handlers (owner only)
        if (customId.startsWith('serverbot_')) {
          const serverbotCommand = require('../../commands/admin/serverbot');
          const handled = await serverbotCommand.handleButton(interaction);
          if (handled) return;
        }

        // ROUTE 12: Loto handlers
        if (customId.startsWith('loto_')) {
          const handled = await lotoHandlers.handleButton(interaction, client);
          if (handled) return;
        }

        // ROUTE 13: Booster Voice Room handlers
        if (customId.startsWith('boostvc_')) {
          const handled = await boosterVoiceHandlers.handleButton(interaction);
          if (handled) return;
        }

        // ROUTE 14: Booster Panel persistent buttons (booster_create / booster_delete)
        if (customId === 'booster_create' || customId === 'booster_delete') {
          const handled = await boosterVoiceHandlers.handlePanelButton(interaction);
          if (handled) return;
        }

        // ROUTE 15: NhacLabs Key List handlers (pagination, tìm kiếm, chọn key)
        if (customId.startsWith('nlkey_')) {
          const handled = await nlListHandlers.handleButton(interaction);
          if (handled) return;
        }

        // ROUTE 16: Schedule English button - Reply ephemeral bản tiếng Anh lịch sự kiện
        if (customId === 'schedule_english') {
          const { EmbedBuilder } = require('discord.js');
          const { getWeeklySchedule } = require('../../commands/thongbao/thongbaoguild');
          const guildId = interaction.guild.id;
          const weeklyScheduleEN = getWeeklySchedule(guildId, true, 'en');
          if (!weeklyScheduleEN) {
            return interaction.reply({ content: '📭 No guild events scheduled!', flags: MessageFlags.Ephemeral });
          }
          const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('📅 WEEKLY EVENT SCHEDULE')
            .setDescription(weeklyScheduleEN)
            .setTimestamp()
            .setFooter({ text: 'Lang Gia Các' });
          return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

      } catch (error) {
        console.error('Lỗi khi xử lý button:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Đã xảy ra lỗi!', flags: MessageFlags.Ephemeral });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SELECT MENU INTERACTIONS
    // ═══════════════════════════════════════════════════════════════════════
    if (interaction.isStringSelectMenu()) {
      try {
        const customId = interaction.customId;
        console.log('[interactionCreate] SELECT MENU nhận được, customId:', customId);

        // Route to selectMenuHandlers (event role, bangchien kick/priority)
        // Lưu ý: show_role_select_ đã chuyển sang collector trong show.js
        if (customId === 'event_role_select' ||
          customId.startsWith('bangchien_kick_select_') || customId.startsWith('bangchien_priority_select_')) {
          const handled = await selectMenuHandlers.handleSelectMenu(interaction, client);
          if (handled) return;
        }

        // BCQL select menus
        if (customId.startsWith('bcql_') && customId.includes('_select_')) {
          const handled = await handleBcqlSelect(interaction);
          if (handled) return;
        }

        // Vote select menus
        if (customId === 'voteyentiec_time') {
          const voteyentiecCommand = require('../../commands/apps/voteyentiec');
          await voteyentiecCommand.handleVote(interaction);
          return;
        }

        if (customId === 'votecustom_select') {
          const voteCommand = require('../../commands/apps/vote');
          await voteCommand.handleVote(interaction);
          return;
        }

        if (customId.startsWith('votebosssolo_') || customId.startsWith('votepvpsolo_')) {
          // These are handled by their respective command files via collectors
          return;
        }

        // bcswap select menu
        if (customId.startsWith('bcswap_')) {
          const bcswapCommand = require('../../commands/bangchien/bcswap');
          if (bcswapCommand.handleSelectMenu) {
            await bcswapCommand.handleSelectMenu(interaction);
            return;
          }
        }

        // locmem select menu
        if (customId.startsWith('locmem_select_')) {
          const locmemCommand = require('../../commands/quanly/locmem');
          await locmemCommand.handleInteraction(interaction);
          return;
        }

        // serverbot invite select menu (owner only)
        if (customId.startsWith('serverbot_invite_select_')) {
          const serverbotCommand = require('../../commands/admin/serverbot');
          const handled = await serverbotCommand.handleSelectMenu(interaction);
          if (handled) return;
        }

        // Booster Voice Room select menus
        if (customId.startsWith('boostvc_')) {
          const handled = await boosterVoiceHandlers.handleSelectMenu(interaction);
          if (handled) return;
        }

        // NhacLabs Key List filter select menu
        if (customId.startsWith('nlkey_filter_select_')) {
          const handled = await nlListHandlers.handleSelectMenu(interaction);
          if (handled) return;
        }

      } catch (error) {
        console.error('Lỗi khi xử lý select menu:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Đã xảy ra lỗi!', flags: MessageFlags.Ephemeral });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MODAL SUBMIT INTERACTIONS
    // ═══════════════════════════════════════════════════════════════════════
    if (interaction.type === InteractionType.ModalSubmit) {
      try {
        const customId = interaction.customId;

        // BCQL modals (Panel quản lý BC)
        if (customId.startsWith('bcql_')) {
          const handled = await handleBcqlModal(interaction);
          if (handled) return;
        }

        // Listmem search modal
        if (customId.startsWith('listmem_modal_')) {
          const handled = await quanlyHandlers.handleModalSubmit(interaction);
          if (handled) return;
        }

        // Booster Voice Room modals
        if (customId.startsWith('boostvc_modal_')) {
          const handled = await boosterVoiceHandlers.handleModal(interaction);
          if (handled) return;
        }

        // NhacLabs Key List modals (tìm kiếm + chọn key theo STT)
        if (customId.startsWith('nlkey_modal_')) {
          const handled = await nlListHandlers.handleModalSubmit(interaction);
          if (handled) return;
        }

      } catch (error) {
        console.error('Lỗi khi xử lý modal:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Đã xảy ra lỗi!', flags: MessageFlags.Ephemeral });
        }
      }
    }
  }
};
