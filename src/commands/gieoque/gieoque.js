const { GoogleGenerativeAI } = require("@google/generative-ai");
const db = require('../../database/db');
const { isCoreQuestion, rollCoreOutcome } = require('../../utils/gieoqueCore');

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
        const userQuery = args.join(' ').trim();
        const asksCore = isCoreQuestion(userQuery);
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
        const shouldAnswerCore = asksCore && isWWM;
        const coreStatus = shouldAnswerCore ? db.getGieoQueCoreStatus(message.author.id) : null;
        const coreOutcome = shouldAnswerCore
            ? coreStatus.usedThisMonth
                ? {
                    content: coreStatus.coreContent,
                    pulls: coreStatus.corePulls,
                    result: coreStatus.coreResult,
                }
                : rollCoreOutcome(selectedFortune.name)
            : null;
        const noCoreLine = shouldAnswerCore
            ? 'Phần core/game sẽ được hệ thống thêm bằng một dòng cố định sau. KHÔNG tự nêu số phát, Core, Bát Âm, nổ vàng, nổ 7 sắc, roll hay pity trong phần quẻ ngày.'
            : asksCore
                ? 'Người dùng hỏi core/game nhưng không có role WWM; KHÔNG trả lời core/game/roll/pity, chỉ phán quẻ ngày theo câu hỏi chung.'
                : 'KHÔNG nhắc tới game, core, Bát Âm, roll, nổ vàng, nổ 7 sắc, pity hay bảo hiểm. Người dùng không hỏi core thì tuyệt đối không trả lời phần core.';
        const questionFocusLine = shouldAnswerCore
            ? 'Người dùng hỏi về core/game. Phần core cụ thể sẽ được hệ thống thêm sau; trong phần quẻ ngày chỉ nói vận may/hành sự hôm nay, không nêu số phát hay Core.'
            : asksCore
                ? 'Người dùng hỏi về core/game nhưng không có role WWM. Hãy nói quẻ này chỉ phán vận ngày chung, rồi bám theo vận ngày; không nêu kết quả core.'
                : 'Hãy lấy câu hỏi này làm trọng tâm chính của quẻ bói, nhưng vẫn giữ đúng vận đã định.';

        if (usedToday && lastFortune) {
            prompt = `Hãy đóng vai một con ngỗng thầy bói, đang hơi quạu vì người dùng đòi gieo quẻ lại trong ngày.
Người dùng tên: ${userName}. Giới tính: ${gender}.

QUẺ CŨ CỦA HỌ (đã gieo hôm nay):
"""
${lastFortune}
"""

YÊU CẦU QUAN TRỌNG:
- GIỮ NGUYÊN các vận hạn (tiền bạc tốt/xấu, công việc tốt/xấu). Nếu quẻ cũ tốt thì phải tốt, nếu xấu thì vẫn xấu. KHÔNG ĐƯỢC đổi trắng thay đen.
- Giọng điệu: Khó chịu, cà khịa, mắng yêu kiểu "Ta đã bảo rồi...", "Cố chấp quá...", "Gieo mấy lần cũng vậy thôi...".
- Ngắn gọn 3-4 câu, kết thúc bằng câu đuổi khéo.
- Nếu người dùng có câu hỏi mới, phải trả lời trực tiếp câu hỏi đó trong 1-2 câu đầu, nhưng vẫn giữ đúng kết luận quẻ cũ.
- ${noCoreLine}
- Có thể thay đổi cách diễn đạt, ví von, nhưng ý nghĩa phải giống hệt.${langGiaLine}`;

            if (userQuery) {
                prompt += `\n\nNgười dùng vừa hỏi thêm: "${userQuery}".\n${questionFocusLine} Có thể cà khịa nhẹ, nhưng không được trả lời chung chung.`;
            }
        } else {
            prompt = `Hãy đóng vai một con ngỗng thầy bói, hài hước và hơi "bựa" một chút. Hãy phán quẻ cho người dùng trong NGÀY HÔM NAY. Xưng "Ta".
Người dùng tên là: ${userName}. Giới tính: ${gender}.

Yêu cầu:
- **QUAN TRỌNG**: Quẻ này có vận ${fortuneType}
- CHỈ phán cho NGÀY HÔM NAY, không phán cho cả năm hay tháng. Ví dụ: "Hôm nay...", "Ngày hôm nay..."
- Có thể phán về tiền bạc hoặc công việc. KHÔNG phán về tình duyên (đã có lệnh riêng).
- Ngắn gọn, súc tích (khoảng 4-5 câu).
- Kết thúc bằng một câu chúc "bá đạo".
- Không dùng các format markdown phức tạp như Heading (#).
- Nếu người dùng có câu hỏi cụ thể, phải trả lời trực tiếp câu hỏi đó trong 1-2 câu đầu rồi mới ví von thêm; không được chỉ phán chung chung.
- ${noCoreLine}
- Thêm 1 câu ví von ngắn gọn, hài hước liên quan đến ý nghĩa tên của người dùng (tên là "${userName}"). Nếu tên là tiếng nước ngoài (Anh, Trung, Nhật, v.v.), hãy dịch nghĩa sang Tiếng Việt rồi mới dùng để ví von. Ví dụ: Rain -> Cơn mưa, Moon -> Mặt trăng, Sakura -> Hoa anh đào.${langGiaLine}`;

            if (userQuery) {
                prompt += `\n\nNgười dùng có lời thỉnh cầu cụ thể: "${userQuery}".\n${questionFocusLine} Vận của quẻ là ${fortuneType}.`;
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
            const dailyFortuneText = text.trim();
            const coreLine = shouldAnswerCore && coreOutcome
                ? `\n\n🎯 **Core tháng này:** ${coreOutcome.content}.`
                : '';
            const finalText = `${dailyFortuneText}${coreLine}`;
            const title = usedToday && lastFortune
                ? `🔮 **Đại Ngỗng bói lại quẻ cho ${userName}** 🔮`
                : `🌟 **QUẺ NGÀY HÔM NAY CỦA ${userName.toUpperCase()}** 🌟`;
            await waitingMessage.edit(`${title}\n\n${finalText}`);

            if (!usedToday || !lastFortune) {
                db.markGieoQueUsed(message.author.id, dailyFortuneText);
            } else {
                db.markGieoQueUsed(message.author.id, lastFortune);
            }

            if (shouldAnswerCore && coreOutcome && !coreStatus.usedThisMonth) {
                db.markGieoQueCore(message.author.id, coreOutcome);
            }

            cooldowns.set(message.author.id, Date.now());
        }

    } catch (error) {
        console.error("[GieoQue] Error:", error.message);

        await waitingMessage.edit(`❌ Thầy bói hôm nay đau bụng, ngày mai quay lại nhé!`);
    }
}

module.exports = { execute };
