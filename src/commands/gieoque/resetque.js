const db = require('../../database/db');

module.exports = {
    name: 'resetque',
    description: 'Reset lượt gieo quẻ/cầu duyên trong ngày (Admin)',
    aliases: ['rsq'],
    async execute(message, args) {
        // 1. Kiểm tra quyền hạn (Hardcoded User ID)
        if (message.author.id !== '395151484179841024') {
            return message.reply('❌ Bạn không có quyền sử dụng lệnh này!');
        }

        let targetId = null;
        let targetName = '';

        // 2. Xác định đối tượng reset
        if (args.length === 0) {
            // Reset bản thân
            targetId = message.author.id;
            targetName = message.author.username;
        } else {
            // Reset người khác
            const mention = message.mentions.users.first();
            if (mention) {
                targetId = mention.id;
                targetName = mention.username;
            } else {
                // Thử tìm theo UID hoặc Username
                const input = args[0];

                // Nếu là UID (độ dài snowflake ~18-19 ký tự số)
                if (/^\d{17,19}$/.test(input)) {
                    targetId = input;
                    // Lấy tên nếu có thể (từ cache hoặc DB)
                    const user = db.getUserByDiscordId(targetId);
                    targetName = user ? user.discord_name : targetId;
                } else {
                    // Tìm theo username (DB search)
                    const users = db.searchUsers(input);
                    if (users.length > 0) {
                        targetId = users[0].discord_id;
                        targetName = users[0].discord_name;
                    } else {
                        return message.reply(`❌ Không tìm thấy người dùng nào với từ khóa "${input}"`);
                    }
                }
            }
        }

        if (!targetId) {
            return message.reply('❌ Không xác định được người dùng cần reset.');
        }

        // 3. Thực hiện reset
        try {
            db.resetGieoQueUsage(targetId);
            db.resetCauDuyenUsage(targetId);
            return message.reply(`✅ Đã reset lượt gieo quẻ & cầu duyên hôm nay cho **${targetName}**!`);
        } catch (error) {
            console.error('[ResetQue] Error:', error);
            return message.reply(`❌ Lỗi khi reset: \`${error.message}\``);
        }
    },
};
