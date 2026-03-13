// ============================================================
// NhacLabs License Commands — Quản lý key NhacLabs qua Discord
// Prefix: ?nl (nhac labs)
// Tất cả lệnh bắt đầu bằng ?nl được xử lý ở đây
// ============================================================

const { Events, EmbedBuilder } = require('discord.js');
const {
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
} = require('../../utils/firebaseLicense');
const { sendKeyList } = require('../../utils/nlListHandlers');

// Bảng alias lệnh tắt → lệnh gốc
const CMD_ALIASES = {
  '': 'list',       // ?nl → list (hiện danh sách key)
  'help': 'help',
  'info': 'info', 'i': 'info',
  'list': 'list',
  'gen': 'gen', 'g': 'gen', 'c': 'gen', 'cap': 'gen', 'key': 'gen',
  'block': 'block', 'b': 'block',
  'pblock': 'pblock', 'pb': 'pblock',
  'unblock': 'unblock', 'ul': 'unblock',
  'remove': 'remove', 'rm': 'remove',
  'delete': 'delete', 'd': 'delete',
  'cat': 'category', 'category': 'category',
  'sales': 'sales', 'doanhthu': 'sales', 'dt': 'sales', 'revenue': 'sales',
  'up': 'upgrade', 'upgrade': 'upgrade',
  'deleteall': 'deleteall', 'da': 'deleteall', 'xoahet': 'deleteall',
};

// Chỉ admin mới được dùng (trừ ?nlhelp)
const AUTHOR_IDS = ["395151484179841024", "1247475535317422111"];

// Màu chủ đạo cho embed
const EMBED_COLOR = 0xFFD700; // Gold
const ERROR_COLOR = 0xFF4444; // Đỏ
const SUCCESS_COLOR = 0x44FF44; // Xanh lá

module.exports = {
  name: Events.MessageCreate,

  /**
   * @param {import('discord.js').Message} message
   */
  async execute(message, client) {
    if (message.author.bot) return;

    const content = message.content.trim();
    const prefix = process.env.PREFIX || '?';

    // Chỉ xử lý lệnh bắt đầu bằng ?nl
    if (!content.startsWith(`${prefix}nl`)) return;

    // Parse sub-command: ?nlhelp → subCmd = "help", ?nlinfo KEY → subCmd = "info"
    const fullCmd = content.slice(prefix.length); // "nlhelp KEY" hoặc "nlinfo KEY"
    const parts = fullCmd.trim().split(/\s+/);
    const cmdPart = parts[0].toLowerCase(); // "nlhelp", "nlinfo", ...
    const rawSubCmd = cmdPart.slice(2); // bỏ "nl" → "help", "info", ...
    const subCmd = CMD_ALIASES[rawSubCmd] || rawSubCmd; // áp dụng alias
    const args = parts.slice(1); // các tham số sau lệnh

    // ============== ?nlhelp — Ai cũng dùng được ==============
    if (subCmd === 'help') {
      return sendHelp(message, prefix);
    }

    // Các lệnh còn lại yêu cầu quyền admin
    if (!AUTHOR_IDS.includes(message.author.id)) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(ERROR_COLOR)
            .setDescription('❌ Bạn không có quyền sử dụng lệnh này!'),
        ],
      });
    }

    try {
      switch (subCmd) {
        case 'info':
          return await cmdInfo(message, args);
        case 'list':
          // ?nl thông minh: nếu có args và arg đầu là PRO/UNL → chuyển sang gen
          if (args.length > 0 && ['PRO', 'UNL'].includes(args[0].toUpperCase())) {
            return await cmdGen(message, args);
          }
          // ?nl thông minh: nếu có args khác → tìm key/mã máy
          if (args.length > 0) {
            return await cmdSmartSearch(message, args);
          }
          return await sendKeyList(message);
        case 'gen':
          return await cmdGen(message, args);
        case 'category':
          return await cmdCategory(message, args);
        case 'sales':
          return await cmdSales(message, args);
        case 'block':
          return await cmdBlock(message, args, false);
        case 'pblock':
          return await cmdBlock(message, args, true);
        case 'unblock':
          return await cmdUnblock(message, args);
        case 'remove':
          return await cmdRemove(message, args);
        case 'delete':
          return await cmdDelete(message, args);
        case 'upgrade':
          return await cmdUpgrade(message, args);
        case 'deleteall':
          return await cmdDeleteAll(message);
        default:
          // Không khớp lệnh nào → gợi ý dùng ?nlhelp
          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(ERROR_COLOR)
                .setDescription(
                  `❌ Lệnh \`${prefix}${cmdPart}\` không tồn tại.\nDùng \`${prefix}nlhelp\` để xem danh sách lệnh.`
                ),
            ],
          });
      }
    } catch (error) {
      console.error('[NhacLabs] Command error:', error);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(ERROR_COLOR)
            .setDescription(`❌ Lỗi: ${error.message}`),
        ],
      });
    }
  },
};

// ══════════════════════════════════════════════════════════
// ?nlhelp — Hiện hướng dẫn tất cả lệnh
// ══════════════════════════════════════════════════════════
function sendHelp(message, prefix) {
  const p = prefix;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('🔑 NhacLabs License Manager — Hướng Dẫn Chi Tiết')
    .setDescription(
      `Hệ thống quản lý license key NhacLabs qua Firebase Firestore.\n` +
      `Tất cả lệnh bắt đầu bằng \`${p}nl\`. Ngoặc \`<>\` = bắt buộc, \`[]\` = tùy chọn.`
    )
    .addFields(
      {
        name: '📋  XEM THÔNG TIN',
        value:
          `**\`${p}nl\`** — Danh sách key / hoặc tạo key nhanh\n` +
          `> Không args → hiện danh sách │ Có args PRO/UNL → tạo key\n` +
          `> VD: \`${p}nl\` = list │ \`${p}nl unl 3 tm\` = tạo 3 key UNL\n` +
          `> 📄 Phân trang, lọc theo danh mục, 🔍 tìm kiếm\n\n` +
          `**\`${p}nlinfo <key>\`** — Xem chi tiết 1 key (Alias: \`${p}nli\`)`,
      },
      {
        name: '🔧  TẠO KEY',
        value:
          `**\`${p}nlgen <PRO|UNL> [số lượng] [thời hạn] [danh mục]\`**\n` +
          `> Tier: \`PRO\` (3 máy) hoặc \`UNL\` (unlimited)\n` +
          `> Thời hạn: \`30d\`, \`7d\`, bỏ trống = vĩnh viễn\n` +
          `> Danh mục: \`tm\` (thương mại), \`mp\` (miễn phí), \`test\`\n` +
          `> VD: \`${p}nlg PRO 3 tm\` — 3 key PRO thương mại\n` +
          `> VD: \`${p}nlg UNL 5 30d mp\` — 5 key UNL miễn phí 30 ngày`,
      },
      {
        name: '📂  DANH MỤC KEY',
        value:
          `**\`${p}nlcat <key> <danh mục>\`** — Đổi danh mục cho key\n` +
          `> Danh mục: \`tm\` = Thương mại, \`mp\` = Miễn phí, \`test\` = Dùng thử\n` +
          `> Key thương mại sẽ lưu ngày cấp để tính tiền\n` +
          `> VD: \`${p}nlcat NL-PRO-XXX tm\``,
      },
      {
        name: '🗑️  XÓA KEY & MÁY',
        value:
          `**\`${p}nldelete <key>\`** — Xóa key hoàn toàn (Alias: \`${p}nld\`)\n` +
          `**\`${p}nlremove <key> <hw_id>\`** — Xóa 1 máy (Alias: \`${p}nlrm\`)`,
      },
      {
        name: '🚫  CHẶN & MỞ CHẶN',
        value:
          `**\`${p}nlblock <key> [lý do]\`** — Chặn tạm (Alias: \`${p}nlb\`)\n` +
          `**\`${p}nlpblock <key> [lý do]\`** — Chặn vĩnh viễn (Alias: \`${p}nlpb\`)\n` +
          `**\`${p}nlunblock <key>\`** — Mở chặn (Alias: \`${p}nlul\`)`,
      },
      {
        name: '⬆️  UPGRADE KEY',
        value:
          `**\`${p}nlup <key_PRO>\`** — Upgrade PRO → UNL\n` +
          `> Verify key PRO hợp lệ → tạo key UNL mới (giá chênh lệch)\n` +
          `> Tự động block key PRO cũ + lưu thông tin upgrade`,
      },
      {
        name: '📊  DOANH THU',
        value:
          `**\`${p}nlsales\`** — Tổng quan doanh thu (PRO/UNL)\n` +
          `**\`${p}nlsales pro\`** — Chi tiết key PRO đã bán\n` +
          `**\`${p}nlsales unl\`** — Chi tiết key UNL đã bán\n` +
          `> Alias: \`${p}nldoanhthu\`, \`${p}nldt\``,
      },
      {
        name: '⌨️  BẢNG ALIAS TẮT',
        value:
          `\`${p}nl\` → list │ \`${p}nli\` → info │ \`${p}nlg\` \`${p}nlc\` → gen\n` +
          `\`${p}nlup\` → upgrade │ \`${p}nlcat\` → category │ \`${p}nldt\` → sales\n` +
          `\`${p}nlb\` → block │ \`${p}nlpb\` → pblock │ \`${p}nlul\` → unblock │ \`${p}nlrm\` → remove │ \`${p}nld\` → delete`,
      },
    )
    .setFooter({ text: '🔑 NhacLabs License Manager • Chỉ admin mới dùng được (trừ ?nl)' })
    .setTimestamp();

  return message.reply({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════
// ?nlinfo <key> — Xem thông tin 1 key
// ══════════════════════════════════════════════════════════
async function cmdInfo(message, args) {
  if (args.length < 1) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription('❌ Cú pháp: `?nlinfo <key>`\nVí dụ: `?nlinfo NL-UNL-11377F54A4-62EE4F4387`'),
      ],
    });
  }

  const key = args[0];
  const info = await getKeyInfo(key);

  if (!info.exists) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription(`❌ Key \`${key}\` không tồn tại trên Firebase.\n*Key chỉ xuất hiện sau khi user kích hoạt lần đầu.*`),
      ],
    });
  }

  // Danh sách máy
  const machineList =
    info.machines.length > 0
      ? info.machines
          .map(
            (m, i) =>
              `**${i + 1}.** \`${m.hw_id}\` — ${m.name || 'N/A'} *(${m.activated_at || '?'})*`
          )
          .join('\n')
      : '*Chưa có máy nào kích hoạt*';

  const statusIcon = info.blocked ? '🔴 BỊ CHẶN' : '🟢 Hoạt động';
  const blockInfo = info.blocked
    ? `\n📝 Lý do: ${info.block_reason || 'Không rõ'}`
    : '';

  // Thông tin danh mục
  const catInfo = CATEGORIES[info.category] || CATEGORIES['thuongmai'];
  const catLine = `**Danh mục:** ${catInfo.emoji} ${catInfo.label}`;
  const issuedLine = info.issued_date ? `\n**Ngày cấp:** ${new Date(info.issued_date).toLocaleDateString('vi-VN')}` : '';

  const embed = new EmbedBuilder()
    .setColor(info.blocked ? ERROR_COLOR : EMBED_COLOR)
    .setTitle(`🔑 Thông Tin Key`)
    .setDescription(
      `**Key:** \`${info.key}\`\n` +
      `**Tier:** ${info.tier.toUpperCase()}\n` +
      `${catLine}${issuedLine}\n` +
      `**Trạng thái:** ${statusIcon}${blockInfo}\n` +
      `**Số máy:** ${info.machines.length}/${info.max_machines}\n` +
      `**Kích hoạt cuối:** ${info.last_activated || 'Chưa'}\n\n` +
      `💻 **Danh sách máy:**\n${machineList}`
    )
    .setTimestamp();

  return message.reply({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════
// ?nl <key/mã máy> — Tìm kiếm thông minh
// Ưu tiên: khớp chính xác key → khớp hw_id → khớp một phần
// ══════════════════════════════════════════════════════════
async function cmdSmartSearch(message, args) {
  const query = args.join(' ').trim();
  if (!query) return await sendKeyList(message);

  const queryUpper = query.toUpperCase();

  // Bước 1: Thử tìm chính xác key trước (nhanh nhất, chỉ 1 API call)
  const directInfo = await getKeyInfo(query);
  if (directInfo.exists) {
    return await cmdInfo(message, args);
  }

  // Bước 2: Tìm trong toàn bộ danh sách key
  const allKeys = await listAllKeys();

  // Tìm khớp chính xác hw_id
  const hwMatch = allKeys.find(k =>
    k.machines && k.machines.some(m =>
      (m.hw_id || '').toUpperCase() === queryUpper
    )
  );

  if (hwMatch) {
    // Tìm thấy máy → hiện chi tiết key chứa máy đó
    return await cmdInfo(message, [hwMatch.key]);
  }

  // Tìm khớp một phần (key, tên máy, hw_id)
  const partialMatches = allKeys.filter(k => {
    if ((k.key || '').toUpperCase().includes(queryUpper)) return true;
    if (k.machines && k.machines.some(m =>
      (m.name || '').toUpperCase().includes(queryUpper) ||
      (m.hw_id || '').toUpperCase().includes(queryUpper)
    )) return true;
    return false;
  });

  if (partialMatches.length === 1) {
    // Chỉ 1 kết quả → hiện chi tiết luôn
    return await cmdInfo(message, [partialMatches[0].key]);
  }

  if (partialMatches.length > 1) {
    // Nhiều kết quả → hiện danh sách tìm kiếm
    return await sendKeyList(message, '', query);
  }

  // Không tìm thấy gì
  return message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(ERROR_COLOR)
        .setDescription(
          `🔍 Không tìm thấy key hoặc mã máy nào khớp với \`${query}\`\n\n` +
          `💡 Thử:\n` +
          `• \`?nlinfo <key đầy đủ>\` — xem chi tiết 1 key\n` +
          `• \`?nl\` — hiện danh sách tất cả key`
        ),
    ],
  });
}

// ══════════════════════════════════════════════════════════
// ?nlgen <PRO|UNL> [số lượng] [thời hạn] — Tạo key mới
// Ví dụ: ?nlgen PRO 3 30d → 3 key PRO hết hạn 30 ngày
//        ?nlgen UNL 7d    → 1 key UNL hết hạn 7 ngày
//        ?nlgen PRO 5     → 5 key PRO vĩnh viễn
// ══════════════════════════════════════════════════════════
async function cmdGen(message, args) {
  if (args.length < 1) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription(
            '❌ Cú pháp: `?nlgen <PRO|UNL> [số lượng] [thời hạn] [danh mục]`\n' +
            'Danh mục: `tm` (thương mại), `mp` (miễn phí), `test`\n' +
            'Ví dụ:\n' +
            '• `?nlgen UNL 3 tm` — 3 key UNL thương mại\n' +
            '• `?nlgen PRO 30d mp` — 1 key PRO miễn phí 30 ngày\n' +
            '• `?nlgen PRO 5 7d` — 5 key PRO hết hạn 7 ngày (mặc định thương mại)'
          ),
      ],
    });
  }

  const tierCode = args[0].toUpperCase();
  if (!['PRO', 'UNL'].includes(tierCode)) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription('❌ Tier phải là `PRO` hoặc `UNL`.'),
      ],
    });
  }

  // Parse args — phân biệt số lượng, thời hạn, danh mục
  let count = 1;
  let days = 0;
  let category = 'thuongmai'; // Mặc định thương mại

  // Alias danh mục ngắn
  const CAT_ALIASES = { 'tm': 'thuongmai', 'mp': 'mienphi', 'test': 'test' };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i].toLowerCase();
    // Kiểm tra category alias
    if (CAT_ALIASES[arg]) {
      category = CAT_ALIASES[arg];
      continue;
    }
    // Kiểm tra category đầy đủ
    if (CATEGORIES[arg]) {
      category = arg;
      continue;
    }
    const dayMatch = arg.match(/^(\d+)[dn]$/i); // "30d", "7d", "30n", "7n",...
    if (dayMatch) {
      days = parseInt(dayMatch[1]);
      if (days < 1 || days > 3650) {
        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(ERROR_COLOR)
              .setDescription('❌ Thời hạn phải từ `1d` đến `3650d` (10 năm).'),
          ],
        });
      }
    } else {
      const num = parseInt(arg);
      if (!isNaN(num)) count = num;
    }
  }

  count = Math.min(Math.max(count, 1), 10); // Tối đa 10 key/lần
  const generatedKeys = [];

  for (let i = 0; i < count; i++) {
    generatedKeys.push(generateKey(tierCode, days));
  }

  // Ghi tất cả key lên Firestore (với category)
  const results = await Promise.all(
    generatedKeys.map((k) => createKeyDoc(k, tierCode, days, category))
  );
  const successCount = results.filter(Boolean).length;
  const failCount = count - successCount;

  const keyList = generatedKeys.map((k, i) => `**${i + 1}.** \`${k}\``).join('\n');
  const daysInfo = days > 0 ? `⏰ Hết hạn: **${days} ngày** kể từ khi kích hoạt` : '♾️ Vĩnh viễn (không hết hạn)';
  const catInfo = CATEGORIES[category];
  const fbStatus = failCount === 0
    ? '✅ Đã lưu lên Firebase'
    : `⚠️ ${successCount}/${count} key lưu thành công`;

  const embed = new EmbedBuilder()
    .setColor(SUCCESS_COLOR)
    .setTitle(`🔧 Đã Tạo ${count} Key ${tierCode}${days > 0 ? ` (${days} ngày)` : ''}`)
    .setDescription(
      `${keyList}\n\n` +
      `${daysInfo}\n` +
      `${catInfo.emoji} Danh mục: **${catInfo.label}**\n` +
      `${fbStatus}\n` +
      `📋 Giới hạn: ${MAX_MACHINES} máy/key`
    )
    .setTimestamp();

  await message.reply({ embeds: [embed] });

  // Gửi thêm tin nhắn chỉ chứa key thuần để dễ copy
  const plainKeys = generatedKeys.join('\n');
  return message.channel.send(plainKeys);
}

// ══════════════════════════════════════════════════════════
// ?nlblock / ?nlpblock <key> [lý do] — Chặn key
// ══════════════════════════════════════════════════════════
async function cmdBlock(message, args, permanent) {
  if (args.length < 1) {
    const cmd = permanent ? 'nlpblock' : 'nlblock';
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription(`❌ Cú pháp: \`?${cmd} <key> [lý do]\`\nVí dụ: \`?${cmd} NL-UNL-XXXXX Hết hạn\``),
      ],
    });
  }

  const key = args[0];
  const reason = args.slice(1).join(' ') || 'Bị chặn bởi admin';
  const type = permanent ? 'VĨNH VIỄN' : 'TẠM THỜI';

  const success = await blockKey(key, reason, permanent);

  if (success) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(SUCCESS_COLOR)
          .setTitle(`🚫 Đã Chặn Key [${type}]`)
          .setDescription(`**Key:** \`${key}\`\n**Lý do:** ${reason}`),
      ],
    });
  } else {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription(`❌ Không thể chặn key \`${key}\`. Key có thể không tồn tại.`),
      ],
    });
  }
}

// ══════════════════════════════════════════════════════════
// ?nlunblock <key> — Mở chặn key
// ══════════════════════════════════════════════════════════
async function cmdUnblock(message, args) {
  if (args.length < 1) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription('❌ Cú pháp: `?nlunblock <key>`'),
      ],
    });
  }

  const key = args[0];
  const success = await unblockKey(key);

  if (success) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(SUCCESS_COLOR)
          .setDescription(`✅ Đã mở chặn key \`${key}\``),
      ],
    });
  } else {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription(`❌ Không thể mở chặn key \`${key}\`. Key có thể không tồn tại.`),
      ],
    });
  }
}

// ══════════════════════════════════════════════════════════
// ?nlremove <key> <hw_id> — Xóa 1 máy khỏi key
// ══════════════════════════════════════════════════════════
async function cmdRemove(message, args) {
  if (args.length < 2) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription('❌ Cú pháp: `?nlremove <key> <hw_id>`\nDùng `?nlinfo <key>` để xem danh sách hw_id.'),
      ],
    });
  }

  const key = args[0];
  const hwId = args[1];
  const result = await removeMachine(key, hwId);

  if (result.ok) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(SUCCESS_COLOR)
          .setDescription(`✅ Đã xóa máy \`${hwId}\` khỏi key \`${key}\``),
      ],
    });
  } else {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription(`❌ ${result.error}`),
      ],
    });
  }
}

// ══════════════════════════════════════════════════════════
// ?nldelete <key> — Xóa key hoàn toàn
// ══════════════════════════════════════════════════════════
async function cmdDelete(message, args) {
  if (args.length < 1) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription('❌ Cú pháp: `?nldelete <key>`'),
      ],
    });
  }

  const key = args[0];

  // Xác nhận trước khi xóa
  const confirmEmbed = new EmbedBuilder()
    .setColor(0xFF8800)
    .setTitle('⚠️ Xác Nhận Xóa Key')
    .setDescription(
      `Bạn có chắc muốn xóa hoàn toàn key này?\n\`${key}\`\n\n` +
      `Phản hồi ✅ trong 15 giây để xác nhận.`
    );

  const confirmMsg = await message.reply({ embeds: [confirmEmbed] });
  await confirmMsg.react('✅');

  // Chờ phản hồi từ người gửi lệnh
  const filter = (reaction, user) =>
    reaction.emoji.name === '✅' && user.id === message.author.id;

  try {
    await confirmMsg.awaitReactions({ filter, max: 1, time: 15000, errors: ['time'] });

    const success = await deleteKey(key);

    if (success) {
      await confirmMsg.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(SUCCESS_COLOR)
            .setDescription(`🗑️ Đã xóa hoàn toàn key \`${key}\``),
        ],
      });
    } else {
      await confirmMsg.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(ERROR_COLOR)
            .setDescription(`❌ Không thể xóa key \`${key}\`. Key có thể không tồn tại.`),
        ],
      });
    }
  } catch {
    // Hết thời gian
    await confirmMsg.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription(`⏰ Đã hủy — hết thời gian xác nhận.`),
        ],
    });
  }

  // Xóa reactions
  try { await confirmMsg.reactions.removeAll(); } catch { }
}

// ══════════════════════════════════════════════════════════
// ?nlcat <key> <category> — Đổi danh mục cho key
// ══════════════════════════════════════════════════════════
async function cmdCategory(message, args) {
  const CAT_ALIASES = { 'tm': 'thuongmai', 'mp': 'mienphi', 'test': 'test' };

  if (args.length < 2) {
    const catList = Object.entries(CATEGORIES)
      .map(([k, v]) => `\`${k}\` = ${v.emoji} ${v.label}`)
      .join('\n');
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription(
            `❌ Cú pháp: \`?nlcat <key> <danh mục>\`\n\n` +
            `**Danh mục có sẵn:**\n${catList}\n\n` +
            `**Alias tắt:** \`tm\` = thương mại, \`mp\` = miễn phí\n` +
            `VD: \`?nlcat NL-PRO-XXX tm\``
          ),
      ],
    });
  }

  const key = args[0];
  const rawCat = args[1].toLowerCase();
  const category = CAT_ALIASES[rawCat] || rawCat;

  if (!CATEGORIES[category]) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription(
            `❌ Danh mục \`${rawCat}\` không tồn tại.\n` +
            `Danh mục hợp lệ: ${Object.keys(CATEGORIES).map(k => `\`${k}\``).join(', ')}`
          ),
      ],
    });
  }

  const success = await setCategoryKey(key, category);

  if (success) {
    const catInfo = CATEGORIES[category];
    const issuedNote = category === 'thuongmai' ? '\n📅 Đã lưu ngày cấp (hôm nay) để tính tiền.' : '';
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(SUCCESS_COLOR)
          .setTitle(`📂 Đã Đổi Danh Mục`)
          .setDescription(
            `**Key:** \`${key}\`\n` +
            `**Danh mục mới:** ${catInfo.emoji} ${catInfo.label}${issuedNote}`
          ),
      ],
    });
  } else {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription(`❌ Không thể đổi danh mục. Key \`${key}\` có thể không tồn tại.`),
      ],
    });
  }
}

// ══════════════════════════════════════════════════════════
// ?nlsales [pro|unl] — Thống kê doanh thu từ key thương mại
// ══════════════════════════════════════════════════════════
async function cmdSales(message, args) {
  const keys = await listAllKeys();

  // Lọc key thương mại
  const soldKeys = keys.filter(k => (k.category || 'thuongmai') === 'thuongmai');

  // Nếu có tham số → chi tiết 1 gói
  const tierFilter = args[0]?.toUpperCase();

  if (tierFilter && ['PRO', 'UNL'].includes(tierFilter)) {
    // ── Chi tiết 1 gói (startsWith để khớp cả PRO2D, UNL7D,...) ──
    const tierKeys = soldKeys.filter(k => (k.tier || '').toUpperCase().startsWith(tierFilter));
    const price = TIER_PRICES[tierFilter] || 0;
    // Tính doanh thu: key upgrade có paid_amount riêng, key thường dùng giá gốc
    const totalRevenue = tierKeys.reduce((sum, k) => {
      const pa = k.paid_amount;
      return sum + (pa != null && pa >= 0 ? pa : price);
    }, 0);

    // Sắp xếp theo ngày cấp (mới nhất trước)
    tierKeys.sort((a, b) => {
      const da = a.issued_date ? new Date(a.issued_date) : new Date(0);
      const db = b.issued_date ? new Date(b.issued_date) : new Date(0);
      return db - da;
    });

    // Danh sách key (tối đa 15)
    const keyLines = tierKeys.slice(0, 15).map((k, i) => {
      const date = k.issued_date
        ? new Date(k.issued_date).toLocaleDateString('vi-VN')
        : 'N/A';
      const status = k.blocked ? '🔴' : '🟢';
      const machineCount = k.machines ? k.machines.length : 0;
      return `**${i + 1}.** ${status} \`${k.key}\` — ${machineCount} máy — 📅 ${date}`;
    }).join('\n');

    const remaining = tierKeys.length > 15 ? `\n*...và ${tierKeys.length - 15} key khác*` : '';

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`📊 Chi Tiết Gói ${tierFilter} — Thương Mại`)
      .setDescription(
        `💰 **Giá gói:** ${formatVND(price)}\n` +
        `🔑 **Tổng key đã bán:** ${tierKeys.length}\n` +
        `💵 **Tổng doanh thu:** ${formatVND(totalRevenue)}\n\n` +
        `📋 **Danh sách key (mới → cũ):**\n${keyLines || '*Chưa có key nào*'}${remaining}`
      )
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // ── Tổng quan doanh thu ──
  // startsWith để khớp cả key theo ngày (PRO2D, UNL7D,...)
  const proKeys = soldKeys.filter(k => (k.tier || '').toUpperCase().startsWith('PRO'));
  const unlKeys = soldKeys.filter(k => (k.tier || '').toUpperCase().startsWith('UNL'));

  // Tính doanh thu: key upgrade có paid_amount riêng
  const proPrice = TIER_PRICES['PRO'] || 0;
  const unlPrice = TIER_PRICES['UNL'] || 0;
  const proRevenue = proKeys.reduce((s, k) => s + (k.paid_amount != null && k.paid_amount >= 0 ? k.paid_amount : proPrice), 0);
  const unlRevenue = unlKeys.reduce((s, k) => s + (k.paid_amount != null && k.paid_amount >= 0 ? k.paid_amount : unlPrice), 0);
  const totalRevenue = proRevenue + unlRevenue;

  // Key đang hoạt động vs bị chặn
  const activeKeys = soldKeys.filter(k => !k.blocked);
  const blockedKeys = soldKeys.filter(k => k.blocked);

  // Key đã kích hoạt vs chưa
  const activatedKeys = soldKeys.filter(k => k.machines && k.machines.length > 0);
  const notActivatedKeys = soldKeys.filter(k => !k.machines || k.machines.length === 0);

  // Thống kê key miễn phí & test (không tính doanh thu)
  const freeKeys = keys.filter(k => k.category === 'mienphi');
  const testKeys = keys.filter(k => k.category === 'test');

  const embed = new EmbedBuilder()
    .setColor(0x00FF88)
    .setTitle('📊 Thống Kê Doanh Thu NhacLabs')
    .setDescription(
      `### 💰 Tổng Doanh Thu: **${formatVND(totalRevenue)}**\n\n` +

      `**⭐ Gói PRO — ${formatVND(TIER_PRICES['PRO'])}**\n` +
      `> 🔑 Đã bán: **${proKeys.length}** key\n` +
      `> 💵 Doanh thu: **${formatVND(proRevenue)}**\n\n` +

      `**👑 Gói UNL — ${formatVND(TIER_PRICES['UNL'])}**\n` +
      `> 🔑 Đã bán: **${unlKeys.length}** key\n` +
      `> 💵 Doanh thu: **${formatVND(unlRevenue)}**\n\n` +

      `───────────────────\n` +
      `📈 **Tổng quan key thương mại:**\n` +
      `> 🟢 Hoạt động: **${activeKeys.length}** │ 🔴 Bị chặn: **${blockedKeys.length}**\n` +
      `> ✅ Đã KH: **${activatedKeys.length}** │ ⬜ Chưa KH: **${notActivatedKeys.length}**\n\n` +

      `📦 **Các loại khác (không tính doanh thu):**\n` +
      `> 🎁 Miễn phí: **${freeKeys.length}** key\n` +
      `> 🧪 Dùng thử: **${testKeys.length}** key\n\n` +

      `*Dùng \`?nlsales pro\` hoặc \`?nlsales unl\` để xem chi tiết từng gói.*`
    )
    .setFooter({ text: `Tổng cộng: ${keys.length} key trên hệ thống` })
    .setTimestamp();

  return message.reply({ embeds: [embed] });
}

// Format số tiền VNĐ: 199000 → "199,000đ"
function formatVND(amount) {
  return amount.toLocaleString('vi-VN') + 'đ';
}

// ══════════════════════════════════════════════════════════
// ?nlup <key_PRO> — Upgrade key PRO → UNL
// Verify key PRO hợp lệ → tạo key UNL mới (giá chênh lệch)
// ══════════════════════════════════════════════════════════
async function cmdUpgrade(message, args) {
  const prefix = process.env.PREFIX || '?';
  const upgradeCost = (TIER_PRICES['UNL'] || 0) - (TIER_PRICES['PRO'] || 0);

  if (args.length < 1) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription(
            `❌ Cú pháp: \`${prefix}nlup <key_PRO>\`\n\n` +
            `**Chức năng:** Upgrade key PRO → UNL\n` +
            `> Khách gửi key PRO hiện tại → bot verify → tạo key UNL mới\n` +
            `> Giá upgrade: **${formatVND(upgradeCost)}** (chênh lệch PRO → UNL)\n` +
            `> Key PRO cũ tự động bị block\n\n` +
            `VD: \`${prefix}nlup NL-PRO-A1B2C3D4E5-F6G7H8I9J0\``
          ),
      ],
    });
  }

  const proKey = args[0];

  // Bước 1: Check key PRO trên Firebase
  const info = await getKeyInfo(proKey);

  if (!info.exists) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription(`❌ Key \`${proKey}\` không tồn tại trên Firebase.`),
      ],
    });
  }

  // Bước 2: Verify tier = PRO
  if (info.tier.toUpperCase() !== 'PRO') {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription(
            `❌ Key \`${proKey}\` không phải tier **PRO** (hiện tại: **${info.tier}**).\n` +
            `Chỉ có thể upgrade từ PRO → UNL.`
          ),
      ],
    });
  }

  // Bước 3: Check không bị block
  if (info.blocked) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription(
            `❌ Key \`${proKey}\` đang bị **chặn**.\n` +
            `Lý do: ${info.block_reason || 'Không rõ'}\n` +
            `Không thể upgrade key đang bị chặn.`
          ),
      ],
    });
  }

  // Bước 4: Tạo key UNL mới
  const newKey = generateKey('UNL', 0);
  const success = await createUpgradeKeyDoc(newKey, proKey);

  if (!success) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription(`❌ Lỗi khi tạo key UNL mới. Vui lòng thử lại.`),
      ],
    });
  }

  // Bước 5: Thông báo thành công
  const machineInfo = info.machines.length > 0
    ? info.machines.map(m => `\`${m.hw_id}\` — ${m.name || 'N/A'}`).join(', ')
    : 'Chưa có máy';

  const embed = new EmbedBuilder()
    .setColor(SUCCESS_COLOR)
    .setTitle('⬆️ Upgrade Thành Công — PRO → UNL')
    .setDescription(
      `**Key PRO cũ:** \`${proKey}\`\n` +
      `> 🔴 Đã bị block (lý do: upgrade)\n` +
      `> 💻 Máy: ${machineInfo}\n\n` +
      `**Key UNL mới:** \`${newKey}\`\n` +
      `> 🟢 Sẵn sàng kích hoạt\n\n` +
      `💰 **Giá upgrade:** ${formatVND(upgradeCost)}\n` +
      `📋 Đã lưu thông tin upgrade lên Firebase`
    )
    .setTimestamp();

  await message.reply({ embeds: [embed] });

  // Gửi key thuần để dễ copy
  return message.channel.send(newKey);
}

// ══════════════════════════════════════════════════════════
// ?nldeleteall — Xóa TOÀN BỘ key NhacLabs trên Firebase
// Yêu cầu 3 lần xác nhận: ✅ → ⚠️ → gõ "xac nhan"
// ══════════════════════════════════════════════════════════
async function cmdDeleteAll(message) {
  const keys = await listAllKeys();

  if (keys.length === 0) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription('📋 Không có key nào để xóa.'),
      ],
    });
  }

  // ── BƯỚC 1: Xác nhận lần 1 (reaction ✅) ──
  const step1 = await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xFF8800)
        .setTitle('⚠️ XÁC NHẬN LẦN 1/3')
        .setDescription(
          `Bạn đang yêu cầu **XÓA TOÀN BỘ ${keys.length} key** trên Firebase!\n\n` +
          `Hành động này **KHÔNG THỂ HOÀN TÁC**.\n\n` +
          `Bấm ✅ trong 15 giây để tiếp tục.`
        ),
    ],
  });
  await step1.react('✅');

  const filter1 = (reaction, user) =>
    reaction.emoji.name === '✅' && user.id === message.author.id;

  try {
    await step1.awaitReactions({ filter: filter1, max: 1, time: 15000, errors: ['time'] });
  } catch {
    await step1.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription('⏰ Đã hủy — hết thời gian xác nhận lần 1.'),
      ],
    });
    try { await step1.reactions.removeAll(); } catch { }
    return;
  }

  // ── BƯỚC 2: Xác nhận lần 2 (reaction ⚠️) ──
  const step2 = await message.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xFF4400)
        .setTitle('🚨 XÁC NHẬN LẦN 2/3')
        .setDescription(
          `Bạn **thật sự chắc chắn** muốn xóa **${keys.length} key**?\n\n` +
          `Bao gồm:\n` +
          `> 💰 Thương mại: **${keys.filter(k => (k.category || 'thuongmai') === 'thuongmai').length}** key\n` +
          `> 🎁 Miễn phí: **${keys.filter(k => k.category === 'mienphi').length}** key\n` +
          `> 🧪 Dùng thử: **${keys.filter(k => k.category === 'test').length}** key\n\n` +
          `Bấm ⚠️ trong 15 giây để tiếp tục.`
        ),
    ],
  });
  await step2.react('⚠️');

  const filter2 = (reaction, user) =>
    reaction.emoji.name === '⚠️' && user.id === message.author.id;

  try {
    await step2.awaitReactions({ filter: filter2, max: 1, time: 15000, errors: ['time'] });
  } catch {
    await step2.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription('⏰ Đã hủy — hết thời gian xác nhận lần 2.'),
      ],
    });
    try { await step2.reactions.removeAll(); } catch { }
    return;
  }

  // ── BƯỚC 3: Xác nhận lần 3 (gõ "xac nhan") ──
  const step3 = await message.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('🔴 XÁC NHẬN LẦN CUỐI 3/3')
        .setDescription(
          `**Gõ \`xac nhan\` trong 30 giây** để xóa toàn bộ ${keys.length} key.\n\n` +
          `⚠️ Sau bước này, TẤT CẢ KEY sẽ bị xóa vĩnh viễn!`
        ),
    ],
  });

  const msgFilter = (m) =>
    m.author.id === message.author.id && m.content.trim().toLowerCase() === 'xac nhan';

  try {
    const collected = await message.channel.awaitMessages({
      filter: msgFilter,
      max: 1,
      time: 30000,
      errors: ['time'],
    });

    // Xóa tin nhắn "xac nhan" của user
    try { await collected.first().delete(); } catch { }
  } catch {
    await step3.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription('⏰ Đã hủy — không nhận được xác nhận lần cuối.'),
      ],
    });
    return;
  }

  // ── THỰC HIỆN XÓA ──
  const progressMsg = await message.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xFFAA00)
        .setDescription(`🗑️ Đang xóa ${keys.length} key... Vui lòng chờ.`),
    ],
  });

  let successCount = 0;
  let failCount = 0;

  for (const key of keys) {
    const ok = await deleteKey(key.key);
    if (ok) successCount++;
    else failCount++;
  }

  // Kết quả
  const resultEmbed = new EmbedBuilder()
    .setColor(failCount === 0 ? SUCCESS_COLOR : ERROR_COLOR)
    .setTitle('🗑️ Kết Quả Xóa Toàn Bộ Key')
    .setDescription(
      `✅ Đã xóa thành công: **${successCount}** key\n` +
      (failCount > 0 ? `❌ Thất bại: **${failCount}** key\n` : '') +
      `\n*Tổng cộng: ${successCount + failCount} key đã xử lý.*`
    )
    .setTimestamp();

  await progressMsg.edit({ embeds: [resultEmbed] });

  // Xóa reactions cũ
  try { await step1.reactions.removeAll(); } catch { }
  try { await step2.reactions.removeAll(); } catch { }
}
