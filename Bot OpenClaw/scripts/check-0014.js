'use strict';
const fs = require('node:fs');

for (const p of [
  'F:\\Hình Ảnh\\anhYoutube\\SeoraChill\\_metadata\\0014 — Low Notes, Warm Foam (item).json',
  'F:\\Hình Ảnh\\anhYoutube\\SeoraChill\\_metadata\\0012 — Low Notes, Warm Foam (item).json',
]) {
  const j = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  console.log('---', p.split('\\').pop());
  console.log('  id:', j.id, '| title:', j.title, '| delivered:', j.delivered, '| delivery:', JSON.stringify(j.delivery || {}).slice(0, 220));
}
