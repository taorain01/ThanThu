/**
 * ?bcsize - ĐÃ KHÓA — Thay bằng UI Resize trong ?bcql hoặc Web Team Editor
 */

const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'bcsize',
    aliases: ['teamsize', 'bcsoluong'],
    description: '[KHÓA] Dùng nút 📏 Resize trong ?bcql hoặc Web Team Editor',

    async execute(message, args, client) {
        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('⛔ Lệnh ?bcsize đã bị khóa')
            .setDescription(
                '📏 **Resize đội hình** và **đổi tên team** đã được tích hợp vào UI thông minh hơn:\n\n' +
                '**Trên Discord:**\n' +
                '> Dùng `?bcql` → bấm nút **📏 Resize**\n\n' +
                '**Trên Web:**\n' +
                '> Mở **Team Editor** → bấm nút **Resize** ở góc trên phải'
            )
            .setFooter({ text: 'Bạn có thể thay đổi cả số slot lẫn tên team trong UI mới' });

        return message.reply({ embeds: [embed] });
    }
};
