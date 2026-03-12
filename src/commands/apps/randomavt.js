const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');

module.exports = {
    name: 'randomavt',
    aliases: ['rda'],
    description: 'Bật/tắt chế độ random avatar từ album',
    async execute(message, args) {
        const userId = message.author.id;

        // Kiểm tra xem user có ảnh trong album không
        const imageCount = db.getAlbumImageCount(userId);
        if (imageCount === 0 && args[0]?.toLowerCase() !== 'off') {
            return message.reply('❌ Album của bạn đang trống! Hãy gửi ảnh vào Phòng Ảnh để lưu trước khi bật chế độ này.');
        }

        // Trường hợp tắt: ?randomavt off
        if (args[0]?.toLowerCase() === 'off') {
            db.updateUserRandomAvatar(userId, 0, null);
            return message.reply('✅ Đã **tắt** chế độ random avatar. Bot sẽ dùng avatar bạn đã set thủ công (hoặc avatar mặc định).');
        }

        // Trường hợp random theo list: ?randomavt 1 2 5
        if (args.length > 0) {
            const numbers = args.map(arg => parseInt(arg)).filter(n => !isNaN(n) && n > 0 && n <= imageCount);

            if (numbers.length === 0) {
                return message.reply('❌ Danh sách số ảnh không hợp lệ! Vui lòng nhập số ảnh có trong album (VD: `?rda 1 2 5`).');
            }

            // Lưu dưới dạng JSON array
            db.updateUserRandomAvatar(userId, 2, JSON.stringify(numbers));
            return message.reply(`✅ Đã bật chế độ random avatar từ danh sách ảnh: **${numbers.join(', ')}**. Khi bạn dùng \`?mem\`, bot sẽ bốc ngẫu nhiên 1 trong các ảnh này.`);
        }

        // Trường hợp random tất cả: ?randomavt
        db.updateUserRandomAvatar(userId, 1, null);
        return message.reply(`✅ Đã bật chế độ random từ **TẤT CẢ** ${imageCount} ảnh trong album của bạn.`);
    }
};
