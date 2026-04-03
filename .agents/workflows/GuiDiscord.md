---
description: Gửi file HTML (hoặc bất kỳ file nào) lên Discord qua Webhook để xem nhanh trên điện thoại
---

# Workflow: Gửi file lên Discord (GuiDiscord)

## Thông tin cố định
- **Webhook URL**: `https://discord.com/api/webhooks/1489493107564216391/LyWYs432U0YN87FQ3WllNu_6t6d3xNt6rgfcp16anzxkhArx-eG9vKXJgTnxfLPUqeLR`
- **Giới hạn file Discord**: 25MB
- **Script path**: `App/Script/send_to_discord.js` (Node.js — không dùng Python vì bị SSL timeout)

## Các bước thực hiện

### 1. Đảm bảo script tồn tại
Nếu chưa có file `App/Script/send_to_discord.js`, tạo file mới với nội dung sau:

```javascript
/**
 * Gửi file/tin nhắn lên Discord qua Webhook.
 * Dùng Node.js fetch (built-in từ Node 18+).
 * 
 * Cách dùng:
 *   Gửi file:  node send_to_discord.js <file> [tin_nhắn]
 *   Gửi text:  node send_to_discord.js --text "nội dung"
 */

const fs = require('fs');
const path = require('path');

const WEBHOOK_URL = "https://discord.com/api/webhooks/1489493107564216391/LyWYs432U0YN87FQ3WllNu_6t6d3xNt6rgfcp16anzxkhArx-eG9vKXJgTnxfLPUqeLR";

async function guiTinNhan(noiDung) {
    const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: noiDung })
    });
    if (res.ok) console.log('✅ Đã gửi tin nhắn thành công!');
    else console.error(`❌ Lỗi ${res.status}: ${await res.text()}`);
}

async function guiFile(filePath, noiDung = '') {
    if (!fs.existsSync(filePath)) {
        console.error(`❌ Không tìm thấy file: ${filePath}`);
        process.exit(1);
    }
    const stats = fs.statSync(filePath);
    if (stats.size > 25 * 1024 * 1024) {
        console.error(`❌ File quá lớn (${(stats.size / 1024 / 1024).toFixed(1)}MB). Giới hạn 25MB.`);
        process.exit(1);
    }

    const tenFile = path.basename(filePath);
    const message = noiDung || `📎 **${tenFile}** (${(stats.size / 1024).toFixed(1)} KB)`;

    // Tạo multipart/form-data bằng tay (không cần thư viện ngoài)
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const fileData = fs.readFileSync(filePath);

    const parts = [];
    // Part 1: content (tin nhắn)
    parts.push(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="content"\r\n\r\n` +
        `${message}\r\n`
    );
    // Part 2: file
    parts.push(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${tenFile}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`
    );

    const head = Buffer.from(parts.join(''));
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, fileData, tail]);

    const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: body
    });

    if (res.ok) console.log(`✅ Đã gửi thành công: ${tenFile}`);
    else console.error(`❌ Lỗi ${res.status}: ${await res.text()}`);
}

// Main
const args = process.argv.slice(2);
if (args.length === 0) {
    console.log('Cách dùng:');
    console.log('  Gửi file:  node send_to_discord.js <file> [tin_nhắn]');
    console.log('  Gửi text:  node send_to_discord.js --text "nội dung"');
    process.exit(0);
}

if (args[0] === '--text') {
    guiTinNhan(args.slice(1).join(' '));
} else {
    guiFile(args[0], args.slice(1).join(' ') || '');
}
```

### 2. Gửi file HTML (hoặc bất kỳ file nào)
// turbo
```
node "App/Script/send_to_discord.js" "<đường_dẫn_tuyệt_đối_file>"
```

### 3. Gửi file với tin nhắn kèm theo
// turbo
```
node "App/Script/send_to_discord.js" "<đường_dẫn_file>" "📊 Mô tả nội dung file"
```

### 4. Gửi chỉ tin nhắn text (không file)
// turbo
```
node "App/Script/send_to_discord.js" --text "nội dung tin nhắn"
```

## Khi tạo HTML mới cho báo cáo
File HTML gửi qua Discord nên có định dạng **mobile-friendly**:
- Viewport: `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
- Font size tối thiểu 16px, padding/margin hợp lý
- Nên dùng dark mode để dễ đọc trên điện thoại
- User sẽ tải file về và mở trong trình duyệt điện thoại

## Xử lý lỗi
- Nếu lỗi `fetch is not defined`: Node.js < 18. Chạy `node --version` kiểm tra, nếu cũ thì dùng `https` module thay thế.
- Nếu lỗi timeout: Kiểm tra firewall/VPN.
- Nếu lỗi 413: File quá lớn (> 25MB).