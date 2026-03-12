const { createEventRoleMenu } = require('./eventRoleMenu');

/**
 * Gửi tin nhắn thông báo kèm event role menu
 * Tự động xóa menu cũ trong channel (nếu có)
 * 
 * @param {Client} client - Discord client
 * @param {TextChannel} channel - Channel để gửi
 * @param {Object} messageOptions - Options cho message (content, embeds, files)
 * @returns {Message} - Message object đã gửi
 */
async function sendNotificationWithMenu(client, channel, messageOptions) {
    try {
        console.log('[menuManager] Đang gửi notification với menu...');

        // Bước 1: Xóa menu cũ (nếu có)
        const lastMenu = client.lastEventMenuMessage?.get(channel.id);

        if (lastMenu) {
            try {
                const oldMessage = await channel.messages.fetch(lastMenu.messageId);
                // Chỉ xóa components (menu), không xóa tin nhắn
                await oldMessage.edit({ components: [] });
            } catch (error) {
                // Tin nhắn cũ có thể đã bị xóa - không sao, bỏ qua
                console.log(`[menuManager] Không thể xóa menu cũ: ${error.message}`);
            }
        }

        // Bước 2: Gửi tin nhắn mới với menu
        const eventMenu = createEventRoleMenu();
        console.log('[menuManager] Đã tạo eventMenu:', eventMenu ? 'OK' : 'NULL');

        const newMessage = await channel.send({
            ...messageOptions,
            components: [eventMenu]
        });

        console.log('[menuManager] Đã gửi message với menu, ID:', newMessage.id);

        // Bước 3: Lưu message ID để xóa lần sau
        if (client.lastEventMenuMessage) {
            client.lastEventMenuMessage.set(channel.id, {
                messageId: newMessage.id,
                timestamp: Date.now()
            });
        }

        return newMessage;

    } catch (error) {
        console.error('[menuManager] Lỗi khi gửi thông báo với menu:', error.message);

        // Fallback: Vẫn cố gắng gửi VỚI menu
        try {
            console.log('[menuManager] Fallback - cố gắng gửi lại VỚI menu');
            const eventMenu = createEventRoleMenu();
            return await channel.send({
                ...messageOptions,
                components: [eventMenu]
            });
        } catch (fallbackError) {
            console.error('[menuManager] Fallback thất bại hoàn toàn:', fallbackError.message);
            return await channel.send(messageOptions);
        }
    }
}

/**
 * Cleanup menu cũ hơn 1 giờ từ Map (tránh memory leak)
 * Gọi định kỳ hoặc khi bot ready
 */
function cleanupOldMenus(client) {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    let cleaned = 0;

    for (const [channelId, data] of client.lastEventMenuMessage.entries()) {
        if (data.timestamp < oneHourAgo) {
            client.lastEventMenuMessage.delete(channelId);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        console.log(`🧹 Đã cleanup ${cleaned} menu cũ khỏi Map`);
    }
}

module.exports = {
    sendNotificationWithMenu,
    cleanupOldMenus
};


