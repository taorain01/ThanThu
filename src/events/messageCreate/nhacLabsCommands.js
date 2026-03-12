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
  MAX_MACHINES,
} = require('../../utils/firebaseLicense');
const { sendKeyList } = require('../../utils/nlListHandlers');

// Bảng alias lệnh tắt → lệnh gốc
const CMD_ALIASES = {
  '': 'help',       // ?nl → help
  'help': 'help',
  'info': 'info', 'i': 'info',
  'list': 'list',
  'gen': 'gen', 'g': 'gen', 'c': 'gen', 'cap': 'gen', 'key': 'gen',
  'block': 'block', 'b': 'block',
  'pblock': 'pblock', 'pb': 'pblock',
  'unblock': 'unblock', 'ul': 'unblock',
  'remove': 'remove', 'rm': 'remove',
  'delete': 'delete', 'd': 'delete',
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
          `**\`${p}nlinfo <key>\`** — Xem chi tiết 1 key\n` +
          `> Hiện: tier, trạng thái, số máy, danh sách máy (hw_id, tên, ngày KH)\n` +
          `> Alias: \`${p}nli\`\n` +
          `> VD: \`${p}nli NL-UNL-11377F54A4-62EE4F4387\`\n\n` +
          `**\`${p}nllist\`** — Danh sách tất cả key\n` +
          `> 📄 Phân trang 10 key/trang, hiện tên máy ngắn gọn\n` +
          `> 🔍 **Tìm kiếm** — nhập vài ký tự, lọc key + tên máy chứa chuỗi đó\n` +
          `> 🔎 **Lọc** — theo: Hoạt động, Bị chặn, Đã KH, Chưa KH, PRO, UNL\n` +
          `> 📤 **Chọn Key** — nhập STT, bot gửi key dạng tin nhắn thường`,
      },
      {
        name: '🔧  TẠO KEY',
        value:
          `**\`${p}nlgen <PRO|UNL> [số lượng] [thời hạn]\`** — Tạo key mới\n` +
          `> Tier: \`PRO\` (3 máy) hoặc \`UNL\` (unlimited)\n` +
          `> Số lượng: 1–10, mặc định 1\n` +
          `> Thời hạn: \`30d\` = 30 ngày, \`7d\` = 7 ngày, bỏ trống = vĩnh viễn\n` +
          `> Key tạo bằng HMAC-SHA256, chưa lên Firebase cho đến khi user kích hoạt\n` +
          `> Alias: \`${p}nlcap\`, \`${p}nlc\`, \`${p}nlg\`\n` +
          `> VD: \`${p}nlg UNL 3\` — 3 key UNL vĩnh viễn\n` +
          `> VD: \`${p}nlg PRO 5 30d\` — 5 key PRO hết hạn 30 ngày`,
      },
      {
        name: '🗑️  XÓA KEY & MÁY',
        value:
          `**\`${p}nldelete <key>\`** — Xóa key hoàn toàn khỏi Firebase\n` +
          `> Yêu cầu xác nhận bằng reaction ✅ trong 15 giây\n` +
          `> Alias: \`${p}nld\`\n\n` +
          `**\`${p}nlremove <key> <hw_id>\`** — Xóa 1 máy khỏi key\n` +
          `> Dùng \`${p}nli <key>\` để xem danh sách hw_id trước\n` +
          `> Alias: \`${p}nlrm\`\n` +
          `> VD: \`${p}nlrm NL-PRO-XXX ABC123DEF\``,
      },
      {
        name: '🚫  CHẶN & MỞ CHẶN',
        value:
          `**\`${p}nlblock <key> [lý do]\`** — Chặn tạm thời\n` +
          `> Key bị chặn sẽ không thể kích hoạt/sử dụng\n` +
          `> Alias: \`${p}nlb\`\n` +
          `> VD: \`${p}nlb NL-PRO-XXX Vi phạm điều khoản\`\n\n` +
          `**\`${p}nlpblock <key> [lý do]\`** — Chặn vĩnh viễn\n` +
          `> Alias: \`${p}nlpb\`\n\n` +
          `**\`${p}nlunblock <key>\`** — Mở chặn key\n` +
          `> Alias: \`${p}nlul\``,
      },
      {
        name: '⌨️  BẢNG ALIAS TẮT',
        value:
          `\`${p}nl\` → help │ \`${p}nli\` → info │ \`${p}nlg\` \`${p}nlc\` \`${p}nlcap\` → gen\n` +
          `\`${p}nlb\` → block │ \`${p}nlpb\` → pblock │ \`${p}nlul\` → unblock\n` +
          `\`${p}nlrm\` → remove │ \`${p}nld\` → delete`,
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

  const embed = new EmbedBuilder()
    .setColor(info.blocked ? ERROR_COLOR : EMBED_COLOR)
    .setTitle(`🔑 Thông Tin Key`)
    .setDescription(
      `**Key:** \`${info.key}\`\n` +
      `**Tier:** ${info.tier.toUpperCase()}\n` +
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
            '❌ Cú pháp: `?nlgen <PRO|UNL> [số lượng] [thời hạn]`\n' +
            'Ví dụ:\n' +
            '• `?nlgen UNL 3` — 3 key UNL vĩnh viễn\n' +
            '• `?nlgen PRO 30d` — 1 key PRO hết hạn 30 ngày\n' +
            '• `?nlgen PRO 5 7d` — 5 key PRO hết hạn 7 ngày'
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

  // Parse args[1], args[2] — phân biệt số lượng vs thời hạn
  let count = 1;
  let days = 0;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i].toLowerCase();
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

  // Ghi tất cả key lên Firestore
  const results = await Promise.all(
    generatedKeys.map((k) => createKeyDoc(k, tierCode, days))
  );
  const successCount = results.filter(Boolean).length;
  const failCount = count - successCount;

  const keyList = generatedKeys.map((k, i) => `**${i + 1}.** \`${k}\``).join('\n');
  const daysInfo = days > 0 ? `⏰ Hết hạn: **${days} ngày** kể từ khi kích hoạt` : '♾️ Vĩnh viễn (không hết hạn)';
  const fbStatus = failCount === 0
    ? '✅ Đã lưu lên Firebase'
    : `⚠️ ${successCount}/${count} key lưu thành công`;

  const embed = new EmbedBuilder()
    .setColor(SUCCESS_COLOR)
    .setTitle(`🔧 Đã Tạo ${count} Key ${tierCode}${days > 0 ? ` (${days} ngày)` : ''}`)
    .setDescription(
      `${keyList}\n\n` +
      `${daysInfo}\n` +
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
