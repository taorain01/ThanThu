const { translateToVietnamese } = require('../../utils/translateService');
const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'dich',
    aliases: ['translate', 'dichtiengviet'],
    description: 'Dịch tin nhắn phía trên sang tiếng Việt',

    async execute(message, args) {
        try {
            // Xóa lệnh ?dich ngay lập tức
            await message.delete().catch(() => { });

            // Tìm tin nhắn cần dịch
            let targetMessage = null;

            // Nếu reply vào tin nhắn → dịch tin nhắn đó
            if (message.reference && message.reference.messageId) {
                try {
                    targetMessage = await message.channel.messages.fetch(message.reference.messageId);
                } catch (e) {
                    return message.channel.send('❌ Không tìm thấy tin nhắn được reply.').then(m => setTimeout(() => m.delete().catch(() => { }), 5000));
                }
            } else {
                // Không reply → quét các tin nhắn phía trên để tìm tin nhắn có nội dung/embed
                const prefix = process.env.PREFIX || '?';
                const messages = await message.channel.messages.fetch({ limit: 10, before: message.id });

                // Tìm tin nhắn đầu tiên có nội dung hoặc embed để dịch
                targetMessage = messages.find(m => {
                    // Bỏ qua tin nhắn từ chính bot
                    if (m.author.id === message.client.user.id) return false;
                    // Bỏ qua các lệnh
                    if (m.content && m.content.startsWith(prefix)) return false;
                    // Phải có content hoặc embed
                    const hasContent = m.content && m.content.trim().length > 0;
                    const hasEmbeds = m.embeds && m.embeds.length > 0;
                    return hasContent || hasEmbeds;
                });
            }

            if (!targetMessage) {
                return message.channel.send('❌ Không tìm thấy tin nhắn để dịch.').then(m => setTimeout(() => m.delete().catch(() => { }), 5000));
            }

            // Kiểm tra có nội dung để dịch không
            const hasContent = targetMessage.content && targetMessage.content.trim().length > 0;
            const hasEmbeds = targetMessage.embeds && targetMessage.embeds.length > 0;

            if (!hasContent && !hasEmbeds) {
                return message.channel.send('❌ Tin nhắn không có nội dung text hoặc embed để dịch.').then(m => setTimeout(() => m.delete().catch(() => { }), 5000));
            }

            // Dịch content
            let translatedContent = null;
            if (hasContent) {
                translatedContent = await translateToVietnamese(targetMessage.content);
            }

            // Dịch embeds
            const translatedEmbeds = [];
            if (hasEmbeds) {
                for (const oldEmbed of targetMessage.embeds) {
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

                    // Dịch title
                    if (oldEmbed.title) {
                        const translatedTitle = await translateToVietnamese(oldEmbed.title);
                        newEmbed.setTitle(translatedTitle || oldEmbed.title);
                    }

                    // Dịch description
                    if (oldEmbed.description) {
                        const translatedDesc = await translateToVietnamese(oldEmbed.description);
                        newEmbed.setDescription(translatedDesc || oldEmbed.description);
                    }

                    // Dịch fields
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

            // Gửi bản dịch (reply vào tin nhắn gốc)
            if (translatedContent || translatedEmbeds.length > 0) {
                const replyOptions = {
                    allowedMentions: { repliedUser: false }
                };

                if (translatedContent) {
                    replyOptions.content = `🌐 **Bản dịch:**\n${translatedContent}`;
                } else {
                    replyOptions.content = `🌐 **Bản dịch:**`;
                }

                if (translatedEmbeds.length > 0) {
                    replyOptions.embeds = translatedEmbeds;
                }

                await targetMessage.reply(replyOptions);
            } else {
                await message.channel.send('❌ Không thể dịch nội dung này.').then(m => setTimeout(() => m.delete().catch(() => { }), 5000));
            }

        } catch (error) {
            console.error('[Dich] Lỗi:', error);
            await message.channel.send('❌ Có lỗi xảy ra khi dịch. Vui lòng thử lại.').then(m => setTimeout(() => m.delete().catch(() => { }), 5000));
        }
    }
};

