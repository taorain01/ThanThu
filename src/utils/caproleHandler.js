/**
 * ═══════════════════════════════════════════════════════════════════════════
 * caproleHandler.js - Xử lý cấp role thông minh qua Gemini AI
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Hai chức năng chính:
 *   1. handleCaproleMessage  : Phân tích tin nhắn + ảnh bằng Gemini AI
 *   2. handleCaproleReaction : Duyệt yêu cầu cấp role khi admin reaction
 * 
 * Được gọi từ:
 *   - src/events/client/messageCreate.js
 *   - src/events/messageReactionAdd/reactionRoleAdd.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

const { EmbedBuilder } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
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

// ============== API KEY ROTATION (giống gieoque.js) ==============
function loadApiKeys() {
    const keys = [];
    for (let i = 1; i <= 30; i++) {
        const key = process.env[`GEMINI_API_KEY_${i}`];
        if (key) keys.push(key);
    }
    if (keys.length === 0 && process.env.GEMINI_API_KEY) {
        keys.push(process.env.GEMINI_API_KEY);
    }
    return keys;
}

let currentKeyIndex = 0;
function getNextApiKey(keys) {
    if (keys.length === 0) return null;
    const key = keys[currentKeyIndex % keys.length];
    currentKeyIndex = (currentKeyIndex + 1) % keys.length;
    return key;
}

// ============== DOWNLOAD ẢNH → BASE64 ==============
async function imageToBase64(attachment) {
    const response = await fetch(attachment.url);
    const arrayBuffer = await response.arrayBuffer();
    return {
        data: Buffer.from(arrayBuffer).toString('base64'),
        mimeType: attachment.contentType || 'image/png'
    };
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

    // Tạo danh sách role cho prompt
    const roleList = codes.map(code => {
        const entry = mappings[code];
        const name = typeof entry === 'string' ? entry : entry.name;
        return `- code: "${code}", tên: "${name}"`;
    }).join('\n');

    // Set cooldown
    cooldowns.set(message.author.id, Date.now());

    // Gửi tin nhắn đang xử lý
    const waitMsg = await message.reply('🔍 Đang phân tích yêu cầu...');

    try {
        // Chuẩn bị nội dung gửi Gemini
        const contentParts = [];

        // Prompt chính
        const prompt = `Bạn là một AI hỗ trợ phân tích yêu cầu cấp role Discord cho một game guild.

Danh sách roles có thể cấp:
${roleList}

User "${message.member?.displayName || message.author.username}" gửi tin nhắn:
"${message.content || '(không có text, chỉ có ảnh)'}"

${images.length > 0 ? `User cũng gửi kèm ${images.length} ảnh để chứng minh.` : 'User không gửi ảnh.'}

YÊU CẦU:
1. Phân tích text và ảnh (nếu có) để xác định user muốn role nào trong danh sách trên.
2. Ảnh có thể chứa: tên môn phái, rank, thành tựu, hoặc bằng chứng liên quan đến role.
3. Trả về ĐÚNG 1 dòng JSON, KHÔNG có markdown, KHÔNG có giải thích thêm:
{"role_code": "mã_role_hoặc_null", "confidence": số_từ_0_đến_100, "reason": "lý_do_ngắn_gọn"}

Ví dụ: {"role_code": "clm", "confidence": 90, "reason": "Ảnh hiển thị đang ở Cửu Lưu Môn"}
Nếu không match: {"role_code": null, "confidence": 0, "reason": "Không tìm thấy thông tin liên quan role nào"}`;

        contentParts.push(prompt);

        // Thêm ảnh (base64)
        for (const img of images) {
            try {
                const imgData = await imageToBase64(img);
                contentParts.push({ inlineData: imgData });
            } catch (e) {
                console.error('[CapRole] Lỗi tải ảnh:', e.message);
            }
        }

        // Gọi Gemini API với key rotation
        const apiKeys = loadApiKeys();
        if (apiKeys.length === 0) {
            await waitMsg.edit('❌ Chưa cấu hình Gemini API Key!');
            return true;
        }

        let resultText = null;

        for (let keyAttempt = 0; keyAttempt < apiKeys.length; keyAttempt++) {
            const apiKey = getNextApiKey(apiKeys);
            try {
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

                const result = await model.generateContent(contentParts);
                resultText = result.response.text();
                break;
            } catch (apiError) {
                const isRateLimit = apiError.message?.includes('429');
                if (isRateLimit && keyAttempt < apiKeys.length - 1) {
                    console.log(`[CapRole] Key ${keyAttempt + 1} rate limit, thử key tiếp...`);
                    continue;
                }
                throw apiError;
            }
        }

        if (!resultText) {
            await waitMsg.edit('❌ Không thể phân tích. Thử lại sau!');
            return true;
        }

        // Parse JSON từ kết quả Gemini
        let parsed;
        try {
            // Xử lý trường hợp Gemini trả về có markdown wrapper
            let cleanText = resultText.trim();
            if (cleanText.startsWith('```')) {
                cleanText = cleanText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
            }
            parsed = JSON.parse(cleanText);
        } catch (e) {
            console.error('[CapRole] Lỗi parse JSON:', resultText);
            await waitMsg.edit(`❌ Gemini trả về không đúng format. Thử lại sau!\n\`\`\`${resultText.substring(0, 200)}\`\`\``);
            return true;
        }

        const { role_code, confidence, reason } = parsed;

        // Nếu không match role nào
        if (!role_code || confidence < 30) {
            const noMatchEmbed = new EmbedBuilder()
                .setColor(0x95A5A6) // Xám
                .setDescription(
                    `👤 <@${message.author.id}>\n` +
                    `❓ Không xác định được role phù hợp.\n` +
                    `📝 ${reason || 'Vui lòng ghi rõ tên role hoặc gửi ảnh rõ hơn.'}`
                )
                .setTimestamp();

            await waitMsg.edit({ content: null, embeds: [noMatchEmbed] });
            return true;
        }

        // Tìm thông tin role
        const roleEntry = mappings[role_code];
        if (!roleEntry) {
            await waitMsg.edit(`❌ Role code \`${role_code}\` không tồn tại trong hệ thống.`);
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
                .setColor(0xF39C12) // Vàng
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
            .setColor(0x3498DB) // Xanh dương
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
        console.error('[CapRole] Error:', error.message);

        let errorMsg = `❌ Lỗi phân tích: \`${error.message}\``;
        if (error.message?.includes('429')) {
            errorMsg = '❌ Tất cả API key đang bị rate limit. Thử lại sau 1-2 phút!';
        }
        await waitMsg.edit(errorMsg);
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
