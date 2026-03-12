const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const thongbao = require('./thongbao');
const { checkPermissionAndReply } = require('../../utils/permissionHelper');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('suathongbao')
        .setDescription('Sửa thông báo định kỳ')
        .addIntegerOption(option =>
            option.setName('so_thu_tu')
                .setDescription('Số thứ tự của thông báo cần sửa (xem bằng /listthongbao)')
                .setRequired(true)
                .setMinValue(1)
        )
        .addStringOption(option =>
            option.setName('tieu_de')
                .setDescription('Tiêu đề mới')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('noi_dung')
                .setDescription('Nội dung mới')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('thoi_gian')
                .setDescription('Giờ gửi mới (VD: 20h hoặc 20h30)')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('thu')
                .setDescription('Thứ trong tuần')
                .setRequired(true)
                .addChoices(
                    { name: 'Thứ 2', value: 2 },
                    { name: 'Thứ 3', value: 3 },
                    { name: 'Thứ 4', value: 4 },
                    { name: 'Thứ 5', value: 5 },
                    { name: 'Thứ 6', value: 6 },
                    { name: 'Thứ 7', value: 7 },
                    { name: 'Chủ nhật', value: 8 }
                )
        ),

    async execute(interaction, client) {
        // Kiểm tra quyền
        if (!await checkPermissionAndReply(interaction)) {
            return;
        }

        const index = interaction.options.getInteger('so_thu_tu');
        const newTitle = interaction.options.getString('tieu_de');
        const newMessage = interaction.options.getString('noi_dung');
        const newTimeInput = interaction.options.getString('thoi_gian');
        const newThu = interaction.options.getInteger('thu');

        // Lấy notification theo số thứ tự (không filter theo user)
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

        // Parse thời gian mới
        const timeRegex = /^(\d{1,2})[hH](\d{2})?$/;
        const match = newTimeInput.match(timeRegex);

        if (!match) {
            return interaction.reply({
                content: '❌ Định dạng thời gian không hợp lệ! Vui lòng sử dụng format: `XXh` hoặc `XXhYY` (VD: 20h30)'
            });
        }

        const newHours = parseInt(match[1], 10);
        const newMinutes = match[2] ? parseInt(match[2], 10) : 0;

        if (newHours < 0 || newHours > 23 || newMinutes < 0 || newMinutes > 59) {
            return interaction.reply({
                content: '❌ Thời gian không hợp lệ! Giờ phải từ 0-23 và phút phải từ 0-59.'
            });
        }

        // Tạo thời gian string
        const oldTimeStr = `${notification.hours.toString().padStart(2, '0')}h${notification.minutes.toString().padStart(2, '0')}`;
        const newTimeStr = `${newHours.toString().padStart(2, '0')}h${newMinutes.toString().padStart(2, '0')}`;

        // Tạo embed so sánh
        const compareEmbed = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle('📝 Xác nhận sửa thông báo')
            .setDescription('So sánh thông báo **CŨ** và **MỚI**:')
            .addFields(
                { name: '📌 Tiêu đề CŨ', value: notification.title, inline: true },
                { name: '📌 Tiêu đề MỚI', value: newTitle, inline: true },
                { name: '\u200B', value: '\u200B', inline: false },
                { name: '📝 Nội dung CŨ', value: notification.message.substring(0, 500), inline: true },
                { name: '📝 Nội dung MỚI', value: newMessage.substring(0, 500), inline: true },
                { name: '\u200B', value: '\u200B', inline: false },
                { name: '📅 Lịch CŨ', value: `${thongbao.dayNames[notification.thu]} lúc ${oldTimeStr}`, inline: true },
                { name: '📅 Lịch MỚI', value: `${thongbao.dayNames[newThu]} lúc ${newTimeStr}`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Nhấn nút bên dưới để xác nhận hoặc hủy' });

        // Tạo buttons
        const editId = `edit_${interaction.user.id}_${Date.now()}`;
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_edit_${editId}`)
                    .setLabel('✅ Xác nhận sửa')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`cancel_edit_${editId}`)
                    .setLabel('❌ Hủy bỏ')
                    .setStyle(ButtonStyle.Danger)
            );

        // Lưu pending edit
        client.pendingEdits.set(editId, {
            notificationId: notification.id,
            userId: interaction.user.id,
            channelId: interaction.channel.id,
            newData: {
                title: newTitle,
                message: newMessage,
                hours: newHours,
                minutes: newMinutes,
                thu: newThu
            },
            oldData: {
                title: notification.title,
                message: notification.message,
                hours: notification.hours,
                minutes: notification.minutes,
                thu: notification.thu
            }
        });

        // Tự động xóa pending edit sau 5 phút
        setTimeout(() => {
            client.pendingEdits.delete(editId);
        }, 5 * 60 * 1000);

        await interaction.reply({ embeds: [compareEmbed], components: [row] });
    }
};


