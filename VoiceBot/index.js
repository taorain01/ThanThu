/**
 * Entry point cho VoiceBot (Tiểu Ngỗng)
 * File này dùng cho hosting panel yêu cầu index.js ở root
 * Chuyển hướng sang file bot chính tại src/bot.js
 */

console.log('\n════════════════════════════════════════');
console.log('🦆 Tiểu Ngỗng VoiceBot đang khởi động...');
console.log('════════════════════════════════════════\n');

require('./src/bot.js');
