function normalizeEmojiName(rawName) {
    return String(rawName || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function sanitizeTtsText(input) {
    let text = String(input || '');
    if (!text) return '';

    text = text
        // Custom Discord emoji: chỉ giữ tên, bỏ ID dài
        .replace(/<a?:([a-zA-Z0-9_]{2,32}):\d+>/g, (_, emojiName) => {
            const normalized = normalizeEmojiName(emojiName);
            return normalized ? ` ${normalized} ` : ' ';
        })
        // Bỏ các mention Discord để bot không đọc ID/tag
        .replace(/<@!?\d+>/g, ' ')
        .replace(/<@&\d+>/g, ' ')
        .replace(/<#\d+>/g, ' ')
        .replace(/@everyone|@here/gi, ' ')
        // Bỏ timestamp Discord nếu có
        .replace(/<t:\d+(?::[tTdDfFR])?>/g, ' ')
        // Dọn khoảng trắng thừa
        .replace(/\s+([,.;!?])/g, '$1')
        .replace(/([(\[{])\s+/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trim();

    return text;
}

module.exports = {
    sanitizeTtsText
};
