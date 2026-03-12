const db = require('../../database/db');

module.exports = {
    name: 'setgieoque',
    description: 'Set channel chính thức cho bot gieo quẻ (Admin only)',
    execute(message, args) {
        // Chỉ cho phép user ID 395151484179841024
        if (message.author.id !== '395151484179841024') {
            return message.reply('❌ Bạn không có quyền sử dụng lệnh này!');
        }

        const channel = message.mentions.channels.first() || message.channel;

        db.setGieoQueChannelId(channel.id);

        // Reset activity for the timer logic (even if implemented in memory/DB)
        db.setLastActivityGieoQue(Date.now());

        const guideEmbed = {
            color: 0xFFD700, // Gold
            title: '🔮 Gieo Quẻ & Cầu Duyên Mỗi Ngày 🔮',
            description: `Kênh ${channel} đã được thiết lập để gieo quẻ mỗi ngày!\n\n` +
                `👉 **\`?gieoque [câu hỏi]\`**: Xin quẻ tổng quan (công việc, tài lộc, sự nghiệp...).\n` +
                `👉 **\`?cauduyen [câu hỏi]\`**: Xin quẻ tình duyên (cho nam thanh nữ tú).\n\n` +
                `*Ví dụ: \`?gieoque hôm nay có may mắn không?\`*\n\n` +
                `⚠️ **Lưu ý:**\n` +
                `- Mỗi người chỉ được gieo **1 quẻ công danh** và **1 quẻ tình duyên** mỗi ngày.\n` +
                `- Quẻ chỉ phán cho ngày hôm nay, reset mỗi ngày mới.\n` +
                `- Bot sẽ gửi lại hướng dẫn này mỗi 30 phút nếu kênh vắng vẻ.`,
            footer: { text: '🔮 Mỗi ngày một quẻ, vận may tự đến! 🔮' }
        };

        return message.reply({ content: '✅ Đã thiết lập thành công!', embeds: [guideEmbed] });
    },
};
