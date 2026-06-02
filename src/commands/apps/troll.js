const ttsService = require('../../utils/ttsService');

const ALLOWED_USER_ID = '395151484179841024';

function canUse(message) {
    return message.author?.id === ALLOWED_USER_ID;
}

async function reply(message, content) {
    try {
        await message.reply(content);
    } catch (_) {
        // The command can be used from any channel the bot can read, even if it cannot reply there.
    }
}

async function execute(message, args) {
    if (!canUse(message)) return;

    const guildId = message.guild?.id;
    if (!guildId) return;

    const text = args.join(' ').trim();
    if (!text) {
        return reply(message, 'Cú pháp: `?troll nội dung cần đọc`');
    }

    if (!ttsService.isConnected(guildId)) {
        return reply(message, 'Bot chưa ở voice channel nào. Dùng `?join` trước.');
    }

    const spoken = await ttsService.speak(guildId, text);
    if (!spoken) {
        return reply(message, 'Không đọc được nội dung này.');
    }
}

module.exports = {
    name: 'troll',
    ALLOWED_USER_ID,
    canUse,
    execute
};
