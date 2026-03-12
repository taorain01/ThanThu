/**
 * ?lotohelp / ?lth - Hướng dẫn chơi Loto + danh sách lệnh
 */

const { EmbedBuilder } = require('discord.js');

async function execute(message, args) {
    const prefix = process.env.PREFIX || '?';

    const embed = new EmbedBuilder()
        .setColor('#E74C3C')
        .setTitle('🎰 HƯỚNG DẪN CHƠI LOTO')
        .setDescription([
            '### 📖 Cách chơi',
            '1️⃣ Mỗi người chọn **1 lá Loto** riêng (xem lá bằng `?lta`).',
            '2️⃣ **Nhà cái** bắt đầu ván bằng `?lt`, sau đó dùng nút trên bảng để bốc số.',
            '3️⃣ Khi số được bốc trùng với số trên lá của bạn → **Đánh dấu** vào.',
            '4️⃣ Khi có **5 số thẳng hàng ngang** đã được đánh dấu → Bấm nút **KINH** ngay!',
            '',
            '### 🎯 Luật Thắng (KINH)',
            '- Bạn phải có đủ **5 số** trên cùng **1 hàng ngang** đã được bốc.',
            '- Nếu kiểm tra đúng → 🎉 **BẠN THẮNG!**',
            '- Nếu sai (chưa đủ/sai số) → ❌ Phạt và tiếp tục chơi.',
        ].join('\n'))
        .addFields(
            {
                name: '👤 Lệnh Cho Người Chơi',
                value: [
                    `\`${prefix}lta\` - Xem lá số của bạn (Album)`,
                    `\`${prefix}ltc\` - Kiểm tra các số đã bốc`,
                    `\`${prefix}lth\` - Xem hướng dẫn này`,
                    `📢 **Nút KINH** - Bấm trên bảng số khi bạn thắng`,
                ].join('\n'),
                inline: false
            },
            {
                name: '🎩 Lệnh Cho Nhà Cái (Host)',
                value: [
                    `\`${prefix}lt\` - Bắt đầu ván mới (Bốc số đầu tiên)`,
                    `\`${prefix}lte\` - Kết thúc ván (Xóa bảng, reset)`,
                    `\`${prefix}ltrb\` - Rollback (Khôi phục) ván nếu lỡ tắt`,
                    `\`${prefix}ltt <số>\` - Thêm số vào sàn (sửa sai)`,
                    `\`${prefix}ltb <số>\` - Bỏ số khỏi sàn (sửa sai)`,
                    `🎲 **Nút Bốc Số** - Bốc số tiếp theo`,
                    `🔄 **Nút Auto** - Tự động bốc (3s/số)`,
                ].join('\n'),
                inline: false
            },
            {
                name: '🔧 Admin Only',
                value: [
                    `\`${prefix}lt on/off\` - Bật/Tắt hệ thống Loto`,
                ].join('\n'),
                inline: false
            }
        )
        .setFooter({ text: 'CHƠI LOTO KHÔNG NGHIỆN ĐÂU!!! - Chúc may mắn!' })
        .setTimestamp();

    return message.reply({ embeds: [embed] });
}

module.exports = { execute };
