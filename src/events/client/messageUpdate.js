const { handleTranslation, TRANSLATE_CHANNEL_ID } = require('../../utils/translateService');

module.exports = {
    name: 'messageUpdate',
    async execute(oldMessage, newMessage, client) {
        try {
            // Fetch full message nếu là partial (chưa cache)
            if (newMessage.partial) {
                try {
                    newMessage = await newMessage.fetch();
                } catch (e) {
                    console.error('[MessageUpdate] Không thể fetch message:', e.message);
                    return;
                }
            }

            // Chỉ xử lý trong kênh translate
            if (newMessage.channel.id !== TRANSLATE_CHANNEL_ID) return;

            // Không dịch tin nhắn từ chính bot
            if (!newMessage.author || newMessage.author.id === client.user.id) return;

            // Chỉ xử lý khi có embed mới được thêm vào
            if (!newMessage.embeds || newMessage.embeds.length === 0) return;

            // Chỉ xử lý nếu embed mới nhiều hơn embed cũ (Discord vừa load embed)
            const oldEmbedCount = (oldMessage.partial || !oldMessage.embeds) ? 0 : oldMessage.embeds.length;
            if (newMessage.embeds.length <= oldEmbedCount) return;

            // Gọi handleTranslation để dịch
            await handleTranslation(newMessage);
        } catch (error) {
            console.error('[MessageUpdate] Lỗi xử lý dịch khi update:', error);
        }
    }
};
