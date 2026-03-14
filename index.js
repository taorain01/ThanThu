/**
 * Entry point for Discord bot
 * This file is used by hosting panels that require index.js in root
 * Redirects to the actual bot file at src/bot.js
 */

console.log('\n════════════════════════════════════════');
console.log('🤖 Bot Đại Ngỗng đang khởi động...');
console.log('════════════════════════════════════════\n');

require('./src/bot.js');
