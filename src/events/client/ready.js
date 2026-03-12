const { ActivityType, EmbedBuilder } = require("discord.js");
const thongbao = require('../../commands/thongbao/thongbao');
const { scheduleWeeklyReminders } = require('../../utils/yentiecReminder');
const { DISPLAY_ROLE_NAME, OLD_DISPLAY_ROLE_NAMES } = require('../../commands/quanly/subrole/addrole');
const db = require('../../database/db');

// Constants for member check
const LEAVE_NOTIFICATION_CHANNEL = '1465959064575152263';
const ROLE_NAME = 'Kỳ Cựu';

/**
 * Check if active members in database are still in Discord guild
 * If not, mark them as left and send notification
 */
async function checkMemberPresence(client) {
  console.log('[checkMemberPresence] Đang kiểm tra thành viên...');

  // Get all users and filter active ones (left_at is null and not pending)
  const allUsers = db.getAllUsers();
  const activeMembers = allUsers.filter(u => !u.left_at && !u.discord_id.startsWith('pending_'));

  console.log(`[checkMemberPresence] Tìm thấy ${activeMembers.length} thành viên active trong database`);

  let leftCount = 0;
  const leftMembers = [];

  // Get the first guild (assuming bot is in one main guild)
  const guild = client.guilds.cache.first();
  if (!guild) {
    console.log('[checkMemberPresence] Không tìm thấy guild nào');
    return;
  }

  // Fetch all guild members to ensure cache is updated
  try {
    await guild.members.fetch();
  } catch (e) {
    console.error('[checkMemberPresence] Lỗi fetch members:', e.message);
  }

  for (const userData of activeMembers) {
    try {
      // Check if member exists in guild
      const member = guild.members.cache.get(userData.discord_id);

      if (!member) {
        // Member not in guild anymore - mark as left
        const result = db.markUserAsLeft(userData.discord_id);

        if (result.success) {
          leftCount++;
          leftMembers.push(userData);

          // Clear display preference
          db.clearUserDisplay(userData.discord_id);

          console.log(`[checkMemberPresence] Đánh dấu rời: ${userData.game_username || userData.discord_name}`);
        }
      }
    } catch (e) {
      // Member doesn't exist
    }
  }

  console.log(`[checkMemberPresence] Hoàn tất! ${leftCount} thành viên đã rời Discord`);

  // Send batch notification if any members left
  if (leftMembers.length > 0) {
    try {
      const channel = await client.channels.fetch(LEAVE_NOTIFICATION_CHANNEL);
      if (channel) {
        const kyCuuRole = guild.roles.cache.find(r => r.name === ROLE_NAME);
        const roleMention = kyCuuRole ? `<@&${kyCuuRole.id}>` : `@${ROLE_NAME}`;

        // Create member list
        const memberList = leftMembers.map((u, i) =>
          `**${i + 1}.** ${u.game_username || 'N/A'} (${u.discord_name}) - UID: ${u.game_uid || 'N/A'}`
        ).join('\n');

        const embed = new EmbedBuilder()
          .setColor(0xFF4444)
          .setTitle('⚠️ Phát hiện thành viên đã rời Discord')
          .setDescription(`Sau khi kiểm tra, bot phát hiện **${leftMembers.length}** thành viên trong guild list không còn trong Discord.\n\n💡 **Có thể họ đã rời guild.** Vui lòng kiểm tra và kick trong game nếu cần.\n\n${memberList}`)
          .setFooter({ text: '🔄 Đã tự động đánh dấu "Rời guild" và reset thông tin' })
          .setTimestamp();

        await channel.send({
          content: `${roleMention} ⚠️ **Kiểm tra khi khởi động bot**`,
          embeds: [embed]
        });
      }
    } catch (e) {
      console.error('[checkMemberPresence] Lỗi gửi thông báo:', e.message);
    }
  }
}

/**
 * Migrate old display roles to new star symbol name
 */
async function migrateDisplayRoles(client) {
  console.log('[migrateDisplayRoles] Starting migration...');
  let migratedCount = 0;

  for (const [, guild] of client.guilds.cache) {
    try {
      // Find all roles with old names
      const oldRoles = guild.roles.cache.filter(r =>
        OLD_DISPLAY_ROLE_NAMES.includes(r.name) || r.name.trim() === ''
      );

      for (const [, role] of oldRoles) {
        try {
          // Check if role has icon (display roles typically have icons)
          if (role.icon || role.unicodeEmoji) {
            await role.setName(DISPLAY_ROLE_NAME, 'Migration: Đổi tên display role sang ✦');
            migratedCount++;
            console.log(`[migrateDisplayRoles] Migrated role in ${guild.name}`);
          }
        } catch (e) {
          console.error(`[migrateDisplayRoles] Error migrating role in ${guild.name}:`, e.message);
        }
      }
    } catch (e) {
      console.error(`[migrateDisplayRoles] Error processing guild ${guild.name}:`, e.message);
    }
  }

  console.log(`[migrateDisplayRoles] Completed! Migrated ${migratedCount} roles.`);
}

// Danh sách status random
const statusList = [
  { name: 'Đang chill ở Lang Gia Các', type: ActivityType.Watching },
  { name: 'Đang chơi Where Winds Meet', type: ActivityType.Playing },
  { name: 'Đang thưởng trà ở Tuý Hoa Lâu', type: ActivityType.Watching },
  { name: 'Đang bịp ở Cửu Lưu Môn', type: ActivityType.Playing },
  { name: 'Đang chill ở Lang Gia', type: ActivityType.Watching },
  { name: 'Đang luyện kiếm ở Lang Gia', type: ActivityType.Playing },
  { name: 'Đang ngắm cảnh ở Lang Gia', type: ActivityType.Watching },
];

// Hàm lấy status ngẫu nhiên
function getRandomStatus() {
  return statusList[Math.floor(Math.random() * statusList.length)];
}

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`Bot ${client.user.tag} đã online!`);

    // Migrate old display roles sang tên mới (✦)
    await migrateDisplayRoles(client);

    // ✅ Kiểm tra thành viên còn trong Discord không
    await checkMemberPresence(client);

    // Khởi tạo notifications từ file
    thongbao.initializeNotifications(client);

    // Khởi tạo YenTiec Time Change Reminder
    // Tự động lấy channel ID từ YenTiec notification đã lưu
    const { weeklyNotifications } = require('../../utils/notificationState');
    let yentiecChannelId = null;
    for (const [id, notif] of weeklyNotifications) {
      if (notif.missionType === 'YenTiec' && notif.channelId) {
        yentiecChannelId = notif.channelId;
        break;
      }
    }

    if (yentiecChannelId) {
      scheduleWeeklyReminders(client, yentiecChannelId);
      console.log(`[yentiecReminder] Initialized with channel ${yentiecChannelId}`);
    } else {
      console.log('[yentiecReminder] No YenTiec notification found, skipping');
    }

    // Set status ban đầu (random)
    client.user.setPresence({
      activities: [getRandomStatus()],
      status: 'online',
    });

    // Random status mỗi 30 giây
    setInterval(() => {
      client.user.setPresence({
        activities: [getRandomStatus()],
        status: 'online',
      });
    }, 30 * 1000); // 30 giây
  }
};
