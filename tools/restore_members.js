/**
 * Script khôi phục thành viên bị đánh dấu rời nhầm
 * Chạy: node tools/restore_members.js
 *
 * Cách hoạt động:
 * - Tìm tất cả user có left_at được set trong vòng 1 tiếng qua (do checkMemberPresence chạy lúc khởi động)
 * - Khôi phục left_at = NULL và position về giá trị cũ (hoặc 'mem' nếu bị ghi đè thành 'Không có')
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data.db');
const db = new Database(DB_PATH);

// Tìm các user bị đánh dấu rời trong vòng 2 tiếng qua
const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

const affected = db.prepare(`
  SELECT discord_id, discord_name, game_username, position, left_at
  FROM users
  WHERE left_at IS NOT NULL AND left_at > ?
  ORDER BY left_at DESC
`).all(cutoff);

console.log(`\n🔍 Tìm thấy ${affected.length} thành viên bị đánh dấu rời trong 2 tiếng qua:\n`);

if (affected.length === 0) {
  console.log('✅ Không có thành viên nào cần khôi phục!');
  process.exit(0);
}

affected.forEach((u, i) => {
  console.log(`  ${i + 1}. ${u.discord_name || u.game_username} | position: ${u.position} | left_at: ${u.left_at}`);
});

// Khôi phục: xóa left_at, nếu position = 'Không có' thì đặt lại thành 'mem'
const restore = db.prepare(`
  UPDATE users
  SET
    left_at = NULL,
    position = CASE WHEN position = 'Không có' THEN 'mem' ELSE position END,
    updated_at = CURRENT_TIMESTAMP
  WHERE discord_id = ?
`);

const restoreAll = db.transaction(() => {
  let count = 0;
  for (const u of affected) {
    const result = restore.run(u.discord_id);
    if (result.changes > 0) count++;
  }
  return count;
});

const restored = restoreAll();

console.log(`\n✅ Đã khôi phục ${restored}/${affected.length} thành viên về trạng thái active!`);
console.log('\n📝 Lưu ý: Position bị ghi đè thành "Không có" đã được đặt lại thành "mem".');
console.log('   Nếu có thành viên cần position khác (bc, pbc, kc...) hãy cập nhật thủ công bằng lệnh bot.\n');

db.close();
