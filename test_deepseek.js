require("dotenv").config();
const { generateFortuneText } = require("./src/utils/fortuneAiService");

async function main() {
    console.log("Starting DeepSeek test...");
    console.log("DEEPSEEK_API_KEY length:", process.env.DEEPSEEK_API_KEY ? process.env.DEEPSEEK_API_KEY.length : 0);
    console.log("DEEPSEEK_MODEL:", process.env.DEEPSEEK_MODEL);
    
    try {
        const result = await generateFortuneText("Đóng vai một con ngỗng thầy bói phán ngắn gọn 1 câu chào buổi sáng cho thí chủ SongT.", { logPrefix: "TestDeepSeek" });
        console.log("\n--- RESULT ---");
        console.log(result);
        console.log("--------------");
    } catch (error) {
        console.error("Test failed with error:", error);
    }
}

main();
