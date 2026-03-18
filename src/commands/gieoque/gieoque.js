const { GoogleGenerativeAI } = require("@google/generative-ai");
const db = require('../../database/db');

// Helper: delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ============== API KEY ROTATION ==============
// Load all GEMINI_API_KEY_* from env
function loadApiKeys() {
    const keys = [];
    for (let i = 1; i <= 30; i++) {
        const key = process.env[`GEMINI_API_KEY_${i}`];
        if (key) keys.push(key);
    }
    // Fallback: old single key
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

// ============== COOLDOWN ==============
const cooldowns = new Map();
const COOLDOWN_MS = 30000; // 30 giây

// ============== EXTRACT WWM NUMBER ==============
function extractWWMNumber(text) {
    if (!text) return null;
    const patterns = [
        /(\d+)\s*phát/i,
        /(\d+)\s*lần/i,
        /(\d+)\s*roll/i,
        /(\d+)\s*summon/i,
        /(\d+)\s*pull/i,
    ];
    for (const p of patterns) {
        const match = text.match(p);
        if (match) return match[1];
    }
    return null;
}

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
        return message.reply(`⏳ Thí chủ nóng vội quá! Đợi thêm **${remaining} giây** nữa rồi hãy gieo lại nhé.`);
    }

    // 1. Kiểm tra trạng thái Gieo Quẻ
    const { usedToday, lastFortune } = db.getGieoQueStatus(message.author.id);

    // 2. Load API keys
    const apiKeys = loadApiKeys();
    if (apiKeys.length === 0) {
        return message.reply("⚠️ Bot chưa được cấu hình API Key. Vui lòng liên hệ Admin!");
    }

    // 3. Lấy tên người dùng
    const userName = message.member?.displayName || message.author.username;
    const isFemale = message.member?.roles.cache.some(role => role.name === 'Nữ Nhi Quốc');
    const gender = isFemale ? 'Nữ' : 'Nam';
    const isLangGia = message.member?.roles.cache.some(role => role.name === 'LangGia');
    const isWWM = message.member?.roles.cache.some(role => role.name === 'WWM');

    // 4. Gửi thông báo đang xử lý
    let waitingText = `🔮 Thầy đang lắc ống xăm cho thí chủ **${userName}**... Đợi xíu nhé!`;
    if (usedToday) {
        waitingText = `🔮 Thí chủ **${userName}** lại muốn xin xăm nữa sao? Để thầy xem lại quẻ cũ...`;
    }
    const waitingMessage = await message.reply(waitingText);

    // Set cooldown ngay
    cooldowns.set(message.author.id, Date.now());

    try {
        // 5. Tạo prompt
        let prompt = "";
        const userQuery = args.join(' ');
        const langGiaLine = isLangGia
            ? `\n- Có thể thêm 1 câu ngắn về đồng hành cùng bang hội Lang Gia (không bắt buộc, chỉ thêm nếu phù hợp ngữ cảnh). Ví dụ: "Đường cùng bang hội năm nay..." hoặc "Bên cạnh anh em...".`
            : "";

        // Weighted random cho 8 cấp vận hạn
        const fortuneLevels = [
            { name: 'Đại Cát (大吉)', weight: 10, desc: 'Rất tốt, cực kỳ may mắn. Quẻ này mang đại vận hanh thông, mọi việc đều thuận lợi, tài lộc dồi dào.' },
            { name: 'Trung Cát (中吉)', weight: 15, desc: 'Tốt vừa. Quẻ này mang vận may khá, công việc ổn định, có cơ hội phát triển.' },
            { name: 'Tiểu Cát (小吉)', weight: 20, desc: 'May mắn nhỏ. Quẻ này mang chút vận may, có điềm tốt nhưng cần kiên nhẫn.' },
            { name: 'Cát (吉)', weight: 0, desc: 'Tốt. Quẻ này mang điềm lành, thuận buồm xuôi gió.' }, // merged into others
            { name: 'Bình (平)', weight: 20, desc: 'Bình thường, không tốt không xấu. Quẻ này bình lặng, nên giữ vững tinh thần, không nên mạo hiểm.' },
            { name: 'Tiểu Hung (小凶)', weight: 15, desc: 'Xui nhẹ. Quẻ này có chút trở ngại, cần cẩn thận trong chi tiêu và đề phòng tiểu nhân.' },
            { name: 'Hung (凶)', weight: 12, desc: 'Xấu. Quẻ này mang vận hạn, nên hành sự thận trọng, tránh đầu tư mạo hiểm.' },
            { name: 'Đại Hung (大凶)', weight: 8, desc: 'Rất xấu. Quẻ này mang đại hạn, cần đặc biệt cẩn trọng, nên nằm yên chờ thời.' },
        ];
        const totalWeight = fortuneLevels.reduce((sum, l) => sum + l.weight, 0);
        let rand = Math.random() * totalWeight;
        let selectedFortune = fortuneLevels[0];
        for (const level of fortuneLevels) {
            if (level.weight === 0) continue;
            rand -= level.weight;
            if (rand <= 0) { selectedFortune = level; break; }
        }
        const fortuneType = `${selectedFortune.name} – ${selectedFortune.desc}`;

        if (usedToday && lastFortune) {
            const wwmNumber = extractWWMNumber(lastFortune);
            const wwmInstruction = (isWWM && wwmNumber)
                ? `\n- **BẮT BUỘC**: Phải sử dụng ĐÚNG con số **${wwmNumber} phát** khi nói về game (nổ vàng). KHÔNG ĐƯỢC thay đổi con số này dù gieo bao nhiêu lần.`
                : "";

            prompt = `Hãy đóng vai một con ngỗng thầy bói, đang hơi quạu vì người dùng đòi gieo quẻ lại trong ngày.
Người dùng tên: ${userName}. Giới tính: ${gender}.

QUẺ CŨ CỦA HỌ (đã gieo hôm nay):
"""
${lastFortune}
"""

YÊU CẦU QUAN TRỌNG:
- GIỮ NGUYÊN các vận hạn (tiền bạc tốt/xấu, công việc tốt/xấu). Nếu quẻ cũ tốt thì phải tốt, nếu xấu thì vẫn xấu. KHÔNG ĐƯỢC đổi trắng thay đen.${wwmInstruction}
- Giọng điệu: Khó chịu, cà khịa, mắng yêu kiểu "Ta đã bảo rồi...", "Cố chấp quá...", "Gieo mấy lần cũng vậy thôi...".
- Ngắn gọn 3-4 câu, kết thúc bằng câu đuổi khéo.
- Có thể thay đổi cách diễn đạt, ví von, nhưng ý nghĩa phải giống hệt.${langGiaLine}`;

            if (userQuery) {
                prompt += `\n\nNgười dùng vừa hỏi thêm: "${userQuery}".\nHãy dựa vào câu hỏi này để mắng/cà khịa thêm (ví dụ: "Đã bảo là... mà còn hỏi '${userQuery}' làm gì?").`;
            }
        } else {
            const wwmLine = isWWM
                ? `- Thêm 1 câu về gacha game (mốc 150 phát). Quy ước: "Nổ vàng" là được 1 Core (1 Bát Âm), "Nổ 7 sắc cầu vồng" là được 2 Core (2 Bát Âm).
                - TỈ LỆ QUAN TRỌNG: Hãy giả định "Nổ 2 Core" là CỰC KỲ HIẾM (chỉ ~5% cơ hội), "Nổ sớm" (trước 70 phát) là HIẾM (20% cơ hội).
                - Đa phần (75%) hãy phán nổ ở mốc soft pity (70-140) hoặc phải bảo hiểm (150). Tuỳ vận hạn quẻ bói mà phán.`
                : "";

            prompt = `Hãy đóng vai một con ngỗng thầy bói, hài hước và hơi "bựa" một chút. Hãy phán quẻ cho người dùng trong NGÀY HÔM NAY. Xưng "Ta".
Người dùng tên là: ${userName}. Giới tính: ${gender}.

Yêu cầu:
- **QUAN TRỌNG**: Quẻ này có vận ${fortuneType}
- CHỈ phán cho NGÀY HÔM NAY, không phán cho cả năm hay tháng. Ví dụ: "Hôm nay...", "Ngày hôm nay..."
- Có thể phán về tiền bạc hoặc công việc. KHÔNG phán về tình duyên (đã có lệnh riêng).
- Ngắn gọn, súc tích (khoảng 4-5 câu).
- Kết thúc bằng một câu chúc "bá đạo".
- Không dùng các format markdown phức tạp như Heading (#).
${wwmLine}
- Thêm 1 câu ví von ngắn gọn, hài hước liên quan đến ý nghĩa tên của người dùng (tên là "${userName}"). Nếu tên là tiếng nước ngoài (Anh, Trung, Nhật, v.v.), hãy dịch nghĩa sang Tiếng Việt rồi mới dùng để ví von. Ví dụ: Rain -> Cơn mưa, Moon -> Mặt trăng, Sakura -> Hoa anh đào.${langGiaLine}`;

            if (userQuery) {
                prompt += `\n\nNgười dùng có lời thỉnh cầu cụ thể: "${userQuery}".\nHãy kết hợp nội dung này vào quẻ bói một cách tự nhiên.`;
            }
        }

        // 6. Gọi API với KEY ROTATION + retry
        let text = null;
        const maxKeyAttempts = apiKeys.length; // Thử tất cả keys
        const maxRetries = 2;

        for (let keyAttempt = 0; keyAttempt < maxKeyAttempts; keyAttempt++) {
            const apiKey = getNextApiKey(apiKeys);
            const keyLabel = `Key ${(currentKeyIndex === 0 ? apiKeys.length : currentKeyIndex)}/${apiKeys.length}`;

            try {
                const genAI = new GoogleGenerativeAI(apiKey);

                // Thử gemini-2.5-flash-lite trước, fallback gemini-2.0-flash
                const modelsToTry = ['gemini-2.5-flash-lite', 'gemini-2.0-flash'];

                for (const modelName of modelsToTry) {
                    const model = genAI.getGenerativeModel({ model: modelName });

                    for (let attempt = 0; attempt <= maxRetries; attempt++) {
                        try {
                            const result = await model.generateContent(prompt);
                            const response = await result.response;
                            text = response.text();
                            console.log(`[GieoQue] Success with ${keyLabel} (${modelName})`);
                            break;
                        } catch (apiError) {
                            const isRateLimit = apiError.message?.includes("429") || apiError.message?.includes("Too Many Requests");
                            if (isRateLimit && attempt < maxRetries) {
                                console.log(`[GieoQue] ${keyLabel} (${modelName}) rate limit, retry ${attempt + 1}/${maxRetries}...`);
                                await delay(5000);
                            } else {
                                // Kiểm tra lỗi API key expired/invalid → skip key này luôn
                                const isKeyInvalid = apiError.message?.includes("API_KEY_INVALID") || apiError.message?.includes("API key expired") || apiError.message?.includes("400 Bad Request");
                                console.log(`[GieoQue] ${keyLabel} (${modelName}) failed: ${apiError.message?.slice(0, 100)}`);
                                if (isKeyInvalid) {
                                    // Key hết hạn → bỏ qua tất cả model cho key này, thử key tiếp
                                    throw apiError;
                                }
                                break; // Lỗi model khác → thử model tiếp theo
                            }
                        }
                    }

                    if (text) break; // Đã có kết quả, thoát vòng model
                }

                if (text) break; // Thành công, thoát vòng lặp key

            } catch (keyError) {
                const isRateLimit = keyError.message?.includes("429") || keyError.message?.includes("Too Many Requests");
                const isKeyInvalid = keyError.message?.includes("API_KEY_INVALID") || keyError.message?.includes("API key expired") || keyError.message?.includes("400 Bad Request");
                if ((isRateLimit || isKeyInvalid) && keyAttempt < maxKeyAttempts - 1) {
                    console.log(`[GieoQue] ${keyLabel} ${isKeyInvalid ? 'expired/invalid' : 'rate limit'}, trying next key...`);
                    continue;
                }
                throw keyError; // Tất cả key đều fail
            }
        }

        // 7. Chỉnh sửa message và ghi nhận usage
        if (text) {
            const title = usedToday
                ? `🔮 **Đại Ngỗng bói lại quẻ cho ${userName}** 🔮`
                : `🌟 **QUẺ NGÀY HÔM NAY CỦA ${userName.toUpperCase()}** 🌟`;
            await waitingMessage.edit(`${title}\n\n${text}`);

            if (!usedToday) {
                db.markGieoQueUsed(message.author.id, text);
            } else {
                db.markGieoQueUsed(message.author.id, lastFortune);
            }

            cooldowns.set(message.author.id, Date.now());
        }

    } catch (error) {
        console.error("[GieoQue] Error:", error.message);

        await waitingMessage.edit(`❌ Thầy bói hôm nay đau bụng, ngày mai quay lại nhé!`);
    }
}

module.exports = { execute };
