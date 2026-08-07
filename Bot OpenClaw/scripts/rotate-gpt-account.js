'use strict';

// ============================================================================
// rotate-gpt-account.js — đổi tài khoản GPT OAuth dùng cho bước tạo ảnh.
//
// Vì sao cần script riêng thay vì để agent tự click GUI: tài khoản GPT thật
// KHÔNG nằm trong app Ting!. Ting! chỉ là sổ ghi "mua ngày nào, hạn tới đâu".
// Chỗ thực sự quyết định request đi bằng tài khoản nào là hai store khác:
//
//   1. OpenClaw auth store (~/.openclaw/agents/<agent>/agent/openclaw-agent.sqlite)
//      Bảng auth_profile_store giữ các profile OAuth `openai:*`; bảng
//      auth_profile_state giữ usageStats với `blockedUntil` + `blockedReason`.
//      Đây là store mà route `openai/*` (image_generate, gpt-image) dùng.
//
//   2. 9router (http://127.0.0.1:20128) giữ providerConnections `codex` cùng
//      3 tài khoản đó, phục vụ route fallback `9router/cx/*`, và — quan trọng —
//      có endpoint usage trả quota thật (used/total, limitReached, resetAt).
//
// Ting! vẫn được bật vì đó là yêu cầu vận hành và vì mở app sẽ kéo dữ liệu hạn
// mới nhất từ Firestore xuống cache IndexedDB cục bộ, tức là làm cho bước đọc
// hạn ở dưới chính xác hơn. Nhưng hạn trong Ting! chỉ dùng để loại tài khoản
// ĐÃ HẾT HẠN RÕ RÀNG, không bao giờ dùng để chọn — thiếu dữ liệu Ting! không
// được phép làm nghẽn việc đổi tài khoản.
//
// Bốn quy tắc, mỗi quy tắc là một cách hỏng đã tính trước:
//
//   1. Khoá theo EMAIL, không theo profile id. Quota ChatGPT tính trên tài
//      khoản, còn OpenClaw có thể có nhiều profile trỏ về cùng một email
//      (ví dụ `openai:plus-test` và `openai:cusp...` cùng là cusp.legate2r).
//      Khoá theo profile thì rotate sang profile thứ hai của đúng tài khoản
//      vừa hết quota, và lần nào cũng lỗi lại.
//
//   2. Chỉ ĐỌC bí mật, không bao giờ in ra. accessToken/refreshToken/idToken,
//      cùng field `rawInput` của Ting! (chứa password + TOTP seed) bị loại
//      ngay tại chỗ đọc. Output và log chỉ có email, ngày, trạng thái.
//
//   3. Không tạo ảnh để thử. Yêu cầu là "đổi và làm luôn, không test": mọi
//      quyết định dựa trên metadata đọc được (blockedUntil, quota usage, hạn),
//      không tiêu một lượt generate nào để dò.
//
//   4. Nhớ trạng thái giữa các lần gọi, và chỉ báo lỗi khi đã hết đường. Một
//      lần rotate thất bại là chuyện thường; báo blocker chỉ khi không còn ứng
//      viên nào hoặc đã rotate quá ngưỡng trong cùng một phiên.
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const BOT_ROOT = path.resolve(__dirname, '..');
const OPENCLAW_HOME = path.join(os.homedir(), '.openclaw');
const STATE_FILE = path.join(BOT_ROOT, 'data', 'gpt-rotation-state.json');
const LOG_FILE = path.join(BOT_ROOT, 'logs', 'gpt-rotation.log');

const NINEROUTER_ORIGIN = 'http://127.0.0.1:20128';
const NINEROUTER_DATA_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  '9router',
);
const CLI_TOKEN_HEADER = 'x-9r-cli-token';
const CLI_TOKEN_SALT = '9r-cli-auth';

const TING_EXE = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'Programs', 'Ting', 'Ting.exe',
);
const TING_CACHE_DIRS = [
  path.join(process.env.APPDATA || '', 'Ting!', 'IndexedDB'),
  path.join(process.env.APPDATA || '', 'Ting!', 'Local Storage'),
];

/** Một phiên rotate: các lần gọi cách nhau dưới ngưỡng này là cùng phiên. */
const SESSION_WINDOW_MS = 90 * 60 * 1000;
/** Rotate quá số này trong một phiên thì coi như đổi tài khoản không cứu được. */
const MAX_ROTATIONS_PER_SESSION = 6;
/**
 * Số lần bắt gặp email trong cache Ting! tối thiểu để tin ngày đọc được quanh
 * nó là hạn. LevelDB compact/xoá nửa chừng nên một hit lẻ thường dính ngày
 * không liên quan (ngày mua, record cụt) — đủ hit mới là dữ liệu ổn định.
 */
const MIN_CACHE_HITS = 3;
/** Chờ Ting! đồng bộ Firestore xuống cache trước khi đọc hạn. */
const TING_SYNC_WAIT_MS = 9000;
/** Bí mật tuyệt đối không được lọt ra output/log. */
const SECRET_FIELDS = ['access', 'accessToken', 'refresh', 'refreshToken', 'idToken', 'id_token', 'apiKey', 'rawInput'];

class RotateError extends Error {
  constructor(message, code = 'rotate_failed') {
    super(message);
    this.name = 'RotateError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------------

function takeValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new RotateError(`Thiếu giá trị cho ${name}.`, 'bad_args');
  }
  return value;
}

function parseArgs(argv) {
  const result = {
    mode: 'status',
    launchTing: true,
    sync9router: true,
    dryRun: false,
    json: false,
    reason: 'unspecified',
    failedProfile: '',
    failedEmail: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--status') {
      result.mode = 'status';
    } else if (arg === '--rotate') {
      result.mode = 'rotate';
    } else if (arg === '--reset-session') {
      result.mode = 'reset-session';
    } else if (arg === '--reason') {
      result.reason = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === '--failed-profile') {
      result.failedProfile = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === '--failed-email') {
      result.failedEmail = takeValue(argv, index, arg).toLowerCase();
      index += 1;
    } else if (arg === '--agent') {
      result.agent = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === '--no-ting') {
      result.launchTing = false;
    } else if (arg === '--no-9router') {
      result.sync9router = false;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--json') {
      result.json = true;
    } else if (arg === '--help' || arg === '-h') {
      result.mode = 'help';
    } else {
      throw new RotateError(`Tham số không nhận ra: ${arg}`, 'bad_args');
    }
  }
  return result;
}

/** Cắt mọi field bí mật trước khi giá trị đi vào output hoặc log. */
function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (SECRET_FIELDS.includes(key)) continue;
      out[key] = scrub(inner);
    }
    return out;
  }
  return value;
}

function appendLog(entry) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...scrub(entry) });
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
  } catch {
    // Log hỏng không được làm chết việc đổi tài khoản.
  }
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // Chưa có state là bình thường ở lần chạy đầu.
  }
  return { version: 1, session: null, cursor: 0, history: [] };
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, STATE_FILE);
}

function powershell(script) {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', timeout: 60000, windowsHide: true },
  );
}

/**
 * Chờ đồng bộ, không busy-loop. Nhánh gọi nó (bật Ting! rồi đọc cache) là code
 * đồng bộ nên không await được; Atomics.wait chặn thread mà không đốt CPU.
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Gọi CLI OpenClaw bằng `node openclaw.mjs`, KHÔNG qua openclaw.cmd: Node 24
 * chặn spawn file .cmd (EINVAL spawnSync) vì lỗ hổng command injection của shim
 * batch, nên đường .cmd chết ngay khi rotate thật cần nó.
 */
function resolveOpenclawEntry() {
  const candidates = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'openclaw', 'openclaw.mjs'),
    path.join(process.env.ProgramFiles || '', 'nodejs', 'node_modules', 'openclaw', 'openclaw.mjs'),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new RotateError('Không tìm thấy openclaw.mjs để gọi CLI.', 'openclaw_cli_missing');
}

function runOpenclaw(args) {
  return execFileSync(process.execPath, [resolveOpenclawEntry(), ...args], {
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
  });
}

// ---------------------------------------------------------------------------
// Nguồn 1 — OpenClaw auth store (store quyết định route openai/*)
// ---------------------------------------------------------------------------

function resolveAgentDir(agentId) {
  const agent = agentId || 'main';
  return path.join(OPENCLAW_HOME, 'agents', agent, 'agent');
}

/**
 * Đọc profile OAuth openai + usageStats. Mở readOnly để tuyệt đối không đụng
 * vào store mà gateway đang dùng; token bị loại ngay khi parse.
 */
function readOpenclawAuth(agentId) {
  const dbPath = path.join(resolveAgentDir(agentId), 'openclaw-agent.sqlite');
  if (!fs.existsSync(dbPath)) {
    throw new RotateError(`Không thấy auth store OpenClaw: ${dbPath}`, 'auth_store_missing');
  }

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (error) {
    throw new RotateError(`Không mở được auth store: ${error.message}`, 'auth_store_locked');
  }

  try {
    const storeRow = db.prepare('SELECT store_json FROM auth_profile_store WHERE store_key = ?').get('primary');
    const stateRow = db.prepare('SELECT state_json FROM auth_profile_state WHERE state_key = ?').get('primary');
    const store = storeRow ? JSON.parse(storeRow.store_json) : { profiles: {} };
    const state = stateRow ? JSON.parse(stateRow.state_json) : {};

    const profiles = [];
    for (const [id, raw] of Object.entries(store.profiles || {})) {
      if (!raw || raw.provider !== 'openai') continue;
      const usage = (state.usageStats || {})[id] || {};
      profiles.push({
        id,
        email: String(raw.email || '').toLowerCase(),
        type: raw.type || 'unknown',
        plan: raw.chatgptPlanType || '',
        tokenExpiresAt: raw.expires ? new Date(raw.expires).toISOString() : null,
        blockedUntil: usage.blockedUntil ? new Date(usage.blockedUntil).toISOString() : null,
        blockedUntilMs: usage.blockedUntil || 0,
        blockedReason: usage.blockedReason || '',
        lastUsedAt: usage.lastUsed ? new Date(usage.lastUsed).toISOString() : null,
        lastUsedMs: usage.lastUsed || 0,
        errorCount: usage.errorCount || 0,
      });
    }
    return { profiles, lastGood: (state.lastGood || {}).openai || null };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Nguồn 2 — 9router (quota thật + route fallback)
// ---------------------------------------------------------------------------

/**
 * Token CLI của 9router = sha256(machineId + salt + cliSecret) cắt 16 ký tự.
 * Cả hai file do server ghi ra, nên đọc file là cách hợp lệ để gọi API cục bộ.
 */
function nineRouterToken() {
  try {
    const machineId = fs.readFileSync(path.join(NINEROUTER_DATA_DIR, 'machine-id'), 'utf8').trim();
    const secret = fs.readFileSync(path.join(NINEROUTER_DATA_DIR, 'auth', 'cli-secret'), 'utf8').trim();
    if (!machineId || !secret) return '';
    return crypto.createHash('sha256').update(machineId + CLI_TOKEN_SALT + secret).digest('hex').slice(0, 16);
  } catch {
    return '';
  }
}

async function nineRouterRequest(method, urlPath, body) {
  const token = nineRouterToken();
  if (!token) throw new RotateError('Không dẫn xuất được token CLI của 9router.', 'ninerouter_no_token');
  const response = await fetch(`${NINEROUTER_ORIGIN}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', [CLI_TOKEN_HEADER]: token },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    throw new RotateError(`9router ${method} ${urlPath} → HTTP ${response.status}`, 'ninerouter_http_error');
  }
  return parsed;
}

/**
 * Lấy các connection codex + quota. Trả về best-effort: 9router tắt thì rotate
 * vẫn chạy được bằng dữ liệu OpenClaw, chỉ mất tín hiệu quota.
 */
async function readNineRouter() {
  const result = { available: false, connections: [], error: '' };
  try {
    const data = await nineRouterRequest('GET', '/api/providers');
    const connections = (data && (data.connections || data.data)) || [];
    for (const connection of connections) {
      if (connection.provider !== 'codex') continue;
      const entry = {
        id: connection.id,
        email: String(connection.email || connection.name || '').toLowerCase(),
        priority: connection.priority ?? null,
        isActive: connection.isActive !== false,
        testStatus: connection.testStatus || '',
        quota: null,
      };
      try {
        const usage = await nineRouterRequest('GET', `/api/usage/${connection.id}`);
        if (usage) {
          const session = (usage.quotas || {}).session || {};
          entry.quota = {
            plan: usage.plan || '',
            limitReached: usage.limitReached === true,
            used: session.used ?? null,
            total: session.total ?? null,
            remaining: session.remaining ?? null,
            resetAt: session.resetAt || null,
          };
        }
      } catch {
        // Thiếu quota của một connection không làm hỏng cả danh sách.
      }
      result.connections.push(entry);
    }
    result.available = true;
  } catch (error) {
    result.error = error.message;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Nguồn 3 — Ting! (sổ hạn "TK Mua")
// ---------------------------------------------------------------------------

function tingRunning() {
  try {
    const out = powershell('$p = Get-Process -Name Ting -ErrorAction SilentlyContinue; if ($p) { "running" } else { "stopped" }');
    return out.trim().includes('running');
  } catch {
    return false;
  }
}

/**
 * Bật Ting! nếu chưa chạy. Mục đích thật sự không phải để "xem bằng mắt" mà để
 * app đăng nhập Firestore và ghi dữ liệu hạn mới nhất xuống cache cục bộ, vì
 * bước đọc hạn ở dưới đọc chính cache đó.
 */
function launchTing() {
  const info = { exePath: TING_EXE, wasRunning: false, launched: false, note: '' };
  if (!fs.existsSync(TING_EXE)) {
    info.note = 'khong_thay_ting_exe';
    return info;
  }
  if (tingRunning()) {
    info.wasRunning = true;
    info.note = 'da_chay_san';
    return info;
  }
  try {
    powershell(`Start-Process -FilePath ${JSON.stringify(TING_EXE)}`);
    info.launched = true;
    // Chờ đồng bộ. Ting! có autoLock 5 phút nên cache có thể đã cũ.
    sleepSync(TING_SYNC_WAIT_MS);
    info.note = 'da_bat_va_cho_sync';
  } catch (error) {
    info.note = `bat_that_bai: ${error.message}`;
  }
  return info;
}

function collectCacheFiles() {
  const files = [];
  for (const dir of TING_CACHE_DIRS) {
    if (!dir || !fs.existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length) {
      const current = stack.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (/\.(ldb|log)$/i.test(entry.name)) {
          files.push(full);
        }
      }
    }
  }
  return files;
}

/**
 * Dò hạn của từng email đã biết trong cache IndexedDB của Ting!.
 *
 * Chỉ tra theo danh sách email cho trước, không quét email tự do: cache còn
 * chứa `rawInput` với password và TOTP seed của mọi tài khoản, quét rộng là tự
 * kéo bí mật không liên quan vào tiến trình này.
 *
 * Cache là LevelDB, phần lớn block nén snappy nên có email đọc không ra hạn.
 * Đó là lý do kết quả này chỉ mang tính tham chiếu: chỉ dùng để loại tài khoản
 * hạn đã qua, không dùng để chọn, và thiếu dữ liệu thì trả `unknown`.
 *
 * Hạn chỉ được phép TĂNG theo thời gian (renewal cộng dồn về phía trước), nên
 * `knownExpiry` — hạn cao nhất từng xác nhận ở các lần chạy trước, lưu trong
 * state — là mốc sàn. Cache chỉ nâng cấp mốc đó khi đủ `MIN_CACHE_HITS` hit;
 * dữ liệu cụt (ít hit, ngày nhỏ hơn) bị bỏ qua thay vì làm hạn tụt xuống.
 */
/**
 * Hạn hiệu lực của một email = mốc đã xác nhận trước đây (`knownExpiry`),
 * cache chỉ nâng lên khi đủ hit. Trả về record `accounts` chuẩn của Ting!.
 */
function resolveTingExpiry(entry, knownExpiry) {
  let expiryDate = knownExpiry[entry.email] || null;
  if (entry.expiryDate && entry.hits >= MIN_CACHE_HITS) {
    if (!expiryDate || entry.expiryDate > expiryDate) expiryDate = entry.expiryDate;
  }
  return {
    expiryDate,
    daysLeft: expiryDate ? daysUntil(expiryDate) : null,
    status: expiryDate ? (daysUntil(expiryDate) < 0 ? 'expired' : 'active') : 'unknown',
    cacheHits: entry.hits,
  };
}

function readTingExpiry(emails, knownExpiry = {}) {
  const wanted = emails.filter(Boolean).map((email) => email.toLowerCase());
  const found = new Map(wanted.map((email) => [email, { email, expiryDate: null, hits: 0 }]));
  if (!wanted.length) return { available: false, accounts: {}, knownExpiry: { ...knownExpiry }, note: 'khong_co_email_can_tra' };

  const files = collectCacheFiles();
  if (!files.length) return { available: false, accounts: {}, knownExpiry: { ...knownExpiry }, note: 'khong_thay_cache' };

  const datePattern = /\d{4}-\d{2}-\d{2}/g;
  for (const file of files) {
    let raw;
    try {
      raw = fs.readFileSync(file);
    } catch {
      continue;
    }
    const text = raw.toString('latin1');
    for (const email of wanted) {
      let index = text.indexOf(email);
      while (index !== -1) {
        const slice = text.slice(Math.max(0, index - 1500), index + 1500);
        const entry = found.get(email);
        entry.hits += 1;
        datePattern.lastIndex = 0;
        let match = datePattern.exec(slice);
        while (match) {
          // Renewal cộng dồn về phía trước nên hạn hiện tại là mốc lớn nhất.
          if (!entry.expiryDate || match[0] > entry.expiryDate) entry.expiryDate = match[0];
          match = datePattern.exec(slice);
        }
        index = text.indexOf(email, index + email.length);
      }
    }
  }

  const accounts = {};
  const updated = { ...knownExpiry };
  for (const [email, entry] of found) {
    accounts[email] = resolveTingExpiry(entry, knownExpiry);
    if (accounts[email].expiryDate && accounts[email].expiryDate !== (knownExpiry[email] || null)) {
      updated[email] = accounts[email].expiryDate;
    }
  }
  return { available: true, accounts, knownExpiry: updated, scannedFiles: files.length };
}

function daysUntil(dateText) {
  const target = new Date(`${dateText}T23:59:59Z`).getTime();
  if (!Number.isFinite(target)) return null;
  return Math.floor((target - Date.now()) / (24 * 60 * 60 * 1000));
}

// ---------------------------------------------------------------------------
// Hợp nhất ba nguồn thành danh sách ứng viên
// ---------------------------------------------------------------------------

/**
 * Gộp theo email vì quota ChatGPT tính trên tài khoản. Một email có thể ứng với
 * nhiều profile OpenClaw; chỉ cần MỘT profile của email đó bị chặn vì
 * subscription_limit là cả email coi như hết lượt, nếu không rotate sẽ nhảy
 * sang profile thứ hai của đúng tài khoản vừa hết và lỗi lại y nguyên.
 */
function buildCandidates({ auth, ninerouter, ting, failedEmails }) {
  const byEmail = new Map();
  const now = Date.now();

  const ensure = (email) => {
    const key = String(email || '').toLowerCase();
    if (!byEmail.has(key)) {
      byEmail.set(key, {
        email: key,
        profileIds: [],
        plan: '',
        tokenExpiresAt: null,
        blockedUntil: null,
        blockedReason: '',
        lastUsedMs: 0,
        quota: null,
        ting: null,
        inOpenclaw: false,
        in9router: false,
        usable: false,
        reasons: [],
        notes: [],
      });
    }
    return byEmail.get(key);
  };

  for (const profile of auth.profiles) {
    const entry = ensure(profile.email);
    entry.inOpenclaw = true;
    entry.profileIds.push(profile.id);
    entry.plan = entry.plan || profile.plan;
    if (profile.tokenExpiresAt && (!entry.tokenExpiresAt || profile.tokenExpiresAt > entry.tokenExpiresAt)) {
      entry.tokenExpiresAt = profile.tokenExpiresAt;
    }
    if (profile.blockedUntilMs > now) {
      if (!entry.blockedUntil || profile.blockedUntil > entry.blockedUntil) {
        entry.blockedUntil = profile.blockedUntil;
        entry.blockedReason = profile.blockedReason;
      }
    }
    entry.lastUsedMs = Math.max(entry.lastUsedMs, profile.lastUsedMs);
  }

  for (const connection of ninerouter.connections) {
    const entry = ensure(connection.email);
    entry.in9router = true;
    entry.ninerouterId = connection.id;
    entry.ninerouterPriority = connection.priority;
    if (connection.quota) entry.quota = connection.quota;
  }

  for (const [email, info] of Object.entries(ting.accounts || {})) {
    if (!byEmail.has(email)) continue;
    byEmail.get(email).ting = info;
  }

  for (const entry of byEmail.values()) {
    if (!entry.email) {
      entry.reasons.push('khong_xac_dinh_email');
    }
    if (!entry.inOpenclaw) {
      // Có tài khoản nhưng OpenClaw chưa có profile OAuth cho nó: route
      // openai/* không dùng được tới khi đăng nhập, và đăng nhập OAuth cần
      // trình duyệt nên không tự động hoá được ở đây.
      entry.reasons.push('chua_dang_nhap_trong_openclaw');
    }
    if (entry.blockedUntil) {
      entry.reasons.push(`openclaw_chan:${entry.blockedReason || 'unknown'}_den_${entry.blockedUntil}`);
    }
    if (entry.quota && entry.quota.limitReached) {
      entry.reasons.push(`het_quota_9router_reset_${entry.quota.resetAt || 'khong_ro'}`);
    }
    if (entry.ting && entry.ting.status === 'expired') {
      // Mâu thuẫn với nguồn hoạt động: 9router còn quota và token chưa hết hạn
      // nghĩa là account vẫn sống — hạn từ cache cụt (hoặc sổ chưa cập nhật
      // renewal) không đủ tin để chặn. Ghi chú, không loại.
      const quotaAlive = Boolean(
        entry.quota && !entry.quota.limitReached && (entry.quota.remaining ?? 1) > 0,
      );
      const tokenAlive = !entry.tokenExpiresAt || new Date(entry.tokenExpiresAt).getTime() > now;
      if (quotaAlive && tokenAlive) {
        entry.notes.push(`ting_het_han_${entry.ting.expiryDate}_nhung_quota_con`);
      } else {
        entry.reasons.push(`ting_het_han_${entry.ting.expiryDate}`);
      }
    }
    if (failedEmails.includes(entry.email)) {
      entry.reasons.push('vua_loi_o_luot_nay');
    }
    entry.usable = entry.reasons.length === 0;
  }

  return [...byEmail.values()];
}

/**
 * Round-robin có nhớ: cursor trong state quyết định điểm bắt đầu, nên hai lần
 * rotate liên tiếp không trả về cùng một tài khoản. Trong số ứng viên dùng
 * được, ưu tiên cái lâu chưa dùng nhất để rải đều lượt.
 */
function pickNext(candidates, state) {
  const usable = candidates.filter((entry) => entry.usable);
  if (!usable.length) return null;
  const ordered = [...usable].sort((a, b) => a.lastUsedMs - b.lastUsedMs || a.email.localeCompare(b.email));
  const cursor = Number.isInteger(state.cursor) ? state.cursor : 0;
  return ordered[cursor % ordered.length];
}

// ---------------------------------------------------------------------------
// Áp dụng lựa chọn
// ---------------------------------------------------------------------------

/**
 * Đưa profile của tài khoản được chọn lên đầu thứ tự auth của provider openai.
 * Dùng đúng lệnh CLI được hỗ trợ (`models auth order set`) thay vì ghi tay vào
 * sqlite mà gateway đang mở.
 */
function applyOpenclawOrder(chosen, auth, { dryRun }) {
  const chosenIds = chosen.profileIds;
  const rest = auth.profiles
    .map((profile) => profile.id)
    .filter((id) => !chosenIds.includes(id));
  const order = [...chosenIds, ...rest];
  const args = ['models', 'auth', 'order', 'set', '--provider', 'openai', ...order];
  if (dryRun) return { applied: false, order, command: `openclaw ${args.join(' ')}` };
  const output = runOpenclaw(args);
  return { applied: true, order, output: output.trim().split('\n').slice(-3).join(' | ') };
}

/**
 * Đồng bộ ưu tiên bên 9router để route fallback `9router/cx/*` cũng dùng đúng
 * tài khoản. Best-effort: chỉ đổi `priority`, không xoá, không đụng token; lỗi
 * ở đây không làm hỏng việc đổi tài khoản chính.
 */
async function applyNineRouterPriority(chosen, ninerouter, { dryRun }) {
  if (!ninerouter.available) return { applied: false, note: '9router_khong_san_sang' };
  const target = ninerouter.connections.find((connection) => connection.email === chosen.email);
  if (!target) return { applied: false, note: 'khong_thay_connection_tuong_ung' };

  const others = ninerouter.connections.filter((connection) => connection.id !== target.id);
  const plan = [{ id: target.id, email: target.email, priority: 1 }];
  others.forEach((connection, index) => {
    plan.push({ id: connection.id, email: connection.email, priority: index + 2 });
  });
  if (dryRun) return { applied: false, plan, note: 'dry_run' };

  const results = [];
  for (const item of plan) {
    try {
      await nineRouterRequest('PUT', `/api/providers/${item.id}`, { priority: item.priority });
      results.push({ email: item.email, priority: item.priority, ok: true });
    } catch (error) {
      results.push({ email: item.email, priority: item.priority, ok: false, error: error.message });
    }
  }
  return { applied: results.some((item) => item.ok), results };
}

// ---------------------------------------------------------------------------
// Phiên + leo thang
// ---------------------------------------------------------------------------

function openSession(state, reason) {
  const now = Date.now();
  const session = state.session;
  if (session && now - (session.lastAttemptAt || 0) <= SESSION_WINDOW_MS) {
    session.attempts += 1;
    session.lastAttemptAt = now;
    session.reasons.push(reason);
    return session;
  }
  state.session = {
    id: `sess-${new Date(now).toISOString().replace(/[:.]/g, '-')}`,
    startedAt: now,
    lastAttemptAt: now,
    attempts: 1,
    reasons: [reason],
    triedEmails: [],
  };
  return state.session;
}

// ---------------------------------------------------------------------------
// Lệnh
// ---------------------------------------------------------------------------

async function gather(options) {
  const state = readState();
  const tingInfo = options.launchTing ? launchTing() : { note: 'bo_qua_theo_yeu_cau' };
  const auth = readOpenclawAuth(options.agent);
  const ninerouter = options.sync9router ? await readNineRouter() : { available: false, connections: [], error: 'bo_qua_theo_yeu_cau' };

  const emails = new Set();
  auth.profiles.forEach((profile) => emails.add(profile.email));
  ninerouter.connections.forEach((connection) => emails.add(connection.email));
  // Hạn đã xác nhận ở lần chạy trước là mốc sàn; cache cụt không được làm tụt.
  const known = state.knownExpiry || {};
  const ting = readTingExpiry([...emails], known);
  if (JSON.stringify(ting.knownExpiry) !== JSON.stringify(known)) {
    state.knownExpiry = ting.knownExpiry;
    writeState(state);
  }
  ting.app = tingInfo;

  return { auth, ninerouter, ting };
}

async function commandStatus(options) {
  const sources = await gather(options);
  const state = readState();
  const failedEmails = options.failedEmail ? [options.failedEmail] : [];
  const candidates = buildCandidates({ ...sources, failedEmails });
  return {
    ok: true,
    mode: 'status',
    tingApp: sources.ting.app,
    tingCache: { available: sources.ting.available, scannedFiles: sources.ting.scannedFiles || 0 },
    ninerouter: { available: sources.ninerouter.available, error: sources.ninerouter.error || '' },
    lastGoodProfile: sources.auth.lastGood,
    session: state.session,
    candidates: candidates.map((entry) => ({
      email: entry.email,
      usable: entry.usable,
      reasons: entry.reasons,
      notes: entry.notes,
      profileIds: entry.profileIds,
      plan: entry.plan,
      tokenExpiresAt: entry.tokenExpiresAt,
      blockedUntil: entry.blockedUntil,
      quota: entry.quota,
      ting: entry.ting,
    })),
    usableCount: candidates.filter((entry) => entry.usable).length,
  };
}

async function commandRotate(options) {
  const state = readState();
  const session = openSession(state, options.reason);
  const sources = await gather(options);

  const failedEmails = [];
  if (options.failedEmail) failedEmails.push(options.failedEmail);
  if (options.failedProfile) {
    const match = sources.auth.profiles.find((profile) => profile.id === options.failedProfile);
    if (match && match.email) failedEmails.push(match.email);
  }
  // Tài khoản đã thử trong phiên này cũng bị loại: lặp lại cái vừa lỗi là cách
  // nhanh nhất để đốt hết ngưỡng rotate mà không đổi được gì.
  const triedThisSession = session.triedEmails || [];
  const excluded = [...new Set([...failedEmails, ...triedThisSession])];

  const candidates = buildCandidates({ ...sources, failedEmails: excluded });
  const chosen = pickNext(candidates, state);

  const base = {
    mode: 'rotate',
    reason: options.reason,
    session: { id: session.id, attempts: session.attempts, startedAt: new Date(session.startedAt).toISOString() },
    tingApp: sources.ting.app,
    excludedEmails: excluded,
    candidates: candidates.map((entry) => ({ email: entry.email, usable: entry.usable, reasons: entry.reasons, notes: entry.notes })),
  };

  if (!chosen) {
    // Hết ứng viên. Đây là một trong hai điều kiện được phép báo blocker.
    const missingLogin = candidates
      .filter((entry) => entry.reasons.includes('chua_dang_nhap_trong_openclaw') && entry.reasons.length === 1)
      .map((entry) => entry.email);
    const soonest = candidates
      .map((entry) => entry.blockedUntil || (entry.quota && entry.quota.resetAt) || null)
      .filter(Boolean)
      .sort()[0] || null;

    const result = {
      ok: false,
      ...base,
      escalate: true,
      code: 'khong_con_tai_khoan_dung_duoc',
      soonestRecoveryAt: soonest,
      needsInteractiveLogin: missingLogin,
      hint: missingLogin.length
        ? `Còn tài khoản chưa đăng nhập trong OpenClaw: ${missingLogin.join(', ')}. Cần chạy tay: openclaw models auth login --provider openai (mở trình duyệt, không tự động hoá được).`
        : 'Mọi tài khoản đều đang bị chặn quota hoặc hết hạn; phải chờ tới mốc reset.',
    };
    writeState(state);
    appendLog(result);
    return result;
  }

  const orderResult = applyOpenclawOrder(chosen, sources.auth, { dryRun: options.dryRun });
  const nineResult = await applyNineRouterPriority(chosen, sources.ninerouter, { dryRun: options.dryRun });

  if (!options.dryRun) {
    state.cursor = (Number.isInteger(state.cursor) ? state.cursor : 0) + 1;
    session.triedEmails = [...new Set([...triedThisSession, chosen.email])];
    state.history = [...(state.history || []), {
      at: new Date().toISOString(),
      session: session.id,
      email: chosen.email,
      reason: options.reason,
    }].slice(-100);
    writeState(state);
  }

  const exhausted = session.attempts >= MAX_ROTATIONS_PER_SESSION;
  const result = {
    ok: true,
    ...base,
    switchedTo: {
      email: chosen.email,
      profileIds: chosen.profileIds,
      plan: chosen.plan,
      tokenExpiresAt: chosen.tokenExpiresAt,
      ting: chosen.ting,
      quota: chosen.quota,
    },
    openclawOrder: orderResult,
    ninerouter: nineResult,
    dryRun: options.dryRun,
    // Đã đổi được thì chưa phải lúc báo lỗi — người gọi làm tiếp luôn. Chỉ khi
    // phiên này đã rotate quá ngưỡng mà vẫn quay lại đây thì mới coi là bế tắc.
    escalate: exhausted,
    escalateHint: exhausted
      ? `Phiên ${session.id} đã đổi ${session.attempts} lần mà vẫn lỗi. Đổi tài khoản không phải nguyên nhân — dừng và báo người dùng.`
      : '',
    nextAction: 'Chạy lại bước tạo ảnh ngay, không cần test.',
  };
  appendLog(result);
  return result;
}

function commandResetSession() {
  const state = readState();
  const previous = state.session;
  state.session = null;
  writeState(state);
  const result = { ok: true, mode: 'reset-session', clearedSession: previous ? previous.id : null };
  appendLog(result);
  return result;
}

function printHelp() {
  process.stdout.write(`Đổi tài khoản GPT OAuth cho bước tạo ảnh.

  node scripts/rotate-gpt-account.js --status
  node scripts/rotate-gpt-account.js --rotate --reason image_generate_failed
  node scripts/rotate-gpt-account.js --rotate --failed-email <email> --reason rate_limit
  node scripts/rotate-gpt-account.js --reset-session

Tuỳ chọn:
  --status              Liệt kê tài khoản, hạn, quota, ai đang dùng được (không đổi gì).
  --rotate              Đổi sang tài khoản kế tiếp còn dùng được.
  --reason <text>        Lý do đổi, ghi vào log.
  --failed-profile <id>  Profile vừa lỗi (loại cả email của nó).
  --failed-email <email> Email vừa lỗi (loại khỏi ứng viên).
  --reset-session        Xoá phiên đang nhớ, cho ngưỡng rotate về 0.
  --no-ting              Không bật app Ting!.
  --no-9router           Không đọc/ghi 9router.
  --dry-run              Tính toán và in kế hoạch, không áp dụng.
  --json                 In JSON thuần.

Exit code: 0 đổi xong · 10 hết tài khoản dùng được (blocker) · 1 lỗi.
`);
}

function renderHuman(result) {
  const lines = [];
  if (result.mode === 'status') {
    lines.push(`Ting!: ${result.tingApp.note}${result.tingApp.wasRunning ? '' : result.tingApp.launched ? ' (vừa bật)' : ''}`);
    lines.push(`Cache Ting!: ${result.tingCache.available ? `đọc ${result.tingCache.scannedFiles} file` : 'không đọc được'}`);
    lines.push(`9router: ${result.ninerouter.available ? 'sẵn sàng' : `không dùng được (${result.ninerouter.error})`}`);
    lines.push(`Dùng được: ${result.usableCount}/${result.candidates.length} tài khoản`);
    lines.push('');
    for (const entry of result.candidates) {
      const mark = entry.usable ? 'OK  ' : 'X   ';
      const quota = entry.quota ? `quota ${entry.quota.used}/${entry.quota.total}${entry.quota.limitReached ? ' (hết)' : ''}` : 'quota ?';
      const han = entry.ting && entry.ting.expiryDate ? `hạn ${entry.ting.expiryDate} (còn ${entry.ting.daysLeft}d)` : 'hạn ?';
      lines.push(`${mark}${entry.email} · ${quota} · ${han}`);
      if (!entry.usable) lines.push(`      ${entry.reasons.join('; ')}`);
      if (entry.notes && entry.notes.length) lines.push(`      (!) ${entry.notes.join('; ')}`);
    }
  } else if (result.mode === 'rotate') {
    if (result.ok) {
      lines.push(`Đã đổi sang: ${result.switchedTo.email}`);
      lines.push(`Profile: ${result.switchedTo.profileIds.join(', ')}`);
      lines.push(`Thứ tự openai: ${result.openclawOrder.order.join(' > ')}`);
      lines.push(`9router: ${result.ninerouter.applied ? 'đã đồng bộ ưu tiên' : result.ninerouter.note || 'không đổi'}`);
      lines.push(`Phiên ${result.session.id} · lần thứ ${result.session.attempts}`);
      lines.push(result.dryRun ? 'DRY RUN — chưa áp dụng.' : result.nextAction);
      if (result.escalate) lines.push(`CẢNH BÁO: ${result.escalateHint}`);
    } else {
      lines.push(`Không đổi được: ${result.code}`);
      lines.push(result.hint);
      if (result.soonestRecoveryAt) lines.push(`Mốc hồi phục gần nhất: ${result.soonestRecoveryAt}`);
    }
  } else if (result.mode === 'reset-session') {
    lines.push(`Đã xoá phiên: ${result.clearedSession || '(không có)'}`);
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (options.mode === 'help') {
    printHelp();
    return;
  }

  try {
    let result;
    if (options.mode === 'status') result = await commandStatus(options);
    else if (options.mode === 'rotate') result = await commandRotate(options);
    else result = commandResetSession();

    const scrubbed = scrub(result);
    process.stdout.write(options.json ? `${JSON.stringify(scrubbed, null, 2)}\n` : renderHuman(scrubbed));
    if (result.mode === 'rotate' && !result.ok) process.exitCode = 10;
  } catch (error) {
    const payload = { ok: false, code: error.code || 'rotate_failed', error: error.message };
    appendLog(payload);
    process.stderr.write(options.json ? `${JSON.stringify(payload, null, 2)}\n` : `Lỗi: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  RotateError,
  MIN_CACHE_HITS,
  buildCandidates,
  daysUntil,
  parseArgs,
  pickNext,
  readOpenclawAuth,
  readTingExpiry,
  resolveTingExpiry,
  scrub,
};
