/* Voice Bot config editor - 3 bot quick setup. */

const BOT_IDS = window.BOT_IDS || [1, 2, 3];
const FIXED_ROLES = [
  { key: 'langgia', label: 'LangGia', aliases: ['langgia', 'lang gia'] },
  { key: 'kycuu', label: 'Kỳ Cựu', aliases: ['ky cuu', 'kycuu', 'kỳ cựu'] },
  { key: 'chihuy', label: 'Chỉ Huy', aliases: ['chi huy', 'chihuy', 'chỉ huy'] }
];

let masterState = { enabled: false };
let managedChannels = [];
let memberRows = [];
let quickAnchorId = '';
let pickerState = null;

function defaultConfig(botId) {
  return {
    voice_channel_id: '',
    mode: 'bridge',
    caller_role_ids: defaultCallerRoleIds(),
    blocked_role_ids: [],
    caller_user_ids: [],
    muted_user_ids: [],
    relay_targets: BOT_IDS.filter((id) => id !== botId).map(String),
    speaker_priority: 'mix',
    priority_role_ids: [],
    relay_enabled: false,
    auto_join: true,
    command_prefix: botId === 1 ? '?relay' : botId === 2 ? '!relay' : '#relay',
    auto_create_channel: false,
    created_channel_name: BOT_NAMES[botId] || `Bot ${botId}`,
    create_position: 'below',
    create_anchor_channel_id: ''
  };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function roleLookup() {
  const roles = Array.isArray(guildMeta.roles) ? guildMeta.roles : [];
  const map = {};
  for (const def of FIXED_ROLES) {
    const aliases = def.aliases.map(normalizeText);
    map[def.key] = roles.find((role) => {
      const name = normalizeText(role.name);
      return aliases.some((alias) => name === alias || name.includes(alias));
    }) || null;
  }
  return map;
}

function defaultCallerRoleIds() {
  const kyCuu = roleLookup().kycuu;
  return kyCuu?.id ? [String(kyCuu.id)] : [];
}

function memberName(row) {
  return row?.game_username || row?.discord_name || row?.discord_id || 'Không rõ';
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
  await Promise.all([loadGuildMeta(), loadMaster(), loadManagedChannels(), loadMembers()]);
  await Promise.all([loadConfigs(), loadStatuses()]);
  for (const botId of BOT_IDS) drafts[botId] = { ...configs[botId] };
  quickAnchorId = findBangChienChannelId() || guildMeta.voice_channels[0]?.id || '';
  show('editorShell');
  renderBotTabs();
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

async function loadMaster() {
  try {
    const { data } = await sb.from('voice_relay_master').select('*').eq('guild_id', GUILD_ID).maybeSingle();
    masterState = data || { enabled: false };
  } catch (_) { masterState = { enabled: false }; }
}

async function loadManagedChannels() {
  try {
    const { data } = await sb.from('voice_relay_managed_channels').select('*').eq('guild_id', GUILD_ID);
    managedChannels = Array.isArray(data) ? data : [];
  } catch (_) { managedChannels = []; }
}

async function loadMembers() {
  try {
    const { data } = await sb.from('bc_users')
      .select('discord_id,discord_name,game_username,game_uid,position,lang_gia_member,left_at')
      .eq('guild_id', GUILD_ID)
      .eq('lang_gia_member', true)
      .is('left_at', null)
      .range(0, 4999);
    memberRows = Array.isArray(data) ? data : [];
  } catch (_) { memberRows = []; }
}

async function loadConfigs() {
  try {
    const { data } = await sb.from('voice_relay_config').select('*').eq('guild_id', GUILD_ID);
    for (const botId of BOT_IDS) {
      const row = (data || []).find((r) => Number(r.bot_id) === botId);
      configs[botId] = row ? { ...defaultConfig(botId), ...normalizeRow(row) } : defaultConfig(botId);
    }
  } catch (_) {
    for (const botId of BOT_IDS) configs[botId] = defaultConfig(botId);
  }
}

function normalizeRow(row) {
  const arr = (v) => Array.isArray(v) ? v.map(String) : [];
  return {
    voice_channel_id: row.voice_channel_id || '',
    mode: row.mode || 'bridge',
    caller_role_ids: arr(row.caller_role_ids),
    blocked_role_ids: arr(row.blocked_role_ids),
    caller_user_ids: arr(row.caller_user_ids),
    muted_user_ids: arr(row.muted_user_ids),
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
    for (const botId of BOT_IDS) statuses[botId] = (data || []).find((r) => Number(r.bot_id) === botId) || null;
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
  sb.channel('voice_relay_master_rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'voice_relay_master', filter: 'guild_id=eq.' + GUILD_ID }, (payload) => {
      masterState = payload.new || { enabled: false };
      renderPane(activeBot);
    })
    .subscribe();
}

/* ---------------- Render ---------------- */
function renderBotTabs() {
  const tabs = document.querySelector('.tabs');
  tabs.innerHTML = BOT_IDS.map((botId) => `
    <div class="tab ${botId === activeBot ? 'active' : ''}" id="tab${botId}" data-bot="${botId}" onclick="switchBot(${botId})">
      <div class="avatar">${botId === 1 ? '🦢' : botId === 2 ? '🐥' : '⚔️'}</div>
      <div class="meta"><div class="name">${esc(BOT_NAMES[botId])}</div><div class="role">Bot ${botId}</div></div>
      <div class="state"><span class="dot"></span><span class="lbl">offline</span></div>
    </div>`).join('');
  updateTabDots();
}

function switchBot(botId) {
  activeBot = botId;
  for (const id of BOT_IDS) document.getElementById('tab' + id)?.classList.toggle('active', id === botId);
  renderPane(botId);
}
window.switchBot = switchBot;

function updateTabDots() {
  for (const botId of BOT_IDS) {
    const online = statuses[botId]?.discord_connected === true;
    const tab = document.getElementById('tab' + botId);
    if (!tab) continue;
    tab.classList.toggle('online', online);
    const lbl = tab.querySelector('.lbl');
    if (lbl) lbl.textContent = online ? 'online' : 'offline';
  }
}

function fixedRoleChecklist(key, selected) {
  const lookup = roleLookup();
  const rows = FIXED_ROLES.map((def) => {
    const role = lookup[def.key];
    const disabled = role ? '' : 'disabled';
    const checked = role && selected.includes(String(role.id)) ? 'checked' : '';
    const missing = role ? '' : '<span class="missing">chưa thấy role</span>';
    return `<label class="fixed-check ${disabled}">
      <input type="checkbox" data-key="${key}" value="${esc(role?.id || '')}" ${checked} ${disabled}>
      <span>${esc(def.label)}</span>${missing}
    </label>`;
  }).join('');
  return `<div class="fixed-checks" data-list="${key}">${rows}</div>`;
}

function memberChips(botId, key) {
  const ids = drafts[botId][key] || [];
  if (!ids.length) return '<div class="hint">Chưa chọn ai.</div>';
  const rows = ids.map((id) => {
    const row = memberRows.find((m) => String(m.discord_id) === String(id));
    return `<span class="member-chip">${esc(memberName(row) || id)}<button type="button" onclick="removeMemberPick(${botId},'${key}','${esc(id)}')">×</button></span>`;
  }).join('');
  return `<div class="member-chips">${rows}</div>`;
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

function findBangChienChannelId() {
  const wanted = ['bang chien', 'bangchien'];
  const channel = guildMeta.voice_channels.find((c) => wanted.some((w) => normalizeText(c.name).includes(w)));
  return channel?.id || '';
}

function quickSetupHtml() {
  const totalPeople = BOT_IDS.reduce((sum, botId) => sum + Number(statuses[botId]?.channel_member_count || 0), 0);
  return `
    <div class="section quick-panel">
      <h3>⚡ Setup nhanh 3 bot</h3>
      <div class="quick-row">
        <div>
          <div class="quick-title">Bật/tắt tổng</div>
          <div class="hint">Bật: Bot 1 vào phòng Bang Chiến, Bot 2/3 tạo phòng relay bên dưới và vào kênh.</div>
        </div>
        <label class="switch"><input type="checkbox" ${masterState.enabled ? 'checked' : ''} onchange="toggleMaster(this.checked)"><span class="slider"></span></label>
      </div>
      <div class="field">
        <label>Phòng mốc Bot 1</label>
        <select id="quickAnchor" onchange="quickAnchorId=this.value">${channelOptions(quickAnchorId)}</select>
        <div class="hint">Mặc định tự tìm phòng có tên BANG CHIẾN. Bot 2/3 sẽ tạo phòng relay bên dưới phòng này.</div>
      </div>
      ${totalPeople ? `<div class="hint">Hiện có ${totalPeople} người thật trong các kênh relay. Khi tắt tổng web sẽ hỏi trước nếu cần xóa phòng.</div>` : ''}
    </div>`;
}

function targetChecklist(botId, selected) {
  const rows = BOT_IDS.filter((id) => id !== botId).map((id) => {
    const checked = selected.includes(String(id)) ? 'checked' : '';
    return `<label class="fixed-check"><input type="checkbox" data-key="relay_targets" value="${id}" ${checked}> <span>${esc(BOT_NAMES[id])}</span></label>`;
  }).join('');
  return `<div class="fixed-checks">${rows}</div>`;
}

function renderPane(botId) {
  const d = drafts[botId];
  const host = document.getElementById('paneHost');

  host.innerHTML = `
    ${quickSetupHtml()}
    <div class="bot-pane active">
      <div class="grid">
        <div>
          <div class="section">
            <h3>🎧 Bot & kênh</h3>
            <div class="field">
              <label>Kênh voice của ${esc(BOT_NAMES[botId])}</label>
              <select data-field="voice_channel_id">${channelOptions(d.voice_channel_id)}</select>
              <div class="hint">Setup nhanh sẽ tự điền kênh. Vẫn có thể chỉnh tay khi cần.</div>
            </div>
            <div class="field">
              <label>Phát âm thanh tới bot</label>
              ${targetChecklist(botId, d.relay_targets)}
              <div class="hint">Mặc định mesh: mỗi bot phát sang 2 bot còn lại.</div>
            </div>
            <div class="field">
              <label>Prefix lệnh</label>
              <input type="text" data-field="command_prefix" value="${esc(d.command_prefix)}" placeholder="${botId === 1 ? '?relay' : botId === 2 ? '!relay' : '#relay'}">
            </div>
          </div>

          <div class="section">
            <h3>⚙️ Bật/tắt bot này</h3>
            <div class="toggle-row"><span>Bật relay</span>${sw('relay_enabled', d.relay_enabled)}</div>
            <div class="toggle-row"><span>Tự động vào kênh</span>${sw('auto_join', d.auto_join)}</div>
          </div>
        </div>

        <div>
          <div class="section">
            <h3>🛡️ Ai được nói</h3>
            <div class="field">
              <label>Role được nói</label>
              ${fixedRoleChecklist('caller_role_ids', d.caller_role_ids)}
            </div>
            <div class="field">
              <label>Thêm người được nói riêng</label>
              ${memberChips(botId, 'caller_user_ids')}
              <button class="btn ghost small" onclick="openMemberPicker(${botId},'caller_user_ids')">+ Thêm người</button>
            </div>
            <div class="field">
              <label>Mute người cụ thể</label>
              ${memberChips(botId, 'muted_user_ids')}
              <button class="btn ghost small" onclick="openMemberPicker(${botId},'muted_user_ids')">+ Chọn người mute</button>
            </div>
            <div class="field">
              <label>Blocked role</label>
              ${fixedRoleChecklist('blocked_role_ids', d.blocked_role_ids)}
            </div>
          </div>
        </div>
      </div>

      <div class="section" id="statusSection">${statusHtml(botId)}</div>
      <div class="err-note" id="errNote"></div>

      <div class="save-bar">
        <button class="btn ghost" onclick="doAction(${botId},'leave')">Rời kênh</button>
        <button class="btn" onclick="doAction(${botId},'rejoin')">Vào lại kênh</button>
        <button class="btn gold" onclick="saveConfig(${botId})">Lưu ${esc(BOT_NAMES[botId])}</button>
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
      <div class="status-item"><div class="k">Link mesh</div><div class="v ${link ? 'ok' : 'off'}">${link ? 'Kết nối' : 'Mất'}</div></div>
      <div class="status-item"><div class="k">Người trong kênh</div><div class="v">${Number(s?.channel_member_count || 0)}</div></div>
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
      if (el.type === 'checkbox') d[f] = el.checked;
      else d[f] = el.value;
    });
  });

  host.querySelectorAll('input[data-key]').forEach((el) => {
    el.addEventListener('change', () => {
      const key = el.dataset.key;
      const set = new Set((d[key] || []).map(String));
      if (el.checked) set.add(el.value); else set.delete(el.value);
      d[key] = [...set].filter(Boolean);
    });
  });
}

/* ---------------- Member picker ---------------- */
function ensurePicker() {
  if (document.getElementById('memberPicker')) return;
  const div = document.createElement('div');
  div.id = 'memberPicker';
  div.className = 'modal hidden';
  div.innerHTML = `
    <div class="modal-panel">
      <div class="modal-head">
        <strong id="pickerTitle">Chọn thành viên</strong>
        <button class="btn ghost small" onclick="closeMemberPicker()">Đóng</button>
      </div>
      <input id="memberSearch" type="text" placeholder="Tìm tên Discord, tên game, UID..." oninput="renderMemberResults()">
      <div id="memberResults" class="member-results"></div>
    </div>`;
  document.body.appendChild(div);
}

function openMemberPicker(botId, key) {
  pickerState = { botId, key };
  ensurePicker();
  document.getElementById('pickerTitle').textContent = key === 'muted_user_ids' ? 'Mute người cụ thể' : 'Thêm người được nói';
  document.getElementById('memberSearch').value = '';
  document.getElementById('memberPicker').classList.remove('hidden');
  renderMemberResults();
  setTimeout(() => document.getElementById('memberSearch')?.focus(), 0);
}
window.openMemberPicker = openMemberPicker;

function closeMemberPicker() {
  document.getElementById('memberPicker')?.classList.add('hidden');
  pickerState = null;
}
window.closeMemberPicker = closeMemberPicker;

function renderMemberResults() {
  const host = document.getElementById('memberResults');
  if (!host || !pickerState) return;
  const q = normalizeText(document.getElementById('memberSearch')?.value || '');
  const current = new Set((drafts[pickerState.botId][pickerState.key] || []).map(String));
  const rows = memberRows
    .filter((m) => !q || normalizeText([m.discord_name, m.game_username, m.game_uid, m.discord_id].join(' ')).includes(q))
    .slice(0, 80);
  host.innerHTML = rows.map((m) => {
    const id = String(m.discord_id || '');
    const picked = current.has(id);
    return `<button class="member-result ${picked ? 'picked' : ''}" onclick="pickMember('${esc(id)}')">
      <span><b>${esc(memberName(m))}</b><small>${esc(m.discord_name || m.discord_id || '')}</small></span>
      <span>${picked ? 'Đã chọn' : '+'}</span>
    </button>`;
  }).join('') || '<div class="empty">Không tìm thấy thành viên.</div>';
}
window.renderMemberResults = renderMemberResults;

function pickMember(id) {
  if (!pickerState || !id) return;
  const list = drafts[pickerState.botId][pickerState.key] || [];
  if (!list.includes(id)) list.push(id);
  drafts[pickerState.botId][pickerState.key] = list;
  renderPane(pickerState.botId);
  closeMemberPicker();
}
window.pickMember = pickMember;

function removeMemberPick(botId, key, id) {
  drafts[botId][key] = (drafts[botId][key] || []).filter((x) => String(x) !== String(id));
  renderPane(botId);
}
window.removeMemberPick = removeMemberPick;

/* ---------------- Save / actions ---------------- */
function validateDraft(d) {
  if (!d.caller_role_ids.length && !d.caller_user_ids.length) return 'Chọn ít nhất 1 role hoặc 1 người được nói.';
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

async function toggleMaster(on) {
  try {
    if (on) {
      const callerRoleIds = defaultCallerRoleIds();
      await api({ action: 'quickSetup', guild_id: GUILD_ID, payload: { voice_channel_id: quickAnchorId, caller_role_ids: callerRoleIds } });
      toast('Đã bật setup nhanh 3 bot.');
    } else {
      const people = BOT_IDS.reduce((sum, botId) => sum + Number(statuses[botId]?.channel_member_count || 0), 0);
      const mode = people > 0 && window.confirm('Kênh relay đang có người. OK = xóa phòng relay tự tạo, Cancel = chỉ cho bot rời kênh.') ? 'delete' : 'leave';
      await api({ action: 'globalStop', guild_id: GUILD_ID, payload: { mode } });
      toast('Đã tắt voice relay tổng.');
    }
    await Promise.all([loadMaster(), loadConfigs(), loadStatuses(), loadManagedChannels()]);
    for (const botId of BOT_IDS) drafts[botId] = { ...configs[botId] };
    renderPane(activeBot);
  } catch (e) {
    toast('Thao tác tổng thất bại: ' + e.message, true);
    renderPane(activeBot);
  }
}
window.toggleMaster = toggleMaster;

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
