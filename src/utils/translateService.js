const translate = require('google-translate-api-x');
const { EmbedBuilder } = require('discord.js');

// Kênh cần theo dõi và gửi bản dịch
const TRANSLATE_CHANNEL_ID = '1449361220439248916';

// Cache để tránh dịch lại tin nhắn đã dịch
const translatedMessages = new Map();

// Thời gian giữ cache (1 giờ)
const CACHE_DURATION = 60 * 60 * 1000;

/**
 * Kiểm tra xem tin nhắn có cần dịch không
 */
function shouldTranslate(message) {
    // Chỉ dịch tin nhắn trong kênh được chỉ định
    if (message.channel.id !== TRANSLATE_CHANNEL_ID) return false;

    // Không dịch tin nhắn từ chính bot này
    if (message.author.id === message.client.user.id) return false;

    // Không dịch lệnh (tin nhắn bắt đầu bằng prefix)
    const prefix = process.env.PREFIX || '?';
    if (message.content && message.content.startsWith(prefix)) return false;

    // Đã dịch tin nhắn này rồi
    if (translatedMessages.has(message.id)) return false;

    return true;
}

/**
 * Danh sách từ phổ biến tiếng Anh cần dịch (không bảo vệ)
 * Những từ này dù viết hoa cũng sẽ được dịch
 */
const COMMON_WORDS_TO_TRANSLATE = new Set([
    'You', 'Your', 'Yours', 'Yourself',
    'I', 'Me', 'My', 'Mine', 'Myself',
    'We', 'Us', 'Our', 'Ours', 'Ourselves',
    'They', 'Them', 'Their', 'Theirs', 'Themselves',
    'He', 'Him', 'His', 'Himself',
    'She', 'Her', 'Hers', 'Herself',
    'It', 'Its', 'Itself',
    'Open', 'Close', 'Start', 'Stop', 'Begin', 'End',
    'Step', 'Steps', 'Click', 'Tap', 'Press', 'Select',
    'Go', 'Come', 'Move', 'Run', 'Walk',
    'Download', 'Upload', 'Install', 'Update',
    'Note', 'Notes', 'Warning', 'Tip', 'Tips',
    'New', 'Old', 'First', 'Last', 'Next', 'Previous',
    'All', 'Some', 'Any', 'None', 'Many', 'Few',
    'This', 'That', 'These', 'Those',
    'Here', 'There', 'Where', 'When', 'Why', 'How',
    'What', 'Which', 'Who', 'Whom', 'Whose',
    'And', 'Or', 'But', 'If', 'Then', 'Else',
    'For', 'From', 'To', 'With', 'Without',
    'In', 'On', 'At', 'By', 'Of', 'As',
    'More', 'Less', 'Most', 'Least',
    'Before', 'After', 'While', 'During',
    'Mobile', 'Desktop', 'Android', 'Device',
    'Continue', 'Play', 'Playing', 'Game',
    'Enter', 'Exit', 'Login', 'Logout'
]);

/**
 * Danh sách tên riêng cần bảo vệ (không dịch)
 * Bao gồm tên game, tên nhân vật, tên địa điểm, v.v.
 */
const PROTECTED_NAMES = [
    'Where Winds Meet',
    'Lang Gia Các',
    'Genshin Impact',
    'Honkai',
    'Wuthering Waves'
];

/**
 * Tìm và bảo vệ các danh từ riêng khỏi bị dịch
 * Trả về object chứa text đã xử lý và map để khôi phục
 */
function protectProperNouns(text) {
    const placeholders = new Map();
    let counter = 0;
    let processed = text;

    // Bước 1: Bảo vệ các tên riêng đã biết (case-insensitive)
    for (const name of PROTECTED_NAMES) {
        const regex = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        processed = processed.replace(regex, (match) => {
            const placeholder = `__PROPER_NOUN_${counter}__`;
            placeholders.set(placeholder, match);
            counter++;
            return placeholder;
        });
    }

    // Bước 2: Tìm các chuỗi từ viết hoa liên tiếp (3+ từ) - có thể là tên riêng
    // Ví dụ: "The Legend of Zelda", "Grand Theft Auto"
    processed = processed.replace(/([A-Z][a-z]+(?:\s+(?:of|the|and|in|on|at|to|for|with|a|an)?\s*[A-Z][a-z]+){2,})/g, (match) => {
        // Kiểm tra xem có từ phổ biến không
        const words = match.split(/\s+/);
        const hasCommonWord = words.some(w => COMMON_WORDS_TO_TRANSLATE.has(w));

        // Nếu toàn bộ là từ phổ biến, không bảo vệ
        if (words.every(w => COMMON_WORDS_TO_TRANSLATE.has(w) || ['of', 'the', 'and', 'in', 'on', 'at', 'to', 'for', 'with', 'a', 'an'].includes(w.toLowerCase()))) {
            return match;
        }

        // Nếu là chuỗi dài có từ đặc biệt, bảo vệ
        const placeholder = `__PROPER_NOUN_${counter}__`;
        placeholders.set(placeholder, match);
        counter++;
        return placeholder;
    });

    return { processed, placeholders };
}

/**
 * Khôi phục các danh từ riêng đã bảo vệ
 */
function restoreProperNouns(text, placeholders) {
    let result = text;
    for (const [placeholder, original] of placeholders) {
        result = result.replace(placeholder, original);
    }
    return result;
}

/**
 * Dịch nội dung sang tiếng Việt
 */
async function translateToVietnamese(text) {
    if (!text || text.trim().length === 0) return null;

    try {
        // Bảo vệ danh từ riêng trước khi dịch
        const { processed, placeholders } = protectProperNouns(text);

        const result = await translate(processed, {
            from: 'en',
            to: 'vi',
            autoCorrect: true
        });

        // Khôi phục danh từ riêng sau khi dịch
        const restored = restoreProperNouns(result.text, placeholders);
        return restored;
    } catch (error) {
        console.error('[Translate] Lỗi khi dịch:', error.message);
        return null;
    }
}

/**
 * Xử lý dịch tin nhắn
 */
async function handleTranslation(message) {
    if (!shouldTranslate(message)) return;

    try {
        // Kiểm tra có nội dung để dịch không trước khi đánh dấu
        const hasContent = message.content && message.content.trim().length > 0;
        const hasEmbeds = message.embeds && message.embeds.length > 0;

        // Nếu không có nội dung text lẫn embed → bỏ qua, KHÔNG đánh dấu đã dịch
        // để messageUpdate có thể dịch khi embed load xong
        if (!hasContent && !hasEmbeds) return;

        // Đánh dấu đã xử lý (chỉ khi có nội dung để dịch)
        translatedMessages.set(message.id, true);

        // Xóa cache cũ sau 1 giờ
        setTimeout(() => {
            translatedMessages.delete(message.id);
        }, CACHE_DURATION);

        let translatedContent = null;
        if (hasContent) {
            translatedContent = await translateToVietnamese(message.content);
        }

        const translatedEmbeds = [];
        if (message.embeds && message.embeds.length > 0) {
            for (const oldEmbed of message.embeds) {
                const newEmbed = new EmbedBuilder();

                // Clone properties
                if (oldEmbed.color) newEmbed.setColor(oldEmbed.color);
                if (oldEmbed.timestamp) newEmbed.setTimestamp(new Date(oldEmbed.timestamp));

                if (oldEmbed.author) {
                    newEmbed.setAuthor({
                        name: oldEmbed.author.name,
                        iconURL: oldEmbed.author.iconURL,
                        url: oldEmbed.author.url
                    });
                }

                if (oldEmbed.thumbnail) newEmbed.setThumbnail(oldEmbed.thumbnail.url);
                if (oldEmbed.image) newEmbed.setImage(oldEmbed.image.url);

                if (oldEmbed.footer) {
                    const translatedFooter = oldEmbed.footer.text ? await translateToVietnamese(oldEmbed.footer.text) : null;
                    newEmbed.setFooter({
                        text: translatedFooter || oldEmbed.footer.text,
                        iconURL: oldEmbed.footer.iconURL
                    });
                }

                if (oldEmbed.url) newEmbed.setURL(oldEmbed.url);

                // Translate textual properties
                if (oldEmbed.title) {
                    const translatedTitle = await translateToVietnamese(oldEmbed.title);
                    newEmbed.setTitle(translatedTitle || oldEmbed.title);
                }

                if (oldEmbed.description) {
                    const translatedDesc = await translateToVietnamese(oldEmbed.description);
                    newEmbed.setDescription(translatedDesc || oldEmbed.description);
                }

                if (oldEmbed.fields && oldEmbed.fields.length > 0) {
                    for (const field of oldEmbed.fields) {
                        const translatedName = field.name ? await translateToVietnamese(field.name) : null;
                        const translatedValue = await translateToVietnamese(field.value);
                        newEmbed.addFields({
                            name: translatedName || field.name,
                            value: translatedValue || field.value,
                            inline: field.inline
                        });
                    }
                }

                translatedEmbeds.push(newEmbed);
            }
        }

        // Gửi bản dịch
        if (translatedContent || translatedEmbeds.length > 0) {
            const replyOptions = {
                allowedMentions: { repliedUser: false }
            };

            if (translatedContent) {
                replyOptions.content = `🌐 **Bản dịch:**\n${translatedContent}`;
            } else {
                replyOptions.content = `🌐 **Bản dịch từ bot:**`;
            }

            if (translatedEmbeds.length > 0) {
                replyOptions.embeds = translatedEmbeds;
            }

            await message.reply(replyOptions);
        }
    } catch (error) {
        console.error('[Translate] Lỗi xử lý dịch:', error);
    }
}

/**
 * Khởi tạo translation service
 */
function initTranslateService(client) {
    // Lắng nghe tất cả tin nhắn (bao gồm cả từ bot/webhook)
    client.on('messageCreate', async (message) => {
        try {
            await handleTranslation(message);
        } catch (error) {
            console.error('[Translate] Lỗi không mong đợi:', error);
        }
    });
}

module.exports = {
    initTranslateService,
    handleTranslation,
    translateToVietnamese,
    TRANSLATE_CHANNEL_ID
};
