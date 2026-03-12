/**
 * Weekly Scheduler - Gửi embed định kỳ hàng tuần
 * 
 * Tự động gửi:
 * - Lịch Boss Guild (vào kênh boss đã đăng ký)
 * - Hướng dẫn Phòng Ảnh (vào kênh album đã đăng ký)
 * - Hướng dẫn Gieo Quẻ & Cầu Duyên (vào kênh gieoque đã đăng ký)
 * 
 * Kết hợp với inactivity timer đã có sẵn trong messageCreate.js
 */

const db = require('../database/db');
const { lastScheduleEmbed, bossChannels } = require('./bossState');
const { lastPhongAnhMessage, lastGieoQueGuideWeekly } = require('./weeklyState');

const WEEKLY_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7 ngày

/**
 * Gửi embed lịch Boss Guild (xóa cũ trước)
 */
async function sendBossScheduleEmbed(client) {
    try {
        // Lấy tất cả guild channels từ bossChannels Map
        for (const [guildId, channelId] of bossChannels) {
            try {
                const channel = await client.channels.fetch(channelId).catch(() => null);
                if (!channel) continue;

                // Xóa embed cũ nếu có
                const oldEmbedId = lastScheduleEmbed.get(channelId);
                if (oldEmbedId) {
                    try {
                        const oldMsg = await channel.messages.fetch(oldEmbedId).catch(() => null);
                        if (oldMsg) await oldMsg.delete();
                    } catch (e) { /* Ignore */ }
                }

                // Gửi embed mới
                const { createScheduleOnlyEmbed } = require('../commands/thongbao/bossguild');
                const scheduleEmbed = createScheduleOnlyEmbed();
                const newMessage = await channel.send({ embeds: [scheduleEmbed] });

                // Lưu message ID mới
                lastScheduleEmbed.set(channelId, newMessage.id);

                console.log(`[WeeklyScheduler] 📅 Gửi lịch Boss Guild tại ${channel.name}`);
            } catch (e) {
                console.error(`[WeeklyScheduler] Lỗi gửi boss schedule cho guild ${guildId}:`, e.message);
            }
        }

        if (bossChannels.size === 0) {
            console.log('[WeeklyScheduler] ⚠️ Không có kênh boss guild nào đã đăng ký');
        }
    } catch (e) {
        console.error('[WeeklyScheduler] Boss schedule error:', e.message);
    }
}

/**
 * Gửi embed Hướng dẫn Phòng Ảnh (xóa cũ trước)
 */
async function sendPhongAnhHelp(client) {
    try {
        const albumChannelId = db.getAlbumChannelId();
        if (!albumChannelId) {
            console.log('[WeeklyScheduler] ⚠️ Chưa set kênh Phòng Ảnh');
            return;
        }

        const channel = await client.channels.fetch(albumChannelId).catch(() => null);
        if (!channel) {
            console.log('[WeeklyScheduler] ⚠️ Không tìm thấy kênh Phòng Ảnh');
            return;
        }

        // Xóa embed cũ nếu có
        const oldMsgId = lastPhongAnhMessage.get(albumChannelId);
        if (oldMsgId) {
            try {
                const oldMsg = await channel.messages.fetch(oldMsgId).catch(() => null);
                if (oldMsg) await oldMsg.delete();
            } catch (e) { /* Ignore */ }
        }

        // Gửi embed mới
        const helpphonganhCommand = require('../commands/quanly/helpphonganh');
        const sentMessage = await helpphonganhCommand.execute({ channel: channel });

        if (sentMessage) {
            lastPhongAnhMessage.set(albumChannelId, sentMessage.id);
            console.log(`[WeeklyScheduler] 📸 Gửi hướng dẫn Phòng Ảnh tại ${channel.name} (ID: ${sentMessage.id})`);
        }
    } catch (e) {
        console.error('[WeeklyScheduler] Phòng Ảnh help error:', e.message);
    }
}

/**
 * Gửi embed Hướng dẫn Gieo Quẻ & Cầu Duyên (xóa cũ trước)
 */
async function sendGieoQueGuide(client) {
    try {
        const gieoQueChannelId = db.getGieoQueChannelId();
        if (!gieoQueChannelId) {
            console.log('[WeeklyScheduler] ⚠️ Chưa set kênh Gieo Quẻ');
            return;
        }

        const channel = await client.channels.fetch(gieoQueChannelId).catch(() => null);
        if (!channel) {
            console.log('[WeeklyScheduler] ⚠️ Không tìm thấy kênh Gieo Quẻ');
            return;
        }

        // Xóa embed cũ nếu có
        const oldMsgId = lastGieoQueGuideWeekly.get(gieoQueChannelId);
        if (oldMsgId) {
            try {
                const oldMsg = await channel.messages.fetch(oldMsgId).catch(() => null);
                if (oldMsg) await oldMsg.delete();
            } catch (e) { /* Ignore */ }
        }

        const guideEmbed = {
            color: 0xFFD700, // Gold
            title: '🔮 Gieo Quẻ & Cầu Duyên Mỗi Ngày 🔮',
            description: `Kênh ${channel} đã được thiết lập để gieo quẻ mỗi ngày!\n\n` +
                `👉 **\`?gieoque [câu hỏi]\`**: Xin quẻ tổng quan (công việc, tài lộc, sự nghiệp...).\n` +
                `👉 **\`?cauduyen [câu hỏi]\`**: Xin quẻ tình duyên (cho nam thanh nữ tú).\n\n` +
                `*Ví dụ: \`?gieoque hôm nay có may mắn không?\`*\n\n` +
                `⚠️ **Lưu ý:**\n` +
                `- Mỗi người chỉ được gieo **1 quẻ công danh** và **1 quẻ tình duyên** mỗi ngày.\n` +
                `- Quẻ chỉ phán cho ngày hôm nay, reset mỗi ngày mới.\n` +
                `- Bot sẽ nhắc nhở nếu kênh không có hoạt động sau 30 phút.`,
            footer: { text: '🔮 Mỗi ngày một quẻ, vận may tự đến! 🔮' }
        };

        const sentMsg = await channel.send({ embeds: [guideEmbed] });
        lastGieoQueGuideWeekly.set(gieoQueChannelId, sentMsg.id);
        console.log(`[WeeklyScheduler] 🔮 Gửi hướng dẫn Gieo Quẻ tại ${channel.name} (ID: ${sentMsg.id})`);
    } catch (e) {
        console.error('[WeeklyScheduler] Gieo Quẻ guide error:', e.message);
    }
}

/**
 * Tính thời gian đến thứ Hai tiếp theo lúc 8:00 sáng (giờ VN UTC+7)
 */
function getTimeUntilNextMonday8AM() {
    const now = new Date();
    const vnOffset = 7 * 60;
    const localOffset = now.getTimezoneOffset();
    const vnNow = new Date(now.getTime() + (localOffset + vnOffset) * 60 * 1000);

    let daysUntilMonday = (1 - vnNow.getDay() + 7) % 7;

    // Nếu hôm nay là thứ 2
    if (daysUntilMonday === 0) {
        // Nếu đã qua 8:00 → lấy tuần sau
        if (vnNow.getHours() >= 8) {
            daysUntilMonday = 7;
        }
        // Nếu chưa qua 8:00 → lấy hôm nay (daysUntilMonday = 0)
    }

    const nextMonday = new Date(vnNow);
    nextMonday.setDate(vnNow.getDate() + daysUntilMonday);
    nextMonday.setHours(8, 0, 0, 0);

    return nextMonday.getTime() - vnNow.getTime();
}

/**
 * Khởi động Weekly Scheduler
 */
function initWeeklyScheduler(client) {
    const delayMs = getTimeUntilNextMonday8AM();
    const delayHours = (delayMs / (60 * 60 * 1000)).toFixed(1);

    console.log(`[WeeklyScheduler] ⏰ Lần gửi đầu tiên sau ${delayHours} giờ (thứ 2 lúc 8:00 giờ VN)`);

    // Timer đến thứ 2 đầu tiên
    setTimeout(() => {
        // Gửi lần đầu
        console.log('[WeeklyScheduler] 🔔 Gửi embed hàng tuần...');
        sendBossScheduleEmbed(client);
        sendPhongAnhHelp(client);
        sendGieoQueGuide(client);

        // Sau đó lặp lại mỗi 7 ngày
        setInterval(() => {
            console.log('[WeeklyScheduler] 🔔 Gửi embed hàng tuần...');
            sendBossScheduleEmbed(client);
            sendPhongAnhHelp(client);
            sendGieoQueGuide(client);
        }, WEEKLY_INTERVAL);
    }, delayMs);

    console.log('[WeeklyScheduler] ✅ Đã khởi động scheduler hàng tuần');
}

module.exports = { initWeeklyScheduler };

