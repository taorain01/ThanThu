/**
 * Debug: Dump bc_users và tìm người bị mất trong team thủ
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const fs = require('fs');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Người cần tìm (tên game hoặc username Discord)
const MISSING_NAMES = [
  'MinggWang',
  'Paxetamor',
  'JinYangLu', 'VNHK-JinYangLu',
  'Arisusagi',
  'SteveYip', 'Yip',
  'Omal',
  'MasterPaw',
  'Moonmoon',
  'JiüHuī', 'JiuHui',
];

// Discord IDs đã biết chắc từ screenshot
const KNOWN_IDS = {
  '753987903146950677': 'Arisusagi',
  '1444738899669942332': 'Omal',
  '416955235714727936': 'MasterPaw',
};

(async () => {
  try {
    // 1. Dump toàn bộ bc_users
    const { data: users, error: uErr } = await sb.from('bc_users').select('*');
    if (uErr) { console.error('bc_users error:', uErr.message); process.exit(1); }
    
    console.log(`\n=== TỔNG bc_users: ${users.length} ===\n`);
    
    // 2. Tìm theo known IDs trước
    console.log('--- Tìm bằng Known Discord IDs ---');
    for (const [id, label] of Object.entries(KNOWN_IDS)) {
      const user = users.find(u => u.discord_id === id);
      if (user) {
        console.log(`✅ ${label} (${id}): gn="${user.game_username}" username="${user.username}" role=${user.position}`);
      } else {
        console.log(`❌ ${label} (${id}): KHÔNG TÌM THẤY`);
      }
    }
    
    // 3. Tìm theo tên
    console.log('\n--- Tìm bằng Tên ---');
    for (const name of MISSING_NAMES) {
      const nl = name.toLowerCase().replace(/[üū]/g, 'u').replace(/[-_\s]/g, '');
      const matches = users.filter(u => {
        const gn = (u.game_username || '').toLowerCase().replace(/[-_\s]/g, '');
        const un = (u.username || '').toLowerCase().replace(/[-_\s]/g, '');
        const dn = (u.discord_name || '').toLowerCase().replace(/[-_\s]/g, '');
        return gn.includes(nl) || nl.includes(gn.substring(0, Math.min(gn.length, 5))) ||
               un.includes(nl) || nl.includes(un.substring(0, Math.min(un.length, 5))) ||
               dn.includes(nl) || nl.includes(dn.substring(0, Math.min(dn.length, 5)));
      });
      if (matches.length === 1) {
        const u = matches[0];
        console.log(`✅ "${name}" → id=${u.discord_id} gn="${u.game_username}" username="${u.username}" role=${u.position}`);
      } else if (matches.length > 1) {
        console.log(`⚠️  "${name}" → ${matches.length} matches:`);
        matches.forEach(u => console.log(`   id=${u.discord_id} gn="${u.game_username}" username="${u.username}"`));
      } else {
        console.log(`❌ "${name}" → KHÔNG KHỚP`);
      }
    }
    
    // 4. Dump session sat để xem def hiện tại
    console.log('\n--- Session SAT - team_defense ---');
    const { data: sessions } = await sb.from('bc_sessions').select('*')
      .eq('guild_id', '450633680000385036').eq('status', 'active');
    
    for (const s of (sessions || [])) {
      const def = typeof s.team_defense === 'string' ? JSON.parse(s.team_defense) : (s.team_defense || []);
      console.log(`Session ${s.day}: DEF có ${def.length} người`);
      def.forEach((m, i) => console.log(`  ${i+1}. id=${m.id} gn="${m.gn || m.name}" role=${m.role}`));
    }
    
    // 5. Ghi dump bc_users ra file để xem offline
    fs.writeFileSync('bc_users_dump.json', JSON.stringify(users, null, 2), 'utf8');
    console.log('\n✅ Đã ghi bc_users_dump.json để xem offline');
    
  } catch (err) {
    console.error('Error:', err.message);
  }
  process.exit();
})();
