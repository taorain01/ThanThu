const { MessageFlags } = require('discord.js');
const db = require('../../database/db');

const ALLOWED_USER_ID = '395151484179841024';

async function execute(message, args, client) {
    // Chỉ cho phép user cụ thể
    if (message.author.id !== ALLOWED_USER_ID) {
        return message.reply('❌ Bạn không có quyền sử dụng lệnh này!');
    }

    if (args.length === 0) {
        return message.reply('❌ Vui lòng tag hoặc nhập ID của user!\nVí dụ: `?addvip @user` hoặc `?addvip 123456789`');
    }

    let targetId;
    const mentionMatch = args[0].match(/^<@!?(\d+)>$/);
    
    if (mentionMatch) {
        targetId = mentionMatch[1];
    } else {
        targetId = args[0];
    }

    if (!/^\d{17,20}$/.test(targetId)) {
        return message.reply('❌ ID không hợp lệ!');
    }

    // Lấy thành viên
    const targetMember = await message.guild.members.fetch(targetId).catch(() => null);
    if (!targetMember) {
        return message.reply('❌ Không tìm thấy user này trong server!');
    }

    // Thêm vào database
    const result = db.addBoosterVipUser(targetId);
    
    if (result.success) {
        await message.reply(`✅ Đã thêm **${targetMember.displayName}** vào danh sách VIP Booster Room.\nBây giờ họ có thể tạo và sử dụng tính năng của Booster Room như một server booster.`);
    } else {
        if (result.reason === 'already_exists') {
            await message.reply(`⚠️ User **${targetMember.displayName}** đã có trong danh sách VIP từ trước!`);
        } else {
            await message.reply('❌ Đã xảy ra lỗi khi thêm VIP!');
        }
    }
}

module.exports = { 
    name: 'addvip',
    execute 
};
