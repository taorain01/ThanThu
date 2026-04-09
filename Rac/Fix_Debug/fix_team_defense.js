/**
 * Fix team thủ V3 - Dùng Discord IDs chính xác từ bc_users
 * Thêm 7 người bị mất vào team_defense (session sat)
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const GUILD_ID = '450633680000385036';

// Danh sách 7 người bị mất - lấy từ bc_users_dump.json (đã xác thực)
const MISSING_MEMBERS = [
  { id: '732674973772283985', gn: 'MinggWang',        role: 'DPS', sub: '' },
  { id: '92773910101123072',  gn: 'Paxetamor',        role: 'DPS', sub: 'kts' },
  { id: '968516551085006848', gn: 'VNHK-JinYangLu',   role: 'DPS', sub: '' },
  { id: '753987903146950677', gn: 'Arisusagi',         role: 'DPS', sub: '' },
  { id: '1401194197759037621',gn: 'SteveYip',          role: 'DPS', sub: '' },
  { id: '1444738899669942332',gn: 'Omal',              role: 'DPS', sub: '' },
  { id: '416955235714727936', gn: 'MasterPaw',         role: 'DPS', sub: '' },
  { id: '1380596282246037504',gn: 'Moonmoon',          role: 'DPS', sub: 'taitro' },
  { id: '876511299914309654', gn: 'JiüHuī-メ竹玲',     role: 'DPS', sub: '' },
];

const parse = v => { try { return typeof v === 'string' ? JSON.parse(v) : (v || []); } catch(e) { return []; } };

(async () => {
  try {
    // 1. Đọc sessions active
    const { data: sessions, error: sErr } = await sb
      .from('bc_sessions').select('*')
      .eq('guild_id', GUILD_ID).eq('status', 'active');

    if (sErr) { console.error('Lỗi đọc sessions:', sErr.message); process.exit(1); }
    if (!sessions?.length) { console.log('Không tìm thấy session active'); process.exit(); }

    console.log(`Tìm thấy ${sessions.length} session(s): ${sessions.map(s => s.day).join(', ')}\n`);

    for (const session of sessions) {
      console.log(`=== Xử lý session: ${session.day} ===`);

      const defense    = parse(session.team_defense);
      const attack1    = parse(session.team_attack1);
      const attack2    = parse(session.team_attack2);
      const forest     = parse(session.team_forest);
      const waiting    = parse(session.waiting_list);

      // Tập hợp tất cả IDs hiện có trong session
      const allIds = new Set([
        ...defense.map(m => m.id),
        ...attack1.map(m => m.id),
        ...attack2.map(m => m.id),
        ...forest.map(m => m.id),
        ...waiting.map(m => m.id),
      ]);
      const defIds = new Set(defense.map(m => m.id));

      console.log(`  DEF hiện tại: ${defense.length} người`);
      defense.forEach((m, i) => console.log(`    ${i+1}. ${m.gn || m.name} (${m.id})`));

      const newDefense = [...defense];
      let addedCount = 0;

      for (const member of MISSING_MEMBERS) {
        if (defIds.has(member.id)) {
          console.log(`  ⏩ ${member.gn} đã có trong DEF, bỏ qua`);
          continue;
        }
        if (allIds.has(member.id)) {
          // Người đang ở team khác — không di chuyển, chỉ log
          // Nếu muốn force thêm vào def, comment dòng continue bên dưới
          const foundIn = 
            attack1.find(m => m.id === member.id) ? 'A1' :
            attack2.find(m => m.id === member.id) ? 'A2' :
            forest.find(m => m.id === member.id)  ? 'Forest' :
            waiting.find(m => m.id === member.id) ? 'Waiting' : '?';
          console.log(`  ⚠️  ${member.gn} đang ở ${foundIn}, bỏ qua`);
          continue;
        }
        // Chưa ở đâu -> thêm vào DEF
        newDefense.push({
          id:         member.id,
          gn:         member.gn,
          name:       member.gn,
          role:       member.role,
          sub:        member.sub,
          joinedAt:   Date.now(),
          isLeader:   false,
          isRegular:  false,
        });
        addedCount++;
        console.log(`  ✅ Đã thêm ${member.gn} (${member.id})`);
      }

      if (addedCount === 0) {
        console.log('  Không cần thêm ai.\n');
        continue;
      }

      console.log(`\n  DEF: ${defense.length} → ${newDefense.length} người`);
      console.log('  Danh sách DEF mới:', newDefense.map(m => m.gn || m.name).join(', '));

      // Cập nhật Supabase
      const { error: upErr } = await sb
        .from('bc_sessions')
        .update({ team_defense: JSON.stringify(newDefense) })
        .eq('guild_id', GUILD_ID)
        .eq('day', session.day);

      if (upErr) {
        console.error(`  ❌ Lỗi update ${session.day}:`, upErr.message);
      } else {
        console.log(`  ✅ ĐÃ CẬP NHẬT session ${session.day} lên Supabase!\n`);
      }
    }

    console.log('=== HOÀN TẤT ===');
  } catch (err) {
    console.error('Lỗi không xác định:', err.message);
  }
  process.exit();
})();
