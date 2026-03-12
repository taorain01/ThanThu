// ============================================================
// NhacLabs License Commands — Quản lý key NhacLabs qua Discord
// Prefix: ?nl (nhac labs)
// Tất cả lệnh bắt đầu bằng ?nl được xử lý ở đây
// ============================================================

const { Events, EmbedBuilder } = require('discord.js');
const {
  generateKey,
  createKeyDoc,
  getKeyInfo,
  listAllKeys,
  blockKey,
  unblockKey,
  removeMachine,
  deleteKey,
  setCategoryKey,
  CATEGORIES,
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
          return await sendKeyList(message);
        case 'gen':
          return await cmdGen(message, args);
        case 'category':
          return await cmdCategory(message, args);
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
          `**\`${p}nl\`** hoặc **\`${p}nllist\`** — Danh sách tất cả key\n` +
          `> 📄 Phân trang 10 key/trang, lọc theo danh mục\n` +
          `> 🔍 Tìm kiếm, 🔎 Lọc, 📤 Chọn Key\n\n` +
          `**\`${p}nlinfo <key>\`** — Xem chi tiết 1 key\n` +
          `> Hiện: tier, danh mục, trạng thái, số máy\n` +
          `> Alias: \`${p}nli\``,
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
        name: '⌨️  BẢNG ALIAS TẮT',
        value:
          `\`${p}nl\` → list │ \`${p}nli\` → info │ \`${p}nlg\` \`${p}nlc\` → gen\n` +
          `\`${p}nlcat\` → category │ \`${p}nlb\` → block │ \`${p}nlpb\` → pblock\n` +
          `\`${p}nlul\` → unblock │ \`${p}nlrm\` → remove │ \`${p}nld\` → delete`,
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
// ?nllist — Đã chuyển sang dùng nlListHandlers.sendKeyList()
// Xem src/utils/nlListHandlers.js
// ══════════════════════════════════════════════════════════

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
    const dayMatch = arg.match(/^(\d+)d$/); // "30d", "7d", ...
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
