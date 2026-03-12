const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'lenhbangchien',
    aliases: ['lenhbc', 'bchelp', 'helpbc'],
    description: 'Hiển thị tất cả lệnh Bang Chiến',

    async execute(message, args, client) {
        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('⚔️ LỆNH BANG CHIẾN')
            .setDescription('🔧 **Dùng `?bcql` để quản lý dễ dàng hơn!**\n💡 Thêm `t7` hoặc `cn` để chỉ định ngày (VD: `?bc t7`, `?listbc cn`)')
            .addFields(
                {
                    name: '📝 TẠO & CHỐT',
                    value: '`?bc t7/cn` Tạo mới\n`?bcchot` Chốt DS\n`?huybc` Hủy',
                    inline: true
                },
                {
                    name: '📋 XEM',
                    value: '`?listbc t7/cn` DS chi tiết\n`?bcql` **Panel quản lý**',
                    inline: true
                },
                {
                    name: '⚙️ CÀI ĐẶT',
                    value: '`?bcsize` Số lượng team\n`?bcrole` Xem thống kê role',
                    inline: true
                },
                {
                    name: '🔄 SẮP XẾP',
                    value: '`?bcdoi 5 15` Đổi chỗ 2 người\n`?bcmove @user thu` Di chuyển\n`?bcadd @user` Thêm người',
                    inline: false
                },
                {
                    name: '👑 LEADER',
                    value: '`?bcchihuy @user` Chỉ Huy tổng\n`?bcleader 1 @user` Leader team 1/2/thu/rung',
                    inline: false
                },
                {
                    name: '🏁 KẾT THÚC',
                    value: '`?bcchot` Add role BC\n`?bcend` Kết thúc hoàn toàn',
                    inline: false
                }
            )
            .setFooter({ text: 'Slot: Công1 → Công2 → Thủ → Rừng | Dùng ?bcsize để xem/đổi số lượng' })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    }
};

