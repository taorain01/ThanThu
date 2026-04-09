const fs = require('fs');
let f = fs.readFileSync('WebBangChien/index.html', 'utf8');

// ═══ FIX: Dùng .replace trực tiếp trên từng dòng CSS ═══

// 1. Bỏ background gradient → background:none
f = f.replace(
    'background:linear-gradient(transparent,rgba(0,0,0,.75) 30%);',
    'background:none;pointer-events:none;'
);
console.log('✅ Bỏ background gradient .tactics-controls');

// 2. tc-toggle: đổi background mờ + thêm backdrop-blur + pointer-events:auto
f = f.replace(
    `.tc-toggle{
  display:flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);
  cursor:pointer;transition:all .25s cubic-bezier(.25,.46,.45,.94);
  font-size:11px;font-weight:600;color:var(--text3);
  user-select:none;flex-shrink:0;white-space:nowrap;
}`.replace(/\n/g, '\r\n'),
    `.tc-toggle{
  display:flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;
  background:rgba(10,20,15,.65);border:1px solid rgba(255,255,255,.1);
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  cursor:pointer;transition:all .25s cubic-bezier(.25,.46,.45,.94);
  font-size:11px;font-weight:600;color:var(--text3);
  user-select:none;flex-shrink:0;white-space:nowrap;
  pointer-events:auto;
}`.replace(/\n/g, '\r\n')
);
console.log('✅ Update .tc-toggle (backdrop-blur, pointer-events)');

// 3. tc-mark-label: thêm pointer-events:auto + background nhẹ
const oldMark = 'margin-left:auto;font-size:11px;color:var(--gold);font-weight:700;';
const newMark = 'margin-left:auto;font-size:11px;color:var(--gold);font-weight:700;pointer-events:auto;';
f = f.replace(oldMark, newMark);
console.log('✅ tc-mark-label pointer-events:auto');

fs.writeFileSync('WebBangChien/index.html', f, 'utf8');

// Verify
const v = fs.readFileSync('WebBangChien/index.html', 'utf8');
const idx = v.indexOf('.tactics-controls{');
const end = v.indexOf('}', idx);
console.log('\n=== Kết quả .tactics-controls ===');
console.log(v.substring(idx, end + 1));

const idx2 = v.indexOf('.tc-toggle{');
const end2 = v.indexOf('}', idx2);
console.log('\n=== Kết quả .tc-toggle ===');
console.log(v.substring(idx2, end2 + 1));
