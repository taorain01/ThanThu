const db = require('../../database/db');
const { hasLangGiaRole } = require('../../utils/langGiaRole');
const { generateFortuneText, hasAnyFortuneAiKey } = require('../../utils/fortuneAiService');

// ============== COOLDOWN ==============
const cooldowns = new Map();
const COOLDOWN_MS = 30000; // 30 giây

// ============== MAIN EXECUTE ==============
async function execute(message, args) {
    // 0a. Kiểm tra channel gieo quẻ
    const gqChannelId = db.getGieoQueChannelId();
    if (gqChannelId && message.channel.id !== gqChannelId) {
        return message.reply(`❌ Lệnh này chỉ dùng được trong kênh <#${gqChannelId}>!`);
    }

    // 0b. Kiểm tra cooldown (30 giây)
    const now = Date.now();
    const lastUsed = cooldowns.get(message.author.id);
    if (lastUsed && now - lastUsed < COOLDOWN_MS) {
        const remaining = Math.ceil((COOLDOWN_MS - (now - lastUsed)) / 1000);
        return message.reply(`⏳ Thí chủ nóng vội quá! Đợi thêm **${remaining} giây** nữa rồi hãy cầu lại nhé.`);
    }

    // 1. Kiểm tra trạng thái Cầu Duyên
    const { usedToday, lastFortune } = db.getCauDuyenStatus(message.author.id);

    // 2. Kiểm tra API keys
    if (!hasAnyFortuneAiKey()) {
        return message.reply("⚠️ Bot chưa được cấu hình API Key. Vui lòng liên hệ Admin!");
    }

    // 3. Lấy tên và giới tính
    const userName = message.member?.displayName || message.author.username;
    const isFemale = message.member?.roles.cache.some(role => role.name === 'Nữ Nhi Quốc');
    const gender = isFemale ? 'Nữ' : 'Nam';
    const isLangGia = hasLangGiaRole(message.member);

    // 4. Gửi thông báo đang xử lý
    let waitingText = `💘 Thầy đang lắc ống xăm tình duyên cho thí chủ **${userName}**... Đợi xíu nhé!`;
    if (usedToday) {
        waitingText = `💘 Thí chủ **${userName}** lại muốn xin quẻ duyên nữa sao? Để thầy xem lại quẻ cũ...`;
    }
    const waitingMessage = await message.reply(waitingText);

    // Set cooldown ngay
    cooldowns.set(message.author.id, Date.now());

    try {
        // 5. Tạo prompt
        let prompt = "";
        const userQuery = args.join(' ').trim();
        // Giảm tần suất nhắc Lang Gia: chỉ ~30% cơ hội thay vì 100%
        const shouldMentionLangGia = isLangGia && Math.random() < 0.3;
        const langGiaLine = shouldMentionLangGia
            ? `\n- Có thể thêm 1 câu ngắn liên quan đến duyên phận trong hội nhóm (không bắt buộc, chỉ nếu phù hợp).`
            : "";

        // Weighted random cho 8 cấp vận hạn (giống gieoque)
        const fortuneLevels = [
            { name: 'Đại Cát (大吉)', weight: 10, desc: 'Rất tốt, duyên phận cực kỳ may mắn. Tình duyên nở rộ, gặp người như ý.' },
            { name: 'Trung Cát (中吉)', weight: 15, desc: 'Tốt vừa. Tình duyên ổn định, có nhiều cơ hội tốt.' },
            { name: 'Tiểu Cát (小吉)', weight: 20, desc: 'May mắn nhỏ. Duyên phận khá tốt, nhưng cần kiên nhẫn chờ đợi.' },
            { name: 'Cát (吉)', weight: 0, desc: 'Tốt. Tình duyên thuận lợi.' }, // merged into others
            { name: 'Bình (平)', weight: 20, desc: 'Bình thường, không tốt không xấu. Tình duyên bình lặng, không có gì đặc biệt.' },
            { name: 'Tiểu Hung (小凶)', weight: 15, desc: 'Xui nhẹ. Tình duyên có chút trở ngại, cần thận trọng trong các mối quan hệ.' },
            { name: 'Hung (凶)', weight: 12, desc: 'Xấu. Tình duyên gặp khó khăn, nên hành động cẩn thận.' },
            { name: 'Đại Hung (大凶)', weight: 8, desc: 'Rất xấu. Tình duyên gặp nhiều trở ngại lớn, nên tạm dừng và chờ thời.' },
        ];
        const totalWeight = fortuneLevels.reduce((sum, l) => sum + l.weight, 0);
        let rand = Math.random() * totalWeight;
        let selectedFortune = fortuneLevels[0];
        for (const level of fortuneLevels) {
            if (level.weight === 0) continue;
            rand -= level.weight;
            if (rand <= 0) { selectedFortune = level; break; }
        }
        const loveFortuneType = `${selectedFortune.name} – ${selectedFortune.desc}`;

        if (usedToday && lastFortune) {
            prompt = `Hãy đóng vai một con ngỗng thầy bói, đang hơi quạu vì người dùng đòi cầu duyên lại trong ngày.
Người dùng tên: ${userName}. Giới tính: ${gender}.

QUẺ DUYÊN CŨ CỦA HỌ (đã cầu hôm nay):
"""
${lastFortune}
"""

YÊU CẦU QUAN TRỌNG:
- GIỮ NGUYÊN vận hạn tình duyên (tốt thì vẫn tốt, xấu thì vẫn xấu). KHÔNG ĐƯỢC đổi trắng thay đen.
- Giọng điệu: Khó chịu, cà khịa, mắng yêu kiểu "Ta đã bảo rồi...", "Cố chấp quá...", "Cầu mấy lần cũng vậy thôi...", "Duyên đến thì đến, cầu nhiều cũng không nhanh hơn đâu...".
- Ngắn gọn 3-4 câu, kết thúc bằng câu đuổi khéo.
- Nếu người dùng có câu hỏi mới, phải trả lời trực tiếp câu hỏi đó trong 1-2 câu đầu, nhưng vẫn giữ đúng kết luận quẻ duyên cũ.
- Có thể thay đổi cách diễn đạt, ví von, nhưng ý nghĩa phải giống hệt.${langGiaLine}`;

            if (userQuery) {
                prompt += `\n\nNgười dùng vừa hỏi thêm: "${userQuery}".\nHãy bám sát câu hỏi này để phán lại chuyện tình duyên, có thể cà khịa nhẹ, nhưng không được trả lời chung chung.`;
            }
        } else {
            prompt = `Hãy đóng vai một con ngỗng thầy bói, hài hước và hơi "bựa" một chút. Hãy phán quẻ TÌNH DUYÊN cho người dùng trong NGÀY HÔM NAY. Xưng "Ta".
Người dùng tên là: ${userName}. Giới tính: ${gender}.

Yêu cầu:
- CHỈ phán về TÌNH DUYÊN, tình yêu, nhân duyên, người ấy trong NGÀY HÔM NAY. KHÔNG phán về tiền bạc, công việc, hay game.
- CHỈ phán cho NGÀY HÔM NAY, không phán cho cả năm hay tháng. Ví dụ: "Hôm nay...", "Ngày hôm nay..."
- ${isFemale ? 'Đây là nữ cầu duyên. Phán về chuyện tình cảm phù hợp với nữ.' : 'Đây là nam cầu duyên. Phán về chuyện tình cảm phù hợp với nam.'}
- **QUAN TRỌNG**: Quẻ duyên này có vận ${loveFortuneType}
- Ngắn gọn, súc tích (khoảng 4-5 câu).
- Giọng điệu hài hước, vui tươi, có thể hơi trêu ghẹo.
- Kết thúc bằng một câu chúc tình duyên "bá đạo".
- Không dùng các format markdown phức tạp như Heading (#).
- Nếu người dùng có câu hỏi cụ thể, phải trả lời trực tiếp câu hỏi đó trong 1-2 câu đầu rồi mới ví von thêm; không được chỉ phán chung chung.
- Thêm 1 câu ví von lãng mạn hoặc hài hước liên quan đến ý nghĩa tên của người dùng (tên là "${userName}"). Nếu tên là tiếng nước ngoài (Anh, Trung, Nhật, v.v.), hãy dịch nghĩa sang Tiếng Việt rồi mới dùng để thả thính/ví von. Ví dụ: Rain -> Cơn mưa, Moon -> Mặt trăng, Sakura -> Hoa anh đào.${langGiaLine}`;

            if (userQuery) {
                prompt += `\n\nNgười dùng có lời thỉnh cầu cụ thể về tình duyên: "${userQuery}".\nHãy lấy câu hỏi này làm trọng tâm chính của quẻ bói, nhưng vẫn giữ vận ${loveFortuneType}.`;
            }
        }

        // 6. Gọi DeepSeek V4 Flash trước, nếu lỗi thì fallback Gemini cũ
        const text = await generateFortuneText(prompt, { logPrefix: 'CauDuyen' });

        // 7. Chỉnh sửa message và ghi nhận usage
        if (text) {
            const fortuneText = text.trim();
            const title = usedToday && lastFortune
                ? `💘 **CẦU DUYÊN LẠI CỦA ${userName.toUpperCase()}** 💘`
                : `💘 **QUẺ TÌNH DUYÊN HÔM NAY CỦA ${userName.toUpperCase()}** 💘`;
            await waitingMessage.edit(`${title}\n\n${fortuneText}`);

            if (!usedToday || !lastFortune) {
                db.markCauDuyenUsed(message.author.id, fortuneText);
            } else {
                db.markCauDuyenUsed(message.author.id, lastFortune);
            }

            cooldowns.set(message.author.id, Date.now());
        }

    } catch (error) {
        console.error("[CauDuyen] Error:", error.message);

        await waitingMessage.edit(`❌ Thầy bói đau bụng, ngày mai quay lại nhé!`);
    }
}

module.exports = { execute };
