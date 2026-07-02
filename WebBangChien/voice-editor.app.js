/* Voice Bot config editor - logic. Dùng cùng theme + Supabase với web Bang Chiến. */

function defaultConfig(botId) {
  return {
    voice_channel_id: '',
    mode: 'bridge',
    caller_role_ids: [],
    blocked_role_ids: [],
    relay_targets: [],
    speaker_priority: 'mix',
    priority_role_ids: [],
    relay_enabled: false,
    auto_join: true,
    command_prefix: botId === 1 ? '?1' : '?2',
    auto_create_channel: false,
    created_channel_name: botId === 1 ? '🔊 Đại Ngỗng' : '🔊 Tiểu Ngỗng',
    create_position: 'below',
    create_anchor_channel_id: ''
  };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function toast(msg, isErr) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.toggle('err', !!isErr);
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ---------------- Theme ---------------- */
function initTheme() {
  const saved = localStorage.getItem('lg-theme') || 'dark';
  document.body.classList.toggle('theme-dark', saved !== 'light');
}
function toggleTheme() {
  const isDark = document.body.classList.toggle('theme-dark');
  localStorage.setItem('lg-theme', isDark ? 'dark' : 'light');
}
window.toggleTheme = toggleTheme;

/* ---------------- Auth ---------------- */
async function loginDiscord() {
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await sb.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo } });
  if (error) toast('Lỗi đăng nhập: ' + error.message, true);
}
async function logout() {
  await sb.auth.signOut();
  window.location.reload();
}
window.logout = logout;

function show(id) {
  ['landingPage', 'loadingScreen', 'deniedScreen', 'editorShell'].forEach((x) => {
    document.getElementById(x).classList.toggle('hidden', x !== id);
  });
}

async function checkAuth() {
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (!session) { show('landingPage'); return; }

  show('loadingScreen');
  const meta = session.user.user_metadata || {};
  currentDiscordId = String(meta.provider_id || meta.sub || '').trim();
  currentUserName = meta.full_name || meta.name || 'User';

  if (!ADMIN_IDS.has(currentDiscordId)) {
    document.getElementById('deniedMsg').textContent =
      'Discord ID ' + currentDiscordId + ' không nằm trong danh sách quản trị Voice Bot.';
    show('deniedScreen');
    return;
  }

  document.getElementById('userLabel').textContent = currentUserName + ' · ' + currentDiscordId;
  await Promise.all([loadGuildMeta(), loadConfigs(), loadStatuses()]);
  drafts[1] = { ...configs[1] };
  drafts[2] = { ...configs[2] };
  show('editorShell');
  renderPane(activeBot);
  setupRealtime();
}

/* ---------------- Data ---------------- */
async function loadGuildMeta() {
  try {
    const { data } = await sb.from('voice_relay_guild_meta').select('*').eq('guild_id', GUILD_ID).maybeSingle();
    guildMeta.voice_channels = Array.isArray(data?.voice_channels) ? data.voice_channels : [];
    guildMeta.roles = Array.isArray(data?.roles) ? data.roles : [];
  } catch (_) { guildMeta = { voice_channels: [], roles: [] }; }
}

async function loadConfigs() {
  try {
    const { data } = await sb.from('voice_relay_config').select('*').eq('guild_id', GUILD_ID);
    for (const botId of [1, 2]) {
      const row = (data || []).find((r) => Number(r.bot_id) === botId);
      configs[botId] = row ? { ...defaultConfig(botId), ...normalizeRow(row) } : defaultConfig(botId);
    }
  } catch (_) {
    configs[1] = defaultConfig(1);
    configs[2] = defaultConfig(2);
  }
}

function normalizeRow(row) {
  const arr = (v) => Array.isArray(v) ? v.map(String) : [];
  return {
    voice_channel_id: row.voice_channel_id || '',
    mode: row.mode || 'bridge',
    caller_role_ids: arr(row.caller_role_ids),
    blocked_role_ids: arr(row.blocked_role_ids),
    relay_targets: arr(row.relay_targets),
    speaker_priority: row.speaker_priority || 'mix',
    priority_role_ids: arr(row.priority_role_ids),
    relay_enabled: row.relay_enabled === true,
    auto_join: row.auto_join !== false,
    command_prefix: row.command_prefix || '',
    auto_create_channel: row.auto_create_channel === true,
    created_channel_name: row.created_channel_name || '',
    create_position: row.create_position === 'above' ? 'above' : 'below',
    create_anchor_channel_id: row.create_anchor_channel_id || ''
  };
}

async function loadStatuses() {
  try {
    const { data } = await sb.from('voice_relay_status').select('*').eq('guild_id', GUILD_ID);
    for (const botId of [1, 2]) statuses[botId] = (data || []).find((r) => Number(r.bot_id) === botId) || null;
  } catch (_) { /* ignore */ }
}

/* ---------------- Realtime ---------------- */
function setupRealtime() {
  sb.channel('voice_relay_status_rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'voice_relay_status', filter: 'guild_id=eq.' + GUILD_ID }, (payload) => {
      const row = payload.new || payload.old;
      if (!row) return;
      statuses[Number(row.bot_id)] = payload.eventType === 'DELETE' ? null : row;
      updateTabDots();
      if (Number(row.bot_id) === activeBot) renderStatus(activeBot);
    })
    .subscribe();
}

/* ---------------- Render ---------------- */
function switchBot(botId) {
  activeBot = botId;
  document.getElementById('tab1').classList.toggle('active', botId === 1);
  document.getElementById('tab2').classList.toggle('active', botId === 2);
  renderPane(botId);
}
window.switchBot = switchBot;

function updateTabDots() {
  for (const botId of [1, 2]) {
    const online = statuses[botId]?.discord_connected === true;
    const tab = document.getElementById('tab' + botId);
    tab.classList.toggle('online', online);
    const lbl = tab.querySelector('.lbl');
    if (lbl) lbl.textContent = online ? 'online' : 'offline';
  }
}

function roleChecklist(botId, key, selected) {
  if (!guildMeta.roles.length) {
    return '<div class="checklist"><div class="empty">Chưa có dữ liệu role. Bot cần đồng bộ role của guild lên Supabase (guildSync).</div></div>';
  }
  const rows = guildMeta.roles.map((r) => {
    const checked = selected.includes(String(r.id)) ? 'checked' : '';
    return `<label class="row"><input type="checkbox" data-key="${key}" value="${esc(r.id)}" ${checked}> ${esc(r.name)}</label>`;
  }).join('');
  return `<div class="checklist" data-list="${key}">${rows}</div>`;
}

function channelOptions(selected) {
  if (!guildMeta.voice_channels.length) {
    return `<option value="${esc(selected)}">${selected ? esc(selected) + ' (nhập tay)' : '— chưa có danh sách kênh —'}</option>`;
  }
  let opts = '<option value="">— chọn kênh —</option>';
  opts += guildMeta.voice_channels.map((c) => {
    const sel = String(c.id) === String(selected) ? 'selected' : '';
    return `<option value="${esc(c.id)}" ${sel}>${esc(c.name)}</option>`;
  }).join('');
  return opts;
}

function channelFieldHtml(botId, d) {
  if (!guildMeta.voice_channels.length) {
    return `
      <label>Kênh voice của ${esc(BOT_NAMES[botId])}</label>
      <input type="text" data-field="voice_channel_id" value="${esc(d.voice_channel_id)}" placeholder="Dán ID kênh voice...">
      <div class="hint">Chưa có danh sách kênh (bot chưa quét & đồng bộ lên Supabase). Tạm nhập ID kênh bằng tay: chuột phải kênh voice trong Discord → Copy Channel ID (cần bật Developer Mode).</div>`;
  }
  return `
    <label>Kênh voice của ${esc(BOT_NAMES[botId])}</label>
    <select data-field="voice_channel_id">${channelOptions(d.voice_channel_id)}</select>
    <div class="hint">Bot đứng ở kênh này để vừa thu vừa phát.</div>`;
}

function anchorSelectHtml(d) {
  if (!guildMeta.voice_channels.length) {
    return `<input type="text" data-field="create_anchor_channel_id" value="${esc(d.create_anchor_channel_id)}" placeholder="Dán ID kênh mốc...">`;
  }
  return `<select data-field="create_anchor_channel_id">${channelOptions(d.create_anchor_channel_id)}</select>`;
}

function renderPane(botId) {
  const d = drafts[botId];
  const otherBot = botId === 1 ? 2 : 1;
  const host = document.getElementById('paneHost');
  const targetChecked = d.relay_targets.includes(String(otherBot)) ? 'checked' : '';

  host.innerHTML = `
    <div class="bot-pane active">
      <div class="grid">
        <div>
          <div class="section">
            <h3>🎧 Kênh & chế độ</h3>
            <div class="field">
              ${channelFieldHtml(botId, d)}
            </div>
            <div class="field">
              <label>Chế độ relay</label>
              <div class="seg" data-seg="mode">
                <button data-val="bridge" class="${d.mode === 'bridge' ? 'active' : ''}">Bridge (2 chiều)</button>
                <button data-val="broadcast" class="${d.mode === 'broadcast' ? 'active' : ''}">Broadcast (1→N)</button>
              </div>
            </div>
            <div class="field" data-show="broadcast" style="${d.mode === 'broadcast' ? '' : 'display:none'}">
              <label>Đích nhận âm thanh (định tuyến)</label>
              <div class="checklist">
                <label class="row"><input type="checkbox" data-key="relay_targets" value="${otherBot}" ${targetChecked}> ${esc(BOT_NAMES[otherBot])} (Bot ${otherBot})</label>
              </div>
              <div class="hint">Broadcast phải chọn ít nhất 1 đích.</div>
            </div>
            <div class="field">
              <label>Prefix lệnh</label>
              <input type="text" data-field="command_prefix" value="${esc(d.command_prefix)}" placeholder="?${botId}">
              <div class="hint">Tránh trùng lệnh bot chính (join/leave/stop/lt/loto...).</div>
            </div>
          </div>

          <div class="section">
            <h3>⚙️ Bật/tắt</h3>
            <div class="toggle-row"><span>Bật relay</span>${sw('relay_enabled', d.relay_enabled)}</div>
            <div class="toggle-row"><span>Tự động vào kênh</span>${sw('auto_join', d.auto_join)}</div>
          </div>

          <div class="section">
            <h3>🏗️ Tạo kênh tự động</h3>
            <div class="toggle-row"><span>Tự tạo kênh voice khi bật</span>${sw('auto_create_channel', d.auto_create_channel)}</div>
            <div data-show="autocreate" style="${d.auto_create_channel ? 'margin-top:14px' : 'display:none'}">
              <div class="field">
                <label>Tên kênh sẽ tạo</label>
                <input type="text" data-field="created_channel_name" value="${esc(d.created_channel_name)}" placeholder="🔊 Tên kênh">
              </div>
              <div class="field">
                <label>Vị trí</label>
                <div class="seg" data-seg="create_position">
                  <button data-val="above" class="${d.create_position === 'above' ? 'active' : ''}">Trên kênh mốc</button>
                  <button data-val="below" class="${d.create_position === 'below' ? 'active' : ''}">Dưới kênh mốc</button>
                </div>
              </div>
              <div class="field">
                <label>Kênh mốc (đặt kênh mới kế bên)</label>
                ${anchorSelectHtml(d)}
                <div class="hint">Kênh mới tạo cùng danh mục với kênh mốc, nằm ${d.create_position === 'above' ? 'phía TRÊN' : 'phía DƯỚI'} kênh này.</div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div class="section">
            <h3>🛡️ Luật role</h3>
            <div class="field">
              <label>Caller role (được nói xuống)</label>
              ${roleChecklist(botId, 'caller_role_ids', d.caller_role_ids)}
            </div>
            <div class="field">
              <label>Blocked role (bị chặn)</label>
              ${roleChecklist(botId, 'blocked_role_ids', d.blocked_role_ids)}
            </div>
            <div class="field">
              <label>Ưu tiên khi nhiều người nói</label>
              <div class="seg" data-seg="speaker_priority">
                <button data-val="mix" class="${d.speaker_priority === 'mix' ? 'active' : ''}">Mix (trộn tất cả)</button>
                <button data-val="priority" class="${d.speaker_priority === 'priority' ? 'active' : ''}">Priority</button>
              </div>
            </div>
            <div class="field" data-show="priority" style="${d.speaker_priority === 'priority' ? '' : 'display:none'}">
              <label>Role ưu tiên (cao → thấp)</label>
              ${roleChecklist(botId, 'priority_role_ids', d.priority_role_ids)}
            </div>
          </div>
        </div>
      </div>

      <div class="section" id="statusSection">${statusHtml(botId)}</div>
      <div class="err-note" id="errNote"></div>

      <div class="save-bar">
        <button class="btn ghost" onclick="doAction(${botId},'leave')">Rời kênh</button>
        <button class="btn" onclick="doAction(${botId},'rejoin')">Vào lại kênh</button>
        <button class="btn gold" onclick="saveConfig(${botId})">Lưu cấu hình ${esc(BOT_NAMES[botId])}</button>
      </div>
    </div>`;

  bindPane(botId);
  updateTabDots();
}

function sw(field, on) {
  return `<label class="switch"><input type="checkbox" data-field="${field}" ${on ? 'checked' : ''}><span class="slider"></span></label>`;
}

function statusHtml(botId) {
  const s = statuses[botId];
  const online = s?.discord_connected === true;
  const link = s?.link_connected === true;
  const relay = s?.relay_enabled === true;
  const pill = (ok, t, f) => `<span class="pill ${ok ? 'ok' : 'off'}">${ok ? t : f}</span>`;
  return `
    <h3>📡 Trạng thái ${esc(BOT_NAMES[botId])} ${pill(online, 'ONLINE', 'OFFLINE')}</h3>
    <div class="status-grid">
      <div class="status-item"><div class="k">Kênh voice</div><div class="v">${esc(s?.voice_channel_name || s?.voice_channel_id || '—')}</div></div>
      <div class="status-item"><div class="k">Relay</div><div class="v ${relay ? 'ok' : 'off'}">${relay ? 'Đang bật' : 'Tắt'}</div></div>
      <div class="status-item"><div class="k">Link 2 bot</div><div class="v ${link ? 'ok' : 'off'}">${link ? 'Kết nối' : 'Mất'}</div></div>
      <div class="status-item"><div class="k">Heartbeat</div><div class="v">${s?.heartbeat_at ? new Date(s.heartbeat_at).toLocaleTimeString('vi-VN') : '—'}</div></div>
    </div>
    ${s?.last_error ? `<div class="err-note">Lỗi gần nhất: ${esc(s.last_error)}</div>` : ''}`;
}

function renderStatus(botId) {
  const sec = document.getElementById('statusSection');
  if (sec) sec.innerHTML = statusHtml(botId);
}

/* ---------------- Bind inputs -> draft ---------------- */
function bindPane(botId) {
  const d = drafts[botId];
  const host = document.getElementById('paneHost');

  host.querySelectorAll('[data-field]').forEach((el) => {
    el.addEventListener('change', () => {
      const f = el.dataset.field;
      if (el.type === 'checkbox') {
        d[f] = el.checked;
        if (f === 'auto_create_channel') renderPane(botId); // hiện/ẩn phần cấu hình tạo kênh
      } else {
        d[f] = el.value;
      }
    });
  });

  host.querySelectorAll('[data-seg]').forEach((seg) => {
    seg.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        d[seg.dataset.seg] = btn.dataset.val;
        renderPane(botId); // re-render để hiện/ẩn field phụ thuộc
      });
    });
  });

  host.querySelectorAll('input[data-key]').forEach((el) => {
    el.addEventListener('change', () => {
      const key = el.dataset.key;
      const set = new Set(d[key].map(String));
      if (el.checked) set.add(el.value); else set.delete(el.value);
      d[key] = [...set];
    });
  });
}

/* ---------------- Save / actions ---------------- */
function validateDraft(d) {
  if (d.mode === 'broadcast' && d.relay_targets.length === 0) return 'Chế độ broadcast phải chọn ít nhất 1 đích.';
  if (d.auto_create_channel) {
    if (!String(d.created_channel_name || '').trim()) return 'Bật tự tạo kênh thì phải đặt tên kênh.';
    if (!String(d.create_anchor_channel_id || '').trim()) return 'Chọn kênh mốc (trên/dưới) để đặt vị trí kênh sẽ tạo.';
  }
  return '';
}

async function api(body) {
  const res = await fetch('/api/voice-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || ('HTTP ' + res.status));
  return json;
}

async function saveConfig(botId) {
  const d = drafts[botId];
  const err = validateDraft(d);
  const note = document.getElementById('errNote');
  if (err) { if (note) note.textContent = err; toast(err, true); return; }
  if (note) note.textContent = '';
  try {
    const json = await api({ action: 'saveConfig', guild_id: GUILD_ID, bot_id: botId, payload: d });
    if (json.config) { configs[botId] = { ...defaultConfig(botId), ...normalizeRow(json.config) }; }
    toast('Đã lưu cấu hình ' + BOT_NAMES[botId] + '.');
  } catch (e) {
    toast('Lưu thất bại: ' + e.message, true);
  }
}
window.saveConfig = saveConfig;

async function doAction(botId, action) {
  try {
    await api({ action, guild_id: GUILD_ID, bot_id: botId });
    toast(action === 'rejoin' ? 'Đã gửi lệnh vào lại kênh cho ' + BOT_NAMES[botId] + '.' : 'Đã gửi lệnh rời kênh cho ' + BOT_NAMES[botId] + '.');
  } catch (e) {
    toast('Thất bại: ' + e.message, true);
  }
}
window.doAction = doAction;

/* ---------------- Boot ---------------- */
(function boot() {
  initTheme();
  try {
    const createFn = window.supabase?.createClient;
    sb = createFn ? createFn(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
  } catch (_) { sb = null; }

  if (!sb) { toast('Không tải được Supabase client.', true); return; }

  document.getElementById('btnLogin').addEventListener('click', loginDiscord);
  sb.auth.onAuthStateChange(() => { /* session refresh handled by checkAuth on load */ });
  checkAuth();
})();
