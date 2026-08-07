'use strict';

// ============================================================================
// fix-media-folder-mojibake.js — tự sửa thư mục/file bị lỗi mã hóa ký tự
// (mojibake) do pipeline PowerShell/console đọc chuỗi UTF-8 bằng Windows-1258
// (ANSI tiếng Việt). Ví dụ "Hình Ảnh" bị tạo thành "HĂ¬nh áº¢nh".
//
// Cơ chế: tên lỗi = byte UTF-8 của tên đúng được decode bằng cp1258. Ngược lại,
// encode tên lỗi bằng cp1258 rồi decode UTF-8 sẽ ra tên đúng. Script dùng bảng
// cp1258 nhúng sẵn (Node không có sẵn codec này) để:
//
//   1. Ở MỖI cấp thư mục quét: nếu một thư mục có tên lỗi mà thư mục tên đúng
//      đã tồn tại CẠNH NÓ → gộp toàn bộ nội dung vào thư mục đúng rồi xóa
//      thư mục lỗi (không ghi đè file trùng tên).
//   2. Đổi tên file/thư mục bị lỗi ký tự trong tên (vd "0012 â€” Low Notes..."
//      → "0012 — Low Notes...") nếu tên đúng chưa bị chiếm.
//
// An toàn: chỉ gộp khi thư mục đích đã tồn tại, chỉ đổi tên khi tên đích chưa
// tồn tại; file trùng tên được bỏ qua và báo cáo — không bao giờ ghi đè.
//
// CLI:
//   node fix-media-folder-mojibake.js --check [root...]
//   node fix-media-folder-mojibake.js [root...]
// Mặc định quét ổ chứa media (F:\ tìm từ OPENCLAW_MEDIA_SOURCE_ROOTS) ở cấp 1,
// rồi đệ quy toàn bộ cây trong các root được liệt kê.
// ============================================================================

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

// Bảng cp1258 (Windows-1258 — ANSI tiếng Việt): byte -> ký tự Unicode.
// Chỉ cần 0x80–0xFF; các byte 0x81/0x8D/0x8F/0x90/0x9D không có ký tự.
const CP1258_CHARS = [
  0x20AC, 0xFFFD, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, // 0x80-0x87
  0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0xFFFD, 0x017D, 0xFFFD, // 0x88-0x8F
  0xFFFD, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, // 0x90-0x97
  0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0xFFFD, 0x017E, 0x0178, // 0x98-0x9F
  0x00A0, 0x00A1, 0x00A2, 0x00A3, 0x00A4, 0x00A5, 0x00A6, 0x00A7, // 0xA0-0xA7
  0x00A8, 0x00A9, 0x00AA, 0x00AB, 0x00AC, 0x00AD, 0x00AE, 0x00AF, // 0xA8-0xAF
  0x00B0, 0x00B1, 0x00B2, 0x00B3, 0x00B4, 0x00B5, 0x00B6, 0x00B7, // 0xB0-0xB7
  0x00B8, 0x00B9, 0x00BA, 0x00BB, 0x00BC, 0x00BD, 0x00BE, 0x00BF, // 0xB8-0xBF
  0x00C0, 0x00C1, 0x00C2, 0x0102, 0x00C4, 0x00C5, 0x00C6, 0x00C7, // 0xC0-0xC7
  0x00C8, 0x00C9, 0x00CA, 0x00CB, 0x00CC, 0x00CD, 0x00CE, 0x00CF, // 0xC8-0xCF
  0x0110, 0x00D1, 0x00D2, 0x00D3, 0x00D4, 0x01A0, 0x00D6, 0x00D7, // 0xD0-0xD7
  0x00D8, 0x00D9, 0x00DA, 0x00DB, 0x00DC, 0x01AF, 0x00DD, 0x00DE, // 0xD8-0xDF
  0x00E0, 0x00E1, 0x00E2, 0x0103, 0x00E4, 0x00E5, 0x00E6, 0x00E7, // 0xE0-0xE7
  0x00E8, 0x00E9, 0x00EA, 0x00EB, 0x00EC, 0x00ED, 0x00EE, 0x00EF, // 0xE8-0xEF
  0x0111, 0x00F1, 0x00F2, 0x00F3, 0x00F4, 0x01A1, 0x00F6, 0x00F7, // 0xF0-0xF7
  0x00F7, 0x00F8, 0x00F9, 0x00FA, 0x00FB, 0x00FC, 0x01B0, 0x00FD, // 0xF8-0xFF
  0x00FE, 0x00FF,
];
const BYTE_TO_CHAR = new Map();
const CHAR_TO_BYTE = new Map();
for (let byte = 0x80; byte <= 0xFF; byte += 1) {
  const code = CP1258_CHARS[byte - 0x80];
  if (code === 0xFFFD) {
    continue;
  }
  const ch = String.fromCharCode(code);
  BYTE_TO_CHAR.set(byte, ch);
  if (!CHAR_TO_BYTE.has(ch)) {
    CHAR_TO_BYTE.set(ch, byte);
  }
}

// Encode tên bằng cp1258 rồi decode UTF-8. Trả tên đúng nếu hợp lệ và khác tên
// cũ, ngược lại null. Ký tự ngoài bảng (vd chữ tiếng Việt đúng dấu, ký tự emoji)
// khiến tên KHÔNG phải mojibake → trả null (an toàn tuyệt đối).
function decodeMojibakeName(name) {
  if (!name || !/[^\u0000-\u007F]/.test(name)) {
    return null;
  }
  const bytes = [];
  for (const ch of name) {
    const code = ch.codePointAt(0);
    if (code < 0x80) {
      bytes.push(code);
      continue;
    }
    const byte = CHAR_TO_BYTE.get(ch);
    if (byte === undefined) {
      return null;
    }
    bytes.push(byte);
  }
  const decoded = Buffer.from(bytes).toString('utf8');
  if (!decoded || decoded === name || decoded.includes('\uFFFD')) {
    return null;
  }
  return decoded;
}

// Đổi tên một mục (file/thư mục) nếu tên bị lỗi ký tự và tên đúng chưa tồn tại.
// Trả { renamed, skipped, reason } để báo cáo.
async function fixEntryName(dirPath, entryName, report) {
  const corrected = decodeMojibakeName(entryName);
  if (!corrected) {
    return null;
  }
  const target = path.join(dirPath, corrected);
  const source = path.join(dirPath, entryName);
  if (fs.existsSync(target)) {
    report.conflicts.push({ source, target, reason: 'tên đúng đã tồn tại' });
    return { renamed: false, reason: 'conflict' };
  }
  if (report.dryRun) {
    report.renamed.push({ source, target });
    return { renamed: true, dryRun: true };
  }
  await fsp.rename(source, target);
  report.renamed.push({ source, target });
  return { renamed: true, target };
}

// Gộp toàn bộ nội dung thư mục lỗi vào thư mục đúng (cùng cấp, đã tồn tại).
// Nếu mục trùng tên là THƯ MỤC ở cả hai bên → đệ quy gộp sâu vào bên trong;
// nếu là file → bỏ qua (không ghi đè). Trả true nếu thư mục lỗi đã rỗng.
async function mergeMangledDir(sourceDir, targetDir, report) {
  let entries;
  try {
    entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    report.errors.push({ source: sourceDir, error: error.message });
    return false;
  }
  for (const entry of entries) {
    const src = path.join(sourceDir, entry.name);
    const dst = path.join(targetDir, entry.name);
    if (fs.existsSync(dst)) {
      const dstStat = fs.statSync(dst, { throwIfNoEntry: false });
      if (entry.isDirectory() && dstStat?.isDirectory()) {
        const empty = await mergeMangledDir(src, dst, report);
        if (empty && !report.dryRun) {
          try {
            await fsp.rmdir(src);
          } catch {
            // Thư mục vừa đệ quy có thể được tạo lại — bỏ qua.
          }
        }
        continue;
      }
      report.conflicts.push({ source: src, target: dst, reason: 'thư mục đích đã có mục trùng tên' });
      continue;
    }
    if (report.dryRun) {
      report.moved.push({ source: src, target: dst });
      continue;
    }
    try {
      await fsp.rename(src, dst);
      report.moved.push({ source: src, target: dst });
    } catch (error) {
      report.errors.push({ source: src, target: dst, error: error.message });
    }
  }
  try {
    const remaining = await fsp.readdir(sourceDir);
    if (remaining.length === 0) {
      if (!report.dryRun) {
        await fsp.rmdir(sourceDir);
      }
      return true;
    }
  } catch {
    // Không đọc được → không xóa.
  }
  return false;
}

// Xử lý một thư mục: đổi tên mục bị lỗi, gộp thư mục lỗi có "anh em" đúng, rồi
// đệ quy xuống các thư mục con còn lại. Depth giới hạn để không quét sâu vô ích.
async function processDirectory(dirPath, report, depth) {
  let entries;
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    report.errors.push({ source: dirPath, error: error.message });
    return;
  }

  const byName = new Map(entries.map((e) => [e.name, e]));

  // Bước 1: gộp thư mục tên lỗi vào thư mục tên đúng cạnh nó.
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const corrected = decodeMojibakeName(entry.name);
    if (!corrected || !byName.has(corrected)) {
      continue;
    }
    const sourceDir = path.join(dirPath, entry.name);
    const targetDir = path.join(dirPath, corrected);
    if (report.dryRun) {
      report.merged.push({ source: sourceDir, target: targetDir });
    } else {
      const empty = await mergeMangledDir(sourceDir, targetDir, report);
      report.merged.push({ source: sourceDir, target: targetDir, removed: empty });
    }
  }

  // Bước 2: đổi tên mục bị lỗi (sau khi gộp để không đụng thư mục vừa gộp).
  const mergedNames = new Set();
  for (const merged of report.merged) {
    mergedNames.add(path.basename(merged.source));
  }
  for (const entry of entries) {
    if (mergedNames.has(entry.name)) {
      continue;
    }
    await fixEntryName(dirPath, entry.name, report);
  }

  // Bước 3: đệ quy xuống các thư mục con chưa bị xử lý (không đệ quy vào thư
  // mục lỗi vừa gộp/xóa).
  if (depth <= 0) {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const corrected = decodeMojibakeName(entry.name);
    if (corrected && byName.has(corrected)) {
      continue; // đã gộp
    }
    await processDirectory(path.join(dirPath, entry.name), report, depth - 1);
  }
}

async function fixMediaFolderMojibake(options = {}) {
  const scanRoots = Array.isArray(options.scanRoots) ? options.scanRoots : [];
  const report = {
    dryRun: Boolean(options.dryRun),
    roots: scanRoots,
    merged: [],
    moved: [],
    renamed: [],
    conflicts: [],
    errors: [],
  };
  // Root ổ đĩa (vd F:\) chỉ xử lý CẤP 1 (gộp/đổi tên thư mục con) — không đệ
  // quy để tránh quét trùng với media root bên trong.
  for (const root of scanRoots) {
    if (path.parse(root).root !== root) {
      continue;
    }
    await processDirectory(root, report, 0);
  }
  // Media root: đệ quy đầy đủ để sửa tên file/thư mục bên trong cây.
  for (const root of scanRoots) {
    if (path.parse(root).root === root) {
      continue;
    }
    await processDirectory(root, report, options.maxDepth ?? 5);
  }
  return report;
}

function defaultScanRoots() {
  const roots = new Set();
  const envRoots = String(process.env.OPENCLAW_MEDIA_SOURCE_ROOTS || '')
    .split(';').map((s) => s.trim()).filter(Boolean);
  const all = [...envRoots, 'F:\\Hình Ảnh\\anhYoutube'];
  for (const root of all) {
    const drive = path.parse(root).root;
    if (drive) {
      roots.add(drive);
    }
  }
  for (const root of all) {
    roots.add(root);
  }
  return [...roots];
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--check');
  const positional = args.filter((a) => !a.startsWith('--'));
  const roots = positional.length ? positional : defaultScanRoots();
  const report = await fixMediaFolderMojibake({ scanRoots: roots, dryRun });
  const out = [];
  out.push(`Mojibake fix (${report.dryRun ? 'CHECK — không sửa gì' : 'ĐÃ SỬA'}) — quét ${report.roots.length} root:`);
  for (const m of report.merged) {
    out.push(`  [gộp] ${m.source} -> ${m.target}${m.removed === false ? ' (còn file trùng tên)' : ''}`);
  }
  for (const m of report.moved) {
    out.push(`  [di chuyển] ${m.source} -> ${m.target}`);
  }
  for (const r of report.renamed) {
    out.push(`  [đổi tên] ${r.source} -> ${r.target}`);
  }
  for (const c of report.conflicts) {
    out.push(`  [BỎ QUA — trùng] ${c.source} (${c.reason})`);
  }
  for (const e of report.errors) {
    out.push(`  [LỖI] ${e.source}: ${e.error}`);
  }
  out.push(`Tổng: ${report.merged.length} thư mục gộp · ${report.moved.length} mục di chuyển · ${report.renamed.length} đổi tên · ${report.conflicts.length} trùng · ${report.errors.length} lỗi`);
  console.log(out.join('\n'));
}

module.exports = { CP1258_CHARS, decodeMojibakeName, fixMediaFolderMojibake };

if (require.main === module) {
  main().catch((error) => {
    console.error('Lỗi khi chạy fix-mojibake:', error);
    process.exit(1);
  });
}
