const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const storage = require('../../utils/storage');
const { checkPermissionAndReply } = require('../../utils/permissionHelper');
const { sendNotificationWithMenu } = require('../../utils/menuManager');
const { getRoleMention } = require('../../utils/roleManager');
const { weeklyNotifications, dayNames, guildTemplates, scheduleMessages } = require('../../utils/notificationState');
const { getWeekendYentiecTime } = require('../../utils/yentiecReminder');

// Chuyển đổi thứ (2-8) sang JavaScript day (0-6, 0 = Chủ nhật)
function convertToJsDay(thu) {
  if (thu === 8) return 0; // Chủ nhật
  return thu - 1; // Thứ 2-7 -> 1-6
}

// Hàm tạo thanh tiến trình
function createProgressBar(current, total) {
  const percentage = Math.min(100, Math.round((current / total) * 100));
  const filledBlocks = Math.round(percentage / 10);
  const emptyBlocks = 10 - filledBlocks;
  const bar = '▓'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
  return `${bar} ${percentage}%`;
}

// Hàm format thời gian còn lại
function formatTimeRemaining(ms) {
  const totalMinutes = Math.floor(ms / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours} giờ ${minutes} phút`;
  }
  return `${minutes} phút`;
}

// Mapping thứ trong tuần (0=CN, 1=T2, ...)
const dayOfWeekNames = {
  0: 'Chủ nhật',
  1: 'Thứ 2',
  2: 'Thứ 3',
  3: 'Thứ 4',
  4: 'Thứ 5',
  5: 'Thứ 6',
  6: 'Thứ 7'
};

// Hàm kiểm tra tuần sau
function isNextWeek(date) {
  const now = new Date();
  const vnOffset = 7 * 60;
  const localOffset = now.getTimezoneOffset();
  const vnNow = new Date(now.getTime() + (localOffset + vnOffset) * 60 * 1000);
  const vnDate = new Date(date.getTime() + (localOffset + vnOffset) * 60 * 1000);

  const dayDiff = Math.floor((vnDate - vnNow) / (24 * 60 * 60 * 1000));
  return dayDiff >= 7;
}

// Hàm format ngày giờ theo giờ VN (có thứ và kiểm tra tuần sau)
function formatVNDateTime(date) {
  const vnOffset = 7 * 60;
  const localOffset = date.getTimezoneOffset();
  const vnDate = new Date(date.getTime() + (localOffset + vnOffset) * 60 * 1000);

  const dayOfWeek = dayOfWeekNames[vnDate.getDay()];
  const day = vnDate.getDate().toString().padStart(2, '0');
  const month = (vnDate.getMonth() + 1).toString().padStart(2, '0');
  const year = vnDate.getFullYear();
  const hours = vnDate.getHours().toString().padStart(2, '0');
  const mins = vnDate.getMinutes().toString().padStart(2, '0');

  const nextWeekStr = isNextWeek(date) ? ' (Tuần sau)' : '';

  return `${dayOfWeek}, ngày ${day}/${month}/${year}${nextWeekStr} lúc ${hours}h${mins}`;
}

// Hàm tìm sự kiện tiếp theo gần nhất sau thời điểm cho trước
function getNextClosestEvent(afterTime, guildId, excludeMissionType = null) {
  let closestEvent = null;
  let closestTime = Infinity;

  for (const [id, notif] of weeklyNotifications) {
    if (notif.guildId !== guildId) continue;
    if (excludeMissionType && notif.missionType === excludeMissionType) continue;

    // Tính thời gian tiếp theo của notification này
    let nextTime;
    if (notif.isOneTime) {
      nextTime = new Date(Date.UTC(notif.year, notif.month - 1, notif.day, notif.hours - 7, notif.minutes)).getTime();
    } else if (notif.isDaily) {
      const now = new Date();
      const vnOffset = 7 * 60;
      const localOffset = now.getTimezoneOffset();
      const vnNow = new Date(now.getTime() + (localOffset + vnOffset) * 60 * 1000);
      const next = new Date(vnNow);
      next.setHours(notif.hours, notif.minutes, 0, 0);
      if (next <= vnNow) next.setDate(next.getDate() + 1);
      nextTime = new Date(next.getTime() - (localOffset + vnOffset) * 60 * 1000).getTime();
    } else {
      nextTime = getNextOccurrence(notif.thu, notif.hours, notif.minutes).getTime();
    }

    if (nextTime > afterTime && nextTime < closestTime) {
      closestTime = nextTime;
      closestEvent = {
        ...notif,
        nextTime: new Date(nextTime)
      };
    }
  }

  return closestEvent;
}

// Tính thời gian đến lần gửi tiếp theo (theo múi giờ Việt Nam UTC+7)
function getNextOccurrence(targetDay, hours, minutes) {
  // Lấy thời gian hiện tại theo UTC+7 (Vietnam)
  const now = new Date();
  const vnOffset = 7 * 60; // Vietnam is UTC+7
  const localOffset = now.getTimezoneOffset(); // Local offset in minutes (negative for east of UTC)
  const vnNow = new Date(now.getTime() + (localOffset + vnOffset) * 60 * 1000);

  const jsDay = convertToJsDay(targetDay);

  // Tạo next date theo giờ Vietnam
  const next = new Date(vnNow);
  next.setHours(hours, minutes, 0, 0);

  const currentDay = vnNow.getDay();
  let daysToAdd = jsDay - currentDay;

  if (daysToAdd < 0) {
    daysToAdd += 7;
  } else if (daysToAdd === 0 && next <= vnNow) {
    daysToAdd = 7;
  }

  next.setDate(next.getDate() + daysToAdd);

  // Chuyển lại về UTC để tính delay chính xác
  const nextUtc = new Date(next.getTime() - (localOffset + vnOffset) * 60 * 1000);
  return nextUtc;
}

// Footer mặc định
const FOOTER_TEXT = 'Lang Gia Các - nơi tụ tập các anh hùng.';

// Hàm lấy lịch sự kiện guild trong tuần
function getWeeklySchedule(guildId) {
  const events = [];
  const dailyEvents = [];
  const now = Date.now();
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

  for (const [id, notif] of weeklyNotifications) {
    if (notif.guildId !== guildId || !notif.isGuildMission) continue;

    const template = guildTemplates[notif.missionType];
    if (!template) continue;

    let nextTime;
    if (notif.isDaily) {
      dailyEvents.push({
        name: template.eventName,
        emoji: template.emoji,
        missionType: notif.missionType
      });
      continue;
    } else {
      nextTime = getNextOccurrence(notif.thu, notif.hours, notif.minutes).getTime();
    }

    if (nextTime - now <= oneWeekMs) {
      events.push({
        name: template.eventName,
        emoji: template.emoji,
        time: new Date(nextTime),
        hours: notif.hours,
        minutes: notif.minutes
      });
    }
  }

  if (events.length === 0 && dailyEvents.length === 0) return null;

  events.sort((a, b) => a.time - b.time);

  const vnOffset = 7 * 60;
  const localOffset = new Date().getTimezoneOffset();
  const dayGroups = new Map();

  for (const e of events) {
    const vnDate = new Date(e.time.getTime() + (localOffset + vnOffset) * 60 * 1000);
    const dayKey = `${vnDate.getFullYear()}-${vnDate.getMonth()}-${vnDate.getDate()}`;

    if (!dayGroups.has(dayKey)) {
      dayGroups.set(dayKey, {
        dayName: dayOfWeekNames[vnDate.getDay()],
        day: vnDate.getDate().toString().padStart(2, '0'),
        month: (vnDate.getMonth() + 1).toString().padStart(2, '0'),
        events: []
      });
    }

    const timeStr = `${e.hours.toString().padStart(2, '0')}:${e.minutes.toString().padStart(2, '0')}`;
    dayGroups.get(dayKey).events.push({ emoji: e.emoji, name: e.name, time: timeStr });
  }

  let output = '';

  for (const [key, group] of dayGroups) {
    output += `📆 **${group.dayName.toUpperCase()} (${group.day}/${group.month})**\n`;
    for (const e of group.events) {
      output += `   ${e.emoji} ${e.name}     ${e.time}\n`;
    }
    output += '\n';
  }

  if (dailyEvents.length > 0) {
    output += '─────────────────────────────\n';
    for (const e of dailyEvents) {
      if (e.missionType === 'YenTiec') {
        output += `${e.emoji} **${e.name}**: MỖI NGÀY\n`;
        output += `   T2-T6: **21h00** | T7-CN: **19h00**\n`;
      } else {
        output += `${e.emoji} **${e.name}** - Mỗi ngày\n`;
      }
    }
  }

  output += `\n💡 \`?nhacnho\` để đăng ký nhắc sự kiện`;

  return output.trim();
}

// Load notifications từ file khi module được import
function initializeNotifications(client) {
  const savedNotifications = storage.loadNotifications();

  savedNotifications.forEach(notification => {
    const now = Date.now();
    let nextTime;

    if (notification.isOneTime) {
      // One-time notification - tính theo múi giờ Việt Nam (UTC+7)
      const targetDate = new Date(Date.UTC(notification.year, notification.month - 1, notification.day, notification.hours - 7, notification.minutes));
      nextTime = targetDate.getTime();

      // Nếu đã qua thời gian, bỏ qua
      if (nextTime <= now) {
        console.log(`⏭️ Bỏ qua thông báo 1 lần đã qua: ${notification.title}`);
        return;
      }
    } else if (notification.isDaily) {
      // Daily notification
      const now = new Date();
      const vnOffset = 7 * 60;
      const localOffset = now.getTimezoneOffset();
      const vnNow = new Date(now.getTime() + (localOffset + vnOffset) * 60 * 1000);
      const next = new Date(vnNow);

      // YenTiec: Tự động tính giờ dựa trên ngày trong tuần
      // Weekend: dùng preference đã lưu (19h hoặc 22h30), Weekday: 21h
      let eventHours = notification.hours;
      let eventMinutes = notification.minutes;
      if (notification.missionType === 'YenTiec') {
        const dayOfWeek = next.getDay(); // 0=CN, 6=Thứ 7
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          const weekendTime = getWeekendYentiecTime(notification.guildId);
          eventHours = weekendTime.hours;
          eventMinutes = weekendTime.minutes;
        }
        // Weekday: giữ nguyên giờ đã nhập (hours, minutes)
      }

      next.setHours(eventHours, eventMinutes, 0, 0);

      if (next <= vnNow) {
        next.setDate(next.getDate() + 1);
        // Tính lại giờ cho ngày mới (ngày mai)
        if (notification.missionType === 'YenTiec') {
          const tomorrowDayOfWeek = next.getDay();
          if (tomorrowDayOfWeek === 0 || tomorrowDayOfWeek === 6) {
            const weekendTime = getWeekendYentiecTime(notification.guildId);
            next.setHours(weekendTime.hours, weekendTime.minutes, 0, 0);
          } else {
            next.setHours(notification.hours, notification.minutes, 0, 0); // Dùng giờ đã nhập
          }
        }
      }
      nextTime = new Date(next.getTime() - (localOffset + vnOffset) * 60 * 1000).getTime();
    } else {
      // Weekly notification
      const next = getNextOccurrence(notification.thu, notification.hours, notification.minutes);
      nextTime = next.getTime();
    }

    const delay = nextTime - now;

    // === KIỂM TRA EVENT ĐANG DIỄN RA ===
    // Nếu là guild mission, kiểm tra xem event có đang trong khoảng duration không
    if (notification.isGuildMission) {
      const template = guildTemplates[notification.missionType];
      if (template) {
        const duration = template.duration || 60; // phút

        // Tính thời gian bắt đầu của event hiện tại hoặc vừa qua
        let eventStartTime;
        if (notification.isDaily) {
          // Daily: kiểm tra event hôm nay
          const vnOffset = 7 * 60;
          const localOffset = (new Date()).getTimezoneOffset();
          const vnNow = new Date(now + (localOffset + vnOffset) * 60 * 1000);
          const todayEvent = new Date(vnNow);

          // YenTiec: Tính giờ dựa trên ngày trong tuần
          let eventHours = notification.hours;
          let eventMinutes = notification.minutes;
          if (notification.missionType === 'YenTiec') {
            const dayOfWeek = vnNow.getDay(); // 0=CN, 6=Thứ 7
            if (dayOfWeek === 0 || dayOfWeek === 6) {
              const weekendTime = getWeekendYentiecTime(notification.guildId);
              eventHours = weekendTime.hours;
              eventMinutes = weekendTime.minutes;
            }
            // Weekday: giữ nguyên giờ đã nhập
          }

          todayEvent.setHours(eventHours, eventMinutes, 0, 0);
          eventStartTime = new Date(todayEvent.getTime() - (localOffset + vnOffset) * 60 * 1000).getTime();
        } else {
          // Weekly: lùi lại 1 tuần từ nextTime
          eventStartTime = nextTime - (7 * 24 * 60 * 60 * 1000);
        }

        const eventEndTime = eventStartTime + (duration * 60 * 1000);

        // Nếu đang trong khoảng event diễn ra
        if (now >= eventStartTime && now < eventEndTime) {
          const elapsedMinutes = Math.floor((now - eventStartTime) / (60 * 1000));
          console.log(`🔄 Event ${notification.missionType} đang diễn ra (${elapsedMinutes}/${duration} phút), gửi lại thông báo...`);

          // Gửi lại notification ngay lập tức với elapsed time chính xác
          setTimeout(async () => {
            try {
              const channel = await client.channels.fetch(notification.channelId);

              let notificationTitle;
              if (template.questName) {
                notificationTitle = `${template.emoji} ${template.eventName} (Nhiệm vụ ${template.questName}) đang diễn ra!`;
              } else {
                notificationTitle = `${template.emoji} ${template.eventName} đang diễn ra!`;
              }

              const progressBar = createProgressBar(elapsedMinutes, duration);
              const remaining = duration - elapsedMinutes;

              const { createEventRoleMenu } = require('../../utils/eventRoleMenu');
              const eventMenu = createEventRoleMenu();
              const showMenu = elapsedMinutes < 15;

              // Embed đơn giản - không có description và các field thừa
              const embed = new EmbedBuilder()
                .setColor(template.color)
                .setTitle(notificationTitle)
                .addFields(
                  { name: '⏱️ Thời gian còn lại', value: formatTimeRemaining(remaining * 60 * 1000), inline: true },
                  { name: '📊 Tiến trình', value: progressBar, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'Lang Gia Các - nơi tụ tập các anh hùng.' });

              if (notification.imageUrl) {
                embed.setImage(notification.imageUrl);
              }

              // === TÌM TIN NHẮN CŨ ĐỂ EDIT THAY VÌ GỬI MỚI ===
              let sentMessage = null;
              const activeEvents = storage.loadActiveEventMessages();
              const savedEvent = activeEvents[notification.id];

              if (savedEvent && savedEvent.messageId) {
                try {
                  sentMessage = await channel.messages.fetch(savedEvent.messageId);
                  // Edit tin cũ thay vì gửi mới
                  await sentMessage.edit({
                    embeds: [embed],
                    components: showMenu ? [eventMenu] : []
                  });
                  console.log(`✅ [init] Đã edit tin nhắn cũ ${savedEvent.messageId} thay vì gửi mới`);
                } catch (fetchErr) {
                  console.log(`⚠️ [init] Không tìm thấy tin cũ ${savedEvent.messageId}, sẽ gửi mới: ${fetchErr.message}`);
                  sentMessage = null;
                }
              }

              // Nếu không tìm được tin cũ, gửi mới bằng sendNotificationWithMenu
              if (!sentMessage) {
                const roleMention = getRoleMention(channel.guild, notification.missionType);
                const emojiAndMention = roleMention ? `${roleMention} ${template.emoji}` : template.emoji;
                await channel.send(emojiAndMention);

                sentMessage = await sendNotificationWithMenu(client, channel, { embeds: [embed] });
                // Lưu message ID để lần restart sau có thể edit
                storage.saveActiveEventMessage(notification.id, notification.channelId, sentMessage.id);
              }

              // Tiếp tục update thanh tiến trình
              const updateInterval = 5 * 60 * 1000;
              let elapsed = elapsedMinutes;

              const progressIntervalId = setInterval(async () => {
                elapsed += 5;
                const rem = duration - elapsed;

                if (rem <= 0) {
                  clearInterval(progressIntervalId);

                  // Embed kết thúc đơn giản
                  const endEmbed = new EmbedBuilder()
                    .setColor(0x95A5A6)
                    .setTitle(`✅ ${template.eventName} đã kết thúc!`)
                    .addFields(
                      { name: '⏱️ Thời gian còn lại', value: 'Đã kết thúc', inline: true },
                      { name: '📊 Tiến trình', value: createProgressBar(duration, duration), inline: true }
                    )
                    .setTimestamp()
                    .setFooter({ text: FOOTER_TEXT });

                  // Edit message hiện tại thay vì gửi mới
                  try {
                    if (sentMessage && sentMessage.edit) {
                      await sentMessage.edit({ embeds: [endEmbed], components: [] });
                    }
                  } catch (e) {
                    console.log('[thongbao init] Không thể edit message kết thúc:', e.message);
                  }

                  // Xóa active event message khỏi storage
                  storage.removeActiveEventMessage(notification.id);

                  // Gửi lịch tuần sau khi event kết thúc
                  const channelKey = `${channel.guild.id}_${channel.id}`;

                  // Xóa tin nhắn lịch tuần cũ nếu có
                  const oldScheduleMsg = scheduleMessages.get(channelKey);
                  if (oldScheduleMsg) {
                    try {
                      await oldScheduleMsg.delete();
                      console.log('[thongbao init] Đã xóa tin nhắn lịch tuần cũ');
                    } catch (e) {
                      console.log('[thongbao init] Không thể xóa lịch tuần cũ:', e.message);
                    }
                    scheduleMessages.delete(channelKey);
                    storage.saveScheduleMessages(scheduleMessages);
                  }

                  // Gửi embed lịch tuần mới
                  const weeklySchedule = getWeeklySchedule(channel.guild.id);
                  if (weeklySchedule) {
                    const scheduleEmbed = new EmbedBuilder()
                      .setColor(0x3498DB)
                      .setTitle('📋 LỊCH SỰ KIỆN TUẦN NÀY')
                      .setDescription(weeklySchedule)
                      .setTimestamp()
                      .setFooter({ text: FOOTER_TEXT });
                    const newScheduleMsg = await channel.send({ embeds: [scheduleEmbed] });
                    scheduleMessages.set(channelKey, newScheduleMsg);
                    storage.saveScheduleMessages(scheduleMessages);
                  }
                } else {
                  // Embed update đơn giản
                  const newProgressBar = createProgressBar(elapsed, duration);
                  const showMenuNow = elapsed < 15;

                  const updatedEmbed = new EmbedBuilder()
                    .setColor(template.color)
                    .setTitle(notificationTitle)
                    .addFields(
                      { name: '⏱️ Thời gian còn lại', value: formatTimeRemaining(rem * 60 * 1000), inline: true },
                      { name: '📊 Tiến trình', value: newProgressBar, inline: true }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'Lang Gia Các - nơi tụ tập các anh hùng.' });

                  try {
                    await sentMessage.edit({
                      embeds: [updatedEmbed],
                      components: showMenuNow ? [eventMenu] : []
                    });
                  } catch (e) { }
                }
              }, updateInterval);

            } catch (e) {
              console.error('[initNotif] Lỗi khi gửi lại event đang diễn ra:', e);
            }
          }, 2000); // Delay 2s để bot ổn định
        }
      }
    }

    // Biến lưu message reminder để xóa sau
    let reminderMessage = null;
    let reminderMessage30 = null;

    // Hàm nhắc nhở 30 phút trước
    const sendReminder30 = async () => {
      try {
        const channel = await client.channels.fetch(notification.channelId);

        let eventName = notification.title;
        let roleMention = '';

        if (notification.isGuildMission) {
          const template = guildTemplates[notification.missionType];
          if (template) {
            eventName = template.eventName;
            roleMention = getRoleMention(channel.guild, notification.missionType);
          }
        }

        const reminderMessages = [
          `⏰ Còn 30 phút nữa là đến **${eventName}**, chuẩn bị sẵn sàng nhé!`,
          `🔔 30 phút nữa là **${eventName}**! Nhớ chuẩn bị đồ đi nha!`,
          `📣 Hey! **${eventName}** sẽ bắt đầu trong 30 phút nữa!`
        ];

        const randomMessage = reminderMessages[Math.floor(Math.random() * reminderMessages.length)];
        const messageWithMention = roleMention ? `${roleMention} ${randomMessage}` : randomMessage;
        reminderMessage30 = await channel.send(messageWithMention);
      } catch (error) {
        console.error('Lỗi khi gửi reminder 30p:', error);
      }
    };

    // Hàm nhắc nhở 15 phút trước
    const sendReminder = async () => {
      try {
        // Xóa tin nhắn 30 phút nếu có
        if (reminderMessage30) {
          try {
            await reminderMessage30.delete();
            reminderMessage30 = null;
          } catch (e) {
            console.log('[thongbao] Không thể xóa reminder 30p:', e.message);
          }
        }

        const channel = await client.channels.fetch(notification.channelId);

        // Lấy tên event để hiển thị
        let eventName = notification.title;
        let roleMention = '';

        if (notification.isGuildMission) {
          const template = guildTemplates[notification.missionType];
          if (template) {
            eventName = template.eventName; // "Boss Solo", "PvP Solo", "Yến Tiệc"
            roleMention = getRoleMention(channel.guild, notification.missionType);
          }
        }

        const reminderMessages = [
          `⏰ Còn 15 phút nữa là đến **${eventName}** rồi, mau đến!`,
          `🔔 15 phút nữa là **${eventName}**! Chuẩn bị lên đường thôi!`,
          `⚡ Hey! **${eventName}** sắp bắt đầu trong 15 phút nữa đó!`,
          `🎯 Đừng quên! Còn 15 phút là **${eventName}** rồi nhé!`,
          `💪 Chỉ còn 15 phút! **${eventName}** đang chờ bạn đây!`
        ];
        const randomMessage = reminderMessages[Math.floor(Math.random() * reminderMessages.length)];
        const messageWithMention = roleMention ? `${roleMention} ${randomMessage}` : randomMessage;
        reminderMessage = await channel.send(messageWithMention);
      } catch (error) {
        console.error('Lỗi khi gửi reminder:', error);
      }
    };

    // Setup notification timer
    const sendNotification = async () => {
      try {
        const channel = await client.channels.fetch(notification.channelId);

        // Xóa tin nhắn reminder "Chỉ còn 15 phút" nếu có
        if (reminderMessage) {
          try {
            await reminderMessage.delete();
            reminderMessage = null;
          } catch (e) {
            console.log('[thongbao] Không thể xóa reminder message:', e.message);
          }
        }

        // Xử lý guild mission với embed và thanh tiến trình
        if (notification.isGuildMission) {

          const template = guildTemplates[notification.missionType];
          if (template) {
            // Lấy role mention
            const roleMention = getRoleMention(channel.guild, notification.missionType);
            const emojiAndMention = roleMention ? `${roleMention} ${template.emoji}` : template.emoji;

            await channel.send(emojiAndMention);

            // Tạo title theo format
            let notificationTitle;
            if (template.questName) {
              notificationTitle = `${template.emoji} ${template.eventName} (Nhiệm vụ ${template.questName}) đang diễn ra!`;
            } else {
              notificationTitle = `${template.emoji} ${template.eventName} đang diễn ra!`;
            }

            // === THÊM THANH TIẾN TRÌNH ===
            const duration = template.duration || 60; // phút
            const startTime = Date.now();
            const progressBar = createProgressBar(0, duration);

            // Tính thời gian sự kiện này lần tới
            let nextSameEventTime;
            const isDaily = notification.isDaily || false;
            if (isDaily) {
              nextSameEventTime = new Date(startTime + 24 * 60 * 60 * 1000);
            } else {
              nextSameEventTime = getNextOccurrence(notification.thu, notification.hours, notification.minutes);
            }
            const nextSameEventStr = isDaily
              ? `Ngày mai lúc ${notification.hours.toString().padStart(2, '0')}h${notification.minutes.toString().padStart(2, '0')}`
              : `${dayNames[notification.thu]} ${isNextWeek(nextSameEventTime) ? '(tuần sau)' : ''} lúc ${notification.hours.toString().padStart(2, '0')}h${notification.minutes.toString().padStart(2, '0')}`;

            // Tìm sự kiện tiếp theo gần nhất (khác loại)
            const endTime = startTime + (duration * 60 * 1000);
            const nextClosestEvent = getNextClosestEvent(endTime, channel.guild.id, notification.missionType);
            let nextEventStr = 'Không có sự kiện nào được lên lịch';
            if (nextClosestEvent) {
              const eventTemplate = guildTemplates[nextClosestEvent.missionType];
              const eventName = eventTemplate ? eventTemplate.eventName : nextClosestEvent.title;
              const eventEmoji = eventTemplate ? eventTemplate.emoji : '📅';
              nextEventStr = `${eventEmoji} **${eventName}** - ${formatVNDateTime(nextClosestEvent.nextTime)}`;
            }

            const { createEventRoleMenu } = require('../../utils/eventRoleMenu');
            const eventMenu = createEventRoleMenu();

            // Embed đơn giản - không có description và các field thừa
            const embed = new EmbedBuilder()
              .setColor(template.color)
              .setTitle(notificationTitle)
              .addFields(
                { name: '⏱️ Thời gian còn lại', value: formatTimeRemaining(duration * 60 * 1000), inline: true },
                { name: '📊 Tiến trình', value: progressBar, inline: true }
              )
              .setTimestamp()
              .setFooter({ text: 'Lang Gia Các - nơi tụ tập các anh hùng.' });

            if (notification.imageUrl) {
              embed.setImage(notification.imageUrl);
            }

            // Gửi embed kèm menu
            const sentMessage = await sendNotificationWithMenu(client, channel, { embeds: [embed] });

            // Lưu message ID để khi restart có thể edit thay vì gửi mới
            storage.saveActiveEventMessage(notification.id, notification.channelId, sentMessage.id);

            // Cập nhật thanh tiến trình mỗi 5 phút
            const updateInterval = 5 * 60 * 1000;
            let elapsed = 0;

            const progressIntervalId = setInterval(async () => {
              elapsed += 5;
              const remaining = duration - elapsed;

              if (remaining <= 0) {
                clearInterval(progressIntervalId);

                // Xóa tin nhắn reminder "Chỉ còn 15 phút" nếu có
                if (reminderMessage) {
                  try {
                    await reminderMessage.delete();
                    reminderMessage = null;
                  } catch (e) {
                    console.log('[thongbao] Không thể xóa reminder message:', e.message);
                  }
                }

                // Embed kết thúc đơn giản
                const endEmbed = new EmbedBuilder()
                  .setColor(0x95A5A6)
                  .setTitle(`✅ ${template.eventName} đã kết thúc!`)
                  .addFields(
                    { name: '⏱️ Thời gian còn lại', value: 'Đã kết thúc', inline: true },
                    { name: '📊 Tiến trình', value: createProgressBar(duration, duration), inline: true }
                  )
                  .setTimestamp()
                  .setFooter({ text: FOOTER_TEXT });

                // Edit message hiện tại thay vì gửi mới
                try {
                  if (sentMessage && sentMessage.edit) {
                    await sentMessage.edit({ embeds: [endEmbed], components: [] });
                  }
                } catch (e) {
                  console.log('[thongbao] Không thể edit message kết thúc:', e.message);
                }

                // Xóa active event message khỏi storage
                storage.removeActiveEventMessage(notification.id);

                // Gửi lịch tuần sau khi event kết thúc
                const channelKey = `${channel.guild.id}_${channel.id}`;

                // Xóa tin nhắn lịch tuần cũ nếu có
                const oldScheduleMsg = scheduleMessages.get(channelKey);
                if (oldScheduleMsg) {
                  try {
                    await oldScheduleMsg.delete();
                    console.log('[thongbao] Đã xóa tin nhắn lịch tuần cũ');
                  } catch (e) {
                    console.log('[thongbao] Không thể xóa lịch tuần cũ:', e.message);
                  }
                  scheduleMessages.delete(channelKey);
                  storage.saveScheduleMessages(scheduleMessages);
                }

                // Gửi embed lịch tuần mới
                const weeklySchedule = getWeeklySchedule(channel.guild.id);
                if (weeklySchedule) {
                  const scheduleEmbed = new EmbedBuilder()
                    .setColor(0x3498DB)
                    .setTitle('📋 LỊCH SỰ KIỆN TUẦN NÀY')
                    .setDescription(weeklySchedule)
                    .setTimestamp()
                    .setFooter({ text: FOOTER_TEXT });
                  const newScheduleMsg = await channel.send({ embeds: [scheduleEmbed] });
                  // Lưu message để xóa lần sau
                  scheduleMessages.set(channelKey, newScheduleMsg);
                  storage.saveScheduleMessages(scheduleMessages);
                }
              } else {
                // Embed update đơn giản
                const newProgressBar = createProgressBar(elapsed, duration);
                const showMenu = elapsed < 15;

                const updatedEmbed = new EmbedBuilder()
                  .setColor(template.color)
                  .setTitle(notificationTitle)
                  .addFields(
                    { name: '⏱️ Thời gian còn lại', value: formatTimeRemaining(remaining * 60 * 1000), inline: true },
                    { name: '📊 Tiến trình', value: newProgressBar, inline: true }
                  )
                  .setTimestamp()
                  .setFooter({ text: 'Lang Gia Các - nơi tụ tập các anh hùng.' });

                if (notification.imageUrl) {
                  updatedEmbed.setImage(notification.imageUrl);
                }

                try {
                  if (sentMessage && sentMessage.edit) {
                    const components = showMenu ? [eventMenu] : [];
                    await sentMessage.edit({ embeds: [updatedEmbed], components });
                  }
                } catch (e) {
                  console.log('[thongbao] Không thể edit message:', e.message);
                }
              }
            }, updateInterval);
          }
        } else {
          // Thông báo thường
          const notificationText = `## Đã đến giờ mở ${notification.title}\n${notification.message}`;

          if (notification.imageUrl) {
            await channel.send({ content: notificationText, files: [notification.imageUrl] });
          } else {
            await channel.send(notificationText);
          }
        }

        // Nếu là one-time, xóa sau khi gửi
        if (notification.isOneTime) {
          weeklyNotifications.delete(notification.id);
          storage.saveNotifications(weeklyNotifications);
          console.log(`🗑️ Đã xóa thông báo 1 lần: ${notification.title}`);
        }
      } catch (error) {
        console.error('Lỗi khi gửi thông báo:', error);
      }
    };

    // Đặt timeout cho reminder 30 phút trước
    const reminderDelay30 = delay - (30 * 60 * 1000);
    if (reminderDelay30 > 0) {
      setTimeout(sendReminder30, reminderDelay30);
    }

    // Đặt timeout cho reminder (15 phút trước)
    const reminderDelay = delay - (15 * 60 * 1000);
    if (reminderDelay > 0) {
      setTimeout(sendReminder, reminderDelay);
    }

    // Hàm lên lịch lại cho lần tiếp theo (recursive scheduling)
    const scheduleNextOccurrence = () => {
      let nextTime;
      if (notification.isOneTime) {
        // One-time notification - không cần lên lịch lại
        return;
      } else if (notification.isDaily) {
        // Daily - lên lịch cho ngày mai
        const now = new Date();
        const vnOffset = 7 * 60;
        const localOffset = now.getTimezoneOffset();
        const vnNow = new Date(now.getTime() + (localOffset + vnOffset) * 60 * 1000);
        const next = new Date(vnNow);
        next.setDate(next.getDate() + 1); // Ngày mai

        // YenTiec: Tính giờ dựa trên ngày trong tuần
        let eventHours = notification.hours;
        let eventMinutes = notification.minutes;
        if (notification.missionType === 'YenTiec') {
          const dayOfWeek = next.getDay(); // 0=CN, 6=Thứ 7
          if (dayOfWeek === 0 || dayOfWeek === 6) {
            const weekendTime = getWeekendYentiecTime(notification.guildId);
            eventHours = weekendTime.hours;
            eventMinutes = weekendTime.minutes;
          }
          // Weekday: giữ nguyên giờ đã nhập
        }

        next.setHours(eventHours, eventMinutes, 0, 0);
        nextTime = new Date(next.getTime() - (localOffset + vnOffset) * 60 * 1000).getTime();
      } else {
        // Weekly - lên lịch cho tuần sau
        nextTime = getNextOccurrence(notification.thu, notification.hours, notification.minutes).getTime();
      }

      const nextDelay = nextTime - Date.now();

      // Đặt reminder 30 phút cho lần tiếp theo
      const nextReminderDelay30 = nextDelay - (30 * 60 * 1000);
      if (nextReminderDelay30 > 0) {
        setTimeout(sendReminder30, nextReminderDelay30);
      }

      // Đặt reminder 15 phút cho lần tiếp theo
      const nextReminderDelay = nextDelay - (15 * 60 * 1000);
      if (nextReminderDelay > 0) {
        setTimeout(sendReminder, nextReminderDelay);
      }

      // Đặt timeout cho notification tiếp theo
      const nextTimeoutId = setTimeout(() => {
        sendNotification();
        scheduleNextOccurrence(); // Recursive call
      }, nextDelay);

      // Cập nhật trong Map
      const notificationData = weeklyNotifications.get(notification.id);
      if (notificationData) {
        notificationData.firstTimeoutId = nextTimeoutId;
        notificationData.nextOccurrence = new Date(nextTime);
        storage.saveNotifications(weeklyNotifications);
      }
    };

    // Đặt timer cho lần đầu
    const firstTimeoutId = setTimeout(() => {
      sendNotification();

      // Nếu không phải one-time, lên lịch cho lần tiếp theo
      if (!notification.isOneTime) {
        scheduleNextOccurrence();
      }
    }, delay);

    // Lưu vào Map
    weeklyNotifications.set(notification.id, {
      ...notification,
      firstTimeoutId,
      intervalId: null,
      nextOccurrence: new Date(nextTime)
    });
  });

  console.log(`✅ Đã khôi phục ${savedNotifications.length} thông báo`);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('thongbao')
    .setDescription('Đặt thông báo lặp lại hàng tuần')
    .addStringOption(option =>
      option.setName('tieu_de')
        .setDescription('Tiêu đề thông báo')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('noi_dung')
        .setDescription('Nội dung chi tiết thông báo')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('thoi_gian')
        .setDescription('Giờ gửi (VD: 20h hoặc 20h30)')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('thu')
        .setDescription('Thứ trong tuần')
        .setRequired(true)
        .addChoices(
          { name: 'Thứ 2', value: 2 },
          { name: 'Thứ 3', value: 3 },
          { name: 'Thứ 4', value: 4 },
          { name: 'Thứ 5', value: 5 },
          { name: 'Thứ 6', value: 6 },
          { name: 'Thứ 7', value: 7 },
          { name: 'Chủ nhật', value: 8 }
        )
    )
    .addAttachmentOption(option =>
      option.setName('hinh_anh')
        .setDescription('Ảnh đính kèm (tùy chọn)')
        .setRequired(false)
    ),

  async execute(interaction) {
    // Kiểm tra quyền
    if (!await checkPermissionAndReply(interaction)) {
      return;
    }

    const title = interaction.options.getString('tieu_de');
    const message = interaction.options.getString('noi_dung');
    const timeInput = interaction.options.getString('thoi_gian');
    const thu = interaction.options.getInteger('thu');
    const attachment = interaction.options.getAttachment('hinh_anh');
    const imageUrl = attachment ? attachment.url : null;
    const channel = interaction.channel;

    // Parse thời gian
    const timeRegex = /^(\d{1,2})[hH](\d{2})?$/;
    const match = timeInput.match(timeRegex);

    if (!match) {
      return interaction.reply({
        content: '❌ Định dạng thời gian không hợp lệ! Vui lòng sử dụng format: `XXh` hoặc `XXhYY` (VD: 20h30)'
      });
    }

    const hours = parseInt(match[1], 10);
    const minutes = match[2] ? parseInt(match[2], 10) : 0;

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return interaction.reply({
        content: '❌ Thời gian không hợp lệ! Giờ phải từ 0-23 và phút phải từ 0-59.'
      });
    }

    const nextOccurrence = getNextOccurrence(thu, hours, minutes);
    const delay = nextOccurrence.getTime() - Date.now();
    const notificationId = `${interaction.user.id}_${Date.now()}`;

    // Hàm nhắc nhở 15 phút trước
    const sendReminder = async () => {
      try {
        const reminderMessages = [
          `⏰ Còn 15 phút nữa là đến **${title}** rồi, mau đến!`,
          `🔔 15 phút nữa là **${title}**! Chuẩn bị lên đường thôi!`,
          `⚡ Hey! **${title}** sắp bắt đầu trong 15 phút nữa đó!`,
          `🎯 Đừng quên! Còn 15 phút là **${title}** rồi nhé!`,
          `💪 Chỉ còn 15 phút! **${title}** đang chờ bạn đây!`
        ];
        const randomMessage = reminderMessages[Math.floor(Math.random() * reminderMessages.length)];
        await channel.send(randomMessage);
      } catch (error) {
        console.error('Lỗi khi gửi reminder:', error);
      }
    };

    // Hàm gửi thông báo
    const sendNotification = async () => {
      try {
        const notificationText = `## Đã đến giờ mở ${title}\n${message}`;
        if (imageUrl) {
          await channel.send({ content: notificationText, files: [imageUrl] });
        } else {
          await channel.send(notificationText);
        }
      } catch (error) {
        console.error('Lỗi khi gửi thông báo:', error);
      }
    };

    // Đặt timeout cho reminder (15 phút trước)
    const reminderDelay = delay - (15 * 60 * 1000);
    if (reminderDelay > 0) {
      setTimeout(sendReminder, reminderDelay);
    }

    // Hàm lên lịch lại cho lần tiếp theo (recursive scheduling)
    const scheduleNextOccurrence = () => {
      const nextTime = getNextOccurrence(thu, hours, minutes).getTime();
      const nextDelay = nextTime - Date.now();

      // Đặt reminder cho lần tiếp theo
      const nextReminderDelay = nextDelay - (15 * 60 * 1000);
      if (nextReminderDelay > 0) {
        setTimeout(sendReminder, nextReminderDelay);
      }

      // Đặt timeout cho notification tiếp theo
      const nextTimeoutId = setTimeout(() => {
        sendNotification();
        scheduleNextOccurrence(); // Recursive call
      }, nextDelay);

      // Cập nhật trong Map
      const notificationData = weeklyNotifications.get(notificationId);
      if (notificationData) {
        notificationData.firstTimeoutId = nextTimeoutId;
        notificationData.nextOccurrence = new Date(nextTime);
        storage.saveNotifications(weeklyNotifications);
      }
    };

    // Đặt timeout cho lần đầu
    const firstTimeoutId = setTimeout(() => {
      sendNotification();
      scheduleNextOccurrence(); // Lên lịch cho lần tiếp theo
    }, delay);

    // Lưu notification
    weeklyNotifications.set(notificationId, {
      firstTimeoutId,
      intervalId: null,
      notificationId,
      userId: interaction.user.id,
      channelId: channel.id,
      guildId: interaction.guild.id,
      title,
      message,
      imageUrl,
      thu,
      hours,
      minutes,
      nextOccurrence
    });

    // Lưu vào file
    storage.saveNotifications(weeklyNotifications);

    // Tính thời gian còn lại
    const delayMs = delay;
    const delayDays = Math.floor(delayMs / (24 * 60 * 60 * 1000));
    const delayHours = Math.floor((delayMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const delayMinutes = Math.floor((delayMs % (60 * 60 * 1000)) / (60 * 1000));

    // Embed xác nhận
    const confirmEmbed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('✅ Đã đặt thông báo định kỳ thành công!')
      .addFields(
        { name: '📌 Tiêu đề', value: title, inline: false },
        { name: '📝 Nội dung', value: message.substring(0, 500), inline: false },
        { name: '📅 Lịch gửi', value: `Mỗi **${dayNames[thu]}** lúc **${hours.toString().padStart(2, '0')}h${minutes.toString().padStart(2, '0')}**`, inline: false },
        { name: '⏳ Lần gửi tiếp theo', value: `${delayDays} ngày ${delayHours} giờ ${delayMinutes} phút`, inline: true },
        { name: '📍 Kênh', value: `<#${channel.id}>`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'Dùng /listthongbao để xem | /huythongbao để hủy' });

    await interaction.reply({ embeds: [confirmEmbed] });
  },

  // Exports
  weeklyNotifications,
  dayNames,
  getNextOccurrence,

  cancelNotification(notificationId) {
    const notification = weeklyNotifications.get(notificationId);
    if (notification) {
      if (notification.firstTimeoutId) clearTimeout(notification.firstTimeoutId);
      if (notification.intervalId) clearInterval(notification.intervalId);
      weeklyNotifications.delete(notificationId);
      storage.saveNotifications(weeklyNotifications);
      return true;
    }
    return false;
  },

  getUserNotifications(userId, guildId) {
    const allNotifications = [];
    let index = 1;
    for (const [id, notification] of weeklyNotifications) {
      if (notification.guildId === guildId) {
        allNotifications.push({ index, id, ...notification });
        index++;
      }
    }
    return allNotifications;
  },

  getNotificationByIndex(userId, guildId, targetIndex) {
    let currentIndex = 1;
    for (const [id, notification] of weeklyNotifications) {
      if (notification.guildId === guildId) {
        if (currentIndex === targetIndex) {
          return { id, ...notification };
        }
        currentIndex++;
      }
    }
    return null;
  },

  updateNotification(notificationId, newData, channel) {
    const notification = weeklyNotifications.get(notificationId);
    if (!notification) return false;

    if (notification.firstTimeoutId) clearTimeout(notification.firstTimeoutId);
    if (notification.intervalId) clearInterval(notification.intervalId);

    const nextOccurrence = getNextOccurrence(newData.thu, newData.hours, newData.minutes);
    const delay = nextOccurrence.getTime() - Date.now();

    // Hàm nhắc nhở 15 phút trước
    const sendReminder = async () => {
      try {
        const reminderMessages = [
          `⏰ Còn 15 phút nữa là đến **${newData.title}** rồi, mau đến!`,
          `🔔 15 phút nữa là **${newData.title}**! Chuẩn bị lên đường thôi!`,
          `⚡ Hey! **${newData.title}** sắp bắt đầu trong 15 phút nữa đó!`,
          `🎯 Đừng quên! Còn 15 phút là **${newData.title}** rồi nhé!`,
          `💪 Chỉ còn 15 phút! **${newData.title}** đang chờ bạn đây!`
        ];
        const randomMessage = reminderMessages[Math.floor(Math.random() * reminderMessages.length)];
        await channel.send(randomMessage);
      } catch (error) {
        console.error('Lỗi khi gửi reminder:', error);
      }
    };

    const sendNotification = async () => {
      try {
        const notificationText = `## Đã đến giờ mở ${newData.title}\n${newData.message}`;
        await channel.send(notificationText);
      } catch (error) {
        console.error('Lỗi khi gửi thông báo:', error);
      }
    };

    // Đặt timeout cho reminder (15 phút trước)
    const reminderDelay = delay - (15 * 60 * 1000);
    if (reminderDelay > 0) {
      setTimeout(sendReminder, reminderDelay);
    }

    // Hàm lên lịch lại cho lần tiếp theo (recursive scheduling)
    const scheduleNextOccurrence = () => {
      const nextTime = getNextOccurrence(newData.thu, newData.hours, newData.minutes).getTime();
      const nextDelay = nextTime - Date.now();

      // Đặt reminder cho lần tiếp theo
      const nextReminderDelay = nextDelay - (15 * 60 * 1000);
      if (nextReminderDelay > 0) {
        setTimeout(sendReminder, nextReminderDelay);
      }

      // Đặt timeout cho notification tiếp theo
      const nextTimeoutId = setTimeout(() => {
        sendNotification();
        scheduleNextOccurrence(); // Recursive call
      }, nextDelay);

      // Cập nhật trong Map
      const notificationData = weeklyNotifications.get(notificationId);
      if (notificationData) {
        notificationData.firstTimeoutId = nextTimeoutId;
        notificationData.nextOccurrence = new Date(nextTime);
        storage.saveNotifications(weeklyNotifications);
      }
    };

    const firstTimeoutId = setTimeout(() => {
      sendNotification();
      scheduleNextOccurrence(); // Lên lịch cho lần tiếp theo
    }, delay);

    weeklyNotifications.set(notificationId, {
      ...notification,
      firstTimeoutId,
      intervalId: null,
      title: newData.title,
      message: newData.message,
      thu: newData.thu,
      hours: newData.hours,
      minutes: newData.minutes,
      nextOccurrence
    });

    storage.saveNotifications(weeklyNotifications);

    return true;
  },

  initializeNotifications
};


