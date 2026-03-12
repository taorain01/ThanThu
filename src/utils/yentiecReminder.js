/**
 * YenTiec Time Change Reminder
 * Tự động nhắc @Kỳ Cựu đổi giờ Yến Tiệc trong game:
 * - Thứ 7 lúc 12h: Hỏi chọn 19h hoặc 22h30 (áp dụng cho T7 và CN)
 * - Thứ 2 lúc 12h: Nhắc đổi về 21h
 * Chỉ nhắc 1 lần, không lặp lại.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { weeklyNotifications, dayNames } = require('./notificationState');
const { saveWeekendPreference, loadWeekendPreference, saveConfirmationDate, loadConfirmationDate } = require('./storage');

// State: lưu reference để xóa khi xác nhận
const activeReminders = new Map(); // guildId -> { messageRef, mentionRef, targetTime, isWeekend }

// Config
const ROLE_NAME = 'Kỳ Cựu';

// Format giờ để hiển thị
function formatTime(hours, minutes = 0) {
    if (minutes === 0) return `${hours}h00`;
    return `${hours}h${minutes.toString().padStart(2, '0')}`;
}

// Tạo embed nhắc nhở WEEKEND (có chọn giờ)
function createWeekendReminderEmbed(guildId, previousPref) {
    const defaultTime = previousPref ? formatTime(previousPref.hours, previousPref.minutes) : '19h00';

    return new EmbedBuilder()
        .setColor(0xFF9900)
        .setTitle('⚙️ NHẮC ĐỔI GIỜ YẾN TIỆC CUỐI TUẦN!')
        .setDescription(`📢 Vui lòng **chọn giờ Yến Tiệc** cho **Thứ 7** và **Thứ 2** tuần này!\n\n🎯 **Giờ tuần trước:** ${defaultTime}\n\n⬇️ Bấm nút bên dưới để chọn giờ và xác nhận.`)
        .addFields(
            { name: '📍 Vị trí đổi trong game', value: 'Guild → Cài đặt → Yến Tiệc', inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Chọn giờ bên dưới và đổi trong game' });
}

// Tạo embed nhắc nhở WEEKDAY (chỉ nhắc đổi 21h)
function createWeekdayReminderEmbed() {
    return new EmbedBuilder()
        .setColor(0xFF9900)
        .setTitle('⚙️ NHẮC ĐỔI GIỜ YẾN TIỆC TRONG GAME!')
        .setDescription(`📢 Vui lòng **đổi giờ Yến Tiệc** trong cài đặt Guild thành **21h00**!\n\n⬇️ Bấm nút bên dưới khi đã đổi xong.`)
        .addFields(
            { name: '🎯 Giờ cần đổi', value: '**21:00**', inline: true },
            { name: '📍 Vị trí', value: 'Guild → Cài đặt → Yến Tiệc', inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Bấm nút bên dưới khi đã đổi xong' });
}

// Tạo buttons cho WEEKEND (chọn 19h, 22h30, hoặc giữ nguyên 21h)
function createWeekendButtons(guildId) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`yentiec_weekend_19_${guildId}`)
                .setLabel('🕐 19h00')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`yentiec_weekend_21_${guildId}`)
                .setLabel('🕘 Giữ nguyên 21h')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`yentiec_weekend_2230_${guildId}`)
                .setLabel('🕙 22h30')
                .setStyle(ButtonStyle.Primary)
        );
}

// Tạo button cho WEEKDAY (chỉ xác nhận 21h)
function createWeekdayButton(guildId) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`yentiec_weekday_confirm_${guildId}`)
                .setLabel('✅ Đã đổi về 21h00')
                .setStyle(ButtonStyle.Success)
        );
}

// Gửi nhắc nhở WEEKEND
async function sendWeekendReminder(channel) {
    const guildId = channel.guild.id;
    const role = channel.guild.roles.cache.find(r => r.name === ROLE_NAME);
    const roleMention = role ? `<@&${role.id}>` : '@Kỳ Cựu';

    const previousPref = loadWeekendPreference(guildId);
    const embed = createWeekendReminderEmbed(guildId, previousPref);
    const row = createWeekendButtons(guildId);

    const mentionMsg = await channel.send(roleMention);
    const embedMsg = await channel.send({ embeds: [embed], components: [row] });

    return { mentionMsg, embedMsg };
}

// Gửi nhắc nhở WEEKDAY
async function sendWeekdayReminder(channel) {
    const guildId = channel.guild.id;
    const role = channel.guild.roles.cache.find(r => r.name === ROLE_NAME);
    const roleMention = role ? `<@&${role.id}>` : '@Kỳ Cựu';

    const embed = createWeekdayReminderEmbed();
    const row = createWeekdayButton(guildId);

    const mentionMsg = await channel.send(roleMention);
    const embedMsg = await channel.send({ embeds: [embed], components: [row] });

    return { mentionMsg, embedMsg };
}

// Gửi nhắc nhở 1 lần duy nhất
async function startReminder(channel, targetTime, isWeekend = false) {
    const guildId = channel.guild.id;

    // Xóa reminder cũ nếu có
    stopReminder(guildId);

    // Gửi 1 lần duy nhất
    const { mentionMsg, embedMsg } = isWeekend
        ? await sendWeekendReminder(channel)
        : await sendWeekdayReminder(channel);

    // Lưu state (để xóa message khi xác nhận)
    activeReminders.set(guildId, {
        messageRef: embedMsg,
        mentionRef: mentionMsg,
        targetTime,
        isWeekend,
        channelId: channel.id
    });

    console.log(`[yentiecReminder] Sent reminder for guild ${guildId}, isWeekend: ${isWeekend}, target: ${targetTime}h`);
}

// Dừng/xóa nhắc nhở
function stopReminder(guildId) {
    const data = activeReminders.get(guildId);
    if (data) {
        activeReminders.delete(guildId);
        console.log(`[yentiecReminder] Cleared for guild ${guildId}`);
        return true;
    }
    return false;
}

// Xử lý button - WEEKEND chọn giờ
async function handleConfirmButton(interaction) {
    const customId = interaction.customId;

    // === WEEKEND: Chọn 19h ===
    if (customId.startsWith('yentiec_weekend_19_')) {
        const guildId = customId.replace('yentiec_weekend_19_', '');
        return await handleWeekendChoice(interaction, guildId, 19, 0);
    }

    // === WEEKEND: Chọn giữ nguyên 21h ===
    if (customId.startsWith('yentiec_weekend_21_')) {
        const guildId = customId.replace('yentiec_weekend_21_', '');
        return await handleWeekendChoice(interaction, guildId, 21, 0, true); // skipWeekday = true
    }

    // === WEEKEND: Chọn 22h30 ===
    if (customId.startsWith('yentiec_weekend_2230_')) {
        const guildId = customId.replace('yentiec_weekend_2230_', '');
        return await handleWeekendChoice(interaction, guildId, 22, 30);
    }

    // === WEEKDAY: Xác nhận 21h ===
    if (customId.startsWith('yentiec_weekday_confirm_')) {
        const guildId = customId.replace('yentiec_weekday_confirm_', '');
        return await handleWeekdayConfirm(interaction, guildId);
    }

    // Legacy: yentiec_time_confirm_ (cho button cũ)
    if (customId.startsWith('yentiec_time_confirm_')) {
        const guildId = customId.replace('yentiec_time_confirm_', '');
        return await handleWeekdayConfirm(interaction, guildId);
    }

    return false;
}

// Xử lý chọn giờ weekend
async function handleWeekendChoice(interaction, guildId, hours, minutes, skipWeekday = false) {
    // Kiểm tra quyền Kỳ Cựu - tìm role chứa "Kỳ Cựu" thay vì tìm exact match
    const kyCuuRole = interaction.guild.roles.cache.find(r => r.name.includes('Kỳ Cựu') || r.name === ROLE_NAME);
    const isKyCuu = kyCuuRole && interaction.member.roles.cache.has(kyCuuRole.id);

    // Debug log
    console.log(`[yentiecReminder] User: ${interaction.user.username}, Role found: ${kyCuuRole?.name || 'NONE'}, Has role: ${isKyCuu}`);
    console.log(`[yentiecReminder] User roles:`, interaction.member.roles.cache.map(r => r.name).join(', '));

    if (!isKyCuu) {
        await interaction.reply({ content: '❌ Chỉ Kỳ Cựu mới được chọn giờ!', ephemeral: true });
        return true;
    }

    // Lưu preference (bao gồm cả skipWeekday flag nếu chọn giữ nguyên 21h)
    saveWeekendPreference(guildId, hours, minutes, skipWeekday);

    // Lưu ngày xác nhận để tránh hỏi lại khi bot restart
    saveConfirmationDate(guildId, 'weekend');

    // Nếu chọn giữ nguyên 21h, cũng đánh dấu weekday đã xác nhận để skip nhắc thứ 2
    if (skipWeekday) {
        saveConfirmationDate(guildId, 'weekday');
    }

    // Dừng reminder
    const data = activeReminders.get(guildId);
    stopReminder(guildId);

    const timeStr = formatTime(hours, minutes);

    // Cập nhật message
    let description;
    if (skipWeekday) {
        description = `**${interaction.user.username}** đã chọn **giữ nguyên ${timeStr}** cho Thứ 7 và Thứ 2.\n\n✅ Thứ 2 sẽ **không** nhắc đổi giờ nữa.`;
    } else {
        description = `**${interaction.user.username}** đã chọn giờ **${timeStr}** cho Thứ 7 và Thứ 2.\n\n📝 Giờ này sẽ được lưu cho các tuần tiếp theo.`;
    }

    const confirmEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ ĐÃ XÁC NHẬN GIỜ YẾN TIỆC CUỐI TUẦN!')
        .setDescription(description)
        .addFields({ name: '🎯 Giờ đã chọn', value: `**${timeStr}**`, inline: true })
        .setTimestamp();

    await interaction.update({ embeds: [confirmEmbed], components: [] });

    // Gửi lịch thông báo
    await sendScheduleEmbed(interaction, guildId);

    // Kiểm tra xem đã có thông báo YenTiec chưa và có cần gửi thêm không
    // Không cần schedule thêm nếu giữ nguyên 21h (vì đã có sẵn thông báo 21h)
    if (!skipWeekday) {
        await scheduleAdditionalNotification(interaction.client, guildId, hours, minutes);
    }

    return true;
}

// Xử lý xác nhận weekday
async function handleWeekdayConfirm(interaction, guildId) {
    // Kiểm tra quyền Kỳ Cựu - tìm role chứa "Kỳ Cựu" thay vì tìm exact match
    const kyCuuRole = interaction.guild.roles.cache.find(r => r.name.includes('Kỳ Cựu') || r.name === ROLE_NAME);
    const isKyCuu = kyCuuRole && interaction.member.roles.cache.has(kyCuuRole.id);

    if (!isKyCuu) {
        await interaction.reply({ content: '❌ Chỉ Kỳ Cựu mới được xác nhận!', ephemeral: true });
        return true;
    }

    // Dừng reminder
    stopReminder(guildId);

    // Lưu ngày xác nhận để tránh hỏi lại khi bot restart
    saveConfirmationDate(guildId, 'weekday');

    // Cập nhật message
    const confirmEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ ĐÃ XÁC NHẬN ĐỔI GIỜ YẾN TIỆC!')
        .setDescription(`**${interaction.user.username}** đã xác nhận đổi giờ Yến Tiệc thành **21h00** trong game.`)
        .setTimestamp();

    await interaction.update({ embeds: [confirmEmbed], components: [] });

    // Gửi lịch thông báo
    await sendScheduleEmbed(interaction, guildId);

    return true;
}

// Gửi embed lịch thông báo
async function sendScheduleEmbed(interaction, guildId) {
    try {
        const allNotifications = [];
        let index = 1;

        for (const [id, notification] of weeklyNotifications) {
            if (notification.guildId === guildId) {
                allNotifications.push({ index, id, ...notification });
                index++;
            }
        }

        if (allNotifications.length > 0) {
            const guildNotifications = allNotifications.filter(n => n.isGuildMission);

            if (guildNotifications.length > 0) {
                const scheduleEmbed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('📅 LỊCH THÔNG BÁO GUILD')
                    .setTimestamp()
                    .setFooter({ text: '/listthongbao để xem chi tiết' });

                const missionLabels = {
                    'YenTiec': '🎉 Yến Tiệc',
                    'BossSolo': '⚔️ Boss Solo',
                    'PvpSolo': '🏆 PvP Solo',
                    'BangChien': '🏰 Bang Chiến'
                };

                const missionTypes = ['YenTiec', 'BossSolo', 'PvpSolo', 'BangChien'];
                const scheduleLines = [];

                for (const missionType of missionTypes) {
                    const missionNotifs = guildNotifications.filter(n => n.missionType === missionType);
                    if (missionNotifs.length > 0) {
                        for (const notification of missionNotifs) {
                            const timeStr = `${notification.hours.toString().padStart(2, '0')}:${notification.minutes.toString().padStart(2, '0')}`;
                            let scheduleInfo;
                            if (notification.isDaily) {
                                scheduleInfo = `Mỗi ngày`;
                            } else {
                                scheduleInfo = dayNames[notification.thu];
                            }
                            scheduleLines.push(`${missionLabels[missionType]}: **${scheduleInfo}** lúc **${timeStr}**`);
                        }
                    }
                }

                if (scheduleLines.length > 0) {
                    scheduleEmbed.setDescription(scheduleLines.join('\n'));
                    await interaction.channel.send({ embeds: [scheduleEmbed] });
                }
            }
        }
    } catch (e) {
        console.error('[yentiecReminder] Error showing schedule:', e.message);
    }
}

// Lên lịch thông báo thêm nếu cần (khi chọn giờ khác với giờ đã thông báo)
async function scheduleAdditionalNotification(client, guildId, chosenHours, chosenMinutes) {
    try {
        // Tìm YenTiec notification cho guild này
        let yentiecNotif = null;
        for (const [id, notif] of weeklyNotifications) {
            if (notif.guildId === guildId && notif.missionType === 'YenTiec') {
                yentiecNotif = notif;
                break;
            }
        }

        if (!yentiecNotif) {
            console.log('[yentiecReminder] No YenTiec notification found, skipping additional notification');
            return;
        }

        // Tính xem hôm nay đã gửi thông báo YenTiec chưa và lúc mấy giờ
        const now = new Date();
        const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000); // Shift to VN time (UTC+7)
        const currentHour = vnNow.getUTCHours();
        const currentMinute = vnNow.getUTCMinutes();

        // Giờ đã chọn (convert to total minutes for comparison)
        const chosenTotalMinutes = chosenHours * 60 + chosenMinutes;
        const currentTotalMinutes = currentHour * 60 + currentMinute;

        // Nếu giờ chọn chưa đến và khác với giờ mặc định (19h), lên lịch thông báo
        // Ví dụ: User chọn 22h30 lúc 14h → lên lịch gửi lúc 22h30
        if (chosenTotalMinutes > currentTotalMinutes) {
            const delayMinutes = chosenTotalMinutes - currentTotalMinutes;
            const delayMs = delayMinutes * 60 * 1000;

            console.log(`[yentiecReminder] Scheduling additional notification in ${delayMinutes} minutes for ${formatTime(chosenHours, chosenMinutes)}`);

            setTimeout(async () => {
                try {
                    const channel = await client.channels.fetch(yentiecNotif.channelId);
                    if (channel) {
                        // Import thongbao để gửi notification
                        const thongbao = require('../commands/thongbao/thongbao');
                        const { guildTemplates } = require('./notificationState');
                        const template = guildTemplates['YenTiec'];

                        if (template) {
                            const { getRoleMention } = require('./roleManager');
                            const roleMention = getRoleMention(channel.guild, 'YenTiec');
                            if (roleMention) {
                                await channel.send(`${roleMention} ${template.emoji}`);
                            }

                            const { EmbedBuilder } = require('discord.js');
                            const { sendNotificationWithMenu } = require('./menuManager');

                            const embed = new EmbedBuilder()
                                .setColor(template.color)
                                .setTitle(`${template.emoji} ${template.eventName} đang diễn ra!`)
                                .addFields(
                                    { name: '⏱️ Thời gian còn lại', value: `${template.duration || 60} phút`, inline: true },
                                    { name: '📊 Tiến trình', value: '░░░░░░░░░░ 0%', inline: true }
                                )
                                .setTimestamp()
                                .setFooter({ text: 'Lang Gia Các - nơi tụ tập các anh hùng.' });

                            await sendNotificationWithMenu(client, channel, { embeds: [embed] });
                            console.log(`[yentiecReminder] Sent additional YenTiec notification at ${formatTime(chosenHours, chosenMinutes)}`);
                        }
                    }
                } catch (e) {
                    console.error('[yentiecReminder] Error sending additional notification:', e.message);
                }
            }, delayMs);
        }
    } catch (e) {
        console.error('[yentiecReminder] Error scheduling additional notification:', e.message);
    }
}

// Hàm lên lịch tự động (gọi từ bot startup)
function scheduleWeeklyReminders(client, channelId) {
    const now = new Date();
    const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000); // Shift to VN timezone (UTC+7)
    const currentDay = vnNow.getUTCDay(); // 0=CN, 6=Thứ 7
    const currentHour = vnNow.getUTCHours();

    // === KIỂM TRA GỬI NGAY KHI KHỞI ĐỘNG ===
    // Nếu bot khởi động vào Thứ 7 (sau 12h) hoặc Chủ Nhật → gửi nhắc chọn giờ weekend
    if ((currentDay === 6 && currentHour >= 12) || currentDay === 0) {
        console.log(`[yentiecReminder] Bot started on weekend (day=${currentDay}, hour=${currentHour})`);
        (async () => {
            try {
                const channel = await client.channels.fetch(channelId);
                if (channel && !activeReminders.has(channel.guild.id)) {
                    // Kiểm tra đã xác nhận trong WEEKEND này chưa (T7 hoặc CN)
                    const lastConfirm = loadConfirmationDate(channel.guild.id, 'weekend');
                    if (lastConfirm) {
                        const confirmDateAbsolute = new Date(lastConfirm + 'T00:00:00+07:00');
                        const confirmDateVn = new Date(confirmDateAbsolute.getTime() + 7 * 60 * 60 * 1000);
                        const confirmDay = confirmDateVn.getUTCDay();
                        // Nếu confirm vào T7 và hôm nay là CN (cùng weekend)
                        // Hoặc confirm hôm nay
                        const todayStr = vnNow.toISOString().split('T')[0];
                        const msSinceConfirm = now.getTime() - confirmDateAbsolute.getTime();
                        const isSameWeekend = (
                            lastConfirm === todayStr || // Confirm hôm nay
                            (confirmDay === 6 && currentDay === 0 &&
                                msSinceConfirm >= 0 && msSinceConfirm < 2 * 24 * 60 * 60 * 1000) // Confirm T7, hôm nay CN (trong 2 ngày)
                        );
                        if (isSameWeekend) {
                            console.log(`[yentiecReminder] Already confirmed this weekend (${lastConfirm}), skipping`);
                            return;
                        }
                    }
                    await startReminder(channel, 19, true); // isWeekend = true
                }
            } catch (e) {
                console.error('[yentiecReminder] Error sending immediate weekend reminder:', e.message);
            }
        })();
    }

    // Nếu bot khởi động vào Thứ 2 (sau 12h) đến Thứ 6 → gửi nhắc đổi 21h
    if ((currentDay === 1 && currentHour >= 12) || (currentDay >= 2 && currentDay <= 5)) {
        console.log(`[yentiecReminder] Bot started on weekday (day=${currentDay}, hour=${currentHour})`);
        (async () => {
            try {
                const channel = await client.channels.fetch(channelId);
                if (channel && !activeReminders.has(channel.guild.id)) {
                    // Kiểm tra đã xác nhận trong TUẦN này chưa (từ T2 đến T6)
                    const lastConfirm = loadConfirmationDate(channel.guild.id, 'weekday');
                    if (lastConfirm) {
                        const confirmDateAbsolute = new Date(lastConfirm + 'T00:00:00+07:00');
                        const confirmDateVn = new Date(confirmDateAbsolute.getTime() + 7 * 60 * 60 * 1000);
                        const confirmDay = confirmDateVn.getUTCDay();

                        const msSinceConfirm = now.getTime() - confirmDateAbsolute.getTime();
                        const daysSinceConfirm = Math.floor(msSinceConfirm / (24 * 60 * 60 * 1000));

                        // Case 1: Confirm vào T2-T6 (confirm weekday bình thường)
                        const confirmedOnWeekday = (
                            confirmDay >= 1 && confirmDay <= 5 && // Confirm vào T2-T6
                            daysSinceConfirm >= 0 && daysSinceConfirm < 5 && // Trong 5 ngày
                            currentDay >= confirmDay // Chưa quay lại thứ đã confirm
                        );

                        // Case 2: Confirm vào cuối tuần (T7/CN) - do chọn "Giữ nguyên 21h"
                        // Nếu confirm T7 (day=6) hoặc CN (day=0) và hôm nay là T2-T6, trong vòng 6 ngày
                        const confirmedOnWeekend = (
                            (confirmDay === 6 || confirmDay === 0) && // Confirm vào T7 hoặc CN
                            daysSinceConfirm <= 6 && // Trong 6 ngày (từ T7 đến T6 tuần sau = max 6 ngày)
                            currentDay >= 1 && currentDay <= 5 // Hôm nay là ngày trong tuần
                        );

                        if (confirmedOnWeekday || confirmedOnWeekend) {
                            console.log(`[yentiecReminder] Already confirmed this week (${lastConfirm}, day=${confirmDay}), skipping`);
                            return;
                        }
                    }
                    await startReminder(channel, 21, false); // isWeekend = false
                }
            } catch (e) {
                console.error('[yentiecReminder] Error sending immediate weekday reminder:', e.message);
            }
        })();
    }

    // === LÊN LỊCH CHO CÁC TUẦN SAU ===
    // Dùng recursive setTimeout thay vì setInterval để tránh drift thời gian
    const scheduleReminder = (dayOfWeek, hour, isWeekend) => {
        const calcDelay = () => {
            const calcNow = new Date();
            const calcVnNow = new Date(calcNow.getTime() + 7 * 60 * 60 * 1000); // Shift VN time

            let daysUntil = (dayOfWeek - calcVnNow.getUTCDay() + 7) % 7;
            if (daysUntil === 0) {
                if (calcVnNow.getUTCHours() >= hour) {
                    daysUntil = 7;
                }
            }

            const nextVnDate = new Date(calcVnNow);
            nextVnDate.setUTCDate(nextVnDate.getUTCDate() + daysUntil);
            nextVnDate.setUTCHours(hour, 0, 0, 0);

            const nextUtc = new Date(nextVnDate.getTime() - 7 * 60 * 60 * 1000);
            return nextUtc.getTime() - calcNow.getTime();
        };

        const scheduleNext = () => {
            const delay = calcDelay();
            console.log(`[yentiecReminder] Scheduled: ${dayOfWeek === 6 ? 'Thứ 7' : 'Thứ 2'} ${hour}h, delay: ${Math.round(delay / 60000)}mins, isWeekend: ${isWeekend}`);

            setTimeout(async () => {
                try {
                    const channel = await client.channels.fetch(channelId);
                    if (channel) {
                        // Kiểm tra đã xác nhận chưa trước khi gửi
                        const confirmType = isWeekend ? 'weekend' : 'weekday';
                        const lastConfirm = loadConfirmationDate(channel.guild.id, confirmType);
                        const checkNow = new Date();
                        const checkVnNow = new Date(checkNow.getTime() + 7 * 60 * 60 * 1000); // Shift to VN Time
                        const todayStr = checkVnNow.toISOString().split('T')[0];

                        let shouldSkip = false;
                        if (lastConfirm) {
                            if (isWeekend) {
                                // Skip nếu đã confirm hôm nay
                                shouldSkip = (lastConfirm === todayStr);
                            } else {
                                // Skip nếu đã confirm trong tuần này (T2-T6)
                                const confirmDate = new Date(lastConfirm + 'T00:00:00+07:00');
                                const daysSince = Math.floor((checkVnNow.getTime() - confirmDate.getTime()) / (24 * 60 * 60 * 1000));
                                shouldSkip = daysSince < 5;
                            }
                        }

                        if (!shouldSkip) {
                            const targetTime = isWeekend ? 19 : 21;
                            await startReminder(channel, targetTime, isWeekend);
                        } else {
                            console.log(`[yentiecReminder] Already confirmed (${lastConfirm}), skipping scheduled reminder`);
                        }
                    }
                } catch (e) {
                    console.error('[yentiecReminder] Error starting scheduled reminder:', e.message);
                }

                // Lên lịch cho tuần sau (recursive setTimeout - chính xác hơn setInterval)
                scheduleNext();
            }, delay);
        };

        scheduleNext();
    };

    // Thứ 7 (6) lúc 12h → nhắc chọn giờ weekend (19h hoặc 22h30)
    scheduleReminder(6, 12, true);

    // Thứ 2 (1) lúc 12h → nhắc đổi về 21h
    scheduleReminder(1, 12, false);
}

// Lấy giờ YenTiec cho cuối tuần (dựa trên preference đã lưu)
function getWeekendYentiecTime(guildId) {
    const pref = loadWeekendPreference(guildId);
    if (pref) {
        return { hours: pref.hours, minutes: pref.minutes };
    }
    // Default: 19h00
    return { hours: 19, minutes: 0 };
}

module.exports = {
    startReminder,
    stopReminder,
    handleConfirmButton,
    scheduleWeeklyReminders,
    activeReminders,
    getWeekendYentiecTime
};
