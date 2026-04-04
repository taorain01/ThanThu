const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const fs = require('fs');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
  const { data } = await sb.from('bc_sessions').select('*')
    .eq('guild_id', '450633680000385036').eq('status', 'active').limit(1);
  const s = data[0];
  if (!s) { console.log('NO SESSION'); process.exit(); }
  
  const p = v => { try { return typeof v === 'string' ? JSON.parse(v) : (v || []); } catch(e) { return []; } };
  const lines = [`Session: ${s.day}\n`];
  
  const teams = { A1: p(s.team_attack1), A2: p(s.team_attack2), DEF: p(s.team_defense), FOR: p(s.team_forest), W: p(s.waiting_list) };
  
  for (const [label, members] of Object.entries(teams)) {
    lines.push(`--- ${label} (${members.length}) ---`);
    members.forEach((m, i) => {
      lines.push(`  ${i+1}. id=${m.id} gn=${m.gn||''} name=${m.name||''} user=${m.username||''} role=${m.role||''} sub=${m.sub||''}`);
    });
  }
  
  const total = Object.values(teams).reduce((s, t) => s + t.length, 0);
  lines.push(`\nTOTAL: ${total}`);
  
  fs.writeFileSync('team_dump.txt', lines.join('\n'));
  console.log('Done! Wrote to team_dump.txt');
  process.exit();
})();
