const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { setRequiredRole, getRequiredRole, removeRequiredRole, isOwner } = require('../../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rolethongbao')
        .setDescription('Đặt role yêu cầu để sử dụng các lệnh thông báo (Chỉ Owner)')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role cần có để dùng lệnh thông báo (bỏ trống để xóa yêu cầu)')
                .setRequired(false)
        ),

    async execute(interaction) {
        // Kiểm tra quyền Owner
        if (!isOwner(interaction.user.id)) {
            return interaction.reply({
                content: '❌ Chỉ Owner bot mới có thể sử dụng lệnh này!',
                flags: MessageFlags.Ephemeral
            });
        }

        const role = interaction.options.getRole('role');

        // Nếu không có role → Xóa yêu cầu
        if (!role) {
            removeRequiredRole(interaction.guild.id);

            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Đã xóa yêu cầu role')
                .setDescription('Bây giờ mọi người đều có thể sử dụng các lệnh thông báo.')
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }

        // Set role yêu cầu
        setRequiredRole(interaction.guild.id, role.id);

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('✅ Đã đặt role yêu cầu')
            .setDescription(`Chỉ những người có role ${role} mới có thể sử dụng các lệnh thông báo.`)
            .addFields(
                {
                    name: '📋 Các lệnh bị giới hạn:',
                    value: '• `/thongbao`\n• `/thongbaoguild`\n• `/thongbao1lan`\n• `/huythongbao`\n• `/suathongbao`\n• `/xoahetthongbao`',
                    inline: false
                },
                {
                    name: 'ℹ️ Lưu ý:',
                    value: '• Owner bot luôn có quyền sử dụng\n• `/listthongbao` vẫn dùng được bình thường',
                    inline: false
                }
            )
            .setTimestamp()
            .setFooter({ text: 'Dùng /rolethongbao không có role để xóa yêu cầu' });

        await interaction.reply({ embeds: [embed] });
    }
};


