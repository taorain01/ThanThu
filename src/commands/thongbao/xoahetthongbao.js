const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const thongbao = require('./thongbao');
const storage = require('../../utils/storage');
const { checkPermissionAndReply } = require('../../utils/permissionHelper');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('xoahetthongbao')
        .setDescription('Xóa tất cả thông báo của server'),

    async execute(interaction) {
        // Kiểm tra quyền
        if (!await checkPermissionAndReply(interaction)) {
            return;
        }

        // Lấy tất cả thông báo của server
        const allNotifications = thongbao.getUserNotifications(null, interaction.guild.id);

        if (allNotifications.length === 0) {
            return interaction.reply({
                content: '📭 Server chưa có thông báo nào để xóa!'
            });
        }

        // Tạo embed xác nhận
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('⚠️ Xác nhận xóa tất cả thông báo')
            .setDescription(`Server có **${allNotifications.length}** thông báo.\n\n**Bạn có chắc chắn muốn xóa HẾT?**\n\nHành động này không thể hoàn tác!`)
            .setTimestamp();

        // Tạo buttons xác nhận với userId
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_delete_all_${interaction.user.id}`)
                    .setLabel('✅ Xác nhận xóa hết')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`cancel_delete_all_${interaction.user.id}`)
                    .setLabel('❌ Hủy')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.reply({ embeds: [embed], components: [row] });
    }
};


