/**
 * ═══════════════════════════════════════════════════════════════════════════
 * caproleHandler.js - Xử lý cấp role thông minh qua so khớp text
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Hai chức năng chính:
 *   1. handleCaproleMessage  : Phân tích tin nhắn bằng so khớp text
 *   2. handleCaproleReaction : Duyệt yêu cầu cấp role khi admin reaction
 * 
 * Được gọi từ:
 *   - src/events/client/messageCreate.js
 *   - src/events/messageReactionAdd/reactionRoleAdd.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../database/db');
const { getRoleMappings } = require('../commands/quanly/subrole/addrole');

// ============== CONFIG ==============
const OWNER_ID = '395151484179841024';
const APPROVE_EMOJI_ID = '1178353421951189102'; // <:mlan:...>
const COOLDOWN_MS = 30000; // 30 giây cooldown
const PREFIX = process.env.PREFIX || '?';

// ============== STATE ==============
// Map<originalMessageId, { userId, roleCode, roleName, botReplyId, confidence, reason }>
const pendingRequests = new Map();
// Map<userId, timestamp> cooldown
const cooldowns = new Map();

// ============== SO KHỚP TEXT ==============
/**
 * Bỏ dấu tiếng Việt → chữ thường
 */
function removeDiacritics(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toLowerCase().trim();
}

/**
 * So khớp text của user với danh sách role
 * Trả về { role_code, confidence, reason } hoặc null
 */
function fallbackTextMatch(text, mappings) {
    if (!text || text.trim().length === 0) return null;

    const normalizedInput = removeDiacritics(text);
    const codes = Object.keys(mappings);
    let bestMatch = null;
    let bestScore = 0;

    for (const code of codes) {
        const entry = mappings[code];
        const roleName = typeof entry === 'string' ? entry : entry.name;
        const normalizedName = removeDiacritics(roleName);

        // 1. So chính xác code (VD: user gõ "clm")
        if (normalizedInput === code || normalizedInput.split(/\s+/).includes(code)) {
            return { role_code: code, confidence: 85, reason: `Nhận diện mã role: ${code}` };
        }

        // 2. So chính xác tên đầy đủ (VD: "Cửu Lưu Môn")
        if (removeDiacritics(text) === normalizedName) {
            return { role_code: code, confidence: 90, reason: `Nhận diện tên role: ${roleName}` };
        }

        // 3. Text chứa tên role không dấu (VD: "tôi ở cuu luu mon")
        if (normalizedInput.includes(normalizedName) && normalizedName.length >= 3) {
            const score = normalizedName.length; // Ưu tiên tên dài hơn
            if (score > bestScore) {
                bestScore = score;
                bestMatch = { role_code: code, confidence: 75, reason: `Phát hiện "${roleName}" trong tin nhắn` };
            }
        }

        // 4. So từng từ trong tên role (VD: text có "lưu môn" → match "Cửu Lưu Môn")
        const nameWords = normalizedName.split(/\s+/);
        if (nameWords.length >= 2) {
            const matchedWords = nameWords.filter(w => normalizedInput.includes(w) && w.length >= 2);
            const matchRatio = matchedWords.length / nameWords.length;
            if (matchRatio >= 0.6 && matchedWords.length >= 2) {
                const score = matchedWords.length * 10 + matchRatio * 20;
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = { role_code: code, confidence: 65, reason: `Phát hiện từ khóa liên quan ${roleName}` };
                }
            }
        }
    }

    return bestMatch;
}

// ============== HÀM 1: XỬ LÝ TIN NHẮN ==============
/**
 * Xử lý tin nhắn trong kênh cấp role
 * @param {Message} message
 * @param {Client} client
 * @returns {boolean} true nếu đã xử lý (tin nhắn thuộc kênh cấp role)
 */
async function handleCaproleMessage(message, client) {
    // Lấy channel cấp role từ DB
    const caproleChannelId = db.getConfig('caprole_channel_id');
    if (!caproleChannelId || message.channel.id !== caproleChannelId) return false;

    // Bỏ qua bot và lệnh prefix
    if (message.author.bot) return false;
    if (message.content.startsWith(PREFIX)) return false;

    // Bỏ qua tin nhắn trống (không có text lẫn ảnh)
    const hasText = message.content.trim().length > 0;
    const images = [...message.attachments.values()].filter(a => a.contentType?.startsWith('image/'));
    if (!hasText && images.length === 0) return false;

    // Cooldown check
    const now = Date.now();
    const lastUsed = cooldowns.get(message.author.id);
    if (lastUsed && now - lastUsed < COOLDOWN_MS) {
        const remaining = Math.ceil((COOLDOWN_MS - (now - lastUsed)) / 1000);
        await message.reply(`⏳ Đợi thêm **${remaining} giây** nữa nhé!`);
        return true;
    }

    // Lấy danh sách roles
    const mappings = getRoleMappings();
    const codes = Object.keys(mappings);
    if (codes.length === 0) return false;

    // Set cooldown
    cooldowns.set(message.author.id, Date.now());

    // Gửi tin nhắn đang xử lý
    const waitMsg = await message.reply('🔍 Đang phân tích yêu cầu...');

    // So khớp text để tìm role phù hợp
    let parsed = null;
    const textMatchResult = fallbackTextMatch(message.content, mappings);
    if (textMatchResult) {
        parsed = textMatchResult;
        console.log(`[CapRole] Text match: ${textMatchResult.role_code} (${textMatchResult.confidence}%)`);
    }

    // === BƯỚC 3: Xử lý kết quả (chung cho cả Gemini và fallback) ===
    try {
        // Không có kết quả từ cả Gemini lẫn fallback
        if (!parsed || !parsed.role_code || parsed.confidence < 30) {
            const noMatchEmbed = new EmbedBuilder()
                .setColor(0x95A5A6)
                .setDescription(
                    `👤 <@${message.author.id}>\n` +
                    `❓ Không xác định được role phù hợp.\n` +
                    `📝 ${parsed?.reason || 'Vui lòng ghi rõ tên role hoặc gửi ảnh rõ hơn.'}`
                )
                .setTimestamp();

            await waitMsg.edit({ content: null, embeds: [noMatchEmbed] });
            return true;
        }

        const { role_code, confidence, reason } = parsed;

        // Tìm thông tin role
        const roleEntry = mappings[role_code];
        if (!roleEntry) {
            const noMatchEmbed = new EmbedBuilder()
                .setColor(0x95A5A6)
                .setDescription(
                    `👤 <@${message.author.id}>\n` +
                    `❓ Không xác định được role phù hợp.\n` +
                    `📝 Vui lòng ghi rõ tên role hoặc gửi ảnh rõ hơn.`
                )
                .setTimestamp();
            await waitMsg.edit({ content: null, embeds: [noMatchEmbed] });
            return true;
        }

        const roleName = typeof roleEntry === 'string' ? roleEntry : roleEntry.name;
        const emojiId = typeof roleEntry === 'object' ? roleEntry.emojiId : null;
        const roleIcon = emojiId ? `<:sr_${role_code}:${emojiId}>` : '🎯';

        // Kiểm tra user đã có role chưa
        const guild = message.guild;
        const discordRole = guild.roles.cache.find(r => r.name === roleName);
        const member = message.member;

        if (discordRole && member.roles.cache.has(discordRole.id)) {
            const alreadyEmbed = new EmbedBuilder()
                .setColor(0xF39C12)
                .setDescription(
                    `👤 <@${message.author.id}>\n` +
                    `${roleIcon} Bạn đã có role **${roleName}** rồi!`
                )
                .setTimestamp();

            await waitMsg.edit({ content: null, embeds: [alreadyEmbed] });
            return true;
        }

        // Tạo embed kết quả
        const pendingEmbed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setDescription(
                `👤 <@${message.author.id}>\n` +
                `${roleIcon} **${roleName}** (${confidence}%)\n` +
                `📝 ${reason}\n` +
                `⏳ Đang chờ duyệt`
            )
            .setTimestamp();

        // Nếu có ảnh, hiển thị thumbnail ảnh đầu tiên
        if (images.length > 0) {
            pendingEmbed.setThumbnail(images[0].url);
        }

        const replyMsg = await waitMsg.edit({ content: null, embeds: [pendingEmbed] });

        // Lưu vào pending map (key = tin nhắn gốc của user)
        pendingRequests.set(message.id, {
            userId: message.author.id,
            roleCode: role_code,
            roleName: roleName,
            botReplyId: replyMsg.id,
            confidence: confidence,
            reason: reason
        });

        console.log(`[CapRole] Pending: ${message.author.username} → ${roleName} (${confidence}%)`);
        return true;

    } catch (error) {
        console.error('[CapRole] Error xử lý kết quả:', error.message);
        // Vẫn không báo lỗi model, chỉ báo chung
        const errorEmbed = new EmbedBuilder()
            .setColor(0x95A5A6)
            .setDescription(
                `👤 <@${message.author.id}>\n` +
                `❓ Không xác định được role phù hợp.\n` +
                `📝 Vui lòng ghi rõ tên role hoặc gửi ảnh rõ hơn.`
            )
            .setTimestamp();
        await waitMsg.edit({ content: null, embeds: [errorEmbed] });
        return true;
    }
}

// ============== HÀM 2: XỬ LÝ REACTION DUYỆT ==============
/**
 * Xử lý reaction duyệt cấp role
 * @param {MessageReaction} reaction
 * @param {User} user
 * @param {Client} client
 * @returns {boolean} true nếu đã xử lý
 */
async function handleCaproleReaction(reaction, user, client) {
    // Bỏ qua bot
    if (user.bot) return false;

    // Chỉ owner mới duyệt được
    if (user.id !== OWNER_ID) return false;

    // Kiểm tra emoji: duyệt (mlan) hoặc hủy (❌)
    const emojiId = reaction.emoji.id;
    const emojiName = reaction.emoji.name;
    const isApprove = emojiId === APPROVE_EMOJI_ID;
    const isReject = emojiName === '❌';
    if (!isApprove && !isReject) return false;

    // Kiểm tra tin nhắn có trong pending không
    const messageId = reaction.message.id;
    const pending = pendingRequests.get(messageId);
    if (!pending) return false;

    // Nếu hủy: xóa embed dự đoán + react ❌ vào tin nhắn gốc
    if (isReject) {
        try {
            const botReply = await reaction.message.channel.messages.fetch(pending.botReplyId).catch(() => null);
            if (botReply) await botReply.delete();
        } catch (e) { }
        try {
            await reaction.message.react('❌');
        } catch (e) { }
        pendingRequests.delete(messageId);
        console.log(`[CapRole] Rejected: ${pending.roleName} for userId ${pending.userId}`);
        return true;
    }

    try {
        const guild = reaction.message.guild;
        if (!guild) return false;

        // Tìm Discord role
        const discordRole = guild.roles.cache.find(r => r.name === pending.roleName);
        if (!discordRole) {
            await reaction.message.channel.send(`❌ Role **${pending.roleName}** không tồn tại trong server!`);
            pendingRequests.delete(messageId);
            return true;
        }

        // Fetch member và cấp role
        const member = await guild.members.fetch(pending.userId).catch(() => null);
        if (!member) {
            await reaction.message.channel.send(`❌ Không tìm thấy user <@${pending.userId}> trong server!`);
            pendingRequests.delete(messageId);
            return true;
        }

        // Kiểm tra đã có role chưa
        if (member.roles.cache.has(discordRole.id)) {
            // Edit embed reply thành đã có
            try {
                const botReply = await reaction.message.channel.messages.fetch(pending.botReplyId).catch(() => null);
                if (botReply) {
                    const alreadyEmbed = new EmbedBuilder()
                        .setColor(0xF39C12)
                        .setDescription(
                            `👤 <@${pending.userId}>\n` +
                            `⚠️ Đã có role **${pending.roleName}** rồi!`
                        )
                        .setTimestamp();
                    await botReply.edit({ embeds: [alreadyEmbed] });
                }
            } catch (e) { }
            pendingRequests.delete(messageId);
            return true;
        }

        // Cấp role
        await member.roles.add(discordRole, `Cấp role bởi owner qua hệ thống AI - ${pending.reason}`);

        // Tìm emoji role (nếu có) - dùng để react
        const mappings = getRoleMappings();
        const roleEntry = mappings[pending.roleCode];
        const emojiIdRole = typeof roleEntry === 'object' ? roleEntry.emojiId : null;

        // Xóa tin nhắn dự đoán của bot
        try {
            const botReply = await reaction.message.channel.messages.fetch(pending.botReplyId).catch(() => null);
            if (botReply) await botReply.delete();
        } catch (e) {
            console.error('[CapRole] Lỗi xóa embed:', e.message);
        }

        // React ✅ vào tin nhắn gốc của user
        try {
            await reaction.message.react('✅');
        } catch (e) {
            console.error('[CapRole] Lỗi react:', e.message);
        }

        // Xoá khỏi pending
        pendingRequests.delete(messageId);

        console.log(`[CapRole] Approved: ${member.user.username} ← ${pending.roleName} by ${user.username}`);
        return true;

    } catch (error) {
        console.error('[CapRole] Reaction error:', error);
        pendingRequests.delete(messageId);
        return true;
    }
}

module.exports = {
    handleCaproleMessage,
    handleCaproleReaction,
    pendingRequests // Export để debug nếu cần
};
