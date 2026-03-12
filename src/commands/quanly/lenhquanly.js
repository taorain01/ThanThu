const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    name: 'lenhquanly',
    aliases: ['qlcmd', 'admincmd', 'hiddencommands'],
    description: 'Hiển thị các lệnh quản lý và admin',

    async execute(message, args) {
        // Kiểm tra quyền - chỉ Quản Lý, Bang Chủ, Phó Bang Chủ được xem
        const member = message.member;
        const allowedRoles = ['Quản Lý', 'Bang Chủ', 'Phó Bang Chủ', 'Kỹ Cương'];
        const hasPermission = member.roles.cache.some(r => allowedRoles.includes(r.name));

        if (!hasPermission) {
            return message.reply({
                content: '❌ Bạn không có quyền xem lệnh này!',
                allowedMentions: { repliedUser: false }
            });
        }

        // Xử lý trang
        let page = 1;
        if (args[0] === '2' || args[0] === 'minigame') {
            page = 2;
        }

        const embed = this.createEmbed(page);
        const row = this.createButtons(page, message.author.id);

        return message.reply({ embeds: [embed], components: [row], allowedMentions: { repliedUser: false } });
    },

    createEmbed(page) {
        const prefix = process.env.PREFIX || '?';

        if (page === 1) {
            return new EmbedBuilder()
                .setColor(0xFF6B6B)
                .setTitle('🔐 Lệnh Quản Lý & Admin (Trang 1/2)')
                .setDescription('Danh sách các lệnh quản lý thành viên và sự kiện')
                .addFields(
                    {
                        name: '👥 **Quản Lý Thành Viên**',
                        value: [
                            `\`${prefix}addmem @user <vị trí> <uid> <tên> [Xnt]\` - Thêm thành viên`,
                            `\`${prefix}addid <uid> <tên> [Xnt]\` - Thêm ID chờ duyệt`,
                            `\`${prefix}xoamem @user\` - Xóa thành viên khỏi DB`,
                            `\`${prefix}roiguild @user\` - Đánh dấu rời guild`,
                            `\`${prefix}setkc <tên mới>\` - Đổi tên KC`,
                            `\`${prefix}xoabc\` - Xóa Bang Chủ`,
                            `\`${prefix}xoapbc\` - Xóa Phó Bang Chủ`,
                            `\`${prefix}rsrejoin @user\` - Reset số lần rejoin`,
                            `\`${prefix}locmem\` - Lọc người không trong DB`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '📋 **Danh Sách**',
                        value: [
                            `\`${prefix}listmem\` - DS thành viên hoạt động`,
                            `\`${prefix}listid\` - DS ID chờ duyệt`,
                            `\`${prefix}listallmem\` - DS tất cả (kể cả rời)`,
                            `\`${prefix}mem @user\` - Xem thông tin chi tiết`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '🎮 **Pick Role**',
                        value: [
                            `\`${prefix}pickrole @user <dps|healer|tanker>\` - Set role cho người khác *(Quản Lý)*`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '⚔️ **Bang Chiến**',
                        value: [
                            `\`${prefix}lenhbc\` - **XEM TẤT CẢ LỆNH BC**`,
                            `\`${prefix}bc\` - Tạo thông báo BC`,
                            `\`${prefix}bcql\` - Panel quản lý`,
                            `\`${prefix}listbc\` - Xem chi tiết`,
                            `\`${prefix}chotbc\` - Thêm role @Bang Chiến 30vs30`,
                            `\`${prefix}bcdoi\` \`${prefix}bcadd\` \`${prefix}bcchihuy\` \`${prefix}bcleader\``,
                            `\`${prefix}bcend\` - Kết thúc BC (xóa role + dọn dữ liệu)`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '📢 **Thông Báo**',
                        value: [
                            `\`/thongbaoguild\` - Thông báo sự kiện guild`,
                            `\`/thongbao\` - Đặt thông báo định kỳ`,
                            `\`/listthongbao\` - Xem danh sách thông báo`,
                            `\`/huythongbao\` - Hủy thông báo`,
                            `\`${prefix}bossguild\` - Đăng ký boss guild`,
                            `\`${prefix}lichboss\` - Xem lịch boss`,
                            `\`${prefix}nhacnho\` - Đăng ký nhắc nhở event`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '🔇 **Kênh**',
                        value: [
                            `\`${prefix}nominigame\` - Chặn/mở minigame trong kênh`,
                            `\`${prefix}muteall\` - Chặn/mở TẤT CẢ lệnh trong kênh`,
                            `\`${prefix}moon @user\` - Cho phép thấy voice channel`,
                            `\`${prefix}xmoon @user\` - Xóa quyền thấy voice channel`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '🔧 **Tiện Ích**',
                        value: [
                            `\`${prefix}addhelp\` - Hướng dẫn thêm thành viên`,
                            `\`${prefix}random <min> <max>\` - Random số`,
                            `\`${prefix}chon <a, b, c>\` - Chọn random`
                        ].join('\n'),
                        inline: false
                    }
                )
                .setTimestamp()
                .setFooter({ text: 'Trang 1/2 • Nhấn ▶️ để xem Minigame Admin' });
        } else {
            // Page 2 - Minigame Admin
            return new EmbedBuilder()
                .setColor(0xFFD700)
                .setTitle('💰 Lệnh Minigame Admin (Trang 2/2)')
                .setDescription('Các lệnh dành cho Owner để quản lý minigame')
                .addFields(
                    {
                        name: '💵 **Thêm Tài Nguyên**',
                        value: [
                            `\`${prefix}themtien @user <số>\` - Thêm Hạt cho người chơi`,
                            `\`${prefix}add @user <item_id> [số lượng]\` - Thêm item vào kho`,
                            `\`${prefix}addnhuafull @user\` - Full nhựa cho người chơi`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '🔄 **Reset Data**',
                        value: [
                            `\`${prefix}reset\` - Reset data chính mình`,
                            `\`${prefix}resetplayer @user\` - Reset data người chơi khác`,
                            `\`${prefix}resetallplayer\` - ⚠️ Reset TẤT CẢ người chơi`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '🏰 **Dungeon**',
                        value: [
                            `\`${prefix}donedung @user\` - Force hoàn thành dungeon`,
                            `\`${prefix}cleardung\` - Xóa session dungeon đang chạy`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '📝 **Ghi chú**',
                        value: [
                            '• Các lệnh này chỉ **Owner** được sử dụng',
                            '• Cẩn thận với `resetallplayer` - không thể hoàn tác!',
                            '• `item_id` lấy từ shop hoặc database'
                        ].join('\n'),
                        inline: false
                    }
                )
                .setTimestamp()
                .setFooter({ text: 'Trang 2/2 • Nhấn ◀️ để quay lại' });
        }
    },

    createButtons(currentPage, userId) {
        return new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`lenhquanly_prev_${userId}`)
                    .setLabel('◀️ Trang 1')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(currentPage === 1),
                new ButtonBuilder()
                    .setCustomId(`lenhquanly_next_${userId}`)
                    .setLabel('Trang 2 ▶️')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(currentPage === 2)
            );
    },

    async handleButton(interaction) {
        const customId = interaction.customId;
        const parts = customId.split('_');
        const action = parts[1]; // prev or next
        const authorId = parts[2];

        // Chỉ người dùng lệnh mới được nhấn
        if (interaction.user.id !== authorId) {
            return interaction.reply({
                content: '❌ Chỉ người dùng lệnh mới được chuyển trang!',
                ephemeral: true
            });
        }

        const page = action === 'next' ? 2 : 1;
        const embed = this.createEmbed(page);
        const row = this.createButtons(page, authorId);

        await interaction.update({ embeds: [embed], components: [row] });
    }
};
