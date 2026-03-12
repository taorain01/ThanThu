const { GoogleGenerativeAI } = require("@google/generative-ai");

// Load all GEMINI_API_KEY_* from env
function loadApiKeys() {
    const keys = [];
    for (let i = 1; i <= 30; i++) {
        const key = process.env[`GEMINI_API_KEY_${i}`];
        if (key) keys.push({ key, index: i });
    }
    if (keys.length === 0 && process.env.GEMINI_API_KEY) {
        keys.push({ key: process.env.GEMINI_API_KEY, index: 0 });
    }
    return keys;
}

module.exports = {
    name: 'checkapi',
    description: 'Kiểm tra trạng thái tất cả Gemini API keys (Admin Only)',
    async execute(message, args) {
        if (!message.member.permissions.has('Administrator') && message.author.id !== '395151484179841024') {
            return message.reply('❌ Bạn không có quyền kiểm tra API!');
        }

        const apiKeys = loadApiKeys();
        if (apiKeys.length === 0) return message.reply('❌ Chưa cấu hình GEMINI_API_KEY!');

        const msg = await message.reply(`🔄 Đang kiểm tra **${apiKeys.length} API keys**...`);

        const results = [];

        for (const { key, index } of apiKeys) {
            const masked = key.slice(0, 8) + '...' + key.slice(-4);
            const start = Date.now();

            try {
                const genAI = new GoogleGenerativeAI(key);
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                await model.generateContent("Test");
                const lat = Date.now() - start;
                results.push(`✅ Key ${index}: \`${masked}\` — OK (${lat}ms)`);
            } catch (error) {
                let status = "❌ LỖI";
                if (error.message.includes("429")) status = "⚠️ RATE LIMITED";
                else if (error.message.includes("403")) status = "❌ QUOTA/KEY SAI";
                results.push(`${status} Key ${index}: \`${masked}\``);
            }
        }

        const summary = results.join('\n');
        const okCount = results.filter(r => r.startsWith('✅')).length;
        const header = `📊 **API STATUS: ${okCount}/${apiKeys.length} keys hoạt động**\n\n`;

        await msg.edit(header + summary);
    },
};
