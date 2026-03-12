/**
 * ?xoatoanbodanhsachthanhvien - Delete all members from database
 * Only user ID 395151484179841024 can use this command
 * Requires 3 confirmations before deleting
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../../database/db');

// Owner ID - only this user can delete all members
const OWNER_ID = '395151484179841024';

// Track confirmation states
const confirmationStates = new Map();

/**
 * Execute xoatoanbodanhsachthanhvien command
 */
async function execute(message, args) {
    // Check permission - only owner can use
    if (message.author.id !== OWNER_ID) {
        return message.channel.send('❌ Bạn không có quyền sử dụng lệnh này!');
    }

    const memberCount = db.getUserCount();

    if (memberCount === 0) {
        return message.channel.send('📋 Danh sách thành viên đang trống!');
    }

    // Create confirmation ID
    const confirmId = `deleteall_${message.author.id}_${Date.now()}`;

    // Store confirmation state (0 = not confirmed yet)
    confirmationStates.set(confirmId, { count: 0, userId: message.author.id });

    // Set expiry (60 seconds)
    setTimeout(() => {
        confirmationStates.delete(confirmId);
    }, 60000);

    const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('⚠️ XÁC NHẬN XÓA TOÀN BỘ THÀNH VIÊN')
        .setDescription(`Bạn đang chuẩn bị xóa **${memberCount}** thành viên!\n\n` +
            '**⚠️ CẢNH BÁO: Hành động này KHÔNG THỂ hoàn tác!**\n\n' +
            'Cần xác nhận **3 lần** để xóa.\n' +
            '**Xác nhận: 0/3**')
        .setFooter({ text: 'Hết hạn sau 60 giây' })
        .setTimestamp();

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`confirmdeleteall_${confirmId}`)
                .setLabel('🗑️ Xác nhận xóa (0/3)')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`canceldeleteall_${confirmId}`)
                .setLabel('❌ Hủy')
                .setStyle(ButtonStyle.Secondary)
        );

    await message.channel.send({ embeds: [embed], components: [row] });
}

/**
 * Handle button interaction
 */
async function handleButton(interaction) {
    const customId = interaction.customId;

    if (customId.startsWith('confirmdeleteall_')) {
        const confirmId = customId.replace('confirmdeleteall_', '');
        const state = confirmationStates.get(confirmId);

        if (!state) {
            return interaction.update({
                content: '❌ Yêu cầu đã hết hạn! Sử dụng lại lệnh ?xoatoanbodanhsachthanhvien',
                embeds: [],
                components: []
            });
        }

        // Check user
        if (interaction.user.id !== state.userId) {
            return interaction.reply({
                content: '❌ Chỉ người tạo yêu cầu mới có thể xác nhận!',
                ephemeral: true
            });
        }

        // Increment confirmation count
        state.count++;
        confirmationStates.set(confirmId, state);

        if (state.count >= 3) {
            // Delete all members
            const allUsers = db.getAllUsers();
            let deletedCount = 0;

            for (const user of allUsers) {
                if (db.deleteUser(user.discord_id).success) {
                    deletedCount++;
                }
            }

            confirmationStates.delete(confirmId);

            const successEmbed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Đã xóa toàn bộ thành viên!')
                .setDescription(`Đã xóa **${deletedCount}** thành viên khỏi database.`)
                .setTimestamp();

            return interaction.update({ embeds: [successEmbed], components: [] });
        }

        // Update embed with new count
        const memberCount = db.getUserCount();
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('⚠️ XÁC NHẬN XÓA TOÀN BỘ THÀNH VIÊN')
            .setDescription(`Bạn đang chuẩn bị xóa **${memberCount}** thành viên!\n\n` +
                '**⚠️ CẢNH BÁO: Hành động này KHÔNG THỂ hoàn tác!**\n\n' +
                `**Xác nhận: ${state.count}/3**\n` +
                `Còn **${3 - state.count}** lần xác nhận nữa để xóa.`)
            .setFooter({ text: 'Hết hạn sau 60 giây' })
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirmdeleteall_${confirmId}`)
                    .setLabel(`🗑️ Xác nhận xóa (${state.count}/3)`)
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`canceldeleteall_${confirmId}`)
                    .setLabel('❌ Hủy')
                    .setStyle(ButtonStyle.Secondary)
            );

        return interaction.update({ embeds: [embed], components: [row] });
    }

    if (customId.startsWith('canceldeleteall_')) {
        const confirmId = customId.replace('canceldeleteall_', '');
        confirmationStates.delete(confirmId);

        const cancelEmbed = new EmbedBuilder()
            .setColor(0x808080)
            .setTitle('❌ Đã hủy')
            .setDescription('Không có thành viên nào bị xóa.')
            .setTimestamp();

        return interaction.update({ embeds: [cancelEmbed], components: [] });
    }
}

module.exports = { execute, handleButton };


