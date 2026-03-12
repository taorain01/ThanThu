const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const thongbao = require('./thongbao');
const { checkPermissionAndReply } = require('../../utils/permissionHelper');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('huythongbao')
        .setDescription('Hủy thông báo')
        .addIntegerOption(option =>
            option.setName('so_thu_tu')
                .setDescription('Số thứ tự của thông báo cần hủy (xem bằng /listthongbao)')
                .setRequired(true)
                .setMinValue(1)
        ),

    async execute(interaction) {
        // Kiểm tra quyền
        if (!await checkPermissionAndReply(interaction)) {
            return;
        }

        const index = interaction.options.getInteger('so_thu_tu');

        // Lấy notification theo số thứ tự (không cần check userId nữa)
        const notification = thongbao.getNotificationByIndex(
            null, // Không filter theo user
            interaction.guild.id,
            index
        );

        if (!notification) {
            return interaction.reply({
                content: `❌ Không tìm thấy thông báo số ${index}! Dùng \`/listthongbao\` để xem danh sách.`
            });
        }

        // Hủy notification
        const success = thongbao.cancelNotification(notification.id);

        if (success) {
            const timeStr = `${notification.hours.toString().padStart(2, '0')}h${notification.minutes.toString().padStart(2, '0')}`;

            const embed = new EmbedBuilder()
                .setColor(0xED4245)
                .setTitle('🗑️ Đã hủy thông báo!')
                .addFields(
                    { name: '📌 Tiêu đề', value: notification.title, inline: false },
                    { name: '📝 Nội dung', value: notification.message.substring(0, 500), inline: false },
                    { name: '👤 Người tạo', value: `<@${notification.userId}>`, inline: true },
                    { name: '🗑️ Người hủy', value: `<@${interaction.user.id}>`, inline: true }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        } else {
            await interaction.reply({
                content: '❌ Có lỗi xảy ra khi hủy thông báo!'
            });
        }
    }
};


