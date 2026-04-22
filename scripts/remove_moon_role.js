/**
 * Script 1 lần: Xóa role "moon" (Nữ Hoàng) khỏi database
 * Chạy: node scripts/remove_moon_role.js
 */

const path = require('path');

// Import db module
const db = require('../src/database/db');

const ROLE_MAPPINGS_KEY = 'sub_role_mappings';
const CODE_TO_DELETE = 'moon';

// 1. Đọc role mappings hiện tại
const raw = db.getConfig(ROLE_MAPPINGS_KEY);
if (!raw) {
    console.log('❌ Không tìm thấy sub_role_mappings trong config!');
    process.exit(1);
}

let mappings;
try {
    mappings = JSON.parse(raw);
} catch (e) {
    console.log('❌ Lỗi parse JSON:', e.message);
    process.exit(1);
}

// 2. Kiểm tra có entry "moon" không
if (!mappings[CODE_TO_DELETE]) {
    console.log(`❌ Không tìm thấy mã "${CODE_TO_DELETE}" trong role mappings!`);
    console.log('Danh sách hiện tại:', Object.keys(mappings).join(', '));
    process.exit(1);
}

const entry = mappings[CODE_TO_DELETE];
const roleName = typeof entry === 'string' ? entry : entry.name;
console.log(`🔍 Tìm thấy: ${CODE_TO_DELETE} → ${roleName}`);

// 3. Xóa icon file nếu có
const fs = require('fs');
const iconPath = typeof entry === 'object' ? entry.icon : null;
if (iconPath && fs.existsSync(iconPath)) {
    fs.unlinkSync(iconPath);
    console.log(`🗑️ Đã xóa icon: ${iconPath}`);
}

// 4. Xóa khỏi mappings và lưu lại
delete mappings[CODE_TO_DELETE];
db.setConfig(ROLE_MAPPINGS_KEY, JSON.stringify(mappings));
console.log(`✅ Đã xóa "${CODE_TO_DELETE}" khỏi role mappings`);

// 5. Cleanup display_roles table
try {
    db.deleteDisplayRole('450633680000385036', CODE_TO_DELETE); // Guild ID
    console.log(`✅ Đã xóa display role data cho "${CODE_TO_DELETE}"`);
} catch (e) {
    console.log(`⚠️ Không xóa được display role data:`, e.message);
}

// 6. Cleanup user_display (clear users đang show moon)
try {
    const affected = db.getUsersByDisplayCode(CODE_TO_DELETE);
    if (affected.length > 0) {
        db.clearDisplayCodeForAll(CODE_TO_DELETE);
        console.log(`✅ Đã clear display cho ${affected.length} user(s)`);
    } else {
        console.log('ℹ️ Không có user nào đang show role này');
    }
} catch (e) {
    console.log(`⚠️ Không clear được user display:`, e.message);
}

// 7. Xóa emoji trên emoji server (nếu có emojiId)
if (entry.emojiId) {
    console.log(`ℹ️ Emoji ID: ${entry.emojiId} — cần xóa thủ công trên emoji server`);
}

console.log('\n✅ HOÀN TẤT! Role "moon" (Nữ Hoàng) đã bị xóa khỏi database.');
console.log('Danh sách còn lại:', Object.keys(mappings).length, 'role(s)');
