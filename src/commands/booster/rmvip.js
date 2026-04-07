const { MessageFlags } = require('discord.js');
const db = require('../../database/db');

const ALLOWED_USER_ID = '395151484179841024';

async function execute(message, args, client) {
    // Chỉ cho phép user cụ thể
    if (message.author.id !== ALLOWED_USER_ID) {
        return message.reply('❌ Bạn không có quyền sử dụng lệnh này!');
    }

    if (args.length === 0) {
        return message.reply('❌ Vui lòng tag hoặc nhập ID của user!\nVí dụ: `?rmvip @user` hoặc `?rmvip 123456789`');
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

    // Xoá khỏi database
    const result = db.removeBoosterVipUser(targetId);
    
    if (result.success) {
        // Lấy tên nếu có thể
        const targetMember = await message.guild.members.fetch(targetId).catch(() => null);
        const nameDisplay = targetMember ? targetMember.displayName : targetId;
        
        await message.reply(`✅ Đã gỡ **${nameDisplay}** khỏi danh sách VIP Booster Room.`);
    } else {
        if (result.reason === 'not_found') {
            await message.reply(`⚠️ User này không có trong danh sách VIP!`);
        } else {
            await message.reply('❌ Đã xảy ra lỗi khi gỡ VIP!');
        }
    }
}

module.exports = { 
    name: 'rmvip',
    execute 
};
