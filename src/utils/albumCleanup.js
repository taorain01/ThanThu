const db = require('../database/db');
const cloudinaryService = require('./cloudinaryService');

async function resolveAlbumChannel(options = {}) {
    if (options.channel) return options.channel;
    if (!options.client) return null;

    const albumChannelId = db.getAlbumChannelId();
    if (!albumChannelId) return null;
    return options.client.channels.fetch(albumChannelId).catch(() => null);
}

async function cleanupAlbumForUser(userId, reason = 'unknown', options = {}) {
    const id = String(userId || '').trim();
    if (!id) {
        return { deleted: 0, cloudinaryDeleted: 0, cloudinaryFailed: 0, discordMessagesDeleted: 0, discordMessagesFailed: 0 };
    }

    const images = db.getAllAlbumImagesByUser(id);
    let cloudinaryDeleted = 0;
    let cloudinaryFailed = 0;
    let discordMessagesDeleted = 0;
    let discordMessagesFailed = 0;

    const cloudinaryUrls = new Set(
        images
            .map(image => image.image_url)
            .filter(url => typeof url === 'string' && url.includes('cloudinary.com'))
    );

    for (const imageUrl of cloudinaryUrls) {
        try {
            const result = await cloudinaryService.deleteByUrl(imageUrl);
            if (result.success) cloudinaryDeleted++;
            else cloudinaryFailed++;
        } catch (error) {
            cloudinaryFailed++;
            console.error(`[AlbumCleanup] Cloudinary delete failed for ${id}:`, error.message);
        }
    }

    const deleteResult = db.deleteAllAlbumImagesByUser(id);

    const messageIds = new Set(images.map(image => image.message_id).filter(Boolean));
    if (messageIds.size > 0) {
        const albumChannel = await resolveAlbumChannel(options);
        if (albumChannel) {
            for (const messageId of messageIds) {
                const albumMessage = await albumChannel.messages.fetch(messageId).catch(() => null);
                if (!albumMessage) continue;
                try {
                    await albumMessage.delete();
                    discordMessagesDeleted++;
                } catch (error) {
                    discordMessagesFailed++;
                    console.error(`[AlbumCleanup] Discord message delete failed for ${id}/${messageId}:`, error.message);
                }
            }
        }
    }

    try {
        db.clearUserAvatar(id);
        db.updateUserRandomAvatar(id, 0, null);
    } catch (error) {
        console.error(`[AlbumCleanup] Avatar cleanup failed for ${id}:`, error.message);
    }

    try {
        const cardCache = require('./memberCardCache');
        cardCache.invalidateUser(id);
    } catch (error) { }

    if (deleteResult.changes > 0 || cloudinaryDeleted > 0 || cloudinaryFailed > 0 || discordMessagesDeleted > 0 || discordMessagesFailed > 0) {
        console.log(
            `[AlbumCleanup] user=${id} reason=${reason} db_deleted=${deleteResult.changes} cloudinary_deleted=${cloudinaryDeleted} cloudinary_failed=${cloudinaryFailed} discord_messages_deleted=${discordMessagesDeleted} discord_messages_failed=${discordMessagesFailed}`
        );
    }

    return {
        deleted: deleteResult.changes,
        cloudinaryDeleted,
        cloudinaryFailed,
        discordMessagesDeleted,
        discordMessagesFailed
    };
}

module.exports = {
    cleanupAlbumForUser
};
