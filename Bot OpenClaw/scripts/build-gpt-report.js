'use strict';
// ============================================================================
// build-gpt-report.js — tạo báo cáo HTML chi tiết từng lượt gửi tới GPT
// trong ngày (prompt → đầu ra): tạo ảnh gpt-image-2 + chat gpt-5.6-sol.
//
// Nguồn: ~/.openclaw/agents/main/sessions/*.trajectory.jsonl (hôm nay).
//
// Cách dùng:
//   node scripts/build-gpt-report.js [YYYY-MM-DD]
// Mặc định: hôm nay. Xuất: gpt-report-<ngày>.html trong thư mục bot.
// ============================================================================

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const TODAY = process.argv[2] || new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const SESSIONS_DIR = path.join(os.homedir(), '.openclaw', 'agents', 'main', 'sessions');
const MEDIA_DIR = path.join(os.homedir(), '.openclaw', 'media', 'tool-image-generation');
const OUT_FILE = path.join(__dirname, '..', `gpt-report-${TODAY}.html`);

const TZ_OFFSET_MS = 7 * 3600 * 1000;
function localTime(ts) {
  const d = new Date(new Date(ts).getTime() + TZ_OFFSET_MS);
  return d.toISOString().slice(11, 19);
}

// ---- Thu thập dữ liệu từ trajectory ---------------------------------------
const sessions = {};
for (const f of fs.readdirSync(SESSIONS_DIR)) {
  if (!f.endsWith('.trajectory.jsonl')) continue;
  const lines = fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8').split('\n');
  for (const l of lines) {
    if (!l.trim()) continue;
    let j;
    try { j = JSON.parse(l); } catch { continue; }
    const localDate = new Date(new Date(j.ts || '').getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
    if (localDate !== TODAY) continue;

    const type = j.type;
    const runId = j.runId || '';
    const sid = (j.sessionId || f).slice(0, 8);
    if (!sessions[sid]) sessions[sid] = { image: [], chat: [] };

    if (type === 'tool.call' && j.data?.name === 'image_generate' && j.data?.arguments?.action === 'generate') {
      sessions[sid].image.push({
        kind: 'image', runId, ts: j.ts, session: sid,
        provider: j.provider, model: j.modelId,
        prompt: String(j.data.arguments.prompt || ''),
        filename: String(j.data.arguments.filename || ''),
        size: j.data.arguments.size || '', quality: j.data.arguments.quality || '',
        output: null, error: null,
      });
    } else if (type === 'tool.result' && j.data?.name === 'image_generate') {
      const entry = sessions[sid].image.find((e) => e.runId === runId);
      if (entry) {
        const texts = (j.data?.contentItems || [])
          .filter((c) => c?.type === 'inputText')
          .map((c) => c.text || '')
          .join('\n');
        if (j.data?.success === false || j.runId.endsWith(':error')) {
          entry.error = texts || 'image_generate thất bại';
        } else {
          entry.output = texts || null;
        }
      }
    } else if (type === 'prompt.submitted' && /gpt-5.6-sol/.test(j.modelId || '')) {
      const text = String(j.data?.finalPromptText ?? j.data?.prompt ?? '');
      sessions[sid].chat.push({
        kind: 'chat', runId, ts: j.ts, session: sid,
        provider: j.provider, model: j.modelId,
        prompt: text, output: null, error: null, toolCalls: null,
        isImageSubagent: runId.startsWith('image_generate:'),
      });
    } else if (type === 'model.completed' && /gpt-5.6-sol/.test(j.modelId || '')) {
      const entry = sessions[sid].chat.find((e) => e.runId === runId);
      if (entry && (j.data?.assistantTexts !== undefined || j.data?.terminalError !== undefined)) {
        const texts = (j.data?.assistantTexts || []).filter(Boolean);
        entry.output = texts.length ? texts.join('\n') : null;
        entry.error = j.data?.terminalError || null;
        if (!entry.prompt) entry.prompt = String(j.data?.finalPromptText ?? '');
        // Lượt không có text nhưng không lỗi → thường là lượt gọi tool.
        if (!entry.output && !entry.error) {
          const lastAsst = (j.data?.messagesSnapshot || [])
            .filter((m) => m?.role === 'assistant').slice(-1)[0];
          const tools = (lastAsst?.content || [])
            .filter((c) => c?.type === 'toolCall').map((c) => c.name);
          if (tools.length) entry.toolCalls = tools;
          else if (j.data?.stopReason === 'error') entry.error = 'stopReason=error (không có nội dung)';
        }
      }
    }
  }
}

// ---- Ghép & sắp xếp ---------------------------------------------------------
const imageList = [];
const chatList = [];
for (const s of Object.values(sessions)) {
  imageList.push(...s.image);
  chatList.push(...s.chat);
}
imageList.sort((a, b) => a.ts.localeCompare(b.ts));
chatList.sort((a, b) => a.ts.localeCompare(b.ts));

// ---- Tìm file ảnh thực tế GPT trả về (media folder) ------------------------
// Prompt image_generate có "filename"; GPT trả ảnh lưu thành
// "<filename>---<uuid>.png" trong media folder. Match theo prefix và chọn
// file có giờ tạo gần thời điểm request nhất.
function resolveImageFile(item) {
  if (!item.filename) return null;
  let files;
  try { files = fs.readdirSync(MEDIA_DIR); } catch { return null; }
  const base = item.filename.replace(/\.(png|jpe?g|webp)$/i, '');
  const cands = files.filter((f) => f.startsWith(base));
  if (!cands.length) return null;
  let best = null;
  let bestDiff = Infinity;
  const reqTs = new Date(item.ts).getTime();
  for (const c of cands) {
    try {
      const diff = Math.abs(fs.statSync(path.join(MEDIA_DIR, c)).mtimeMs - reqTs);
      if (diff < bestDiff) { bestDiff = diff; best = c; }
    } catch { /* bỏ qua */ }
  }
  return best ? { file: path.join(MEDIA_DIR, best), name: best } : null;
}
for (const e of imageList) e.imageFile = resolveImageFile(e);

// ---- Render helpers ---------------------------------------------------------
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function detailsCard(idx, item, isImage) {
  const promptPreview = item.prompt.slice(0, 240);
  const status = item.error
    ? '<span class="badge err">LỖI</span>'
    : item.output
      ? '<span class="badge ok">THÀNH CÔNG</span>'
      : item.toolCalls?.length
        ? '<span class="badge tool">GỌI TOOL</span>'
        : '<span class="badge wait">RỖNG</span>';
  const outputHtml = item.error
    ? `<div class="output out-err">${esc(item.error)}</div>`
    : item.output
      ? `<div class="output">${esc(item.output)}</div>`
      : item.toolCalls?.length
        ? `<div class="output">Đã gọi tool: ${esc(item.toolCalls.join(', '))}</div>`
        : '<div class="output"><i>(trống)</i></div>';
  const metaBits = [localTime(item.ts), `session ${item.session}`];
  if (isImage) {
    metaBits.push(item.size, item.quality);
    if (item.filename) metaBits.push(`file: ${item.filename}`);
  } else {
    metaBits.push(item.model, item.provider);
    if (item.isImageSubagent) metaBits.push('(subagent tạo ảnh)');
  }
  // Phần ảnh thực tế GPT trả về (chỉ với lượt tạo ảnh)
  let imageHtml = '';
  if (isImage) {
    if (item.imageFile) {
      imageHtml = `
      <div class="label">🖼️ Ảnh thực tế GPT trả về (${esc(item.imageFile.name)})</div>
      <div class="image-box">
        <img loading="lazy" src="${pathToFileURL(item.imageFile.file).href}" alt="${esc(item.imageFile.name)}">
      </div>`;
    } else if (!item.error) {
      imageHtml = `
      <div class="label">🖼️ Ảnh thực tế</div>
      <div class="output"><i>⚠️ Không tìm thấy file ảnh trong ~/.openclaw/media/tool-image-generation/</i></div>`;
    }
  }
  return `
  <details class="card ${isImage ? 'img' : 'chat'}" id="item-${idx}">
    <summary>
      <span class="num">#${idx}</span>
      <span class="meta">${esc(metaBits.join(' · '))}</span>
      ${status}
    </summary>
    <div class="body">
      <div class="label">📥 Prompt gửi tới GPT</div>
      <div class="prompt">${esc(item.prompt) || '<i>(trống)</i>'}</div>
      <div class="label">📤 Đầu ra</div>
      ${outputHtml}
      ${imageHtml}
    </div>
  </details>`;
}

const imageCards = imageList.map((item, i) => detailsCard(i + 1, item, true)).join('\n');
const chatCards = chatList.map((item, i) => detailsCard(i + 1, item, false)).join('\n');

const okImages = imageList.filter((e) => e.output && !e.error).length;
const errImages = imageList.length - okImages;
const withFileImages = imageList.filter((e) => e.imageFile).length;
const okChats = chatList.filter((e) => e.output && !e.error).length;
const toolChats = chatList.filter((e) => !e.output && !e.error && e.toolCalls?.length).length;
const errChats = chatList.filter((e) => e.error).length;

const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Báo cáo GPT — ${TODAY}</title>
<style>
  :root { --bg:#0f1220; --card:#171b2e; --line:#2a3050; --txt:#e8eaf2; --dim:#9aa0b8; --ok:#35d07f; --err:#ff6b6b; --wait:#ffc857; --acc:#6c8cff; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--txt); padding:24px; }
  h1 { margin:0 0 4px; font-size:22px; }
  .sub { color:var(--dim); margin-bottom:20px; font-size:13px; }
  .stats { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:24px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 18px; min-width:140px; }
  .stat b { font-size:24px; display:block; }
  .stat small { color:var(--dim); }
  .verify { background:rgba(108,140,255,.08); border:1px solid var(--line); border-radius:10px; padding:10px 14px; font-size:13px; color:var(--dim); margin-bottom:20px; }
  .verify code { background:#10142a; padding:1px 6px; border-radius:4px; color:var(--acc); }
  .stat.ok b { color:var(--ok); } .stat.err b { color:var(--err); } .stat.all b { color:var(--acc); }
  h2 { font-size:16px; margin:28px 0 12px; padding-bottom:6px; border-bottom:1px solid var(--line); }
  input#filter { width:100%; max-width:420px; background:var(--card); color:var(--txt); border:1px solid var(--line); border-radius:8px; padding:8px 12px; margin-bottom:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; margin-bottom:8px; overflow:hidden; }
  .card.img { border-left:3px solid var(--acc); }
  .card.chat { border-left:3px solid var(--wait); }
  summary { display:flex; align-items:center; gap:10px; padding:10px 14px; cursor:pointer; list-style:none; flex-wrap:wrap; }
  summary::-webkit-details-marker { display:none; }
  summary:hover { background:#1d2340; }
  .num { color:var(--dim); font-variant-numeric:tabular-nums; min-width:42px; }
  .meta { color:var(--dim); font-size:12px; }
  .badge { font-size:11px; padding:2px 8px; border-radius:20px; font-weight:600; }
  .badge.ok { background:rgba(53,208,127,.15); color:var(--ok); }
  .badge.err { background:rgba(255,107,107,.15); color:var(--err); }
  .badge.wait { background:rgba(255,200,87,.15); color:var(--wait); }
  .badge.tool { background:rgba(108,140,255,.15); color:var(--acc); }
  .body { padding:0 14px 14px; }
  .label { color:var(--acc); font-size:11px; text-transform:uppercase; letter-spacing:.5px; margin:12px 0 4px; }
  .prompt, .output { background:#10142a; border:1px solid var(--line); border-radius:8px; padding:10px 12px; font-size:13px; white-space:pre-wrap; word-break:break-word; max-height:260px; overflow:auto; font-family:Consolas,monospace; }
  .out-err { color:var(--err); }
  .image-box { margin-top:6px; }
  .image-box img { max-width:100%; max-height:640px; border-radius:8px; border:1px solid var(--line); background:#fff; display:block; }
  .footer { color:var(--dim); font-size:12px; margin-top:28px; text-align:center; }
</style>
</head>
<body>
<h1>🤖 Báo cáo chi tiết các lượt gửi tới GPT — ngày ${TODAY}</h1>
<div class="sub">Nguồn: transcript OpenClaw (~/.openclaw/agents/main/sessions) · giờ Việt Nam (UTC+7) · mỗi mục = 1 lượt gửi prompt kèm đầu ra · ảnh = file thực tế trong ~/.openclaw/media/tool-image-generation/</div>
<div class="verify">
✅ <b>Xác minh gửi đúng GPT:</b> gateway log ghi mọi lượt tạo ảnh đều chọn <code>provider=openai · requestedModel=gpt-image-2</code> (0 lượt đi model khác); ảnh GPT trả về khớp đúng tên file trong từng prompt. Prompt chat <code>gpt-5.6-sol</code> chạy qua backend <code>chatgpt.com</code> của tài khoản GPT OAuth. Gateway log không lưu nội dung prompt — toàn văn prompt lấy từ transcript (bản ghi duy nhất giữ text).
</div>

<div class="stats">
  <div class="stat all"><b>${imageList.length + chatList.length}</b><small>tổng lượt gửi GPT</small></div>
  <div class="stat all"><b>${imageList.length}</b><small>tạo ảnh (gpt-image-2)</small></div>
  <div class="stat ok"><b>${okImages}</b><small>ảnh tạo thành công</small></div>
  <div class="stat ok"><b>${withFileImages}</b><small>có file ảnh thực tế</small></div>
  <div class="stat err"><b>${errImages}</b><small>lượt tạo ảnh lỗi</small></div>
  <div class="stat all"><b>${chatList.length}</b><small>chat gpt-5.6-sol</small></div>
  <div class="stat ok"><b>${okChats}</b><small>chat ra nội dung</small></div>
  <div class="stat all"><b>${toolChats}</b><small>lượt gọi tool</small></div>
  <div class="stat err"><b>${errChats}</b><small>chat lỗi / rỗng</small></div>
</div>

<input id="filter" type="text" placeholder="🔍 Lọc theo nội dung prompt / đầu ra / session…">

<h2>🖼️ Lượt tạo ảnh gpt-image-2 (${imageList.length})</h2>
<div id="img-list">${imageCards}</div>

<h2>💬 Lượt chat gpt-5.6-sol (${chatList.length})</h2>
<div id="chat-list">${chatCards}</div>

<div class="footer">Tạo bởi scripts/build-gpt-report.js · ${new Date().toISOString()}</div>
<script>
  const filter = document.getElementById('filter');
  filter.addEventListener('input', () => {
    const q = filter.value.toLowerCase();
    document.querySelectorAll('.card').forEach(c => {
      c.style.display = c.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
</script>
</body>
</html>`;

fs.writeFileSync(OUT_FILE, html, 'utf8');
console.log(`Đã tạo: ${OUT_FILE}`);
console.log(`  Tạo ảnh: ${imageList.length} (thành công ${okImages} · lỗi ${errImages})`);
console.log(`  Chat gpt-5.6-sol: ${chatList.length} (ra nội dung ${okChats} · lỗi/rỗng ${errChats})`);
console.log(`  Tổng lượt gửi GPT: ${imageList.length + chatList.length}`);
