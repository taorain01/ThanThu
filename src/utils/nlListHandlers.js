// ============================================================
// NhacLabs List Handlers — Xử lý button, modal, select menu
// cho lệnh ?nllist (pagination, tìm kiếm, lọc, chọn key)
// ============================================================

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { listAllKeys } = require('./firebaseLicense');
const { CATEGORIES } = require('./firebaseLicense');

// Màu chủ đạo
const EMBED_COLOR = 0xFFD700; // Gold
const ERROR_COLOR = 0xFF4444;
const ITEMS_PER_PAGE = 10;

// ── Cache tạm key list (tránh gọi Firebase mỗi lần bấm button) ──
// Cache hết hạn sau 60 giây
let cachedKeys = null;
let cacheTime = 0;
const CACHE_TTL = 60_000; // 60s

async function getCachedKeys() {
  const now = Date.now();
  if (!cachedKeys || now - cacheTime > CACHE_TTL) {
    cachedKeys = await listAllKeys();
    cacheTime = now;
  }
  return cachedKeys;
}

// Xóa cache (khi cần refresh)
function invalidateCache() {
  cachedKeys = null;
  cacheTime = 0;
}

// ══════════════════════════════════════════════════════════════
// Lọc key theo bộ lọc
// ══════════════════════════════════════════════════════════════
function applyFilter(keys, filterType) {
  switch (filterType) {
    case 'activated':
      return keys.filter(k => k.machines && k.machines.length > 0);
    case 'not_activated':
      return keys.filter(k => !k.machines || k.machines.length === 0);
    case 'pro':
      return keys.filter(k => (k.tier || '').toUpperCase().startsWith('PRO'));
    case 'unl':
      return keys.filter(k => (k.tier || '').toUpperCase().startsWith('UNL'));
    case 'blocked':
      return keys.filter(k => k.blocked);
    case 'active':
      return keys.filter(k => !k.blocked);
    case 'cat_thuongmai':
      return keys.filter(k => (k.category || 'thuongmai') === 'thuongmai');
    case 'cat_mienphi':
      return keys.filter(k => k.category === 'mienphi');
    case 'cat_test':
      return keys.filter(k => k.category === 'test');
    default:
      return keys;
  }
}

// ══════════════════════════════════════════════════════════════
// Tìm kiếm key theo chuỗi (tìm trong key + tên máy)
// ══════════════════════════════════════════════════════════════
function searchKeys(keys, query) {
  const q = query.toUpperCase();
  return keys.filter(k => {
    // Tìm trong key string
    if ((k.key || '').toUpperCase().includes(q)) return true;
    // Tìm trong tên máy
    if (k.machines && k.machines.some(m =>
      (m.name || '').toUpperCase().includes(q) ||
      (m.hw_id || '').toUpperCase().includes(q)
    )) return true;
    return false;
  });
}

// ══════════════════════════════════════════════════════════════
// Tạo embed phân trang
// ══════════════════════════════════════════════════════════════
function buildListEmbed(keys, page, totalPages, filterLabel = '', searchQuery = '', totalAllKeys = 0) {
  const start = page * ITEMS_PER_PAGE;
  const end = Math.min(start + ITEMS_PER_PAGE, keys.length);
  const pageKeys = keys.slice(start, end);

  let title = `📋 Danh Sách Key (${keys.length})`;
  if (searchQuery) title = `🔍 Kết quả tìm "${searchQuery}" (${keys.length})`;
  if (filterLabel) title += ` — ${filterLabel}`;

  const lines = pageKeys.map((k, i) => {
    const idx = start + i + 1;
    const status = k.blocked ? '🔴' : '🟢';
    const tier = (k.tier || '?').toUpperCase().padEnd(3);
    const machineCount = k.machines ? k.machines.length : 0;

    // Danh sách máy ngắn gọn
    let machineInfo = '';
    if (machineCount > 0) {
      const names = k.machines.map(m => m.name || m.hw_id?.slice(0, 6) || '?').join(', ');
      // Giới hạn độ dài tên máy
      machineInfo = names.length > 30 ? ` 💻 ${names.slice(0, 27)}...` : ` 💻 ${names}`;
    }

    // Emoji danh mục
    const catKey = k.category || 'thuongmai';
    const catEmoji = CATEGORIES[catKey]?.emoji || '💰';

    return `**${idx}.** ${status} ${catEmoji} \`${k.key}\` — **${tier}** — ${machineCount} máy${machineInfo}`;
  });

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(title)
    .setDescription(lines.join('\n') || '*Không có key nào.*')
    .setFooter({ text: `Trang ${page + 1}/${totalPages || 1} • Tổng: ${totalAllKeys || keys.length} key • Bấm 📤 để lấy key` })
    .setTimestamp();

  return embed;
}

// ══════════════════════════════════════════════════════════════
// Tạo các button điều hướng
// ══════════════════════════════════════════════════════════════
function buildListButtons(page, totalPages, userId, filter = '', search = '') {
  // Encode state: nlkey_{action}.{page}.{userId}.{filter}.{search}
  // Dùng '.' làm delimiter để tránh xung đột với filter chứa '_' (cat_thuongmai)
  const state = `${page}.${userId}.${filter}.${search}`;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`nlkey_prev.${state}`)
      .setLabel('◀ Trước')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`nlkey_next.${state}`)
      .setLabel('Sau ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId(`nlkey_search.${state}`)
      .setEmoji('🔍')
      .setLabel('Tìm kiếm')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`nlkey_pick.${state}`)
      .setEmoji('📤')
      .setLabel('Chọn Key')
      .setStyle(ButtonStyle.Success),
  );

  // Row 2: Select menu lọc
  const row2 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`nlkey_filter_select_${userId}`)
      .setPlaceholder('🔎 Lọc theo...')
      .addOptions([
        { label: '📋 Tất cả', value: 'all', description: 'Hiện tất cả key' },
        { label: '💰 Thương mại', value: 'cat_thuongmai', description: 'Key bán thương mại' },
        { label: '🎁 Miễn phí', value: 'cat_mienphi', description: 'Key phát miễn phí' },
        { label: '🧪 Dùng thử', value: 'cat_test', description: 'Key test' },
        { label: '🟢 Đang hoạt động', value: 'active', description: 'Key chưa bị chặn' },
        { label: '🔴 Đã bị chặn', value: 'blocked', description: 'Key đã bị block' },
        { label: '✅ Đã kích hoạt', value: 'activated', description: 'Key có máy đăng ký' },
        { label: '⬜ Chưa kích hoạt', value: 'not_activated', description: 'Key chưa có máy nào' },
        { label: '⭐ PRO', value: 'pro', description: 'Chỉ key tier PRO' },
        { label: '👑 Ultimate', value: 'unl', description: 'Chỉ key tier UNL' },
      ]),
  );

  return [row1, row2];
}

// ══════════════════════════════════════════════════════════════
// Parse state từ customId
// Format: nlkey_{action}.{page}.{userId}.{filter}.{search}
// ══════════════════════════════════════════════════════════════
function parseState(customId) {
  // Bước 1: Tách prefix 'nlkey_' và lấy phần còn lại
  const withoutPrefix = customId.slice(6); // bỏ 'nlkey_'
  // withoutPrefix = 'prev.0.123456.cat_thuongmai.FTV'
  const parts = withoutPrefix.split('.');
  const action = parts[0] || '';
  const page = parseInt(parts[1]) || 0;
  const userId = parts[2] || '';
  const filter = parts[3] || '';
  const search = parts.slice(4).join('.') || ''; // search có thể chứa '.'
  return { action, page, userId, filter, search };
}

// ══════════════════════════════════════════════════════════════
// Hàm chính: Gửi danh sách key ban đầu (gọi từ nhacLabsCommands)
// ══════════════════════════════════════════════════════════════
async function sendKeyList(message, filter = '', search = '') {
  invalidateCache();
  let keys = await getCachedKeys();
  const totalAllKeys = keys.length; // Tổng key trước khi lọc

  if (keys.length === 0) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(EMBED_COLOR)
          .setDescription('📋 Chưa có key nào trên Firebase.'),
      ],
    });
  }

  if (search) keys = searchKeys(keys, search);
  if (filter && filter !== 'all') keys = applyFilter(keys, filter);

  const totalPages = Math.ceil(keys.length / ITEMS_PER_PAGE) || 1;
  const filterLabel = getFilterLabel(filter);
  const embed = buildListEmbed(keys, 0, totalPages, filterLabel, search, totalAllKeys);
  const buttons = buildListButtons(0, totalPages, message.author.id, filter, search);

  await message.channel.send({ embeds: [embed], components: buttons });
}

function getFilterLabel(filter) {
  const labels = {
    'all': '', 'active': '🟢 Hoạt động', 'blocked': '🔴 Bị chặn',
    'activated': '✅ Đã KH', 'not_activated': '⬜ Chưa KH',
    'pro': '⭐ PRO', 'unl': '👑 UNL',
    'cat_thuongmai': '💰 Thương mại', 'cat_mienphi': '🎁 Miễn phí', 'cat_test': '🧪 Dùng thử',
  };
  return labels[filter] || '';
}

// ══════════════════════════════════════════════════════════════
// Xử lý Button click
// ══════════════════════════════════════════════════════════════
async function handleButton(interaction) {
  const customId = interaction.customId;
  if (!customId.startsWith('nlkey_')) return false;

  try {
    const { action, page, userId, filter, search } = parseState(customId);

    // Kiểm tra quyền bấm
    if (userId && interaction.user.id !== userId) {
      await interaction.reply({
        content: '❌ Chỉ người sử dụng lệnh mới có thể bấm!',
        ephemeral: true,
      });
      return true;
    }

    // ── Search button: mở modal nhập chuỗi tìm kiếm ──
    if (action === 'search') {
      const modal = new ModalBuilder()
        .setCustomId(`nlkey_modal_search_${userId}`)
        .setTitle('🔍 Tìm kiếm Key / Máy');

      const input = new TextInputBuilder()
        .setCustomId('search_query')
        .setLabel('Nhập chuỗi ký tự để tìm')
        .setPlaceholder('VD: FTV, PRO, tên máy... (để trống = hiện tất cả)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(50);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return true;
    }

    // ── Pick button: mở modal nhập STT ──
    if (action === 'pick') {
      const modal = new ModalBuilder()
        .setCustomId(`nlkey_modal_pick.${userId}.${filter}.${search}`)
        .setTitle('📤 Chọn Key theo số thứ tự');

      const input = new TextInputBuilder()
        .setCustomId('pick_number')
        .setLabel('Nhập số thứ tự của key')
        .setPlaceholder('VD: 1, 5, 12...')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(5);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return true;
    }

    // ── Prev / Next button: đổi trang ──
    let newPage = page;
    if (action === 'prev') newPage = Math.max(0, page - 1);
    if (action === 'next') newPage = page + 1;

    let keys = await getCachedKeys();
    const totalAllKeys = keys.length;
    if (search) keys = searchKeys(keys, search);
    if (filter && filter !== 'all') keys = applyFilter(keys, filter);

    const totalPages = Math.ceil(keys.length / ITEMS_PER_PAGE) || 1;
    newPage = Math.min(newPage, totalPages - 1);

    const filterLabel = getFilterLabel(filter);
    const embed = buildListEmbed(keys, newPage, totalPages, filterLabel, search, totalAllKeys);
    const buttons = buildListButtons(newPage, totalPages, userId, filter, search);

    await interaction.update({ embeds: [embed], components: buttons });
    return true;
  } catch (err) {
    console.error('[nlListHandlers] Lỗi handleButton:', err);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// Xử lý Select Menu (Lọc)
// ══════════════════════════════════════════════════════════════
async function handleSelectMenu(interaction) {
  const customId = interaction.customId;
  if (!customId.startsWith('nlkey_filter_select_')) return false;

  try {
    const userId = customId.replace('nlkey_filter_select_', '');

    // Kiểm tra quyền
    if (userId && interaction.user.id !== userId) {
      await interaction.reply({
        content: '❌ Chỉ người sử dụng lệnh mới có thể lọc!',
        ephemeral: true,
      });
      return true;
    }

    const filterValue = interaction.values[0];

    invalidateCache(); // Refresh khi lọc
    let keys = await getCachedKeys();
    const totalAllKeys = keys.length;
    if (filterValue && filterValue !== 'all') keys = applyFilter(keys, filterValue);

    const totalPages = Math.ceil(keys.length / ITEMS_PER_PAGE) || 1;
    const filterLabel = getFilterLabel(filterValue);
    const embed = buildListEmbed(keys, 0, totalPages, filterLabel, '', totalAllKeys);
    const buttons = buildListButtons(0, totalPages, userId, filterValue, '');

    await interaction.update({ embeds: [embed], components: buttons });
    return true;
  } catch (err) {
    console.error('[nlListHandlers] Lỗi handleSelectMenu:', err);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// Xử lý Modal Submit
// ══════════════════════════════════════════════════════════════
async function handleModalSubmit(interaction) {
  const customId = interaction.customId;

  try {
    // ── Modal tìm kiếm ──
    if (customId.startsWith('nlkey_modal_search_')) {
      const userId = customId.replace('nlkey_modal_search_', '');

      if (userId && interaction.user.id !== userId) {
        await interaction.reply({
          content: '❌ Chỉ người sử dụng lệnh mới có thể tìm kiếm!',
          ephemeral: true,
        });
        return true;
      }

      const query = (interaction.fields.getTextInputValue('search_query') || '').trim();

      let keys = await getCachedKeys();
      const totalAllKeys = keys.length;
      if (query) keys = searchKeys(keys, query);

      const totalPages = Math.ceil(keys.length / ITEMS_PER_PAGE) || 1;
      const embed = buildListEmbed(keys, 0, totalPages, '', query, totalAllKeys);
      const buttons = buildListButtons(0, totalPages, userId, '', query);

      await interaction.update({ embeds: [embed], components: buttons });
      return true;
    }

    // ── Modal chọn key theo STT ──
    if (customId.startsWith('nlkey_modal_pick.')) {
      const parts = customId.replace('nlkey_modal_pick.', '').split('.');
      const userId = parts[0] || '';
      const filter = parts[1] || '';
      const search = parts.slice(2).join('.') || '';

      if (userId && interaction.user.id !== userId) {
        await interaction.reply({
          content: '❌ Chỉ người sử dụng lệnh mới có thể chọn key!',
          ephemeral: true,
        });
        return true;
      }

      const numStr = (interaction.fields.getTextInputValue('pick_number') || '').trim();
      const num = parseInt(numStr);

      if (isNaN(num) || num < 1) {
        await interaction.reply({
          content: '❌ Vui lòng nhập số thứ tự hợp lệ!',
          ephemeral: true,
        });
        return true;
      }

      let keys = await getCachedKeys();
      if (search) keys = searchKeys(keys, search);
      if (filter && filter !== 'all') keys = applyFilter(keys, filter);

      if (num > keys.length) {
        await interaction.reply({
          content: `❌ Số thứ tự ${num} vượt quá tổng số key (${keys.length})!`,
          ephemeral: true,
        });
        return true;
      }

      const selectedKey = keys[num - 1];

      // Gửi tin nhắn bình thường chỉ chứa key
      await interaction.deferUpdate();
      await interaction.channel.send(selectedKey.key);
      return true;
    }
  } catch (err) {
    console.error('[nlListHandlers] Lỗi handleModalSubmit:', err);
  }

  return false;
}

module.exports = {
  sendKeyList,
  handleButton,
  handleSelectMenu,
  handleModalSubmit,
  invalidateCache,
};
