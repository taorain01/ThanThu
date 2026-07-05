/* Voice Bot config editor - 3 bot quick setup. */

const BOT_IDS = window.BOT_IDS || [1, 2, 3];
const FIXED_ROLES = [
  { key: 'langgia', label: 'LangGia', aliases: ['langgia', 'lang gia'] },
  { key: 'kycuu', label: 'Kỳ Cựu', aliases: ['ky cuu', 'kycuu', 'kỳ cựu'] },
  { key: 'chihuy', label: 'Chỉ Huy', aliases: ['chi huy', 'chihuy', 'chỉ huy'] }
];
const BOT_AVATAR_FALLBACKS = { 1: '🦢', 2: '🐥', 3: '⚔️' };
const BOT_ROLE_TAGS = { 1: 'Team 1', 2: 'Team 2', 3: 'Team 3' };
const QUICK_AUTO_ROOM_NAMES = { 1: '⚡ Team Top', 2: '⚡ Team Mid', 3: '⚡ Team Bot' };

let masterState = { enabled: false };
let managedChannels = [];
let memberRows = [];
let quickAnchorId = '';
let quickSetupMode = 'auto';
let manualChannelIds = { 1: '', 2: '', 3: '' };
let pickerState = null;

/* Chế độ cấu hình: 'shared' = chung cả 3 bot, 'perbot' = riêng từng bot. */
let settingScope = 'shared';
const SHARED_FIELDS = ['caller_role_ids', 'caller_user_ids', 'muted_user_ids', 'blocked_role_ids'];
let sharedDraft = { caller_role_ids: [], caller_user_ids: [], muted_user_ids: [], blocked_role_ids: [] };

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
    jitter_buffer_ms: 400,
    speaker_release_ms: 500,
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

function isKcPosition(position) {
  const normalized = normalizeText(position);
  return normalized === 'kc' || normalized === 'ky cuu';
}

async function canAccessVoiceEditor() {
  if (ADMIN_IDS.has(currentDiscordId)) return true;

  try {
    const { data } = await sb.from('bc_users')
      .select('discord_id,position,lang_gia_member,left_at')
      .eq('guild_id', GUILD_ID)
      .eq('discord_id', currentDiscordId)
      .eq('lang_gia_member', true)
      .is('left_at', null)
      .limit(1);
    const row = Array.isArray(data) ? data[0] : null;
    return Boolean(row && isKcPosition(row.position));
  } catch (_) {
    return false;
  }
}

function botAvatarFallback(botId) {
  return BOT_AVATAR_FALLBACKS[botId] || '●';
}

function botRoleTag(botId) {
  return BOT_ROLE_TAGS[botId] || '';
}

function botAvatarUrl(botId) {
  return statuses[botId]?.bot_avatar_url || '';
}

function botAvatarHtml(botId) {
  const url = botAvatarUrl(botId);
  if (!url) return esc(botAvatarFallback(botId));
  return `<img src="${esc(url)}" alt="${esc(BOT_NAMES[botId])}" loading="lazy" referrerpolicy="no-referrer" onerror="handleBotAvatarError(this)">`;
}

function handleBotAvatarError(img) {
  const parent = img?.parentElement;
  if (!parent) return;
  parent.textContent = parent.dataset.fallback || '●';
}
window.handleBotAvatarError = handleBotAvatarError;

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

  if (!(await canAccessVoiceEditor())) {
    document.getElementById('deniedMsg').textContent =
      'Discord ID ' + currentDiscordId + ' cần role Kỳ Cựu hoặc quyền quản trị Voice Bot.';
    show('deniedScreen');
    return;
  }

  document.getElementById('userLabel').textContent = currentUserName + ' · ' + currentDiscordId;
  await Promise.all([loadGuildMeta(), loadMaster(), loadManagedChannels(), loadMembers()]);
  await Promise.all([loadConfigs(), loadStatuses()]);
  for (const botId of BOT_IDS) drafts[botId] = { ...configs[botId] };
  refreshQuickAnchorId();
  manualChannelIds = Object.fromEntries(BOT_IDS.map((botId) => [botId, preferredBotVoiceChannelId(botId)]));
  if (!quickAnchorId) quickSetupMode = 'manual';
  show('editorShell');
  renderBotTabs();
  initSettingScope();
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
    jitter_buffer_ms: Number.isFinite(Number(row.jitter_buffer_ms)) && Number(row.jitter_buffer_ms) > 0 ? Number(row.jitter_buffer_ms) : 400,
    speaker_release_ms: Number.isFinite(Number(row.speaker_release_ms)) && Number(row.speaker_release_ms) >= 0 ? Number(row.speaker_release_ms) : 500,
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
      const anchorChanged = refreshQuickAnchorId();
      updateTabDots();
      if (anchorChanged) renderPane(activeBot);
      else renderStatus();
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
function botTabActions(botId) {
  const name = esc(BOT_NAMES[botId]);
  return `
    <div class="tab-actions">
      <button type="button" class="tab-action rejoin" title="Cho ${name} vào lại kênh" aria-label="Cho ${name} vào lại kênh" onclick="event.stopPropagation();doAction(${botId},'rejoin')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14 17l-5-5 5-5"></path><path d="M9 12h12"></path><path d="M3 5v14a2 2 0 0 0 2 2h6"></path><path d="M11 3H5a2 2 0 0 0-2 2"></path>
        </svg>
        <span>Vào</span>
      </button>
      <button type="button" class="tab-action leave" title="Cho ${name} rời kênh" aria-label="Cho ${name} rời kênh" onclick="event.stopPropagation();doAction(${botId},'leave')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M10 17l5-5-5-5"></path><path d="M15 12H3"></path><path d="M21 19V5a2 2 0 0 0-2-2h-6"></path><path d="M13 21h6a2 2 0 0 0 2-2"></path>
        </svg>
        <span>Rời</span>
      </button>
    </div>`;
}

function renderBotTabs() {
  const tabs = document.querySelector('.tabs');
  tabs.innerHTML = BOT_IDS.map((botId) => `
    <div class="tab ${botId === activeBot ? 'active' : ''}" id="tab${botId}" data-bot="${botId}" onclick="switchBot(${botId})">
      <span class="ribbon">${esc(botRoleTag(botId))}</span>
      <div class="avatar" data-fallback="${esc(botAvatarFallback(botId))}">${botAvatarHtml(botId)}</div>
      <div class="meta"><div class="name-row"><div class="name">${esc(BOT_NAMES[botId])}</div>${botTabActions(botId)}</div><div class="role">Kênh ${esc(BOT_NAMES[botId])}</div></div>
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

/* ---------------- Scope chung / riêng ---------------- */
function refreshSharedDraft() {
  // Lấy cấu hình chung làm chuẩn từ Bot 1 (hoặc draft hiện tại của Bot 1).
  const base = drafts[1] || configs[1] || {};
  sharedDraft = {
    caller_role_ids: [...(base.caller_role_ids || [])],
    caller_user_ids: [...(base.caller_user_ids || [])],
    muted_user_ids: [...(base.muted_user_ids || [])],
    blocked_role_ids: [...(base.blocked_role_ids || [])]
  };
}

function syncSharedToDrafts() {
  for (const botId of BOT_IDS) {
    if (!drafts[botId]) drafts[botId] = { ...(configs[botId] || defaultConfig(botId)) };
    for (const field of SHARED_FIELDS) {
      drafts[botId][field] = [...(sharedDraft[field] || [])];
    }
  }
}

// Cả 3 bot đang có cấu hình chung giống nhau chưa? Dùng để cảnh báo nhẹ ở chế độ chung.
function botsShareSameConfig() {
  return SHARED_FIELDS.every((field) => {
    const ref = JSON.stringify([...((drafts[1] || {})[field] || [])].map(String).sort());
    return BOT_IDS.every((botId) => JSON.stringify([...((drafts[botId] || {})[field] || [])].map(String).sort()) === ref);
  });
}

function applyScopeUI() {
  document.querySelectorAll('#scopeSwitch button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.scope === settingScope);
  });
  document.querySelector('.tabs')?.classList.toggle('hidden', settingScope === 'shared');
}

function setSettingScope(scope) {
  const next = scope === 'perbot' ? 'perbot' : 'shared';
  if (next === settingScope) return;
  if (next === 'perbot') {
    // Vào chế độ riêng: đồng bộ cấu hình chung xuống cả 3 bot làm điểm khởi đầu.
    syncSharedToDrafts();
  } else {
    // Vào chế độ chung: lấy cấu hình Bot 1 làm chuẩn.
    refreshSharedDraft();
  }
  settingScope = next;
  localStorage.setItem('lg-voice-scope', settingScope);
  applyScopeUI();
  renderPane(activeBot);
}
window.setSettingScope = setSettingScope;

function initSettingScope() {
  settingScope = localStorage.getItem('lg-voice-scope') === 'perbot' ? 'perbot' : 'shared';
  refreshSharedDraft();
  applyScopeUI();
}

function updateOnlineSummary() {
  const on = BOT_IDS.filter((id) => statuses[id]?.discord_connected === true).length;
  const el = document.getElementById('onlineSummary');
  if (el) el.innerHTML = `<span class="dot"></span>${on}/${BOT_IDS.length} online`;
}

function updateTabDots() {
  for (const botId of BOT_IDS) {
    const online = statuses[botId]?.discord_connected === true;
    const tab = document.getElementById('tab' + botId);
    if (!tab) continue;
    updateTabAvatar(botId, tab);
    tab.classList.toggle('online', online);
    const lbl = tab.querySelector('.lbl');
    if (lbl) lbl.textContent = online ? 'online' : 'offline';
  }
  updateOnlineSummary();
}

function updateTabAvatar(botId, tab = null) {
  const root = tab || document.getElementById('tab' + botId);
  const avatar = root?.querySelector('.avatar');
  if (!avatar) return;

  const url = botAvatarUrl(botId);
  const img = avatar.querySelector('img');
  if (url) {
    if (!img || img.getAttribute('src') !== url) avatar.innerHTML = botAvatarHtml(botId);
    return;
  }

  if (!avatar.textContent.trim()) avatar.textContent = botAvatarFallback(botId);
}

function fixedRoleChecklist(key, selected) {
  const lookup = roleLookup();
  const rows = FIXED_ROLES.map((def) => {
    const role = lookup[def.key];
    const disabled = role ? '' : 'disabled';
    const checked = role && selected.includes(String(role.id)) ? 'checked' : '';
    const missing = role ? '' : '<span class="missing">chưa thấy role</span>';
    return `<label class="fixed-check role-check ${disabled}">
      <input type="checkbox" data-key="${key}" value="${esc(role?.id || '')}" ${checked} ${disabled}>
      <span class="role-name">${esc(def.label)}</span>${missing}
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

function channelName(channelId, fallback = '—') {
  const channel = guildMeta.voice_channels.find((c) => String(c.id) === String(channelId || ''));
  return channel?.name || fallback;
}

function channelSelectHtml(selected, attrs = '') {
  return `<select ${attrs}>${channelOptions(selected)}</select>`;
}

function findBangChienChannelId() {
  const wanted = ['bang chien', 'bangchien'];
  const channel = guildMeta.voice_channels.find((c) => wanted.some((w) => normalizeText(c.name).includes(w)));
  return channel?.id || '';
}

function isKnownVoiceChannel(channelId) {
  const id = String(channelId || '').trim();
  if (!id) return false;
  if (BOT_IDS.some((botId) => String(statuses[botId]?.voice_channel_id || '') === id)) return true;
  if (!guildMeta.voice_channels.length) return true;
  return guildMeta.voice_channels.some((c) => String(c.id) === id);
}

function preferredBotVoiceChannelId(botId) {
  return String(configs[botId]?.voice_channel_id || statuses[botId]?.voice_channel_id || '').trim();
}

function resolveQuickAnchorId() {
  const candidates = [
    statuses[1]?.voice_channel_id,
    configs[1]?.voice_channel_id,
    findBangChienChannelId(),
    configs[1]?.create_anchor_channel_id
  ];
  return candidates.map((id) => String(id || '').trim()).find(isKnownVoiceChannel) || '';
}

function refreshQuickAnchorId() {
  const next = resolveQuickAnchorId();
  const changed = String(quickAnchorId || '') !== next;
  quickAnchorId = next;
  if (!quickAnchorId && quickSetupMode !== 'manual') quickSetupMode = 'manual';
  return changed;
}

function setQuickSetupMode(mode) {
  quickSetupMode = mode === 'manual' ? 'manual' : 'auto';
  renderPane(activeBot);
}
window.setQuickSetupMode = setQuickSetupMode;

function setManualChannel(botId, channelId) {
  manualChannelIds[botId] = String(channelId || '');
  renderPane(activeBot);
}
window.setManualChannel = setManualChannel;

function manualChannelList() {
  return BOT_IDS.map((botId) => String(manualChannelIds[botId] || '').trim());
}

function manualSetupError() {
  const ids = manualChannelList();
  if (ids.some((id) => !id)) return 'Chọn đủ 3 kênh voice cho 3 bot.';
  if (new Set(ids).size !== ids.length) return 'Mỗi bot phải ở một kênh khác nhau.';
  return '';
}

function quickSetupError() {
  if (quickSetupMode === 'manual') return manualSetupError();
  return quickAnchorId ? '' : 'Không tìm thấy phòng BANG CHIẾN, hãy chọn thủ công đủ 3 kênh.';
}

function botMiniAvatar(botId) {
  return `<span class="room-avatar" data-fallback="${esc(botAvatarFallback(botId))}">${botAvatarHtml(botId)}</span>`;
}

function discordRoomPreview({ name, botId, muted = false, badge = '', tone = 'default', selectHtml = '' }) {
  return `
    <div class="discord-room ${muted ? 'muted' : ''}">
      <div class="room-main">
        <span class="room-icon">⌁</span>
        <span class="room-name">${esc(name)}</span>
        ${badge ? `<span class="room-badge" data-tone="${esc(tone)}">${esc(badge)}</span>` : ''}
      </div>
      <div class="room-bot">
        ${botMiniAvatar(botId)}
        <span>${esc(BOT_NAMES[botId])}</span>
      </div>
      ${selectHtml ? `<div class="room-select">${selectHtml}</div>` : ''}
    </div>`;
}

function autoRoomMap() {
  const bot1Status = statuses[1] || {};
  const bot1InAnchor = quickAnchorId && String(bot1Status.voice_channel_id || '') === String(quickAnchorId);
  const anchorName = quickAnchorId
    ? channelName(quickAnchorId, (bot1InAnchor && bot1Status.voice_channel_name) || QUICK_AUTO_ROOM_NAMES[1])
    : 'BANG CHIẾN';
  const anchorBadge = bot1InAnchor ? 'đang ở voice' : (quickAnchorId ? 'đã nhận' : 'chưa tìm thấy');
  return `
    <div class="discord-map">
      <div class="discord-category">VOICE</div>
      ${discordRoomPreview({ name: anchorName, botId: 1, muted: !quickAnchorId, badge: anchorBadge, tone: quickAnchorId ? 'default' : 'empty' })}
      ${discordRoomPreview({ name: QUICK_AUTO_ROOM_NAMES[2], botId: 2, badge: 'sẽ tạo', tone: 'create' })}
      ${discordRoomPreview({ name: QUICK_AUTO_ROOM_NAMES[3], botId: 3, badge: 'sẽ tạo', tone: 'create' })}
    </div>`;
}

function manualRoomMap() {
  return `
    <div class="discord-map manual">
      <div class="discord-category">VOICE · CHỌN THỦ CÔNG</div>
      ${BOT_IDS.map((botId) => {
        const selectedId = manualChannelIds[botId];
        return discordRoomPreview({
          name: channelName(selectedId, 'Chưa chọn kênh'),
          botId,
          muted: !selectedId,
          badge: selectedId ? '' : 'chưa chọn',
          tone: selectedId ? 'default' : 'empty',
          selectHtml: channelSelectHtml(selectedId, `onchange="setManualChannel(${botId},this.value)" aria-label="Chọn kênh cho ${esc(BOT_NAMES[botId])}"`)
        });
      }).join('')}
    </div>`;
}

function masterHeroHtml() {
  const setupError = quickSetupError();
  const disableOn = !masterState.enabled && !!setupError;
  const on = masterState.enabled === true;
  const totalPeople = BOT_IDS.reduce((sum, botId) => sum + Number(statuses[botId]?.channel_member_count || 0), 0);
  return `
    <div class="section master-hero ${on ? 'is-on' : 'is-off'}">
      <div class="master-hero-top">
        <div class="master-hero-info">
          <div class="master-hero-title">
            <span class="master-ico">${on ? '🔊' : '🔈'}</span>Bật/tắt tổng
            <span class="master-badge ${on ? 'on' : 'off'}">${on ? 'Đang bật' : 'Đang tắt'}</span>
          </div>
          <div class="hint">${quickSetupMode === 'manual' ? 'Bật: 3 bot vào 3 kênh đã chọn, không tạo room mới.' : 'Bật: Bot 1 vào Bang Chiến, Bot 2/3 tạo phòng relay bên dưới và vào kênh.'}</div>
        </div>
        <label class="switch switch-lg" title="${disableOn ? esc(setupError) : ''}"><input type="checkbox" ${on ? 'checked' : ''} ${disableOn ? 'disabled' : ''} onchange="toggleMaster(this.checked)"><span class="slider"></span><span class="lever-lbl lever-on">ON</span><span class="lever-lbl lever-off">OFF</span></label>
      </div>
      <div class="master-hero-note hint relay-lock-hint">⚠ Khi bật Relay, lệnh ?join sẽ không hoạt động. Tính năng voice của bot cũng sẽ không hoạt động.</div>
      ${disableOn ? `<div class="quick-warning">${esc(setupError)}</div>` : ''}
      ${totalPeople ? `<div class="hint master-hero-people">Hiện có ${totalPeople} người thật trong các kênh relay. Khi tắt tổng web sẽ hỏi trước nếu cần xóa phòng.</div>` : ''}
    </div>`;
}

function quickSetupHtml() {
  const setupError = quickSetupError();
  return `
    <div class="section quick-panel">
      <h3>⚡ Chọn kênh relay</h3>
      <div class="quick-mode" role="tablist" aria-label="Chế độ chọn room">
        <button type="button" class="${quickSetupMode === 'auto' ? 'active' : ''}" onclick="setQuickSetupMode('auto')">Tự động</button>
        <button type="button" class="${quickSetupMode === 'manual' ? 'active' : ''}" onclick="setQuickSetupMode('manual')">Chọn thủ công</button>
      </div>
      ${quickSetupMode === 'manual' ? manualRoomMap() : autoRoomMap()}
      ${setupError ? `<div class="quick-warning">${esc(setupError)}</div>` : ''}
    </div>`;
}

/* ---------------- Panel chỉnh độ trễ chống giật (jitter buffer) ---------------- */
const JITTER_MIN = 60;
const JITTER_MAX = 1200;
const JITTER_DEFAULT = 400;
const JITTER_PRESETS = [
  { ms: 150, label: 'Nhanh nhất', desc: 'Cùng máy / mạng LAN' },
  { ms: 250, label: 'Nhanh', desc: 'VPS cùng khu vực' },
  { ms: 400, label: 'Cân bằng', desc: 'Khuyên dùng' },
  { ms: 600, label: 'Ổn định', desc: 'Mạng hơi chập chờn' },
  { ms: 800, label: 'Chắc chắn', desc: 'Mạng yếu' },
  { ms: 1000, label: 'Chống giật tối đa', desc: 'Mạng rất tệ' }
];

function currentJitterMs() {
  for (const botId of BOT_IDS) {
    const v = Number(configs[botId]?.jitter_buffer_ms);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return JITTER_DEFAULT;
}

// Mô tả cảm nhận theo mức delay để người dùng dễ hình dung.
function jitterFeel(ms) {
  if (ms <= 200) return { tone: 'fast', tag: 'Độ trễ rất thấp', note: 'Nghe gần như tức thì, nhưng chỉ mượt khi mạng cực ổn (cùng máy/LAN). Mạng lag một chút là dễ giật.' };
  if (ms <= 350) return { tone: 'fast', tag: 'Độ trễ thấp', note: 'Phản hồi nhanh, hợp VPS cùng khu vực. Vẫn có thể giật nhẹ khi mạng phập phù.' };
  if (ms <= 550) return { tone: 'balance', tag: 'Cân bằng', note: 'Trễ khoảng nửa giây, đổi lại rất mượt trong đa số trường hợp. Đây là mức khuyên dùng.' };
  if (ms <= 800) return { tone: 'stable', tag: 'Ưu tiên mượt', note: 'Trễ thấy rõ nhưng chịu được mạng chập chờn, hiếm khi hụt tiếng.' };
  return { tone: 'max', tag: 'Chống giật tối đa', note: 'Trễ khá lâu (gần như bộ đàm), dùng khi mạng rất tệ mà vẫn cần nghe đủ tiếng.' };
}

function jitterPresetButtons(current) {
  return JITTER_PRESETS.map((p) => {
    const active = Math.abs(current - p.ms) <= 10 ? 'active' : '';
    return `<button type="button" class="jitter-preset ${active}" onclick="setJitterDelay(${p.ms})" title="${esc(p.desc)}">
      <b>${p.ms}ms</b><span>${esc(p.label)}</span>
    </button>`;
  }).join('');
}

function delayPanelHtml() {
  const current = currentJitterMs();
  const feel = jitterFeel(current);
  const pct = Math.round(((current - JITTER_MIN) / (JITTER_MAX - JITTER_MIN)) * 100);
  return `
    <div class="section delay-panel">
      <h3>🎚️ Độ trễ chống giật (delay)
        <button type="button" class="delay-help-toggle" onclick="toggleDelayHelp()" aria-label="Giải thích delay">❔ Delay là gì?</button>
      </h3>

      <div class="delay-live">
        <div class="delay-value"><span id="jitterValue">${current}</span><small>ms</small></div>
        <div class="delay-feel" id="jitterFeel" data-tone="${feel.tone}">
          <b>${esc(feel.tag)}</b>
          <span id="jitterFeelNote">${esc(feel.note)}</span>
        </div>
      </div>

      <div class="delay-slider-wrap">
        <span class="delay-end">Nhanh<br><small>${JITTER_MIN}ms</small></span>
        <input type="range" id="jitterRange" class="delay-slider" min="${JITTER_MIN}" max="${JITTER_MAX}" step="10"
          value="${current}" style="--fill:${pct}%"
          oninput="onJitterInput(this)" aria-label="Độ trễ chống giật (ms)">
        <span class="delay-end">Mượt<br><small>${JITTER_MAX}ms</small></span>
      </div>

      <div class="jitter-presets">${jitterPresetButtons(current)}</div>

      <div class="delay-actions">
        <button class="btn gold small" onclick="applyJitterDelay()">Áp dụng cho cả 3 bot</button>
        <span class="hint" id="jitterApplyHint">Áp dụng riêng, không cần điền role — bot nhận trong ~10 giây.</span>
      </div>

      <div class="delay-explain collapsed" id="delayExplain">
        <div class="delay-explain-title">Delay này là gì?</div>
        <p>Khi bạn nói, tiếng được cắt thành nhiều mẩu nhỏ (mỗi mẩu 20ms) rồi gửi qua mạng sang bot khác. Mạng không bao giờ giao đều tăm tắp: có mẩu tới sớm, có mẩu tới trễ. Nếu bot phát ra ngay khi vừa nhận, chỉ cần một mẩu tới trễ là tiếng bị <b>hụt → nghe giật, rè, ngắt quãng</b>.</p>
        <p><b>Delay</b> là khoảng thời gian bot <b>gom sẵn tiếng vào bộ đệm</b> trước khi bắt đầu phát. Ví dụ delay 400ms nghĩa là bot chứa sẵn 0.4 giây tiếng; nếu mạng trục trặc trong 0.4 giây đó thì vẫn có cái để phát liên tục, người nghe không thấy giật.</p>
        <ul class="delay-list">
          <li><b>Delay thấp</b> (nhỏ) → nghe nhanh, gần thời gian thực, nhưng <b>dễ giật</b> khi mạng yếu.</li>
          <li><b>Delay cao</b> (lớn) → nghe <b>mượt, liền mạch</b> hơn, đổi lại <b>trễ</b> hơn (nói xong một lúc bên kia mới nghe).</li>
        </ul>
        <div class="delay-explain-title">Nên chọn bao nhiêu?</div>
        <ul class="delay-list">
          <li>3 bot chạy <b>cùng một máy / mạng LAN</b>: 150–250ms là đủ mượt.</li>
          <li>Chạy trên <b>VPS cùng khu vực</b> (vd cùng Singapore): 300–450ms.</li>
          <li>Mạng <b>hay chập chờn</b> hoặc bot ở khác vùng: 600–800ms.</li>
          <li>Vẫn còn giật ở mức cao: tăng dần từng nấc 100ms tới khi hết, đừng nhảy vọt.</li>
        </ul>
        <p class="delay-note">Mẹo: cứ để <b>400ms (Cân bằng)</b> trước. Nếu thấy giật thì kéo lên; nếu thấy nói chuyện bị "vọng/chậm" khó chịu thì kéo xuống. Chỉnh xong bấm <b>Áp dụng</b>, nghe thử một lúc rồi tinh chỉnh tiếp.</p>
      </div>
    </div>`;
}

function onJitterInput(el) {
  const ms = Number(el.value) || JITTER_DEFAULT;
  const pct = Math.round(((ms - JITTER_MIN) / (JITTER_MAX - JITTER_MIN)) * 100);
  el.style.setProperty('--fill', pct + '%');
  const valEl = document.getElementById('jitterValue');
  if (valEl) valEl.textContent = ms;
  const feel = jitterFeel(ms);
  const feelEl = document.getElementById('jitterFeel');
  const noteEl = document.getElementById('jitterFeelNote');
  if (feelEl) {
    feelEl.dataset.tone = feel.tone;
    const b = feelEl.querySelector('b');
    if (b) b.textContent = feel.tag;
  }
  if (noteEl) noteEl.textContent = feel.note;
  document.querySelectorAll('.jitter-preset').forEach((btn) => {
    btn.classList.remove('active');
  });
}
window.onJitterInput = onJitterInput;

function setJitterDelay(ms) {
  const range = document.getElementById('jitterRange');
  if (range) {
    range.value = ms;
    onJitterInput(range);
  }
  document.querySelectorAll('.jitter-preset').forEach((btn) => {
    const presetMs = Number(btn.querySelector('b')?.textContent);
    btn.classList.toggle('active', Math.abs(presetMs - ms) <= 10);
  });
}
window.setJitterDelay = setJitterDelay;

async function applyJitterDelay() {
  const range = document.getElementById('jitterRange');
  const ms = Math.min(JITTER_MAX, Math.max(JITTER_MIN, Number(range?.value) || JITTER_DEFAULT));
  const hint = document.getElementById('jitterApplyHint');
  if (hint) hint.textContent = 'Đang áp dụng...';
  try {
    // Lưu riêng độ trễ cho từng bot (không cần điền role, không đụng cấu hình khác).
    for (const botId of BOT_IDS) {
      await api({ action: 'saveConfig', guild_id: GUILD_ID, bot_id: botId, payload: { jitter_buffer_ms: ms } });
      if (configs[botId]) configs[botId].jitter_buffer_ms = ms;
      if (drafts[botId]) drafts[botId].jitter_buffer_ms = ms;
    }
    if (hint) hint.textContent = 'Đã áp dụng, bot sẽ đổi trong ~10 giây.';
    toast('Đã đặt độ trễ ' + ms + 'ms cho cả 3 bot.');
  } catch (e) {
    if (hint) hint.textContent = '';
    toast('Đặt độ trễ thất bại: ' + e.message, true);
  }
}
window.applyJitterDelay = applyJitterDelay;

function toggleDelayHelp() {
  document.getElementById('delayExplain')?.classList.toggle('collapsed');
}
window.toggleDelayHelp = toggleDelayHelp;

/* ---------------- Nhường người nói (speaker release) ---------------- */
const YIELD_MODES = [
  { ms: 0, key: 'off', label: 'Tắt', desc: 'Tắt chờ nhả mic, đổi người gần như ngay khi có tiếng mới' },
  { ms: 900, key: 'hold', label: 'Giữ mic', desc: 'Người đang nói giữ chắc, khó bị chen ngang' },
  { ms: 500, key: 'balance', label: 'Cân bằng', desc: 'Mặc định — nhả mic sau ~0.5s im' },
  { ms: 200, key: 'quick', label: 'Nhường nhanh', desc: 'Thay phiên nhanh, dễ cướp lời' }
];

function currentReleaseMs() {
  for (const botId of BOT_IDS) {
    const v = Number(configs[botId]?.speaker_release_ms);
    if (Number.isFinite(v) && v >= 0) return v;
  }
  return 500;
}

function yieldModeOf(ms) {
  if (Number(ms) === 0) return YIELD_MODES[0];
  // Chọn mode gần nhất theo ms.
  let best = YIELD_MODES[1];
  let bestDiff = Infinity;
  for (const m of YIELD_MODES) {
    const diff = Math.abs(m.ms - ms);
    if (diff < bestDiff) { bestDiff = diff; best = m; }
  }
  return best;
}

function yieldPanelHtml() {
  const current = currentReleaseMs();
  const activeMode = yieldModeOf(current);
  const buttons = YIELD_MODES.map((m) => `
    <button type="button" class="yield-opt ${m.key === activeMode.key ? 'active' : ''}" data-ms="${m.ms}" onclick="setSpeakerYield(${m.ms})" title="${esc(m.desc)}">
      <b>${esc(m.label)}</b><span>${m.ms}ms</span>
    </button>`).join('');
  return `
    <div class="section yield-panel">
      <h3>🎙️ Nhường người nói
        <span class="yield-hint-inline" id="yieldHint">${esc(activeMode.desc)}</span>
      </h3>
      <div class="yield-opts">${buttons}</div>
      <div class="hint">Khi nhiều người cùng nói, bot chỉ phát tiếng 1 người mỗi lúc. Đây là thời gian người đang nói ngừng thì mới nhả mic cho người khác; Tắt = đổi người gần như ngay khi có tiếng mới. Áp dụng ngay cho cả 3 bot.</div>
    </div>`;
}

async function setSpeakerYield(ms) {
  const raw = Number(ms);
  const value = Number.isFinite(raw) && raw === 0 ? 0 : Math.min(3000, Math.max(100, raw || 500));
  // Cập nhật UI ngay.
  document.querySelectorAll('.yield-opt').forEach((btn) => {
    const btnMs = Number(btn.dataset.ms);
    btn.classList.toggle('active', btnMs === 0 ? value === 0 : Math.abs(btnMs - value) <= 10);
  });
  const hintEl = document.getElementById('yieldHint');
  if (hintEl) hintEl.textContent = yieldModeOf(value).desc;
  try {
    for (const botId of BOT_IDS) {
      await api({ action: 'saveConfig', guild_id: GUILD_ID, bot_id: botId, payload: { speaker_release_ms: value } });
      if (configs[botId]) configs[botId].speaker_release_ms = value;
      if (drafts[botId]) drafts[botId].speaker_release_ms = value;
    }
    toast(value === 0 ? 'Đã tắt nhường người nói cho cả 3 bot.' : 'Đã đặt nhường người nói: ' + value + 'ms cho cả 3 bot.');
  } catch (e) {
    toast('Đặt nhường người nói thất bại: ' + e.message, true);
  }
}
window.setSpeakerYield = setSpeakerYield;

function targetChecklist(botId, selected) {
  const rows = BOT_IDS.filter((id) => id !== botId).map((id) => {
    const checked = selected.includes(String(id)) ? 'checked' : '';
    return `<label class="fixed-check"><input type="checkbox" data-key="relay_targets" value="${id}" ${checked}> <span>${esc(BOT_NAMES[id])}</span></label>`;
  }).join('');
  return `<div class="fixed-checks">${rows}</div>`;
}

function currentVoiceRoomCard(botId) {
  const configuredId = drafts[botId]?.voice_channel_id || '';
  const statusName = statuses[botId]?.voice_channel_name || '';
  const name = configuredId ? channelName(configuredId, statusName || configuredId) : (statusName || 'Chưa gán kênh');
  const badge = statuses[botId]?.voice_channel_id ? 'đang ở voice' : (configuredId ? 'đã cấu hình' : '');
  return `
    <div class="current-room">
      ${discordRoomPreview({ name, botId, muted: !configuredId && !statusName, badge })}
    </div>
    <div class="hint">Đổi phòng ở phần Setup nhanh phía trên. Chọn thủ công chỉ bật được khi đủ cả 3 kênh.</div>`;
}

function renderPane(botId) {
  applyScopeUI();
  if (settingScope === 'shared') { renderSharedPane(); return; }

  const d = drafts[botId];
  const host = document.getElementById('paneHost');

  host.innerHTML = `
    <div class="editor-grid">
      <div class="vcol vcol-left">
        <div class="section status-section" id="statusSection">${statusRailHtml()}</div>
        ${quickSetupHtml()}
      </div>
      <div class="vcol vcol-main">
        ${masterHeroHtml()}
        <div class="section speaker-section">
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
        </div>
        <div class="err-note" id="errNote"></div>
      </div>
      <div class="vcol">
        ${delayPanelHtml()}
        ${yieldPanelHtml()}
        <div class="section block-danger">
          <h3>⛔ Blocked role</h3>
          <div class="field">
            <label>Blocked role</label>
            ${fixedRoleChecklist('blocked_role_ids', d.blocked_role_ids)}
          </div>
        </div>
      </div>
    </div>`;

  bindPane(botId);
  updateTabDots();
}

/* ---------------- Chế độ chung 3 bot ---------------- */
function sharedMemberChips(key) {
  const ids = sharedDraft[key] || [];
  if (!ids.length) return '<div class="hint">Chưa chọn ai.</div>';
  const rows = ids.map((id) => {
    const row = memberRows.find((m) => String(m.discord_id) === String(id));
    return `<span class="member-chip">${esc(memberName(row) || id)}<button type="button" onclick="removeSharedMemberPick('${key}','${esc(id)}')">×</button></span>`;
  }).join('');
  return `<div class="member-chips">${rows}</div>`;
}

function statusRailHtml() {
  const clickable = settingScope === 'perbot';
  const cards = BOT_IDS.map((botId) => {
    const s = statuses[botId];
    const online = s?.discord_connected === true;
    const relay = s?.relay_enabled === true;
    const active = clickable && botId === activeBot ? 'active' : '';
    const attrs = clickable ? `role="button" tabindex="0" onclick="switchBot(${botId})"` : '';
    return `
      <div class="rail-card ${online ? 'online' : ''} ${active}" ${attrs}>
        <div class="rail-head">${botMiniAvatar(botId)}<span class="rail-name">${esc(BOT_NAMES[botId])}</span><span class="pill ${online ? 'ok' : 'off'}">${online ? 'ONLINE' : 'OFFLINE'}</span></div>
        <div class="rail-row"><span>Kênh voice</span><b>${esc(s?.voice_channel_name || s?.voice_channel_id || '—')}</b></div>
        <div class="rail-row"><span>Relay</span><b class="${relay ? 'ok' : 'off'}">${relay ? 'Đang bật' : 'Tắt'}</b></div>
        <div class="rail-row"><span>Người trong kênh</span><b>${Number(s?.channel_member_count || 0)}</b></div>
        ${s?.last_error ? `<div class="rail-err">Lỗi gần nhất: ${esc(s.last_error)}</div>` : ''}
      </div>`;
  }).join('');
  return `<h3>📡 Trạng thái 3 bot</h3><div class="status-rail">${cards}</div>`;
}

function renderSharedPane() {
  const host = document.getElementById('paneHost');
  const diffWarn = !botsShareSameConfig()
    ? '<div class="scope-banner"><span class="ico">⚠️</span><span>3 bot đang có cấu hình khác nhau. Lưu ở chế độ chung sẽ đồng bộ cả 3 bot theo cấu hình bên dưới.</span></div>'
    : '';

  host.innerHTML = `
    <div class="editor-grid">
      <div class="vcol vcol-left">
        <div class="section status-section" id="statusSection">${statusRailHtml()}</div>
        ${quickSetupHtml()}
      </div>
      <div class="vcol vcol-main">
        ${masterHeroHtml()}
        ${diffWarn}
        <div class="section speaker-section">
          <h3>🛡️ Ai được nói</h3>
          <div class="field">
            <label>Role được nói</label>
            ${fixedRoleChecklist('caller_role_ids', sharedDraft.caller_role_ids)}
          </div>
          <div class="field">
            <label>Thêm người được nói riêng</label>
            ${sharedMemberChips('caller_user_ids')}
            <button class="btn ghost small" onclick="openSharedMemberPicker('caller_user_ids')">+ Thêm người</button>
          </div>
          <div class="field">
            <label>Mute người cụ thể</label>
            ${sharedMemberChips('muted_user_ids')}
            <button class="btn ghost small" onclick="openSharedMemberPicker('muted_user_ids')">+ Chọn người mute</button>
          </div>
        </div>
        <div class="err-note" id="errNote"></div>
      </div>
      <div class="vcol">
        ${delayPanelHtml()}
        ${yieldPanelHtml()}
        <div class="section block-danger">
          <h3>⛔ Blocked role</h3>
          <div class="field">
            <label>Blocked role</label>
            ${fixedRoleChecklist('blocked_role_ids', sharedDraft.blocked_role_ids)}
          </div>
        </div>
      </div>
    </div>`;

  bindSharedPane();
  updateTabDots();
}

function bindSharedPane() {
  const host = document.getElementById('paneHost');
  host.querySelectorAll('input[data-key]').forEach((el) => {
    el.addEventListener('change', () => {
      const key = el.dataset.key;
      const set = new Set((sharedDraft[key] || []).map(String));
      if (el.checked) set.add(el.value); else set.delete(el.value);
      sharedDraft[key] = [...set].filter(Boolean);
    });
  });
}

function removeSharedMemberPick(key, id) {
  sharedDraft[key] = (sharedDraft[key] || []).filter((x) => String(x) !== String(id));
  renderSharedPane();
}
window.removeSharedMemberPick = removeSharedMemberPick;

function openSharedMemberPicker(key) {
  pickerState = { scope: 'shared', key };
  ensurePicker();
  document.getElementById('pickerTitle').textContent = key === 'muted_user_ids' ? 'Mute người cụ thể' : 'Thêm người được nói';
  document.getElementById('memberSearch').value = '';
  document.getElementById('memberPicker').classList.remove('hidden');
  renderMemberResults();
  setTimeout(() => document.getElementById('memberSearch')?.focus(), 0);
}
window.openSharedMemberPicker = openSharedMemberPicker;

function sw(field, on, disabled = false) {
  return `<label class="switch"><input type="checkbox" data-field="${field}" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="slider"></span></label>`;
}

function renderStatus() {
  const sec = document.getElementById('statusSection');
  if (!sec) return;
  sec.innerHTML = statusRailHtml();
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
  const container = pickerState.scope === 'shared' ? sharedDraft : drafts[pickerState.botId];
  const current = new Set((container[pickerState.key] || []).map(String));
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
  const container = pickerState.scope === 'shared' ? sharedDraft : drafts[pickerState.botId];
  const list = container[pickerState.key] || [];
  if (!list.includes(id)) list.push(id);
  container[pickerState.key] = list;
  if (pickerState.scope === 'shared') renderSharedPane();
  else renderPane(pickerState.botId);
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
  if (!(d.caller_role_ids || []).length && !(d.caller_user_ids || []).length) return 'Chọn ít nhất 1 role hoặc 1 người được nói.';
  return '';
}

function validateAllDrafts() {
  if (!masterState.enabled) return null;
  for (const botId of BOT_IDS) {
    const err = validateDraft(drafts[botId] || {});
    if (err) return { botId, err };
  }
  return null;
}

function effectiveDraftForSave(botId) {
  const draft = { ...(drafts[botId] || {}) };
  if (!masterState.enabled) {
    draft.relay_enabled = false;
    draft.auto_join = false;
  }
  return draft;
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

async function saveAllConfigs() {
  if (settingScope === 'shared') syncSharedToDrafts();
  const invalid = validateAllDrafts();
  const note = document.getElementById('errNote');
  if (invalid) {
    if (settingScope === 'shared') {
      const sharedNote = document.getElementById('errNote');
      if (sharedNote) sharedNote.textContent = invalid.err;
      toast(invalid.err, true);
      return;
    }
    switchBot(invalid.botId);
    const activeNote = document.getElementById('errNote');
    if (activeNote) activeNote.textContent = invalid.err;
    toast(BOT_NAMES[invalid.botId] + ': ' + invalid.err, true);
    return;
  }
  if (note) note.textContent = '';
  try {
    const payload = {
      configs: Object.fromEntries(BOT_IDS.map((botId) => [String(botId), effectiveDraftForSave(botId)]))
    };
    const json = await api({ action: 'saveAllConfigs', guild_id: GUILD_ID, payload });
    const rows = Array.isArray(json.configs) ? json.configs : [];
    for (const botId of BOT_IDS) {
      const row = rows.find((item) => Number(item.bot_id) === botId);
      if (row) configs[botId] = { ...defaultConfig(botId), ...normalizeRow(row) };
      drafts[botId] = { ...configs[botId] };
    }
    refreshSharedDraft();
    renderPane(activeBot);
    toast(settingScope === 'shared' ? 'Đã lưu cấu hình chung cho cả 3 bot.' : 'Đã lưu cấu hình cả 3 bot.');
  } catch (e) {
    toast('Lưu tất cả thất bại: ' + e.message, true);
  }
}
window.saveAllConfigs = saveAllConfigs;

async function doAction(botId, action) {
  const message = action === 'rejoin'
    ? `Cho ${BOT_NAMES[botId]} vào lại kênh voice?`
    : `Cho ${BOT_NAMES[botId]} rời kênh voice?`;
  if (!window.confirm(message)) return;
  try {
    await api({ action, guild_id: GUILD_ID, bot_id: botId });
    toast(action === 'rejoin' ? 'Đã gửi lệnh vào lại kênh cho ' + BOT_NAMES[botId] + '.' : 'Đã gửi lệnh rời kênh cho ' + BOT_NAMES[botId] + '.');
  } catch (e) {
    toast('Thất bại: ' + e.message, true);
  }
}
window.doAction = doAction;

function confirmGlobalStopMode(people) {
  const count = Number(people || 0);
  if (count <= 0) return Promise.resolve('leave');

  return new Promise((resolve) => {
    const existing = document.getElementById('globalStopConfirm');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'globalStopConfirm';
    modal.className = 'modal stop-confirm-modal';
    modal.innerHTML = `
      <div class="modal-panel stop-confirm-panel" role="dialog" aria-modal="true" aria-labelledby="globalStopTitle">
        <div class="modal-head">
          <strong id="globalStopTitle">Tắt voice relay?</strong>
        </div>
        <div class="stop-confirm-warning">
          <b>Đang có ${count} người trong kênh relay.</b>
          <span>Thoát chỉ cho bot rời kênh, không xóa phòng. Xóa phòng relay tự tạo là thao tác nguy hiểm và cần xác nhận riêng.</span>
        </div>
        <label class="stop-confirm-check">
          <input type="checkbox" id="globalStopDeleteCheck">
          <span>Tôi hiểu thao tác này sẽ xóa phòng relay tự tạo.</span>
        </label>
        <div class="stop-confirm-actions">
          <button type="button" class="btn ghost" data-mode="cancel">Hủy</button>
          <button type="button" class="btn gold" data-mode="leave">Thoát</button>
          <button type="button" class="btn danger" data-mode="delete" disabled>OK - Xóa phòng</button>
        </div>
      </div>`;

    const cleanup = (mode) => {
      document.removeEventListener('keydown', onKeyDown);
      modal.remove();
      resolve(mode);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') cleanup(null);
    };

    modal.addEventListener('click', (event) => {
      if (event.target === modal) cleanup(null);
    });
    modal.querySelector('[data-mode="cancel"]').addEventListener('click', () => cleanup(null));
    modal.querySelector('[data-mode="leave"]').addEventListener('click', () => cleanup('leave'));
    modal.querySelector('[data-mode="delete"]').addEventListener('click', () => cleanup('delete'));
    modal.querySelector('#globalStopDeleteCheck').addEventListener('change', (event) => {
      modal.querySelector('[data-mode="delete"]').disabled = !event.target.checked;
    });

    document.addEventListener('keydown', onKeyDown);
    document.body.appendChild(modal);
    setTimeout(() => modal.querySelector('[data-mode="cancel"]')?.focus(), 0);
  });
}

function quickSetupPayload() {
  refreshQuickAnchorId();
  const policySource = settingScope === 'shared'
    ? sharedDraft
    : (drafts[1] || configs[1] || {});
  let callerRoleIds = [...(policySource.caller_role_ids || [])];
  const callerUserIds = [...(policySource.caller_user_ids || [])];
  if (!callerRoleIds.length && !callerUserIds.length) callerRoleIds = defaultCallerRoleIds();
  if (quickSetupMode === 'manual') {
    const err = manualSetupError();
    if (err) throw new Error(err);
    return {
      setup_mode: 'manual',
      manual_channel_ids: Object.fromEntries(BOT_IDS.map((botId) => [String(botId), manualChannelIds[botId]])),
      caller_role_ids: callerRoleIds,
      caller_user_ids: callerUserIds
    };
  }

  if (!quickAnchorId) throw new Error('Không tìm thấy phòng BANG CHIẾN, hãy chọn thủ công đủ 3 kênh.');
  return {
    setup_mode: 'auto',
    voice_channel_id: quickAnchorId,
    caller_role_ids: callerRoleIds,
    caller_user_ids: callerUserIds
  };
}

function applyLocalGlobalStop() {
  masterState = { ...masterState, enabled: false };
  for (const botId of BOT_IDS) {
    configs[botId] = { ...defaultConfig(botId), ...(configs[botId] || {}), relay_enabled: false, auto_join: false };
    drafts[botId] = { ...(drafts[botId] || configs[botId]), relay_enabled: false, auto_join: false };
    statuses[botId] = { ...(statuses[botId] || {}), relay_enabled: false };
  }
}

async function toggleMaster(on) {
  try {
    if (on) {
      masterState = { ...masterState, enabled: true };
      await api({ action: 'quickSetup', guild_id: GUILD_ID, payload: quickSetupPayload() });
      toast('Đã bật setup nhanh 3 bot.');
    } else {
      const people = BOT_IDS.reduce((sum, botId) => sum + Number(statuses[botId]?.channel_member_count || 0), 0);
      const mode = await confirmGlobalStopMode(people);
      if (!mode) {
        renderPane(activeBot);
        return;
      }
      await api({ action: 'globalStop', guild_id: GUILD_ID, payload: { mode } });
      applyLocalGlobalStop();
      renderPane(activeBot);
      toast('Đã tắt voice relay tổng.');
    }
    await Promise.all([loadMaster(), loadConfigs(), loadStatuses(), loadManagedChannels()]);
    for (const botId of BOT_IDS) drafts[botId] = { ...configs[botId] };
    manualChannelIds = Object.fromEntries(BOT_IDS.map((botId) => [botId, configs[botId]?.voice_channel_id || manualChannelIds[botId] || '']));
    if (!on) applyLocalGlobalStop();
    refreshSharedDraft();
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
