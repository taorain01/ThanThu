const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { weeklyNotifications } = require('../../utils/notificationState');
const storage = require('../../utils/storage');
const { checkPermissionAndReply } = require('../../utils/permissionHelper');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('thongbao1lan')
        .setDescription('Đặt thông báo một lần vào ngày giờ cụ thể')
        .addStringOption(option =>
            option.setName('tieu_de')
                .setDescription('Tiêu đề thông báo')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('noi_dung')
                .setDescription('Nội dung chi tiết thông báo')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('thoi_gian')
                .setDescription('Giờ gửi (VD: 20h hoặc 20h30)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('ngay')
                .setDescription('Ngày gửi (VD: 15/01/2026)')
                .setRequired(true)
        )
        .addAttachmentOption(option =>
            option.setName('hinh_anh')
                .setDescription('Ảnh đính kèm (tùy chọn)')
                .setRequired(false)
        ),

    async execute(interaction) {
        // Kiểm tra quyền
        if (!await checkPermissionAndReply(interaction)) {
            return;
        }

        const title = interaction.options.getString('tieu_de');
        const message = interaction.options.getString('noi_dung');
        const timeInput = interaction.options.getString('thoi_gian');
        const dateInput = interaction.options.getString('ngay');
        const attachment = interaction.options.getAttachment('hinh_anh');
        const imageUrl = attachment ? attachment.url : null;
        const channel = interaction.channel;

        // Parse thời gian từ format "20h" hoặc "20h30"
        const timeRegex = /^(\d{1,2})[hH](\d{2})?$/;
        const timeMatch = timeInput.match(timeRegex);

        if (!timeMatch) {
            return interaction.reply({
                content: '❌ Định dạng thời gian không hợp lệ! Vui lòng sử dụng format: `XXh` hoặc `XXhYY` (VD: 20h30)'
            });
        }

        const hours = parseInt(timeMatch[1], 10);
        const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;

        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            return interaction.reply({
                content: '❌ Thời gian không hợp lệ! Giờ phải từ 0-23 và phút phải từ 0-59.'
            });
        }

        // Parse ngày từ format "dd/mm/yyyy"
        const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
        const dateMatch = dateInput.match(dateRegex);

        if (!dateMatch) {
            return interaction.reply({
                content: '❌ Định dạng ngày không hợp lệ! Vui lòng sử dụng format: `dd/mm/yyyy` (VD: 15/01/2026)'
            });
        }

        const day = parseInt(dateMatch[1], 10);
        const month = parseInt(dateMatch[2], 10) - 1; // JavaScript months are 0-indexed
        const year = parseInt(dateMatch[3], 10);

        // Tạo đối tượng Date theo múi giờ Việt Nam (UTC+7)
        // Tính timestamp theo UTC rồi trừ 7 tiếng để có đúng thời điểm VN
        const targetDate = new Date(Date.UTC(year, month, day, hours - 7, minutes, 0, 0));
        const now = new Date();

        // Kiểm tra ngày hợp lệ
        if (isNaN(targetDate.getTime())) {
            return interaction.reply({
                content: '❌ Ngày không hợp lệ!'
            });
        }

        // Kiểm tra ngày trong tương lai
        if (targetDate <= now) {
            return interaction.reply({
                content: '❌ Thời gian phải ở trong tương lai!'
            });
        }

        const delay = targetDate.getTime() - now.getTime();

        // Tạo ID unique cho notification
        const notificationId = `${interaction.user.id}_${Date.now()}`;

        // Hàm gửi thông báo
        const sendNotification = async () => {
            try {
                const notificationText = `## ${title}\n${message}`;
                if (imageUrl) {
                    await channel.send({ content: notificationText, files: [imageUrl] });
                } else {
                    await channel.send(notificationText);
                }

                // Tự động xóa khỏi danh sách sau khi gửi
                weeklyNotifications.delete(notificationId);
                console.log(`Thông báo 1 lần đã gửi và xóa: ${notificationId}`);
            } catch (error) {
                console.error('Lỗi khi gửi thông báo 1 lần:', error);
                weeklyNotifications.delete(notificationId);
            }
        };

        // Đặt timeout
        const timeoutId = setTimeout(sendNotification, delay);

        // Lưu thông tin notification vào weeklyNotifications (dùng chung với thongbao)
        weeklyNotifications.set(notificationId, {
            firstTimeoutId: timeoutId,
            intervalId: null,
            notificationId,
            userId: interaction.user.id,
            channelId: channel.id,
            guildId: interaction.guild.id,
            title,
            message,
            imageUrl,
            isOneTime: true,
            targetDate,
            hours,
            minutes,
            day,
            month: month + 1,
            year
        });

        // Lưu vào file
        storage.saveNotifications(weeklyNotifications);

        // Tính thời gian còn lại
        const delayMs = delay;
        const delayDays = Math.floor(delayMs / (24 * 60 * 60 * 1000));
        const delayHours = Math.floor((delayMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        const delayMinutes = Math.floor((delayMs % (60 * 60 * 1000)) / (60 * 1000));

        // Format ngày hiển thị
        const dateStr = `${day.toString().padStart(2, '0')}/${(month + 1).toString().padStart(2, '0')}/${year}`;
        const timeStr = `${hours.toString().padStart(2, '0')}h${minutes.toString().padStart(2, '0')}`;

        // Tạo embed xác nhận
        const confirmEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('✅ Đã đặt thông báo 1 lần thành công!')
            .addFields(
                { name: '📌 Tiêu đề', value: title, inline: false },
                { name: '📝 Nội dung', value: message, inline: false },
                { name: '📅 Ngày gửi', value: `**${dateStr}** lúc **${timeStr}**`, inline: false },
                { name: '⏳ Thời gian còn lại', value: `${delayDays} ngày ${delayHours} giờ ${delayMinutes} phút`, inline: true },
                { name: '📍 Kênh', value: `<#${channel.id}>`, inline: true },
                { name: '🔔 Loại', value: 'Một lần (tự động xóa sau khi gửi)', inline: true }
            )
            .setTimestamp()
            .setFooter({ text: `Dùng /listthongbao để xem | /huythongbao để hủy` });

        if (imageUrl) {
            confirmEmbed.addFields({ name: '🖼️ Ảnh', value: 'Có đính kèm ảnh', inline: true });
        }

        await interaction.reply({ embeds: [confirmEmbed] });
    }
};


