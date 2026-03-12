/**
 * Event: messageDelete
 * Xử lý khi message bị xóa - sync với album
 */

const db = require('../../database/db');

module.exports = {
    name: 'messageDelete',
    async execute(message, client) {
        // Bỏ qua nếu không có guild
        if (!message.guild) return;

        // Kiểm tra nếu message từ kênh Phòng Ảnh
        const albumChannelId = db.getAlbumChannelId();
        if (!albumChannelId || message.channel.id !== albumChannelId) return;

        // Xóa ảnh khỏi album nếu có
        const result = db.deleteAlbumImageByMessageId(message.id);
        if (result.changes > 0) {
            console.log(`[Album] Đã xóa ${result.changes} ảnh từ message ${message.id}`);
        }
    }
};
