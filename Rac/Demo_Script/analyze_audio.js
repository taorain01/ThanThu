const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");
require("dotenv").config({ path: "c:\\ALABASTA\\ThanThu\\.env" });

const keys = [];
for (let i = 1; i <= 9; i++) {
  if (process.env[`GEMINI_API_KEY_${i}`]) {
    keys.push(process.env[`GEMINI_API_KEY_${i}`]);
  }
}
if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
if (process.env.GOOGLE_API_KEY) keys.push(process.env.GOOGLE_API_KEY);

if (keys.length === 0) {
    console.error("No API key found.");
    process.exit(1);
}

async function run() {
  const filePath = "c:\\ALABASTA\\ThanThu\\Let It Be.wav";
  let uploadResult = null;
  let fileManager = null;
  let genAI = null;
  let globalApiKey = null;

  for (const apiKey of keys) {
    console.log(`Trying API key starting with ${apiKey.substring(0, 10)}...`);
    fileManager = new GoogleAIFileManager(apiKey);
    try {
      uploadResult = await fileManager.uploadFile(filePath, {
        mimeType: "audio/wav",
        displayName: "Let It Be",
      });
      console.log("Upload successful!");
      genAI = new GoogleGenerativeAI(apiKey);
      globalApiKey = apiKey;
      break;
    } catch (err) {
      console.error(`Upload failed: ${err.message}`);
    }
  }

  if (!uploadResult) {
    console.error("All keys failed to upload.");
    process.exit(1);
  }

  const file = uploadResult.file;
  console.log(`Uploaded file as: ${file.name}`);
  
  console.log("Waiting for file processing to complete...");
  let currentFile = await fileManager.getFile(file.name);
  while (currentFile.state === "PROCESSING") {
    process.stdout.write(".");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    currentFile = await fileManager.getFile(file.name);
  }
  
  if (currentFile.state === "FAILED") {
    console.error("\nAudio processing failed.");
    process.exit(1);
  }
  
  console.log("\nFile is ready for processing.");

  const prompt = `Hãy nghe kỹ file âm thanh (bài hát) này và:
1. Phân tích chi tiết:
- Thể loại nhạc (Genre).
- Tinh thần / Cảm xúc (Mood / Vibe).
- Các loại nhạc cụ chính được sử dụng.
- Giọng hát (Voice: nam hay nữ, cách hát như thế nào).
- Nhịp / Tốc độ (Tempo / Rhythm).

2. Phân tích thành 'Style Prompt' cho Suno AI:
- Dựa trên phân tích trên, hãy chuyển đổi các đặc điểm thành một đoạn 'Style Prompt' bằng TIẾNG ANH (tối đa 120 ký tự) tối ưu cho Suno AI. Format của Suno Style prompt là các từ hoặc cụm từ khóa tiếng Anh cách nhau bằng dấu phẩy. 
Ví dụ: acoustic pop rock, sad emotional male vocal, slow piano chords, soft drums, melancholic ballad

Trả về kết quả bằng tiếng Việt theo định dạng rõ ràng.`;

  console.log("Generating analysis from Gemini API...\n");
  try {
    const fetch = require("node-fetch"); // or global fetch if node >= 18
    const fetchFunc = typeof fetch !== 'undefined' ? fetch : (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    
    const response = await fetchFunc(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${globalApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { fileData: { mimeType: file.mimeType, fileUri: file.uri } }
          ]
        }]
      })
    });
    const data = await response.json();
    if (data.error) {
      console.error("API Error:", data.error);
    } else {
      console.log("=== KẾT QUẢ PHÂN TÍCH ===");
      const textResult = data.candidates[0].content.parts[0].text;
      console.log(textResult);
      const fs = require('fs');
      fs.writeFileSync('result.txt', textResult, 'utf-8');
    }
  } catch (err) {
    console.error("Generate content failed: ", err.message);
  }
}

run().catch(console.error);
