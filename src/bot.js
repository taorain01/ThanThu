require("dotenv").config();
const { Client, Collection, GatewayIntentBits, Partials } = require("discord.js");
const fs = require("fs");
const path = require("path");

const token = process.env.token;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers, // Required for guildMemberRemove event
    GatewayIntentBits.GuildVoiceStates, // Required for voiceStateUpdate event
    GatewayIntentBits.GuildMessageReactions, // Required for custom reaction roles
  ],
  partials: [
    Partials.Message,  // Cần để messageUpdate hoạt động với tin nhắn chưa cache
    Partials.Channel,  // Cần để xử lý channel chưa cache
    Partials.Reaction, // Cho phép fetch message phản ứng cũ
    Partials.User,
  ],
});

client.commands = new Collection();
client.commandArray = [];

// Map lưu các pending edits đang chờ xác nhận
client.pendingEdits = new Map();

// Map lưu pending guild notifications (when user needs to delete first)
client.pendingGuildNotifications = new Map();

// Map lưu pending guild delete mapping (index -> notificationId)
client.pendingGuildDelete = new Map();

// Map lưu tin nhắn event menu cuối cùng để xóa menu cũ
client.lastEventMenuMessage = new Map();

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}!`);

  // Khởi tạo dịch vụ dịch tự động
  const { initTranslateService } = require('./utils/translateService');
  initTranslateService(client);

  // Khởi tạo scheduler reset gieo quẻ & cầu duyên hàng ngày
  const { initGieoQueScheduler } = require('./utils/gieoqueScheduler');
  initGieoQueScheduler();

  // Khởi tạo voice EXP tracker (quét voice channels mỗi 60s)
  const { initVoiceExpTracker } = require('./utils/voiceExpTracker');
  initVoiceExpTracker(client);

  // Khởi tạo weekly scheduler (gửi lịch boss + hướng dẫn phòng ảnh hàng tuần)
  const { initWeeklyScheduler } = require('./utils/weeklyScheduler');
  initWeeklyScheduler(client);

  // Auto-migration: Cleanup notifications from guilds bot is no longer in
  // Delay để đảm bảo guild cache đã load xong
  setTimeout(async () => {
    try {
      const storage = require('./utils/storage');
      const savedNotifications = storage.loadNotifications();

      if (savedNotifications.length > 0) {
        const validGuildIds = new Set(client.guilds.cache.keys());

        // Safety check: Nếu cache trống, không xóa gì cả
        if (validGuildIds.size === 0) {
          console.log('⚠️ Guild cache empty, skipping notification cleanup');
          return;
        }

        const initialCount = savedNotifications.length;

        // Filter notifications - only keep those from guilds bot is still in
        const validNotifications = savedNotifications.filter(notification => {
          const isValid = validGuildIds.has(notification.guildId);

          if (!isValid) {
            console.log(`🗑️ Removing notification from guild ${notification.guildId} (bot no longer member)`);
          }

          return isValid;
        });

        const removedCount = initialCount - validNotifications.length;

        if (removedCount > 0) {
          // Convert back to Map format for saving
          const notificationMap = new Map();
          validNotifications.forEach(notif => {
            notificationMap.set(notif.id, notif);
          });

          storage.saveNotifications(notificationMap);
          console.log(`✅ Migration complete: Removed ${removedCount} notification(s) from ${removedCount} old guild(s)`);
          console.log(`📊 Remaining notifications: ${validNotifications.length}`);
        } else {
          console.log(`✅ Migration check: All ${initialCount} notification(s) are valid`);
        }
      }

      // === RESTORE SCHEDULE MESSAGES ===
      try {
        const { scheduleMessages } = require('./utils/notificationState');
        const savedScheduleMessages = storage.loadScheduleMessages();
        const entries = Object.entries(savedScheduleMessages);

        if (entries.length > 0) {
          console.log(`📋 Đang restore ${entries.length} schedule message(s)...`);
          let restored = 0;
          let failed = 0;

          for (const [key, data] of entries) {
            try {
              const channel = await client.channels.fetch(data.channelId).catch(() => null);
              if (!channel) {
                console.log(`  ⚠️ Không tìm thấy channel ${data.channelId}, bỏ qua`);
                failed++;
                continue;
              }

              const message = await channel.messages.fetch(data.messageId).catch(() => null);
              if (!message) {
                console.log(`  ⚠️ Không tìm thấy message ${data.messageId}, bỏ qua`);
                failed++;
                continue;
              }

              scheduleMessages.set(key, message);
              restored++;
            } catch (e) {
              console.log(`  ❌ Lỗi restore ${key}:`, e.message);
              failed++;
            }
          }

          // Xóa các entry không restore được khỏi file
          if (failed > 0) {
            storage.saveScheduleMessages(scheduleMessages);
          }

          console.log(`✅ Đã restore ${restored} schedule message(s), ${failed} thất bại`);
        }
      } catch (scheduleError) {
        console.error('❌ Schedule messages restore error:', scheduleError);
      }

      // === RESTORE VOICE STATE ===
      // Kết nối lại voice channel nếu bot đang trong voice trước khi restart
      try {
        const ttsService = require('./utils/ttsService');
        const savedVoiceState = storage.loadVoiceState();
        const entries = Object.entries(savedVoiceState);

        if (entries.length > 0) {
          console.log(`🎤 Đang restore ${entries.length} voice connection(s)...`);

          for (const [guildId, data] of entries) {
            try {
              const channel = await client.channels.fetch(data.channelId).catch(() => null);
              if (!channel) {
                console.log(`  ⚠️ Không tìm thấy voice channel ${data.channelId}, bỏ qua`);
                storage.removeVoiceState(guildId);
                continue;
              }

              await ttsService.joinChannel(channel);
              console.log(`  ✅ Đã kết nối lại voice: ${channel.name} (guild: ${guildId})`);
            } catch (e) {
              console.log(`  ❌ Lỗi restore voice ${guildId}:`, e.message);
              storage.removeVoiceState(guildId);
            }
          }
        }
      } catch (voiceError) {
        console.error('❌ Voice state restore error:', voiceError);
      }

    } catch (error) {
      console.error('❌ Migration error:', error);
    }
  }, 3000); // Delay 3 giây để đảm bảo guild cache đã load
});

// Load handlers
const functionFolders = fs.readdirSync(`./src/functions`);
for (const folder of functionFolders) {
  const functionFiles = fs
    .readdirSync(`./src/functions/${folder}`)
    .filter((file) => file.endsWith(".js"));
  for (const file of functionFiles) {
    require(`./functions/${folder}/${file}`)(client);
  }
}

client.handleEvents();
client.handleCommands();

client.login(token);

