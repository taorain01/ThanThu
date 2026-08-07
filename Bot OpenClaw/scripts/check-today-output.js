'use strict';
// Kiểm tra output hôm nay: item nào đủ ảnh, item nào thiếu, item nào đã gửi Discord.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = 'F:\\Hình Ảnh\\anhYoutube';
const ITEMS = [
  ['Namizuko', ['0001', '0002', '0003', '0004']],
  ['SeoraChill', ['0004', '0006', '0012', '0013', '0014']],
];

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  } catch { return null; }
}

for (const [channel, nums] of ITEMS) {
  const dir = path.join(ROOT, channel);
  const metaDir = path.join(dir, '_metadata');
  console.log(`\n=== ${channel} ===`);
  if (!fs.existsSync(dir)) { console.log('  (folder không tồn tại)'); continue; }
  const metas = fs.existsSync(metaDir)
    ? fs.readdirSync(metaDir).filter((f) => f.endsWith('.json'))
    : [];
  const fileNames = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /\.png$/i.test(f))
    : [];

  for (const num of nums) {
    const bg = fileNames.find((f) => f.startsWith(`${num} — `) && f.includes('(background)'));
    const pl = fileNames.find((f) => f.startsWith(`${num} — `) && f.includes('(playlist)'));
    const metaFile = metas.find((f) => f.startsWith(`${num} — `));
    const meta = metaFile ? readJson(path.join(metaDir, metaFile)) : null;
    const delivered = meta?.delivered === true || Boolean(meta?.delivery?.deliveredAt || meta?.deliveryStatus === 'delivered');
    const parts = [];
    parts.push(`#${num} ${meta?.title || metaFile?.replace(' (item).json', '')?.replace(`${num} — `, '') || '?'}`);
    parts.push(bg ? 'BG✓' : 'BG✗');
    parts.push(pl ? 'PL✓' : 'PL✗');
    parts.push(delivered ? 'ĐÃ GỬI' : 'CHƯA GỬI');
    if (meta?.delivery?.deliveredAt) parts.push(`(lúc ${String(meta.delivery.deliveredAt).slice(11, 19)})`);
    console.log('  ' + parts.join(' | '));
  }

  // liệt kê file PNG lạ không khớp numbering
  const odd = fileNames.filter((f) => !ITEMS[0][1].some((n) => f.startsWith(`${n} — `)));
  if (odd.length) console.log('  (file khác:) ' + odd.join(', '));
}
