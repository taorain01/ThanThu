const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const storage = require('../../utils/storage');
const { sendNotificationWithMenu } = require('../../utils/menuManager');
const { createEventRoleMenu } = require('../../utils/eventRoleMenu');
const { getRoleMention } = require('../../utils/roleManager');
const { checkPermissionAndReply } = require('../../utils/permissionHelper');
const { weeklyNotifications, dayNames, guildTemplates, activeGuildEvents, scheduleMessages } = require('../../utils/notificationState');
const { getNextOccurrence } = require('./thongbao');
const { getWeekendYentiecTime } = require('../../utils/yentiecReminder');

// Footer mặc định
const FOOTER_TEXT = 'Lang Gia Các - nơi tụ tập các anh hùng.';

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
            // Thông báo 1 lần
            nextTime = new Date(Date.UTC(notif.year, notif.month - 1, notif.day, notif.hours - 7, notif.minutes)).getTime();
        } else if (notif.isDaily) {
            // Sự kiện hàng ngày
            const now = new Date();
            const vnOffset = 7 * 60;
            const localOffset = now.getTimezoneOffset();
            const vnNow = new Date(now.getTime() + (localOffset + vnOffset) * 60 * 1000);
            const next = new Date(vnNow);
            next.setHours(notif.hours, notif.minutes, 0, 0);
            if (next <= vnNow) next.setDate(next.getDate() + 1);
            nextTime = new Date(next.getTime() - (localOffset + vnOffset) * 60 * 1000).getTime();
        } else {
            // Sự kiện hàng tuần
            nextTime = getNextOccurrence(notif.thu, notif.hours, notif.minutes).getTime();
        }

        // Chỉ xét những sự kiện sau afterTime
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

    // Kiểm tra tuần sau
    const nextWeekStr = isNextWeek(date) ? ' (Tuần sau)' : '';

    return `${dayOfWeek}, ngày ${day}/${month}/${year}${nextWeekStr} lúc ${hours}h${mins}`;
}

// Hàm kiểm tra tuần sau
function isNextWeek(date) {
    const now = new Date();
    const vnOffset = 7 * 60;
    const localOffset = now.getTimezoneOffset();
    const vnNow = new Date(now.getTime() + (localOffset + vnOffset) * 60 * 1000);
    const vnDate = new Date(date.getTime() + (localOffset + vnOffset) * 60 * 1000);

    // Lấy thứ trong tuần (0=CN)
    const dayDiff = Math.floor((vnDate - vnNow) / (24 * 60 * 60 * 1000));
    return dayDiff >= 7;
}

// Hàm lấy lịch sự kiện guild trong tuần (format Thời Gian Biểu theo ngày)
// UPDATED: Fixed 7-day display (Mon-Sun), highlight current day
// includeBangchien: nếu true thì hiển thị BC sessions từ DB
function getWeeklySchedule(guildId, includeBangchien = false) {
    const db = require('../../database/db');

    const vnOffset = 7 * 60;
    const localOffset = new Date().getTimezoneOffset();
    const now = new Date();
    const vnNow = new Date(now.getTime() + (localOffset + vnOffset) * 60 * 1000);
    const todayDayOfWeek = vnNow.getDay(); // 0=CN, 1=T2, ...

    // Tạo 7 ngày cố định từ T2 đến CN của tuần này
    const weekDays = []; // [{dayOfWeek, date, dayKey, events[]}]

    // Tìm ngày Thứ 2 của tuần này
    const monday = new Date(vnNow);
    const daysSinceMonday = (todayDayOfWeek === 0 ? 6 : todayDayOfWeek - 1);
    monday.setDate(monday.getDate() - daysSinceMonday);
    monday.setHours(0, 0, 0, 0);

    // Tạo 7 ngày: T2, T3, T4, T5, T6, T7, CN
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const dayOfWeek = d.getDay(); // 0=CN, 1=T2, ...
        weekDays.push({
            dayOfWeek,
            date: d,
            dayName: dayOfWeekNames[dayOfWeek],
            day: d.getDate().toString().padStart(2, '0'),
            month: (d.getMonth() + 1).toString().padStart(2, '0'),
            isToday: d.getDate() === vnNow.getDate() && d.getMonth() === vnNow.getMonth(),
            events: []
        });
    }

    // Thu thập sự kiện từ weeklyNotifications
    let hasYenTiec = false;

    for (const [id, notif] of weeklyNotifications) {
        if (notif.guildId !== guildId || !notif.isGuildMission) continue;

        const template = guildTemplates[notif.missionType];
        if (!template) continue;

        // Bỏ qua BangChien từ weeklyNotifications (sẽ check từ DB)
        if (notif.missionType === 'BangChien') continue;

        if (notif.isDaily) {
            hasYenTiec = true;
            continue;
        }

        // Tìm ngày tương ứng trong tuần
        // notif.thu: 2=T2, 3=T3, ..., 7=T7, 8=CN
        const targetDayOfWeek = notif.thu === 8 ? 0 : notif.thu; // Convert 8 to 0 for Sunday
        const weekDay = weekDays.find(wd => wd.dayOfWeek === targetDayOfWeek);
        if (weekDay) {
            const timeStr = `${notif.hours.toString().padStart(2, '0')}:${notif.minutes.toString().padStart(2, '0')}`;
            weekDay.events.push({
                emoji: template.emoji,
                name: template.eventName,
                time: timeStr
            });
        }
    }

    // Check BC sessions từ DB và thêm vào lịch (chỉ khi được yêu cầu)
    // Chỉ hiện BC nếu session được tạo TRONG TUẦN NÀY (sau monday 00:00)
    if (includeBangchien) {
        const satSession = db.getActiveBangchienByDay(guildId, 'sat');
        const sunSession = db.getActiveBangchienByDay(guildId, 'sun');

        // Helper: kiểm tra session có thuộc tuần này không
        const isThisWeek = (session) => {
            if (!session || !session.created_at) return false;
            const createdDate = new Date(session.created_at);
            // So sánh với monday đầu tuần (đã tính ở trên)
            return createdDate >= monday;
        };

        if (satSession && isThisWeek(satSession)) {
            const satDay = weekDays.find(wd => wd.dayOfWeek === 6); // Thứ 7
            if (satDay) {
                satDay.events.push({
                    emoji: '🏰',
                    name: 'Bang Chiến',
                    time: '19:30'
                });
            }
        }

        if (sunSession && isThisWeek(sunSession)) {
            const sunDay = weekDays.find(wd => wd.dayOfWeek === 0); // Chủ nhật
            if (sunDay) {
                sunDay.events.push({
                    emoji: '🏰',
                    name: 'Bang Chiến',
                    time: '19:30'
                });
            }
        }
    }

    // Check if any events exist
    const hasEvents = weekDays.some(wd => wd.events.length > 0) || hasYenTiec;
    if (!hasEvents) return null;

    // Format output
    let output = '';

    for (const wd of weekDays) {
        if (wd.events.length === 0) continue; // Chỉ hiện ngày có sự kiện

        const highlightIcon = wd.isToday ? '<a:khacarrow:1135980696670830683>' : '📆';
        output += `${highlightIcon} **${wd.dayName.toUpperCase()} (${wd.day}/${wd.month})**\n`;

        for (const e of wd.events) {
            output += `   ${e.emoji} ${e.name}     ${e.time}\n`;
        }
        output += '\n';
    }

    // Thêm Yến Tiệc
    if (hasYenTiec) {
        output += '─────────────────────────────\n';
        output += `🎉 **Yến Tiệc**: MỖI NGÀY\n`;
        output += `   T2-T6: **21h00**\n`;
        output += `   T7-CN: **19h30** (nếu không có BC)\n`;
    }

    // Thêm hint
    output += `\n💡 \`?nhacnho\` để đăng ký nhắc sự kiện`;

    return output.trim();
}

// FOOTER_TEXT constant for schedule embed
const FOOTER_TEXT_SCHEDULE = 'Lang Gia Các - nơi tụ tập các anh hùng.';

/**
 * Refresh/Update lịch tuần embed khi có thay đổi BC
 * @param {Client} client - Discord client
 * @param {string} guildId - Guild ID
 * @param {string} channelId - Channel ID để gửi lịch (optional, sẽ tìm từ scheduleMessages nếu không có)
 * @param {string} mode - 'edit' = edit existing message, 'resend' = delete and send new (default)
 */
async function refreshScheduleEmbed(client, guildId, channelId = null, mode = 'resend') {
    try {
        // Tìm channel từ scheduleMessages hoặc channelId được cung cấp
        let targetChannelId = channelId;
        let existingMsg = null;
        let channelKey = null;

        // Tìm trong scheduleMessages
        for (const [key, msg] of scheduleMessages) {
            if (key.startsWith(guildId + '_')) {
                targetChannelId = key.split('_')[1];
                existingMsg = msg;
                channelKey = key;
                break;
            }
        }

        if (!targetChannelId) {
            console.log('[refreshScheduleEmbed] No channel found for guild:', guildId);
            return false;
        }

        const channel = await client.channels.fetch(targetChannelId).catch(() => null);
        if (!channel) {
            console.log('[refreshScheduleEmbed] Cannot fetch channel:', targetChannelId);
            return false;
        }

        if (!channelKey) {
            channelKey = `${guildId}_${targetChannelId}`;
        }

        // Tạo embed mới (includeBangchien=true vì đây là refresh sau khi BC được tạo)
        const weeklySchedule = getWeeklySchedule(guildId, true);
        if (!weeklySchedule) {
            console.log('[refreshScheduleEmbed] No events to display');
            return false;
        }

        const scheduleEmbed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('📋 LỊCH SỰ KIỆN TUẦN NÀY')
            .setDescription(weeklySchedule)
            .setTimestamp()
            .setFooter({ text: FOOTER_TEXT_SCHEDULE });

        // MODE: EDIT - Cố gắng edit message hiện có
        if (mode === 'edit' && existingMsg) {
            try {
                await existingMsg.edit({ embeds: [scheduleEmbed] });
                console.log('[refreshScheduleEmbed] Edited existing schedule for guild:', guildId);
                return true;
            } catch (e) {
                console.log('[refreshScheduleEmbed] Cannot edit, will send new:', e.message);
                // Fallback: xóa và gửi mới nếu edit thất bại
            }
        }

        // MODE: RESEND (default) - Xóa message cũ và gửi mới
        if (existingMsg) {
            try {
                await existingMsg.delete();
                console.log('[refreshScheduleEmbed] Deleted old schedule message');
            } catch (e) {
                console.log('[refreshScheduleEmbed] Cannot delete old message:', e.message);
            }
            scheduleMessages.delete(channelKey);
            storage.saveScheduleMessages(scheduleMessages);
        }

        // Gửi embed mới
        const newScheduleMsg = await channel.send({ embeds: [scheduleEmbed] });
        scheduleMessages.set(channelKey, newScheduleMsg);
        storage.saveScheduleMessages(scheduleMessages);
        console.log('[refreshScheduleEmbed] Sent new schedule for guild:', guildId);
        return true;

    } catch (error) {
        console.error('[refreshScheduleEmbed] Error:', error.message);
        return false;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('thongbaoguild')
        .setDescription('Đặt thông báo nhiệm vụ Guild')
        .addStringOption(option =>
            option.setName('loai_nhiem_vu')
                .setDescription('Chọn loại nhiệm vụ Guild')
                .setRequired(true)
                .addChoices(
                    { name: '⚔️ BossSolo - Breaking Army (hàng tuần)', value: 'BossSolo' },
                    { name: '🏆 PvpSolo - Test Your Skill (hàng tuần)', value: 'PvpSolo' },
                    { name: '🎉 Yến Tiệc - Guild Party (mỗi ngày)', value: 'YenTiec' }
                    // BangChien đã được tích hợp vào lệnh ?bc
                )
        )
        .addStringOption(option =>
            option.setName('thoi_gian')
                .setDescription('Giờ gửi (VD: 20h hoặc 20h30)')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('thu')
                .setDescription('Thứ trong tuần (không cần cho YenTiec)')
                .setRequired(false)
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
            option.setName('anh')
                .setDescription('Ảnh đính kèm (tùy chọn)')
                .setRequired(false)
        ),

    async execute(interaction, client) {
        // Kiểm tra quyền
        if (!await checkPermissionAndReply(interaction)) {
            return;
        }

        const missionType = interaction.options.getString('loai_nhiem_vu');
        const timeInput = interaction.options.getString('thoi_gian');
        const thu = interaction.options.getInteger('thu');
        const attachment = interaction.options.getAttachment('anh');
        const imageUrl = attachment ? attachment.url : null;
        const channel = interaction.channel;
        const template = guildTemplates[missionType];

        // Kiểm tra thu cho các sự kiện hàng tuần (không phải YenTiec)
        if (missionType !== 'YenTiec' && !thu) {
            return interaction.reply({
                content: `❌ Bạn phải chọn thứ cho ${missionType}!`
            });
        }

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

        // Kiểm tra số lượng thông báo hiện có
        const existingNotifications = Array.from(weeklyNotifications.values())
            .filter(n => n.isGuildMission && n.missionType === missionType && n.guildId === interaction.guild.id)
            .sort((a, b) => {
                // Sort theo thời gian tạo để index đồng nhất
                const timeA = parseInt((a.id || a.notificationId).split('_')[1]);
                const timeB = parseInt((b.id || b.notificationId).split('_')[1]);
                return timeA - timeB;
            });

        if (existingNotifications.length >= template.limit) {
            // Vượt giới hạn - hiển thị danh sách để chọn xóa
            const embed = new EmbedBuilder()
                .setColor(0xFF9900)
                .setTitle(`⚠️ Đã đạt giới hạn thông báo ${missionType}`)
                .setDescription(`Bạn đã có **${existingNotifications.length}/${template.limit}** thông báo ${missionType}.\nHãy chọn 1 thông báo để xóa trước khi tạo mới:`);

            // Tạo buttons với customId ngắn
            const buttons = [];
            existingNotifications.forEach((notif, index) => {
                const timeStr = `${notif.hours.toString().padStart(2, '0')}h${notif.minutes.toString().padStart(2, '0')}`;
                const scheduleStr = notif.isDaily ? `Mỗi ngày lúc ${timeStr}` : `${dayNames[notif.thu]} lúc ${timeStr}`;

                embed.addFields({
                    name: `Thông báo ${index + 1}`,
                    value: scheduleStr,
                    inline: true
                });

                // CustomId với userId: delguild_BossSolo_0_userId
                buttons.push(
                    new ButtonBuilder()
                        .setCustomId(`delguild_${missionType}_${index}_${interaction.user.id}`)
                        .setLabel(`Xóa #${index + 1}`)
                        .setStyle(ButtonStyle.Danger)
                );
            });

            // Đặt tất cả buttons vào 1 ActionRow
            const row = new ActionRowBuilder().addComponents(...buttons);

            // Lưu params để tạo notification mới sau khi xóa
            if (!interaction.client.pendingGuildCreate) {
                interaction.client.pendingGuildCreate = new Map();
            }

            const key = `${interaction.guild.id}_${missionType}_${interaction.user.id}`;
            interaction.client.pendingGuildCreate.set(key, {
                missionType,
                hours,
                minutes,
                thu,
                channelId: channel.id,
                userId: interaction.user.id,
                guildId: interaction.guild.id
            });

            // Timeout sau 10 phút
            setTimeout(() => {
                interaction.client.pendingGuildCreate?.delete(key);
            }, 10 * 60 * 1000);

            return interaction.reply({ embeds: [embed], components: [row] });
        }

        // Tạo thông báo mới
        await createGuildNotification(interaction, missionType, hours, minutes, thu, channel, template, imageUrl);
    },

    guildTemplates,
    createGuildNotification,  // Export để dùng trong interactionCreate
    refreshScheduleEmbed,     // Export để BC commands gọi cập nhật lịch
    getWeeklySchedule         // Export để sử dụng ở nơi khác
};

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

// Hàm tạo embed gộp nhiều sự kiện đang diễn ra
function createMergedEventEmbed(events) {
    // events là Map<missionType, {template, elapsed, duration, message}>
    const eventArray = Array.from(events.values());

    if (eventArray.length === 0) return null;

    // Dùng màu của sự kiện đầu tiên
    const firstEvent = eventArray[0];

    const embed = new EmbedBuilder()
        .setColor(firstEvent.template.color)
        .setTitle('🎮 CÁC SỰ KIỆN ĐANG DIỄN RA')
        .setTimestamp()
        .setFooter({ text: FOOTER_TEXT });

    // Thêm field cho mỗi sự kiện
    for (const event of eventArray) {
        const remaining = event.duration - event.elapsed;
        const progressBar = createProgressBar(event.elapsed, event.duration);
        const timeStr = formatTimeRemaining(remaining * 60 * 1000);

        embed.addFields({
            name: `${event.template.emoji} ${event.template.eventName}`,
            value: `⏱️ ${timeStr} | ${progressBar}`,
            inline: false
        });
    }

    return embed;
}

// Hàm tạo guild notification
async function createGuildNotification(interaction, missionType, hours, minutes, thu, channel, template, imageUrl = null) {
    const title = template.title;
    const message = template.message;
    const isDaily = template.isDaily || false;
    const duration = template.duration || 60; // phút

    // Tính thời gian
    let nextOccurrence, delay;

    if (isDaily) {
        // Tính theo múi giờ Việt Nam (UTC+7)
        const now = new Date();
        const vnOffset = 7 * 60; // Vietnam is UTC+7
        const localOffset = now.getTimezoneOffset();
        const vnNow = new Date(now.getTime() + (localOffset + vnOffset) * 60 * 1000);

        const next = new Date(vnNow);

        // YenTiec: Tự động tính giờ dựa trên ngày trong tuần
        // Weekend: dùng preference đã lưu (19h hoặc 22h30), Weekday: dùng giờ nhập
        let eventHours = hours;
        let eventMinutes = minutes;
        if (missionType === 'YenTiec') {
            const dayOfWeek = next.getDay(); // 0=CN, 6=Thứ 7
            if (dayOfWeek === 0 || dayOfWeek === 6) {
                const weekendTime = getWeekendYentiecTime(interaction.guild.id);
                eventHours = weekendTime.hours;
                eventMinutes = weekendTime.minutes;
            }
            // Weekday: giữ nguyên giờ đã nhập (hours, minutes)
        }

        next.setHours(eventHours, eventMinutes, 0, 0);

        if (next <= vnNow) {
            next.setDate(next.getDate() + 1);
            // Tính lại giờ cho ngày mới (ngày mai)
            if (missionType === 'YenTiec') {
                const tomorrowDayOfWeek = next.getDay();
                if (tomorrowDayOfWeek === 0 || tomorrowDayOfWeek === 6) {
                    const weekendTime = getWeekendYentiecTime(interaction.guild.id);
                    next.setHours(weekendTime.hours, weekendTime.minutes, 0, 0);
                } else {
                    next.setHours(hours, minutes, 0, 0); // Dùng giờ đã nhập
                }
            }
        }

        // Chuyển lại về UTC
        nextOccurrence = new Date(next.getTime() - (localOffset + vnOffset) * 60 * 1000);
        delay = nextOccurrence.getTime() - now.getTime();
    } else {
        nextOccurrence = getNextOccurrence(thu, hours, minutes);
        delay = nextOccurrence.getTime() - Date.now();
    }

    const notificationId = `${interaction.user.id}_${Date.now()}`;

    // Lưu message reminder để xóa sau
    let reminderMessage = null;
    let reminderMessage30 = null;

    // Hàm gửi thông báo "Đang diễn ra" với thanh tiến trình
    const sendNotification = async () => {
        try {
            // Xóa tin nhắn reminder "Chỉ còn 15 phút" nếu có
            if (reminderMessage) {
                try {
                    await reminderMessage.delete();
                    reminderMessage = null;
                } catch (e) {
                    console.log('[thongbaoguild] Không thể xóa reminder message:', e.message);
                }
            }

            // Lấy role mention
            const roleMention = getRoleMention(channel.guild, missionType);
            console.log(`[thongbaoguild] DEBUG: missionType=${missionType}, roleMention=${roleMention}`);
            // Chỉ gửi role mention (không emoji)
            if (roleMention) {
                await channel.send(roleMention);
            }

            const channelKey = `${channel.guild.id}_${channel.id}`;
            const startTime = Date.now();

            // Tạo event data cho sự kiện này
            const eventData = {
                missionType,
                template,
                message,
                duration,
                elapsed: 0,
                startTime,
                imageUrl
            };

            // Kiểm tra có embed đang chạy trong channel không
            let activeData = activeGuildEvents.get(channelKey);

            if (activeData && activeData.events.size > 0) {
                // CÓ SỰ KIỆN KHÁC ĐANG CHẠY - GỘP VÀO
                console.log(`[thongbaoguild] Gộp ${missionType} vào embed đang có ${activeData.events.size} sự kiện`);

                activeData.events.set(missionType, eventData);

                // Cập nhật embed gộp
                const mergedEmbed = createMergedEventEmbed(activeData.events);
                let editSuccess = false;
                try {
                    if (activeData.messageRef && activeData.messageRef.edit) {
                        await activeData.messageRef.edit({ embeds: [mergedEmbed], components: [] });
                        editSuccess = true;
                    }
                } catch (e) {
                    console.log('[thongbaoguild] Không thể edit merged embed, gửi mới:', e.message);
                }

                // FALLBACK: Nếu edit thất bại, gửi embed mới
                if (!editSuccess) {
                    const newMessage = await sendNotificationWithMenu(interaction.client, channel, { embeds: [mergedEmbed] });
                    activeData.messageRef = newMessage;
                }

            } else {
                // KHÔNG CÓ - TẠO MỚI
                const eventMenu = createEventRoleMenu();

                let notificationTitle;
                if (template.questName) {
                    notificationTitle = `${template.emoji} ${template.eventName} (Nhiệm vụ ${template.questName}) đang diễn ra!`;
                } else {
                    notificationTitle = `${template.emoji} ${template.eventName} đang diễn ra!`;
                }

                const progressBar = createProgressBar(0, duration);
                const embed = new EmbedBuilder()
                    .setColor(template.color)
                    .setTitle(notificationTitle)
                    .addFields(
                        { name: '⏱️ Thời gian còn lại', value: formatTimeRemaining(duration * 60 * 1000), inline: true },
                        { name: '📊 Tiến trình', value: progressBar, inline: true }
                    )
                    .setTimestamp()
                    .setFooter({ text: FOOTER_TEXT });

                if (imageUrl) embed.setImage(imageUrl);

                const sentMessage = await sendNotificationWithMenu(interaction.client, channel, { embeds: [embed] });

                // Lưu vào activeGuildEvents
                activeData = {
                    messageRef: sentMessage,
                    events: new Map([[missionType, eventData]])
                };
                activeGuildEvents.set(channelKey, activeData);
            }

            // Interval cập nhật tiến trình cho sự kiện này
            const updateInterval = 5 * 60 * 1000; // 5 phút

            const progressIntervalId = setInterval(async () => {
                const currentActiveData = activeGuildEvents.get(channelKey);
                if (!currentActiveData) {
                    clearInterval(progressIntervalId);
                    return;
                }

                const myEventData = currentActiveData.events.get(missionType);
                if (!myEventData) {
                    clearInterval(progressIntervalId);
                    return;
                }

                myEventData.elapsed += 5;
                const remaining = myEventData.duration - myEventData.elapsed;

                if (remaining <= 0) {
                    // SỰ KIỆN NÀY KẾT THÚC
                    clearInterval(progressIntervalId);

                    // Gửi embed kết thúc riêng cho sự kiện này
                    const endEmbed = new EmbedBuilder()
                        .setColor(0x95A5A6)
                        .setTitle(`✅ ${template.eventName} đã kết thúc!`)
                        .addFields(
                            { name: '⏱️ Thời gian còn lại', value: 'Đã kết thúc', inline: true },
                            { name: '📊 Tiến trình', value: createProgressBar(duration, duration), inline: true }
                        )
                        .setTimestamp()
                        .setFooter({ text: FOOTER_TEXT });

                    await channel.send({ embeds: [endEmbed] });

                    // Xóa sự kiện này khỏi danh sách
                    currentActiveData.events.delete(missionType);

                    // Nếu còn sự kiện khác - cập nhật embed gộp
                    if (currentActiveData.events.size > 0) {
                        const mergedEmbed = createMergedEventEmbed(currentActiveData.events);
                        try {
                            if (currentActiveData.messageRef && currentActiveData.messageRef.edit) {
                                await currentActiveData.messageRef.edit({ embeds: [mergedEmbed], components: [] });
                            }
                        } catch (e) {
                            console.log('[thongbaoguild] Không thể edit merged embed sau khi 1 sk kết thúc:', e.message);
                        }
                    } else {
                        // Không còn sự kiện nào - xóa embed gộp và gửi lịch tuần
                        try {
                            if (currentActiveData.messageRef && currentActiveData.messageRef.delete) {
                                await currentActiveData.messageRef.delete();
                            }
                        } catch (e) { }

                        activeGuildEvents.delete(channelKey);

                        // Xóa tin nhắn lịch tuần cũ nếu có
                        const oldScheduleMsg = scheduleMessages.get(channelKey);
                        if (oldScheduleMsg) {
                            try {
                                await oldScheduleMsg.delete();
                                console.log('[thongbaoguild] Đã xóa tin nhắn lịch tuần cũ');
                            } catch (e) {
                                console.log('[thongbaoguild] Không thể xóa lịch tuần cũ:', e.message);
                            }
                            scheduleMessages.delete(channelKey);
                            storage.saveScheduleMessages(scheduleMessages);
                        }

                        // Gửi embed lịch tuần mới
                        const weeklySchedule = getWeeklySchedule(channel.guild.id, true);
                        if (weeklySchedule) {
                            const scheduleEmbed = new EmbedBuilder()
                                .setColor(0x3498DB)
                                .setTitle('📋 LỊCH SỰ KIỆN TUẦN NÀY')
                                .setDescription(weeklySchedule)
                                .setTimestamp()
                                .setFooter({ text: FOOTER_TEXT });
                            const newScheduleMsg = await channel.send({ embeds: [scheduleEmbed] });
                            // Lưu message để xoá lần sau
                            scheduleMessages.set(channelKey, newScheduleMsg);
                            storage.saveScheduleMessages(scheduleMessages);
                        }
                    }
                } else {
                    // CẬP NHẬT TIẾN TRÌNH
                    const currentActiveDataForUpdate = activeGuildEvents.get(channelKey);
                    if (!currentActiveDataForUpdate) return;

                    if (currentActiveDataForUpdate.events.size > 1) {
                        // Nhiều sự kiện - dùng embed gộp
                        const mergedEmbed = createMergedEventEmbed(currentActiveDataForUpdate.events);
                        try {
                            if (currentActiveDataForUpdate.messageRef && currentActiveDataForUpdate.messageRef.edit) {
                                await currentActiveDataForUpdate.messageRef.edit({ embeds: [mergedEmbed], components: [] });
                            }
                        } catch (e) { }
                    } else {
                        // Chỉ 1 sự kiện - dùng embed đơn
                        // Sử dụng template từ eventData thay vì closure để tránh lỗi khi sự kiện khác loại
                        const eventTemplate = myEventData.template;
                        const newProgressBar = createProgressBar(myEventData.elapsed, myEventData.duration);
                        let notificationTitle;
                        if (eventTemplate.questName) {
                            notificationTitle = `${eventTemplate.emoji} ${eventTemplate.eventName} (Nhiệm vụ ${eventTemplate.questName}) đang diễn ra!`;
                        } else {
                            notificationTitle = `${eventTemplate.emoji} ${eventTemplate.eventName} đang diễn ra!`;
                        }

                        const updatedEmbed = new EmbedBuilder()
                            .setColor(eventTemplate.color)
                            .setTitle(notificationTitle)
                            .addFields(
                                { name: '⏱️ Thời gian còn lại', value: formatTimeRemaining(remaining * 60 * 1000), inline: true },
                                { name: '📊 Tiến trình', value: newProgressBar, inline: true }
                            )
                            .setTimestamp()
                            .setFooter({ text: FOOTER_TEXT });

                        if (myEventData.imageUrl) updatedEmbed.setImage(myEventData.imageUrl);

                        try {
                            if (currentActiveDataForUpdate.messageRef && currentActiveDataForUpdate.messageRef.edit) {
                                await currentActiveDataForUpdate.messageRef.edit({ embeds: [updatedEmbed], components: [] });
                            }
                        } catch (e) { }
                    }
                }
            }, updateInterval);

        } catch (error) {
            console.error('Lỗi khi gửi thông báo Guild:', error);
        }
    };

    // Hàm nhắc nhở 30 phút trước (có select menu)
    const sendReminder30 = async () => {
        try {
            const eventName = template.eventName;
            const roleMention = getRoleMention(channel.guild, missionType);
            const eventMenu = createEventRoleMenu();

            const reminderMessages = [
                `⏰ Còn 30 phút nữa là đến **${eventName}**, chuẩn bị sẵn sàng nhé!`,
                `🔔 30 phút nữa là **${eventName}**! Nhớ chuẩn bị đồ đi nha!`,
                `📣 Hey! **${eventName}** sẽ bắt đầu trong 30 phút nữa!`
            ];

            const randomMessage = reminderMessages[Math.floor(Math.random() * reminderMessages.length)];
            const messageWithMention = roleMention ? `${roleMention} ${randomMessage}` : randomMessage;
            reminderMessage30 = await channel.send({
                content: messageWithMention,
                components: [eventMenu]
            });
        } catch (error) {
            console.error('Lỗi khi gửi reminder 30p:', error);
        }
    };

    // Hàm nhắc nhở 15 phút trước (có select menu)
    const sendReminder = async () => {
        try {
            // Xóa tin nhắn 30 phút nếu có
            if (reminderMessage30) {
                try {
                    await reminderMessage30.delete();
                    reminderMessage30 = null;
                } catch (e) {
                    console.log('[thongbaoguild] Không thể xóa reminder 30p:', e.message);
                }
            }

            const eventName = template.eventName;
            const roleMention = getRoleMention(channel.guild, missionType);
            const eventMenu = createEventRoleMenu();

            // 5 dòng nhắc nhở ngẫu nhiên
            const reminderMessages = [
                `⏰ Còn 15 phút nữa là đến **${eventName}** rồi, mau đến!`,
                `🔔 15 phút nữa là **${eventName}**! Chuẩn bị lên đường thôi!`,
                `⚡ Hey! **${eventName}** sắp bắt đầu trong 15 phút nữa đó!`,
                `🎯 Đừng quên! Còn 15 phút là **${eventName}** rồi nhé!`,
                `💪 Chỉ còn 15 phút! **${eventName}** đang chờ bạn đây!`
            ];

            const randomMessage = reminderMessages[Math.floor(Math.random() * reminderMessages.length)];
            const messageWithMention = roleMention ? `${roleMention} ${randomMessage}` : randomMessage;
            reminderMessage = await channel.send({
                content: messageWithMention,
                components: [eventMenu]
            });
        } catch (error) {
            console.error('Lỗi khi gửi reminder:', error);
        }
    };

    // Đặt timeout cho reminder 30 phút trước
    const reminderDelay30 = delay - (30 * 60 * 1000);
    if (reminderDelay30 > 0) {
        setTimeout(sendReminder30, reminderDelay30);
    }

    // Đặt timeout cho reminder 15 phút trước
    const reminderDelay = delay - (15 * 60 * 1000);
    if (reminderDelay > 0) {
        setTimeout(sendReminder, reminderDelay);
    }

    // Hàm lên lịch lại cho lần tiếp theo (recursive scheduling)
    const scheduleNextOccurrence = () => {
        let nextDelay;
        let nextTime;

        if (isDaily) {
            // Daily - lên lịch cho ngày mai
            const now = new Date();
            const vnOffset = 7 * 60;
            const localOffset = now.getTimezoneOffset();
            const vnNow = new Date(now.getTime() + (localOffset + vnOffset) * 60 * 1000);
            const next = new Date(vnNow);
            next.setDate(next.getDate() + 1); // Ngày mai

            // YenTiec: Tính giờ dựa trên ngày trong tuần
            let eventHours = hours;
            let eventMinutes = minutes;
            if (missionType === 'YenTiec') {
                const dayOfWeek = next.getDay(); // 0=CN, 6=Thứ 7
                if (dayOfWeek === 0 || dayOfWeek === 6) {
                    const weekendTime = getWeekendYentiecTime(interaction.guild.id);
                    eventHours = weekendTime.hours;
                    eventMinutes = weekendTime.minutes;
                }
                // Weekday: giữ nguyên giờ đã nhập (hours, minutes)
            }

            next.setHours(eventHours, eventMinutes, 0, 0);
            nextTime = new Date(next.getTime() - (localOffset + vnOffset) * 60 * 1000).getTime();
            nextDelay = nextTime - Date.now();
        } else {
            // Weekly - lên lịch cho tuần sau cùng thứ cùng giờ
            nextTime = getNextOccurrence(thu, hours, minutes).getTime();
            nextDelay = nextTime - Date.now();
        }

        // Đặt reminder cho lần tiếp theo (30 phút trước)
        const nextReminderDelay30 = nextDelay - (30 * 60 * 1000);
        if (nextReminderDelay30 > 0) {
            setTimeout(sendReminder30, nextReminderDelay30);
        }

        // Đặt reminder cho lần tiếp theo (15 phút trước)
        const nextReminderDelay = nextDelay - (15 * 60 * 1000);
        if (nextReminderDelay > 0) {
            setTimeout(sendReminder, nextReminderDelay);
        }

        // Đặt timeout cho notification tiếp theo
        const nextTimeoutId = setTimeout(() => {
            sendNotification();
            scheduleNextOccurrence(); // Recursive call - lên lịch tiếp
        }, nextDelay);

        // Cập nhật trong Map
        const notificationData = weeklyNotifications.get(notificationId);
        if (notificationData) {
            notificationData.firstTimeoutId = nextTimeoutId;
            notificationData.nextOccurrence = new Date(nextTime);
            storage.saveNotifications(weeklyNotifications);
        }
    };

    // Đặt timeout cho thông báo chính (lần đầu)
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
        isGuildMission: true,
        isDaily,
        missionType,
        thu: thu || null,
        hours,
        minutes,
        nextOccurrence,
        duration
    });

    storage.saveNotifications(weeklyNotifications);

    // Tính thời gian còn lại
    const delayMs = delay;
    const delayDays = Math.floor(delayMs / (24 * 60 * 60 * 1000));
    const delayHours = Math.floor((delayMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const delayMinutes = Math.floor((delayMs % (60 * 60 * 1000)) / (60 * 1000));

    // Tạo embed xác nhận
    const scheduleText = isDaily
        ? `Mỗi ngày lúc **${hours.toString().padStart(2, '0')}h${minutes.toString().padStart(2, '0')}**`
        : `Mỗi **${dayNames[thu]}** lúc **${hours.toString().padStart(2, '0')}h${minutes.toString().padStart(2, '0')}**`;

    const confirmEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('✅ Đã đặt thông báo Guild thành công!')
        .addFields(
            { name: '🎮 Nhiệm vụ', value: missionType, inline: true },
            { name: '⏱️ Thời lượng', value: `${duration} phút`, inline: true },
            { name: '📅 Lịch gửi', value: scheduleText, inline: false },
            { name: '⏳ Lần gửi tiếp theo', value: `${delayDays} ngày ${delayHours} giờ ${delayMinutes} phút`, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Dùng /listthongbao để xem | /huythongbao để hủy' });

    if (imageUrl) {
        confirmEmbed.setThumbnail(imageUrl);
    }

    await interaction.reply({ embeds: [confirmEmbed] });
}


