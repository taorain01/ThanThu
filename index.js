/**
 * Entry point for Discord bot
 * This file is used by hosting panels that require index.js in root
 * Redirects to the actual bot file at src/bot.js
 */

console.log('✅ [GIT TEST] Code mới từ GitHub đã được cập nhật! - ' + new Date().toLocaleString('vi-VN'));
require('./src/bot.js');
