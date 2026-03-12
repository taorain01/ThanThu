const { Events, EmbedBuilder } = require('discord.js');
const { addReactionRole, removeReactionRoleByRole, loadReactionRoles } = require('../../utils/reactionRoleState');

// Giới hạn chỉ tác giả
const AUTHOR_IDS = ["395151484179841024", "1247475535317422111"];

module.exports = {
    name: Events.MessageCreate,
    /**
     * @param {import('discord.js').Message} message 
     */
    async execute(message, client) {
        if (message.author.bot) return;

        const content = message.content.trim();

        // --- COMMAND: ?delmessrole @role ---
        if (content.startsWith('?delmessrole')) {
            if (!AUTHOR_IDS.includes(message.author.id)) {
                return message.reply({ content: `Bạn không có quyền sử dụng lệnh này!` });
            }

            const roleMention = message.mentions.roles.first();
            let targetRoleId = null;
            let roleDisplayStr = "";
            if (roleMention) {
                targetRoleId = roleMention.id;
                roleDisplayStr = roleMention.name;
            } else {
                const msgArgs = content.split(/\s+/).slice(1);
                const roleIdStr = msgArgs.find(a => /^\d{17,21}$/.test(a));
                if (roleIdStr) {
                    targetRoleId = roleIdStr;
                    roleDisplayStr = `có ID ${targetRoleId}`;
                }
            }

            if (!targetRoleId) {
                return message.reply({ content: `❌ Vui lòng tag một role hoặc copy Role ID để xóa. Ví dụ: \`?delmessrole @Role\` hoặc \`?delmessrole 1234567890123456789\`` });
            }

            const data = loadReactionRoles();
            let foundMessageId = null;
            let foundEmoji = null;

            // Truy tìm role này nằm ở message reaction nào
            for (const [msgId, msgData] of Object.entries(data)) {
                foundEmoji = removeReactionRoleByRole(msgId, targetRoleId);
                if (foundEmoji) {
                    foundMessageId = msgId;
                    break;
                }
            }

            if (foundMessageId) {
                try {
                    const channel = await client.channels.fetch(message.channel.id);
                    if (channel) {
                        const targetMessage = await channel.messages.fetch(foundMessageId).catch(() => null);
                        if (targetMessage) {
                            // Tìm reaction tương ứng và xóa hoàn toàn khỏi tin nhắn
                            const reaction = targetMessage.reactions.cache.find(r =>
                                r.emoji.id === foundEmoji || r.emoji.name === foundEmoji
                            );

                            if (reaction) {
                                await reaction.remove();
                            }

                            // Cập nhật lại text log của message (nếu cần thiết và tin nhắn là do bot gửi)
                            if (targetMessage.author.id === client.user.id && targetMessage.embeds.length > 0) {
                                const embed = targetMessage.embeds[0];
                                const newDescLines = embed.description.split('\n').filter(line => !line.includes(`<@&${targetRoleId}>`));

                                const newEmbed = new EmbedBuilder(embed.toJSON())
                                    .setDescription(newDescLines.join('\n') || "Không có role nào được set.");

                                await targetMessage.edit({ embeds: [newEmbed] });
                            }
                        }
                    }
                    return message.reply({ content: `✅ Đã xóa reaction và role ${roleDisplayStr} thành công!` });
                } catch (e) {
                    console.error(e);
                    return message.reply({ content: `✅ Đã xóa role trong database nhưng không thể cập nhật tin nhắn cũ.` });
                }
            } else {
                return message.reply({ content: `❌ Không tìm thấy role ${roleDisplayStr} trong các tin nhắn đang được set reaction.` });
            }
        }

        // --- COMMAND: ?setmessrole ---
        if (content.startsWith('?setmessrole')) {
            if (!AUTHOR_IDS.includes(message.author.id)) {
                return message.reply({ content: `Bạn không có quyền sử dụng lệnh này!` });
            }

            // arguments parsing
            const args = content.split(/\s+/).slice(1);
            if (args.length === 0) {
                return message.reply({ content: `❌ Cách sử dụng: \`?setmessrole @role1 :emoji1: @role2 :emoji2: ...\` (có thể gửi kèm ảnh để set emoji)` });
            }

            const roleRegex = /<@&(\d+)>/g;
            const emojiRegex = /<a?:[a-zA-Z0-9_]+:(\d+)>/;
            const defaultEmojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;

            let extractedRoles = [];
            let extractedEmojis = [];

            // Thu thập các roles và emoji từ text
            for (const arg of args) {
                const roleMatch = arg.match(/<@&(\d+)>/);
                if (roleMatch) {
                    extractedRoles.push({ type: 'role', id: roleMatch[1], raw: arg });
                    continue;
                }
                if (/^\d{17,21}$/.test(arg)) {
                    extractedRoles.push({ type: 'role', id: arg, raw: `<@&${arg}>` });
                    continue;
                }

                const customEmojiMatch = arg.match(emojiRegex);
                if (customEmojiMatch) {
                    extractedEmojis.push({ type: 'emoji', id: customEmojiMatch[1], isCustom: true, raw: arg });
                    continue;
                }

                const defaultEmojiMatch = arg.match(defaultEmojiRegex);
                if (defaultEmojiMatch) {
                    extractedEmojis.push({ type: 'emoji', name: arg, isCustom: false, raw: arg });
                    continue;
                }
            }

            if (extractedRoles.length === 0) {
                return message.reply({ content: `❌ Bạn phải tag ít nhất 1 role!` });
            }

            // Xử lý đính kèm ảnh -> Custom Emoji
            const attachments = Array.from(message.attachments.values());
            const guild = message.guild;

            let uploadedEmojis = [];
            if (attachments.length > 0) {
                await message.channel.send(`⏳ Đang xử lý ${attachments.length} ảnh thành Emoji...`);
                for (let i = 0; i < attachments.length; i++) {
                    try {
                        // Upload ảnh thành emoji server
                        const newEmoji = await guild.emojis.create({
                            attachment: attachments[i].url,
                            name: `role_emoji_${Date.now()}_${i}`
                        });
                        uploadedEmojis.push({ type: 'emoji', id: newEmoji.id, isCustom: true, raw: `<:${newEmoji.name}:${newEmoji.id}>` });
                    } catch (e) {
                        console.error('Lỗi khi tạo emoji từ ảnh:', e);
                    }
                }
            }

            // Gộp danh sách Emojis (Text cung cấp + Ảnh upload)
            const allEmojis = [...extractedEmojis, ...uploadedEmojis];

            if (extractedRoles.length > allEmojis.length) {
                return message.reply({ content: `❌ Số lượng Role đang nhiều hơn số lượng Emoji/Ảnh cung cấp (${extractedRoles.length} Roles > ${allEmojis.length} Emojis).` });
            }

            // Ghép nối Role và Emoji
            const roleMappings = [];
            for (let i = 0; i < extractedRoles.length; i++) {
                roleMappings.push({
                    role: extractedRoles[i],
                    emoji: allEmojis[i]
                });
            }

            // Tìm tin nhắn Bot gần nhất trong channel này nếu "đã dùng rồi thì add vào tin cũ"
            // Wait, để đơn giản, tạo tin nhắn mới hoặc kiểm tra replied message!
            let targetMessage = null;

            if (message.reference && message.reference.messageId) {
                targetMessage = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
            }

            let embedDesc = [];
            if (targetMessage && targetMessage.author.id === client.user.id) {
                // Thêm vào tin cũ
                if (targetMessage.embeds.length > 0) {
                    embedDesc = targetMessage.embeds[0].description ? targetMessage.embeds[0].description.split('\n') : [];
                }
            }

            for (const map of roleMappings) {
                embedDesc.push(`${map.emoji.raw} : <@&${map.role.id}>`);
            }

            const embed = new EmbedBuilder()
                .setTitle("🌟 Nhận Role 🌟")
                .setDescription(embedDesc.join('\n'))
                .setColor(0xFFD700)
                .setFooter({ text: "Phản ứng vào Emoji bên dưới để nhận Role tương ứng!" });

            if (targetMessage && targetMessage.author.id === client.user.id) {
                await targetMessage.edit({ embeds: [embed] });
            } else {
                targetMessage = await message.channel.send({ embeds: [embed] });
            }

            // Add reaction & save to DB
            for (const map of roleMappings) {
                const reactionId = map.emoji.isCustom ? map.emoji.id : map.emoji.name;
                try {
                    await targetMessage.react(reactionId);
                    addReactionRole(targetMessage.id, targetMessage.channel.id, targetMessage.guild.id, reactionId, map.role.id);
                } catch (e) {
                    console.error('Lỗi khi react:', e);
                } // Ignore if bot cannot react
            }

            // Xóa bộ sưu tập tin nhắn setup đi cho gọn gàng
            message.delete().catch(() => { });
        }
    }
};
