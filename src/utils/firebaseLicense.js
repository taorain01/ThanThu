// ============================================================
// Firebase License Manager — Quản lý key NhacLabs qua Firestore REST API
// Dùng trong bot Discord để: xem, tạo, chặn, mở chặn key
// ============================================================

const crypto = require("crypto");
const https = require("https");

// Firebase config
const FIREBASE_PROJECT_ID = "nhaclabs-9b413";
const FIREBASE_API_KEY = "AIzaSyDyoMtBgpaIaN3St5nIuvHOVuCxkMMu2Fk";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// HMAC secret (hex) — phải giống với Cloudflare Worker & Python (core/license.py)
const HMAC_SECRET = "3b299073e6e5bd97a10c25b97acead0d0b004111830442f60e76e085e018fb40";

// Giới hạn
const MAX_MACHINES = 3;

// Bảng danh mục key
const CATEGORIES = {
  'thuongmai': { label: 'Thương mại', emoji: '💰' },
  'mienphi':   { label: 'Miễn phí', emoji: '🎁' },
  'test':      { label: 'Dùng thử', emoji: '🧪' },
};

// Bảng giá các gói (VNĐ)
const TIER_PRICES = {
  'PRO': 199000,
  'UNL': 399000,
};

// ── Firebase Anonymous Auth (giống Python license.py) ──
let _authToken = null;
let _authExpiry = 0;

async function getAuthToken() {
  // Nếu token còn hạn → dùng lại
  if (_authToken && Date.now() < _authExpiry - 60000) {
    return _authToken;
  }

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ returnSecureToken: true });
    const url = new URL(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`
    );
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.idToken) {
            _authToken = json.idToken;
            const expiresIn = parseInt(json.expiresIn || "3600") * 1000;
            _authExpiry = Date.now() + expiresIn;
            resolve(_authToken);
          } else {
            console.error("[Firebase Auth] Không lấy được token:", data);
            resolve(null);
          }
        } catch {
          console.error("[Firebase Auth] Parse lỗi:", data);
          resolve(null);
        }
      });
    });

    req.on("error", (err) => {
      console.error("[Firebase Auth] Lỗi:", err.message);
      resolve(null);
    });
    req.write(postData);
    req.end();
  });
}

// ── Helper: gọi Firestore REST API (có auth token) ──
async function firestoreRequest(method, path, body = null) {
  // Lấy auth token trước
  const token = await getAuthToken();

  return new Promise((resolve, reject) => {
    const url = new URL(`${FIRESTORE_BASE}${path}`);
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: headers,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on("error", (err) => reject(err));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Tạo license key mới (HMAC-SHA256) ──
// days: số ngày hết hạn (tùy chọn, 0 = vĩnh viễn)
function generateKey(tierCode, days = 0) {
  // tierCode: "PRO" hoặc "UNL"
  // Nếu có days → tier segment = "PRO30D", "UNL7D", ...
  const tierSegment = days > 0 ? `${tierCode}${days}D` : tierCode;
  const payload = crypto.randomBytes(5).toString("hex").toUpperCase();
  const raw = `NL-${tierSegment}-${payload}`;
  const sig = crypto
    .createHmac("sha256", Buffer.from(HMAC_SECRET, 'hex'))
    .update(raw)
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();
  return `${raw}-${sig}`;
}

// ── Tạo document key trên Firestore ngay khi gen ──
async function createKeyDoc(key, tierCode, days = 0, category = 'thuongmai') {
  const docId = key.toUpperCase().replace(/-/g, "_");
  const now = new Date().toISOString();
  const expiresAt = days > 0
    ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    : "";

  // Key thương mại lưu ngày cấp để tính tiền
  const issuedDate = category === 'thuongmai' ? now : "";

  const body = {
    fields: {
      key: { stringValue: key },
      tier: { stringValue: tierCode },
      category: { stringValue: category },
      issued_date: { stringValue: issuedDate },
      max_machines: { integerValue: String(MAX_MACHINES) },
      blocked: { booleanValue: false },
      block_reason: { stringValue: "" },
      last_activated: { stringValue: "" },
      created_at: { stringValue: now },
      expires_at: { stringValue: expiresAt },
      machines: { arrayValue: { values: [] } },
    },
  };

  const res = await firestoreRequest("PATCH", `/licenses/${docId}`, body);
  return res.status === 200;
}

// ── Xem thông tin 1 key ──
async function getKeyInfo(key) {
  const docId = key.toUpperCase().replace(/-/g, "_");
  const res = await firestoreRequest("GET", `/licenses/${docId}`);

  if (res.status === 404) return { exists: false, key };

  const fields = res.data.fields || {};
  const machines = (fields.machines?.arrayValue?.values || []).map((v) => {
    const f = v.mapValue?.fields || {};
    return {
      hw_id: f.hw_id?.stringValue || "",
      name: f.name?.stringValue || "",
      activated_at: f.activated_at?.stringValue || "",
    };
  });

  return {
    exists: true,
    key: fields.key?.stringValue || key,
    tier: fields.tier?.stringValue || "unknown",
    category: fields.category?.stringValue || "thuongmai",
    issued_date: fields.issued_date?.stringValue || "",
    max_machines: parseInt(fields.max_machines?.integerValue || MAX_MACHINES),
    machines,
    blocked: fields.blocked?.booleanValue || false,
    block_reason: fields.block_reason?.stringValue || "",
    last_activated: fields.last_activated?.stringValue || "",
    createTime: res.data.createTime,
    updateTime: res.data.updateTime,
  };
}

// ── Liệt kê tất cả key (dùng runQuery thay GET list) ──
async function listAllKeys() {
  // Dùng runQuery vì GET /licenses trả {} với anonymous auth
  const body = {
    structuredQuery: {
      from: [{ collectionId: "licenses" }],
    },
  };
  const res = await firestoreRequest("POST", ":runQuery", body);
  if (res.status !== 200) return [];

  // runQuery trả mảng [{ document: {...}, readTime }, ...]
  const results = Array.isArray(res.data) ? res.data : [];
  return results
    .filter((r) => r.document) // bỏ entry không có document
    .map((r) => {
      const fields = r.document.fields || {};
      const machines = (fields.machines?.arrayValue?.values || []).map((v) => {
        const f = v.mapValue?.fields || {};
        return { hw_id: f.hw_id?.stringValue || "", name: f.name?.stringValue || "" };
      });
      return {
        key: fields.key?.stringValue || "",
        tier: fields.tier?.stringValue || "",
        category: fields.category?.stringValue || "thuongmai",
        issued_date: fields.issued_date?.stringValue || "",
        created_at: fields.created_at?.stringValue || "",
        machines,
        blocked: fields.blocked?.booleanValue || false,
        last_activated: fields.last_activated?.stringValue || "",
        // Thông tin upgrade (nếu có)
        paid_amount: fields.paid_amount?.integerValue != null
          ? parseInt(fields.paid_amount.integerValue) : null,
        upgraded_from: fields.upgraded_from?.stringValue || "",
      };
    });
}

// ── Chặn key (tạm thời hoặc vĩnh viễn) ──
async function blockKey(key, reason = "Bị chặn bởi admin", permanent = false) {
  const docId = key.toUpperCase().replace(/-/g, "_");
  const body = {
    fields: {
      blocked: { booleanValue: true },
      block_reason: { stringValue: `${permanent ? "[VĨNH VIỄN] " : "[TẠM THỜI] "}${reason}` },
      blocked_at: { stringValue: new Date().toISOString() },
    },
  };

  // Dùng updateMask để chỉ cập nhật các field blocked
  const path = `/licenses/${docId}?updateMask.fieldPaths=blocked&updateMask.fieldPaths=block_reason&updateMask.fieldPaths=blocked_at`;
  const res = await firestoreRequest("PATCH", path, body);
  return res.status === 200;
}

// ── Mở chặn key ──
async function unblockKey(key) {
  const docId = key.toUpperCase().replace(/-/g, "_");
  const body = {
    fields: {
      blocked: { booleanValue: false },
      block_reason: { stringValue: "" },
      blocked_at: { stringValue: "" },
    },
  };

  const path = `/licenses/${docId}?updateMask.fieldPaths=blocked&updateMask.fieldPaths=block_reason&updateMask.fieldPaths=blocked_at`;
  const res = await firestoreRequest("PATCH", path, body);
  return res.status === 200;
}

// ── Xóa 1 máy khỏi key ──
async function removeMachine(key, hwId) {
  const info = await getKeyInfo(key);
  if (!info.exists) return { ok: false, error: "Key không tồn tại" };

  const newMachines = info.machines.filter((m) => m.hw_id !== hwId);
  if (newMachines.length === info.machines.length) {
    return { ok: false, error: `Không tìm thấy máy ${hwId}` };
  }

  const docId = key.toUpperCase().replace(/-/g, "_");
  const values = newMachines.map((m) => ({
    mapValue: {
      fields: {
        hw_id: { stringValue: m.hw_id },
        name: { stringValue: m.name },
        activated_at: { stringValue: m.activated_at || "" },
      },
    },
  }));

  const body = {
    fields: {
      machines: { arrayValue: { values: values.length ? values : [] } },
    },
  };

  const path = `/licenses/${docId}?updateMask.fieldPaths=machines`;
  const res = await firestoreRequest("PATCH", path, body);
  return { ok: res.status === 200 };
}

// ── Xóa key hoàn toàn ──
async function deleteKey(key) {
  const docId = key.toUpperCase().replace(/-/g, "_");
  const res = await firestoreRequest("DELETE", `/licenses/${docId}`);
  return res.status === 200;
}

// ── Đổi danh mục cho key ──
async function setCategoryKey(key, category) {
  const docId = key.toUpperCase().replace(/-/g, "_");
  
  // Key thương mại lưu ngày cấp (issued_date)
  const issuedDate = category === 'thuongmai' ? new Date().toISOString() : "";

  const body = {
    fields: {
      category: { stringValue: category },
      issued_date: { stringValue: issuedDate },
    },
  };

  const path = `/licenses/${docId}?updateMask.fieldPaths=category&updateMask.fieldPaths=issued_date`;
  const res = await firestoreRequest("PATCH", path, body);
  return res.status === 200;
}

// ── Tạo key UNL upgrade từ PRO (paid_amount = chênh lệch, lưu key cũ) ──
async function createUpgradeKeyDoc(newKey, oldProKey) {
  const docId = newKey.toUpperCase().replace(/-/g, "_");
  const now = new Date().toISOString();

  // Giá upgrade = UNL - PRO = chênh lệch
  const upgradeCost = (TIER_PRICES['UNL'] || 0) - (TIER_PRICES['PRO'] || 0);

  const body = {
    fields: {
      key: { stringValue: newKey },
      tier: { stringValue: "UNL" },
      category: { stringValue: "thuongmai" },
      issued_date: { stringValue: now },
      max_machines: { integerValue: String(MAX_MACHINES) },
      blocked: { booleanValue: false },
      block_reason: { stringValue: "" },
      last_activated: { stringValue: "" },
      created_at: { stringValue: now },
      expires_at: { stringValue: "" },
      machines: { arrayValue: { values: [] } },
      // Thông tin upgrade
      paid_amount: { integerValue: String(upgradeCost) },
      upgraded_from: { stringValue: oldProKey },
    },
  };

  const res = await firestoreRequest("PATCH", `/licenses/${docId}`, body);
  if (res.status !== 200) return false;

  // Block key PRO cũ
  await blockKey(oldProKey, `Đã upgrade lên UNL — key mới: ${newKey}`, false);

  return true;
}

module.exports = {
  generateKey,
  createKeyDoc,
  createUpgradeKeyDoc,
  getKeyInfo,
  listAllKeys,
  blockKey,
  unblockKey,
  removeMachine,
  deleteKey,
  setCategoryKey,
  CATEGORIES,
  TIER_PRICES,
  MAX_MACHINES,
};
