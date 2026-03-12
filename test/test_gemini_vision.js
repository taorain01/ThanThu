/**
 * Script test nhanh kha nang phan tich anh cua Gemini API
 */

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

const API_KEY = process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.log('ERROR: Khong tim thay GEMINI_API_KEY trong .env!');
    process.exit(1);
}

const LOG_FILE = __dirname + '/vision_result.log';

function log(msg) {
    const line = msg + '\n';
    process.stdout.write(line);
    fs.appendFileSync(LOG_FILE, line, 'utf8');
}

async function main() {
    // Xoa file log cu
    if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);

    log('--- TEST GEMINI VISION API ---');
    log('Model: gemini-2.5-flash');
    log('API Key: ' + API_KEY.substring(0, 10) + '...');
    log('');

    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Tai anh tu URL (picsum cho anh truc tiep, khong redirect HTML)
    const imageUrl = 'https://picsum.photos/200/200.jpg';
    log('Dang tai anh tu URL: ' + imageUrl);

    const response = await fetch(imageUrl);
    const contentType = response.headers.get('content-type') || '';
    log('Response status: ' + response.status + ', content-type: ' + contentType);
    
    if (!contentType.startsWith('image/')) {
        log('LOI: URL khong tra ve anh! Content-Type: ' + contentType);
        return;
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    log('Tai thanh cong! Size: ' + (arrayBuffer.byteLength / 1024).toFixed(1) + ' KB');

    // Gui len Gemini de phan tich
    log('Dang gui anh len Gemini de phan tich...');
    const result = await model.generateContent([
        'Describe this image in 2-3 sentences. What do you see?',
        {
            inlineData: {
                data: base64,
                mimeType: contentType,
            },
        },
    ]);

    const text = result.response.text();
    log('');
    log('=== KET QUA PHAN TICH ===');
    log(text);
    log('');
    log('=== KET LUAN: Gemini 2.5 Flash CO THE phan tich anh! ===');
}

main().catch(err => {
    log('LOI: ' + err.message);
});
