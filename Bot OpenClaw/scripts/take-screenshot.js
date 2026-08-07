'use strict';

// Chụp màn hình PC qua node OpenClaw đã pair và lưu ra file PNG bằng MỘT lệnh.
// Dùng cho model cục bộ (qwen3.5/gemma4) vốn hay thất bại khi phải tự làm chuỗi
// nhiều bước: nodes status -> nodes invoke screen.snapshot -> parse JSON ->
// giải mã payload.base64 -> ghi file.
//
// Cách dùng:
//   node "C:\Bot Discord\Bot OpenClaw\scripts\take-screenshot.js"
//   node ...\take-screenshot.js --out "F:\Hình Ảnh\shot.png" --node RAIN
//
// In ra một dòng JSON: {"ok":true,"path":"...","bytes":123456,"width":..,"height":..}
// Mọi lỗi cũng in JSON {"ok":false,"error":"..."} và exit code 1, nên model chỉ
// cần đọc trường ok và path.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) {
      continue;
    }
    const name = key.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[name] = next;
      i += 1;
    } else {
      args[name] = true;
    }
  }
  return args;
}

// Gọi trực tiếp dist/index.js của OpenClaw bằng node: spawn .cmd trên Windows
// cần shell:true (kéo theo rắc rối escape đường dẫn), còn node thì không.
function openclawEntry() {
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', 'openclaw', 'dist', 'index.js'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', 'openclaw', 'dist', 'index.mjs'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error('Không tìm thấy dist/index.js của OpenClaw CLI.');
}

function runCli(cliArgs) {
  return execFileSync(process.execPath, [openclawEntry(), ...cliArgs], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
}

function nodeIdOf(entry) {
  return entry?.nodeId || entry?.id || entry?.displayName || entry?.name || '';
}

function nodeNamesOf(entry) {
  return [entry?.nodeId, entry?.id, entry?.displayName, entry?.name]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
}

// nodes status --json để tìm node đang connected có capability screen.
function resolveNodeId(preferred) {
  const raw = runCli(['nodes', 'status', '--json']);
  const data = JSON.parse(raw.slice(raw.indexOf('{')));
  const nodes = Array.isArray(data) ? data : (data?.nodes || []);
  const withScreen = nodes.filter((entry) => (
    Array.isArray(entry?.commands) ? entry.commands.includes('screen.snapshot') : true
  ));
  const pool = withScreen.length > 0 ? withScreen : nodes;
  if (preferred) {
    const wanted = String(preferred).trim().toLowerCase();
    const match = pool.find((entry) => nodeNamesOf(entry).some((name) => name.includes(wanted)));
    if (match) {
      return nodeIdOf(match);
    }
    throw new Error(`Không tìm thấy node "${preferred}" hỗ trợ screen.snapshot.`);
  }
  const first = pool[0];
  if (!first) {
    throw new Error('Không có node OpenClaw nào hỗ trợ screen.snapshot.');
  }
  return nodeIdOf(first);
}

// Ảnh có thể nằm ở nhiều vị trí tùy phiên bản node; dò tất cả nhánh khả dĩ.
function findBase64(value, depth = 0) {
  if (depth > 6 || !value) {
    return null;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/^data:image\/[a-z+]+;base64,/i, '');
    return cleaned.length > 512 && /^[A-Za-z0-9+/=\s]+$/.test(cleaned) ? cleaned : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findBase64(item, depth + 1);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const key of ['base64', 'image', 'data', 'png', 'screenshot']) {
      const found = findBase64(value[key], depth + 1);
      if (found) {
        return found;
      }
    }
    for (const nested of Object.values(value)) {
      const found = findBase64(nested, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function findDimensions(value, depth = 0) {
  if (depth > 6 || !value || typeof value !== 'object') {
    return {};
  }
  if (Number.isFinite(value.width) && Number.isFinite(value.height)) {
    return { width: value.width, height: value.height };
  }
  for (const nested of Object.values(value)) {
    const found = findDimensions(nested, depth + 1);
    if (found.width) {
      return found;
    }
  }
  return {};
}

function defaultOutPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(os.homedir(), '.openclaw', 'workspace', `screenshot-${stamp}.png`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const nodeId = resolveNodeId(typeof args.node === 'string' ? args.node : null);
  const timeout = String(args['invoke-timeout'] || 30000);
  const raw = runCli([
    'nodes', 'invoke',
    '--node', nodeId,
    '--command', 'screen.snapshot',
    '--invoke-timeout', timeout,
    '--json',
  ]);
  const jsonStart = raw.indexOf('{');
  if (jsonStart === -1) {
    throw new Error('Node không trả về JSON cho screen.snapshot.');
  }
  const payload = JSON.parse(raw.slice(jsonStart));
  const base64 = findBase64(payload);
  if (!base64) {
    throw new Error('Kết quả screen.snapshot không chứa dữ liệu ảnh base64.');
  }
  const outPath = path.resolve(
    typeof args.out === 'string' && args.out.trim() ? args.out.trim() : defaultOutPath(),
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const buffer = Buffer.from(base64.replace(/\s+/g, ''), 'base64');
  fs.writeFileSync(outPath, buffer);
  const { width, height } = findDimensions(payload);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    path: outPath,
    bytes: buffer.length,
    node: nodeId,
    ...(width ? { width, height } : {}),
  })}\n`);
}

try {
  main();
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exitCode = 1;
}
