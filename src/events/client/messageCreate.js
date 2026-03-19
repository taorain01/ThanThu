const { EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../../database/db');

// Import member management commands
const addmemCommand = require('../../commands/quanly/addmem');
const addhelpCommand = require('../../commands/quanly/addhelp');
const memCommand = require('../../commands/quanly/mem');
const xoabcCommand = require('../../commands/quanly/xoabc');
const xoapbcCommand = require('../../commands/quanly/xoapbc');
const listmemCommand = require('../../commands/quanly/listmem');
const listidCommand = require('../../commands/quanly/listid');
const listallmemCommand = require('../../commands/quanly/listallmem');
const roiguildCommand = require('../../commands/quanly/roiguild');
const rsrejoinCommand = require('../../commands/quanly/rsrejoin');
const xoamemCommand = require('../../commands/quanly/xoamem');
const addidCommand = require('../../commands/quanly/addid');
const locmemCommand = require('../../commands/quanly/locmem');

// Import admin commands
const xoaAllCommand = require('../../commands/admin/thongbao/xoatoanbodanhsachthanhvien');
const themtienCommand = require('../../commands/admin/minigame/themtien');
const donedungCommand = require('../../commands/admin/minigame/donedung');
const addnhuafullCommand = require('../../commands/admin/minigame/addnhuafull');
const resetplayerCommand = require('../../commands/admin/minigame/resetplayer');
const cleardungCommand = require('../../commands/admin/minigame/cleardung');

// Import apps commands
const randomCommand = require('../../commands/apps/random');
const chonCommand = require('../../commands/apps/chon');

// Import minigame commands
const balanceCommand = require('../../commands/minigame/balance');
const dailyCommand = require('../../commands/minigame/daily');
const shopCommand = require('../../commands/minigame/shop');
const buyCommand = require('../../commands/minigame/buy');
const dismantleCommand = require('../../commands/minigame/dismantle');
const inventoryCommand = require('../../commands/minigame/inventory');
const tuneCommand = require('../../commands/minigame/tune');
const equipCommand = require('../../commands/minigame/equip');
const leaderboardCommand = require('../../commands/minigame/leaderboard');
const dungeonCommand = require('../../commands/minigame/dungeon');
const banCommand = require('../../commands/minigame/ban');
const nhuaCommand = require('../../commands/minigame/nhua');

// Import gieoque commands
const gieoqueCommand = require('../../commands/gieoque/gieoque');
const setgieoqueCommand = require('../../commands/gieoque/setgieoque');
const resetqueCommand = require('../../commands/gieoque/resetque');
const checkapiCommand = require('../../commands/admin/checkapi');

// State for timeouts/reminders
// Map<channelId, timeoutId>
const gieoqueReminders = new Map();
const GIEOQUE_INACTIVITY_TIME = 60 * 60 * 1000; // 1 giờ
// Dùng shared state từ weeklyState để cả inactivity timer và weekly scheduler cùng track
const {
    lastGieoQueGuideWeekly: lastGieoQueGuide,
    lastPhongAnhMessage,
    gieoQueGuideSentWeek,
    phongAnhGuideSentWeek,
    getCurrentWeekMonday,
    getCurrentWeekMonday8AM
} = require('../../utils/weeklyState');

// Map<channelId, timeoutId> for phonganh help
const phongAnhReminders = new Map();
const PHONGANH_INACTIVITY_TIME = 30 * 60 * 1000; // 30 phút


// Import thongbao commands
const bossguildCommand = require('../../commands/thongbao/bossguild');
const bangchienCommand = require('../../commands/bangchien/bangchien');
const { finalizedParties, scheduleTimers, bossChannels, lastScheduleEmbed, PRE_REGISTER_CHANNEL_ID, addPreRegistration, removePreRegistration, getPreRegistrations, clearPreRegistrations } = require('../../utils/bossState');
const { bangchienFinalizedParties } = require('../../utils/bangchienState');
const { createScheduleOnlyEmbed } = require('../../commands/thongbao/bossguild');
// Thời gian chờ trước khi gửi schedule embed
const SCHEDULE_DELAY_NORMAL = 60 * 60 * 1000; // 1 giờ khi không có party
const SCHEDULE_DELAY_ACTIVE = 15 * 60 * 1000; // 15 phút khi có party đang mở


module.exports = {
    name: 'messageCreate',
    async execute(message, client) {
        // Bỏ qua nếu là bot
        if (message.author.bot) return;

        // ============== BOOSTER VIP ROOM — Gọi tên/tag bot để mở bảng điều khiển ==============
        const { handleBotMention } = require('../../utils/boosterVoiceHandlers');
        const botMentionHandled = await handleBotMention(message, client);
        if (botMentionHandled) return;

        const guildId = message.guild?.id;

        // ============== BOSS CHANNEL RESTORATION ==============
        if (guildId && !bossChannels.has(guildId)) {
            const savedBossChannel = db.getBossChannelId(guildId);
            if (savedBossChannel) {
                bossChannels.set(guildId, savedBossChannel);
            }
        }

        // ============== TTS AUTO-READ (tin nhắn bắt đầu bằng .) ==============
        if (message.content.startsWith('.') && message.content.length > 1) {
            const ttsService = require('../../utils/ttsService');

            if (guildId && ttsService.isConnected(guildId)) {
                // Kiểm tra xem có đang chơi loto trong kênh này không
                const lotoState = require('../../commands/loto/lotoState');
                const activeLotoChannelId = lotoState.getActiveLotoChannelId(guildId);

                if (activeLotoChannelId && message.channel.id === activeLotoChannelId) {
                    // Kiểm tra có đang KINH check không → cho phép TTS
                    const lotoHandlers = require('../../utils/lotoHandlers');
                    if (lotoHandlers.isKinhChecking(guildId)) {
                        // Đang KINH check → cho phép TTS hoạt động
                        const botConnection = ttsService.getConnection(guildId);
                        const userVoiceChannel = message.member?.voice?.channel;
                        if (botConnection && userVoiceChannel && botConnection.joinConfig.channelId === userVoiceChannel.id) {
                            const textToSpeak = message.content.slice(1).trim();
                            if (textToSpeak) {
                                ttsService.speak(guildId, textToSpeak);
                            }
                        }
                        return; // Không xử lý như command
                    }
                    // Không đang KINH → xoá lệnh TTS, không đọc
                    return message.delete().catch(() => { });
                }

                // Kiểm tra user có trong cùng voice channel với bot không
                const botConnection = ttsService.getConnection(guildId);
                const userVoiceChannel = message.member?.voice?.channel;

                // Chỉ đọc nếu user đang ở cùng voice channel với bot
                if (botConnection && userVoiceChannel && botConnection.joinConfig.channelId === userVoiceChannel.id) {
                    const textToSpeak = message.content.slice(1).trim();
                    if (textToSpeak) {
                        ttsService.speak(guildId, textToSpeak);
                        // Không react nữa theo yêu cầu
                    }
                }
                return; // Không xử lý như command
            }
        }


        // ============== TIKTOK LINK CONVERTER (fxTikTok) ==============
        // Tự động chuyển link TikTok sang fxTikTok để embed tốt hơn
        // Gửi 2 link (tnktok + tfxktok) để đảm bảo ít nhất 1 cái embed được
        const tiktokRegex = /https?:\/\/(www\.|vm\.|vt\.)?tiktok\.com\/[^\s]+/gi;
        const tiktokMatches = message.content.match(tiktokRegex);

        if (tiktokMatches && tiktokMatches.length > 0) {
            try {
                let convertedLinks = [];

                for (const link of tiktokMatches) {
                    // Xóa query parameters để link gọn hơn
                    const cleanLink = link.split('?')[0];

                    // Link live thì giữ nguyên domain, chỉ rút gọn
                    if (cleanLink.includes('/live')) {
                        convertedLinks.push(cleanLink);
                    } else {
                        const fixedLink = cleanLink.replace(/(www\.|vm\.|vt\.)?tiktok\.com/i, 'tnktok.com');
                        convertedLinks.push(fixedLink);
                    }
                }

                // Lấy nội dung text (không phải link) mà user đã gửi kèm
                let extraContent = message.content;
                for (const link of tiktokMatches) {
                    extraContent = extraContent.replace(link, '');
                }
                extraContent = extraContent.trim();

                // Gửi link đã convert + tag user gửi + nội dung kèm theo
                const userTag = `(${message.author})`;
                const replyContent = extraContent
                    ? `${userTag} ${extraContent}\n${convertedLinks.join('\n')}`
                    : `${userTag}\n${convertedLinks.join('\n')}`;

                // Xóa tin nhắn gốc và gửi tin mới
                await message.delete().catch(() => { });
                await message.channel.send(replyContent);

                console.log(`[TikTok] Converted ${tiktokMatches.length} link(s) for ${message.author.username}`);
                return; // Không xử lý thêm
            } catch (e) {
                console.error('[TikTok] Error converting link:', e.message);
            }
        }

        // ============== YOUTUBE LINK CONVERTER (Koutube) ==============
        // Tự động chuyển link YouTube sang koutube.com để embed tốt hơn trên Discord
        // Gửi 2 link (koutube + youtu.be) để đảm bảo ít nhất 1 cái embed được
        /*
        const youtubeRegex = /https?:\/\/(www\.)?(youtube\.com\/watch\?[^\s]+|youtube\.com\/shorts\/[^\s]+|youtu\.be\/[^\s]+)/gi;
        const youtubeMatches = message.content.match(youtubeRegex);

        if (youtubeMatches && youtubeMatches.length > 0) {
            try {
                let convertedLinks = [];

                for (const link of youtubeMatches) {
                    // Link koutube.com (enhanced embed)
                    const koutubeLink = link
                        .replace(/(www\.)?youtube\.com/i, 'koutube.com')
                        .replace(/(www\.)?youtu\.be/i, 'koutube.com');
                    convertedLinks.push(koutubeLink);
                }

                // Gửi link đã convert + tag user gửi
                const userTag = `(${message.author})`;
                const replyContent = `${userTag}\n${convertedLinks.join('\n')}`;

                // Xóa tin nhắn gốc và gửi tin mới
                await message.delete().catch(() => { });
                await message.channel.send(replyContent);

                console.log(`[YouTube] Converted ${youtubeMatches.length} link(s) via Koutube for ${message.author.username}`);
                return;
            } catch (e) {
                console.error('[YouTube] Error converting link:', e.message);
            }
        }
        */

        // ============== BOSS PRE-REGISTRATION (+1) ==============
        // Kiểm tra tin nhắn +1/-1 trong kênh đăng ký trước

        if (guildId && (message.channel.id === PRE_REGISTER_CHANNEL_ID || (bossChannels.has(guildId) && bossChannels.get(guildId) === message.channel.id))) {
            const content = message.content.trim();
            const contentLower = content.toLowerCase();

            // Kiểm tra các cách đăng ký: +1 (có thể kèm text), xin slot, xin 1 slot, cho slot, cho 1 slot
            // Match: "+1", "+1 với", "+1 boss guild tối nay", "xin slot", "cho slot", etc.
            const isRegistration = content.startsWith('+1') ||
                contentLower.includes('xin slot') ||
                contentLower.includes('xin 1 slot') ||
                contentLower.includes('cho slot') ||
                contentLower.includes('cho 1 slot');

            if (isRegistration) {
                // Kiểm tra role LangGia
                if (!message.member.roles.cache.some(r => r.name === 'LangGia')) {
                    try { await message.react('❓'); } catch (e) { }
                    return;
                }

                // Kiểm tra có party đang mở không
                const { getGuildPartyKeys, bossNotifications, bossRegistrations } = require('../../utils/bossState');
                const partyKeys = getGuildPartyKeys(guildId);

                if (partyKeys.length > 0) {
                    // Có party đang mở - thêm trực tiếp vào party
                    const partyKey = partyKeys[0]; // Lấy party đầu tiên
                    let registrations = bossRegistrations.get(partyKey) || [];

                    // Kiểm tra đã đăng ký chưa
                    if (registrations.some(r => r.id === message.author.id)) {
                        try { await message.react('⚠️'); } catch (e) { }
                        return;
                    }

                    // Thêm vào party
                    registrations.push({
                        id: message.author.id,
                        username: message.author.username,
                        joinedAt: Date.now(),
                        isLeader: false
                    });
                    bossRegistrations.set(partyKey, registrations);

                    try { await message.react('✅'); } catch (e) { }

                    // Cập nhật embed ngay lập tức (xóa cũ, gửi mới)
                    const notifData = bossNotifications.get(partyKey);
                    if (notifData) {
                        try {
                            // Xóa embed cũ
                            if (notifData.message) await notifData.message.delete();
                        } catch (e) { }

                        // Gửi embed mới
                        const newEmbed = bossguildCommand.createBossEmbed(partyKey, notifData.leaderName);
                        const newRow = bossguildCommand.createButtons(partyKey);
                        const newMessage = await message.channel.send({ embeds: [newEmbed], components: [newRow] });

                        // Cập nhật reference
                        notifData.messageId = newMessage.id;
                        notifData.message = newMessage;
                    }
                    return;
                }

                // Không có party đang mở - thêm vào danh sách chờ
                const added = addPreRegistration(guildId, message.author.id, message.author.username);
                try {
                    if (added) {
                        await message.react('👍');
                    } else {
                        // Đã đăng ký rồi
                        await message.react('⚠️');
                    }
                } catch (e) {
                    // Lỗi react - bỏ qua
                }
                return; // Không xử lý như command
            }

            if (content === '-1') {
                // Kiểm tra role LangGia
                if (!message.member.roles.cache.some(r => r.name === 'LangGia')) {
                    try { await message.react('❓'); } catch (e) { }
                    return;
                }

                // Kiểm tra có party đang mở không
                const { getGuildPartyKeys, bossRegistrations } = require('../../utils/bossState');
                const partyKeys = getGuildPartyKeys(guildId);

                if (partyKeys.length > 0) {
                    // Có party đang mở - xóa khỏi party
                    const partyKey = partyKeys[0];
                    let registrations = bossRegistrations.get(partyKey) || [];
                    const user = registrations.find(r => r.id === message.author.id);

                    if (user) {
                        // Không cho leader hủy
                        if (user.isLeader) {
                            try { await message.react('🚫'); } catch (e) { }
                            return;
                        }
                        registrations = registrations.filter(r => r.id !== message.author.id);
                        bossRegistrations.set(partyKey, registrations);
                        try { await message.react('❌'); } catch (e) { }

                        // Cập nhật embed ngay lập tức (xóa cũ, gửi mới)
                        const notifData = bossNotifications.get(partyKey);
                        if (notifData) {
                            try {
                                if (notifData.message) await notifData.message.delete();
                            } catch (e) { }

                            const newEmbed = bossguildCommand.createBossEmbed(partyKey, notifData.leaderName);
                            const newRow = bossguildCommand.createButtons(partyKey);
                            const newMessage = await message.channel.send({ embeds: [newEmbed], components: [newRow] });

                            notifData.messageId = newMessage.id;
                            notifData.message = newMessage;
                        }
                    } else {
                        try { await message.react('❓'); } catch (e) { }
                    }
                    return;
                }

                // Không có party - xóa khỏi danh sách chờ
                const removed = removePreRegistration(guildId, message.author.id);
                try {
                    if (removed) {
                        await message.react('❌');
                    } else {
                        // Không có trong danh sách
                        await message.react('❓');
                    }
                } catch (e) {
                    // Lỗi react - bỏ qua
                }
                return; // Không xử lý như command
            }
        }

        // ============== ALBUM AUTO-SAVE (với Cloudinary + ImgBB fallback) ==============
        // Tự động lưu ảnh khi gửi vào Phòng Ảnh

        const albumChannelId = db.getAlbumChannelId();
        if (albumChannelId && message.channel.id === albumChannelId && message.attachments.size > 0) {
            const imageService = require('../../utils/imageService');

            for (const attachment of message.attachments.values()) {
                // Bỏ qua ảnh spoiler
                if (attachment.spoiler) {
                    console.log(`[Album] Skipping spoiler image: ${attachment.name}`);
                    continue;
                }

                if (attachment.contentType?.startsWith('image/')) {
                    let imageUrl = attachment.url;

                    // Upload lên cloud để có link vĩnh viễn (Cloudinary → ImgBB fallback)
                    if (imageService.isConfigured()) {
                        try {
                            await message.react('⏳'); // Đang upload
                            const uploadResult = await imageService.uploadFromUrl(attachment.url);
                            if (uploadResult.success) {
                                imageUrl = uploadResult.url;
                                console.log(`[Album] Uploaded via ${uploadResult.service}: ${imageUrl}`);
                            } else {
                                console.warn(`[Album] Upload failed, using Discord URL: ${uploadResult.error}`);
                            }
                            // Xóa reaction ⏳
                            try { await message.reactions.cache.get('⏳')?.remove(); } catch (e) { }
                        } catch (e) {
                            console.error('[Album] Upload error:', e.message);
                        }
                    }

                    const result = db.addAlbumImage(message.author.id, imageUrl, message.id);
                    if (result.success) {
                        try { await message.react('📸'); } catch (e) { }
                    } else if (result.error === 'limit') {
                        try { await message.react('⚠️'); } catch (e) { }
                    }
                }
            }

            // ============== PHONG ANH AUTO-HELP REMINDER (1 lần/tuần, reset 8h sáng thứ 2) ==============
            // Sau 8h sáng thứ Hai: tin nhắn cuối cùng trong kênh → 1 giờ không hoạt động → gửi hướng dẫn
            // Mỗi tin nhắn mới sẽ RESET timer (debounce), chỉ gửi sau tin nhắn CUỐI CÙNG
            // Sau khi đã gửi, không gửi lại cho đến 8h sáng thứ Hai tuần sau
            const currentWeekPA = getCurrentWeekMonday8AM();

            // Lấy từ DB hoặc cache (để tránh mất khi restart)
            const dbWeekPA = db.getConfig(`pa_guide_week_${albumChannelId}`);
            if (dbWeekPA && !phongAnhGuideSentWeek.has(albumChannelId)) {
                phongAnhGuideSentWeek.set(albumChannelId, dbWeekPA);
            }
            const lastSentWeekPA = phongAnhGuideSentWeek.get(albumChannelId);

            if (lastSentWeekPA !== currentWeekPA) {
                // Xóa timer cũ nếu có (debounce - reset timer mỗi tin nhắn mới)
                if (phongAnhReminders.has(albumChannelId)) {
                    clearTimeout(phongAnhReminders.get(albumChannelId));
                    phongAnhReminders.delete(albumChannelId);
                }

                // Set new timeout: 1 giờ sau tin nhắn cuối cùng
                const timeoutId = setTimeout(async () => {
                    try {
                        const channel = await client.channels.fetch(albumChannelId);
                        if (channel) {
                            // Xóa tin nhắn help cũ nếu có
                            const dbLastMsgId = db.getConfig(`pa_guide_msg_${albumChannelId}`);
                            if (dbLastMsgId && !lastPhongAnhMessage.has(albumChannelId)) {
                                lastPhongAnhMessage.set(albumChannelId, dbLastMsgId);
                            }
                            const lastMsgId = lastPhongAnhMessage.get(albumChannelId);
                            if (lastMsgId) {
                                try {
                                    const oldMsg = await channel.messages.fetch(lastMsgId).catch(() => null);
                                    if (oldMsg) await oldMsg.delete();
                                } catch (e) { /* Ignore delete error */ }
                            }

                            const helpphonganhCommand = require('../../commands/quanly/helpphonganh');
                            const sentMessage = await helpphonganhCommand.execute({ channel: channel, guildId, client });

                            if (sentMessage) {
                                lastPhongAnhMessage.set(albumChannelId, sentMessage.id);
                                phongAnhGuideSentWeek.set(albumChannelId, currentWeekPA);
                                // Lưu vào DB
                                db.setConfig(`pa_guide_week_${albumChannelId}`, currentWeekPA);
                                db.setConfig(`pa_guide_msg_${albumChannelId}`, sentMessage.id);
                                console.log(`[PhongAnh] Sent auto-help in ${channel.name} (tuần ${currentWeekPA})`);
                            }
                        }
                        phongAnhReminders.delete(albumChannelId);
                    } catch (e) {
                        console.error('[PhongAnh] Auto-help error:', e.message);
                    }
                }, GIEOQUE_INACTIVITY_TIME); // Dùng chung 1 giờ

                phongAnhReminders.set(albumChannelId, timeoutId);
            }
        }

        // ============== DEBOUNCED SCHEDULE EMBED ==========================
        // Kiểm tra nếu tin nhắn trong kênh boss guild đã được đăng ký
        const channelId = message.channel.id;

        if (bossChannels.has(guildId) && bossChannels.get(guildId) === channelId) {
            const { getGuildPartyKeys } = require('../../utils/bossState');

            // Refresh boss embed nếu có party đang mở (debounced 5 phút)
            const activeParties = getGuildPartyKeys(guildId);
            if (activeParties.length > 0) {
                bossguildCommand.refreshBossEmbed(client, channelId);
            }

            // Xóa timer cũ nếu có
            const existingTimer = scheduleTimers.get(channelId);
            if (existingTimer) {
                clearTimeout(existingTimer.timeoutId);
            }

            // Nếu có party đang mở, KHÔNG sử dụng timer để gửi schedule nữa (chỉ dùng refreshBossEmbed ở trên)
            // Nếu KHÔNG có party, mới dùng timer 60 phút để gửi lịch
            if (activeParties.length > 0) {
                return;
            }
            const delay = SCHEDULE_DELAY_NORMAL;

            // Đặt timer mới
            const timeoutId = setTimeout(async () => {
                try {
                    const channel = await client.channels.fetch(channelId);
                    if (channel) {
                        // Xóa embed lịch cũ nếu có
                        const oldEmbedId = lastScheduleEmbed.get(channelId);
                        if (oldEmbedId) {
                            try {
                                const oldMessage = await channel.messages.fetch(oldEmbedId);
                                if (oldMessage) await oldMessage.delete();
                            } catch (e) { /* Embed cũ có thể đã bị xóa */ }
                        }

                        // Gửi embed lịch mới
                        const scheduleEmbed = createScheduleOnlyEmbed();
                        const newMessage = await channel.send({ embeds: [scheduleEmbed] });

                        // Lưu message ID mới
                        lastScheduleEmbed.set(channelId, newMessage.id);

                        console.log(`[Schedule] Gửi embed lịch sau ${delay / 60000} phút tại ${channel.name}`);
                    }
                    scheduleTimers.delete(channelId);
                } catch (e) {
                    console.error('[Schedule] Lỗi khi gửi embed:', e);
                }
            }, delay);

            scheduleTimers.set(channelId, { timeoutId, lastActivity: Date.now(), delay });
        }

        // ============== DEBOUNCED BC OVERVIEW REFRESH ==========================
        // Kiểm tra nếu tin nhắn trong kênh BC overview → debounce refresh 5 phút
        const { bangchienOverviews: bcOverviews } = require('../../utils/bangchienState');
        const bcOverviewData = bcOverviews.get(guildId);
        if (bcOverviewData && bcOverviewData.channelId === channelId) {
            bangchienCommand.refreshBcOverviewDebounced(client, guildId);
        }

        // ============== REPLY TO TAG (Boss Guild) ==============
        // Kiểm tra nếu reply vào embed chốt danh sách boss
        if (message.reference && message.reference.messageId) {
            const refMessageId = message.reference.messageId;
            const partyData = finalizedParties.get(refMessageId);

            if (partyData) {
                // Chỉ leader mới được tag
                if (message.author.id === partyData.leaderId) {


                    // Tạo danh sách tag với tên in-game
                    const mentionList = partyData.participants.map(p => {
                        const userData = db.getUserByDiscordId(p.id);
                        const gameName = userData?.game_username || null;
                        return gameName ? `<@${p.id}> (${gameName})` : `<@${p.id}>`;
                    });

                    const mentions = mentionList.join('\n');

                    // Gửi tin nhắn tag
                    await message.channel.send({
                        content: `${mentions}\n\n🔔 **${message.content || 'Vào game đi!'}**`
                    });

                    // Xóa tin nhắn reply của leader (tùy chọn)
                    try { await message.delete(); } catch (e) { }

                    return;
                }
            }
        }

        // ============== REPLY TO TAG (Bang Chiến) ==============
        // Kiểm tra nếu reply vào embed chốt danh sách bang chiến
        if (message.reference && message.reference.messageId) {
            const refMessageId = message.reference.messageId;

            // Tìm trong memory trước, nếu không có thì tìm database
            let partyData = bangchienFinalizedParties.get(refMessageId);

            if (!partyData) {
                // Fallback: tìm trong database
                const { getBangchienHistoryById } = require('../../database/db');
                const dbData = getBangchienHistoryById(refMessageId);
                if (dbData) {
                    partyData = {
                        leaderId: dbData.leader_id,
                        participants: dbData.participants,
                        guildId: dbData.guild_id
                    };
                }
            }

            if (partyData) {
                // Chỉ leader mới được tag
                if (message.author.id === partyData.leaderId) {


                    // Tạo danh sách tag với tên in-game
                    const mentionList = partyData.participants.map(p => {
                        const userData = db.getUserByDiscordId(p.id);
                        const gameName = userData?.game_username || null;
                        return gameName ? `<@${p.id}> (${gameName})` : `<@${p.id}>`;
                    });

                    const mentions = mentionList.join('\n');

                    // Gửi tin nhắn tag
                    await message.channel.send({
                        content: `${mentions}\n\n⚔️ **${message.content || 'Vào game đi bang chiến!'}**`
                    });

                    // Xóa tin nhắn reply của leader
                    try { await message.delete(); } catch (e) { }

                    return;
                }
            }
        }

        // Lấy prefix từ env
        const prefix = process.env.PREFIX || '?';

        // ============== LOTO CHANNEL AUTO-DELETE ==============
        // Khi đang chơi loto trong kênh, xoá tất cả tin nhắn không phải lệnh loto
        const lotoState = require('../../commands/loto/lotoState');
        if (guildId) {
            const activeLotoChannelId = lotoState.getActiveLotoChannelId(guildId);
            if (activeLotoChannelId && message.channel.id === activeLotoChannelId) {
                // Cho phép tin nhắn có ảnh đính kèm (để gửi ảnh lá đã đánh dấu)
                if (message.attachments.size > 0) {
                    // Có ảnh → cho phép
                    return;
                }

                // Danh sách lệnh loto được phép
                const lotoCommands = ['loto', 'lt', 'lotocheck', 'ltc', 'lotoend', 'lte',
                    'lotorollback', 'ltrb', 'lotothem', 'ltt', 'lotobo', 'ltb',
                    'lotoalbum', 'lta', 'lotohelp', 'lth'];

                if (message.content.startsWith(prefix)) {
                    const tempArgs = message.content.slice(prefix.length).trim().split(/ +/);
                    const tempCmd = tempArgs[0]?.toLowerCase();
                    if (!lotoCommands.includes(tempCmd)) {
                        // Không phải lệnh loto → xoá
                        return message.delete().catch(() => { });
                    }
                } else {
                    // Không phải command và không có ảnh → xoá
                    return message.delete().catch(() => { });
                }
            }
        }

        // ============== CẤP ROLE THÔNG MINH ==============
        // Phân tích tin nhắn trong kênh cấp role (so khớp text)
        const { handleCaproleMessage } = require('../../utils/caproleHandler');
        const caproleHandled = await handleCaproleMessage(message, client);
        if (caproleHandled) return;

        // ============== EXP TEXT CHAT ==============
        // Cộng EXP mỗi tin nhắn (≥3 ký tự, không phải command, cooldown 60s)
        if (message.content.length >= 3 && !message.content.startsWith(prefix)) {
            try {
                const { addTextExp, getLevelReward, addHat } = require('../../database/economy');
                const { EmbedBuilder } = require('discord.js');
                const expResult = addTextExp(message.author.id);

                if (expResult.success && expResult.levelUp) {
                    const reward = getLevelReward(expResult.newLevel);

                    // Gán role thưởng nếu có
                    if (reward) {
                        addHat(message.author.id, reward.hat);
                        try {
                            let role = message.guild.roles.cache.find(r => r.name === reward.roleName);
                            if (!role) {
                                role = await message.guild.roles.create({
                                    name: reward.roleName,
                                    reason: `EXP Level ${expResult.newLevel} reward`
                                });
                            }
                            await message.member.roles.add(role);
                        } catch (e) {
                            console.error('[EXP] Lỗi gán role:', e.message);
                        }
                    }

                    // Gửi thông báo vào kênh đã set (nếu có)
                    const levelUpChannelId = db.getLevelUpChannelId();
                    if (levelUpChannelId) {
                        try {
                            const levelUpChannel = await client.channels.fetch(levelUpChannelId);
                            if (levelUpChannel) {
                                const levelEmojis = ['🌱', '⚔️', '🗡️', '🛡️', '👑', '🌟', '💎', '🔥'];
                                const emoji = levelEmojis[Math.min(Math.floor(expResult.newLevel / 10), levelEmojis.length - 1)];
                                const displayName = message.member?.displayName || message.author.username;

                                const embed = new EmbedBuilder()
                                    .setColor(0x00E5FF)
                                    .setAuthor({
                                        name: displayName,
                                        iconURL: message.author.displayAvatarURL({ size: 64 })
                                    })
                                    .setTitle(`${emoji} Lên Cấp!`)
                                    .setDescription(`**${displayName}** đã đạt **Level ${expResult.newLevel}**! 🎉`)
                                    .addFields(
                                        { name: '📊 Level', value: `${expResult.oldLevel} → **${expResult.newLevel}**`, inline: true },
                                        { name: '🏷️ Loại', value: '💬 Chat', inline: true }
                                    )
                                    .setTimestamp()
                                    .setFooter({ text: 'Lang Gia Các • Hệ thống EXP' });

                                if (reward) {
                                    embed.addFields({
                                        name: '🎁 Phần thưởng',
                                        value: `+**${reward.hat.toLocaleString()} Hạt** + Role **${reward.roleName}**`,
                                        inline: false
                                    });
                                    embed.setColor(0xFFD700); // Vàng cho milestone
                                }

                                await levelUpChannel.send({ embeds: [embed] });
                            }
                        } catch (e) {
                            console.error('[EXP] Lỗi gửi thông báo level up:', e.message);
                        }
                    }
                }
            } catch (e) {
                // Không log lỗi EXP để tránh spam console
            }
        }

        // Kiểm tra có bắt đầu với prefix không
        if (!message.content.startsWith(prefix)) return;

        // Parse command và args
        const args = message.content.slice(prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        // ============== MUTE CHECK (Đặt ở đây để chặn TẤT CẢ lệnh trừ muteall) ==============
        // ?muteall - Block/unblock ALL commands in channel (luôn cho phép để có thể unmute)
        if (commandName === 'muteall') {
            const muteallCommand = require('../../commands/admin/muteall');
            return muteallCommand.execute(message, args);
        }

        // ?serverbot - Danh sách server bot đang ở (owner only)
        if (commandName === 'serverbot') {
            const serverbotCommand = require('../../commands/admin/serverbot');
            return serverbotCommand.execute(message, args);
        }

        // Check if channel is muted (chặn TẤT CẢ lệnh khác)
        const { isChannelMuted } = require('../../commands/admin/muteall');
        if (isChannelMuted(message.channel.id)) {
            return; // Không phản hồi bất kỳ lệnh nào trong kênh bị mute
        }

        // ============== MEMBER MANAGEMENT COMMANDS ==============

        // ?tongrole - Xem tổng số role trong server (Owner only)
        if (commandName === 'tongrole') {
            const tongroleCommand = require('../../commands/quanly/tongrole');
            return tongroleCommand.execute(message, args);
        }

        // ?addhelp - Show help
        if (commandName === 'addhelp') {
            return addhelpCommand.execute(message, args);
        }

        // ?lenhquanly, ?qlcmd, ?admincmd - Danh sách lệnh quản lý
        if (['lenhquanly', 'qlcmd', 'admincmd', 'hiddencommands'].includes(commandName)) {
            const lenhquanlyCommand = require('../../commands/quanly/lenhquanly');
            return lenhquanlyCommand.execute(message, args);
        }

        // ?addmem @user <position> <uid> <name> [Xnt]
        if (commandName === 'addmem') {
            return addmemCommand.execute(message, args);
        }

        // ?addid <uid> <name> - Pre-add game data
        if (commandName === 'addid') {
            return addidCommand.execute(message, args);
        }

        // ?setgieoque (Admin only)
        if (commandName === 'setgieoque') {
            return setgieoqueCommand.execute(message, args);
        }

        // ?checkapi - Check Gemini API Status (Admin only)
        if (commandName === 'checkapi') {
            return checkapiCommand.execute(message, args);
        }

        // ============== GIEO QUE INACTIVITY REMINDER (1 lần/tuần, reset 8h sáng thứ 2) ==============
        // Sau 8h sáng thứ Hai: tin nhắn cuối cùng trong kênh → 1 giờ không hoạt động → gửi hướng dẫn
        // Mỗi tin nhắn mới sẽ RESET timer (debounce), chỉ gửi sau tin nhắn CUỐI CÙNG
        // Sau khi đã gửi, không gửi lại cho đến 8h sáng thứ Hai tuần sau

        const gieoQueChannelId = db.getGieoQueChannelId();

        if (gieoQueChannelId && message.channel.id === gieoQueChannelId) {
            const currentWeekGQ = getCurrentWeekMonday8AM();

            const dbWeekGQ = db.getConfig(`gq_guide_week_${gieoQueChannelId}`);
            if (dbWeekGQ && !gieoQueGuideSentWeek.has(gieoQueChannelId)) {
                gieoQueGuideSentWeek.set(gieoQueChannelId, dbWeekGQ);
            }
            const lastSentWeekGQ = gieoQueGuideSentWeek.get(gieoQueChannelId);

            // Chỉ đặt/reset timer nếu chưa gửi tuần này
            if (lastSentWeekGQ !== currentWeekGQ) {
                // Xóa timer cũ nếu có (debounce - reset timer mỗi tin nhắn mới)
                if (gieoqueReminders.has(gieoQueChannelId)) {
                    clearTimeout(gieoqueReminders.get(gieoQueChannelId));
                    gieoqueReminders.delete(gieoQueChannelId);
                }

                // Hàm thực thi gửi nhắc nhở
                const sendReminder = async () => {
                    try {
                        const channel = await client.channels.fetch(gieoQueChannelId);
                        if (channel) {
                            // Xóa embed hướng dẫn cũ nếu có
                            const dbGuideId = db.getConfig(`gq_guide_msg_${gieoQueChannelId}`);
                            if (dbGuideId && !lastGieoQueGuide.has(gieoQueChannelId)) {
                                lastGieoQueGuide.set(gieoQueChannelId, dbGuideId);
                            }
                            const oldGuideId = lastGieoQueGuide.get(gieoQueChannelId);
                            if (oldGuideId) {
                                try {
                                    const oldMsg = await channel.messages.fetch(oldGuideId).catch(() => null);
                                    if (oldMsg) await oldMsg.delete();
                                } catch (e) { /* Embed cũ có thể đã bị xóa */ }
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
                                    `- Quẻ chỉ phán cho ngày hôm nay, reset mỗi ngày mới.`,
                                footer: { text: '🔮 Mỗi ngày một quẻ, vận may tự đến! 🔮' }
                            };

                            const sentMsg = await channel.send({ embeds: [guideEmbed] });
                            lastGieoQueGuide.set(gieoQueChannelId, sentMsg.id);
                            gieoQueGuideSentWeek.set(gieoQueChannelId, currentWeekGQ);
                            db.setConfig(`gq_guide_week_${gieoQueChannelId}`, currentWeekGQ);
                            db.setConfig(`gq_guide_msg_${gieoQueChannelId}`, sentMsg.id);
                            console.log(`[GieoQue] Sent reminder in ${channel.name} (tuần ${currentWeekGQ})`);

                            gieoqueReminders.delete(gieoQueChannelId);
                        }
                    } catch (e) {
                        console.error('[GieoQue] Reminder error:', e.message);
                    }
                };

                // Set timeout mới: 1 giờ sau tin nhắn cuối cùng
                const timeoutId = setTimeout(sendReminder, GIEOQUE_INACTIVITY_TIME);
                gieoqueReminders.set(gieoQueChannelId, timeoutId);
            }
        }

        // ?setkc <new_name>
        if (commandName === 'setkc') {
            const setkcCommand = require('../../commands/admin/setkc');
            return setkcCommand.execute(message, args);
        }

        // === SUB-ROLE SYSTEM ===

        // ?setrole - Set sub-role
        if (commandName === 'setrole') {
            const setroleCommand = require('../../commands/quanly/subrole/setrole');
            return setroleCommand.execute(message, args);
        }

        // ?unsetrole, ?xoarole - Remove sub-role
        if (['unsetrole', 'xoarole'].includes(commandName)) {
            const unsetroleCommand = require('../../commands/quanly/subrole/unsetrole');
            return unsetroleCommand.execute(message, args);
        }

        // ?addrole - Add sub-role (Bang Chủ)
        if (commandName === 'addrole') {
            const addroleCommand = require('../../commands/quanly/subrole/addrole');
            return addroleCommand.execute(message, args);
        }

        // ?editrole, ?doirole - Edit sub-role (Bang Chủ)
        if (['editrole', 'doirole'].includes(commandName)) {
            const editroleCommand = require('../../commands/quanly/subrole/editrole');
            return editroleCommand.execute(message, args);
        }

        // ?delrole - Delete sub-role (Bang Chủ)
        if (commandName === 'delrole') {
            const delroleCommand = require('../../commands/quanly/subrole/delrole');
            return delroleCommand.execute(message, args);
        }

        // ?delallrole - Delete ALL sub-roles (Owner only)
        if (commandName === 'delallrole') {
            const delallroleCommand = require('../../commands/quanly/subrole/delallrole');
            return delallroleCommand.execute(message, args);
        }

        // ?dsrole, ?listrole - List sub-roles
        if (['dsrole', 'listrole'].includes(commandName)) {
            const listroleCommand = require('../../commands/quanly/subrole/listrole');
            return listroleCommand.execute(message, args);
        }

        // ?helprole - Help for role system
        if (commandName === 'helprole') {
            const helproleCommand = require('../../commands/quanly/subrole/helprole');
            return helproleCommand.execute(message, args);
        }

        // ?role, ?show - Đổi display role
        if (['role', 'show'].includes(commandName)) {
            const showCommand = require('../../commands/quanly/subrole/show');
            return showCommand.execute(message, args);
        }

        // ?hideicon, ?anicon - Ẩn display icon
        if (['hideicon', 'anicon'].includes(commandName)) {
            const hideiconCommand = require('../../commands/quanly/subrole/hideicon');
            return hideiconCommand.execute(message, args);
        }

        // ?setroomcaprole - Thiết lập kênh cấp role thông minh
        if (commandName === 'setroomcaprole') {
            const setroomcaproleCommand = require('../../commands/quanly/subrole/setroomcaprole');
            return setroomcaproleCommand.execute(message, args);
        }

        // ?mem, ?me - Xem thông tin thành viên (quản lý)
        if (['mem', 'me'].includes(commandName)) {
            // Chỉ role LangGia trở lên mới được dùng
            if (!message.member.roles.cache.some(r => r.name === 'LangGia')) {
                return message.reply('❌ Chỉ thành viên **LangGia** mới được sử dụng lệnh này!');
            }
            return memCommand.execute(message, args);
        }

        // ============== EXP COMMANDS ==============

        // ?rank, ?level, ?xp, ?exp - Xem EXP/level cá nhân
        if (['rank', 'level', 'xp', 'exp'].includes(commandName)) {
            const rankCommand = require('../../commands/exp/rank');
            return rankCommand.execute(message, args);
        }

        // ?top, ?leaderboard, ?lb, ?bxh - Bảng xếp hạng
        if (['top', 'leaderboard', 'lb', 'bxh'].includes(commandName)) {
            const topCommand = require('../../commands/exp/top');
            return topCommand.execute(message, args);
        }

        // ?randomavt, ?rda - Random avatar từ album
        if (['randomavt', 'rda'].includes(commandName)) {
            const randomavtCommand = require('../../commands/apps/randomavt');
            return randomavtCommand.execute(message, args);
        }

        // ?dich, ?translate, ?dichtiengviet - Dịch tin nhắn phía trên sang tiếng Việt
        if (['dich', 'translate', 'dichtiengviet'].includes(commandName)) {
            const dichCommand = require('../../commands/apps/dich');
            return dichCommand.execute(message, args);
        }

        // ?setavt, ?setavatar, ?avatar, ?avt - Set custom avatar
        if (['setavt', 'setavatar', 'avatar', 'avt'].includes(commandName)) {
            // Chỉ role LangGia trở lên mới được dùng
            if (!message.member.roles.cache.some(r => r.name === 'LangGia')) {
                return message.reply('❌ Chỉ thành viên **LangGia** mới được sử dụng lệnh này!');
            }
            const setavtCommand = require('../../commands/quanly/setavt');
            return setavtCommand.execute(message, args);
        }

        // ?delavt, ?delavatar, ?removeavt, ?clearavt - Xóa custom avatar
        if (['delavt', 'delavatar', 'removeavt', 'removeavatar', 'clearavt'].includes(commandName)) {
            const delavtCommand = require('../../commands/quanly/delavt');
            return delavtCommand.execute(message, args);
        }

        // ?clearallavt, ?xoahetatv, ?delavtall - Xóa TẤT CẢ custom avatar (Owner only)
        if (['clearallavt', 'xoahetatv', 'delavtall'].includes(commandName)) {
            const clearallavtCommand = require('../../commands/quanly/clearallavt');
            return clearallavtCommand.execute(message, args, client);
        }

        // ?banavt @user - Ban user không được set avatar (Kỳ Cựu trở lên)
        if (commandName === 'banavt') {
            // Kiểm tra quyền Kỳ Cựu
            if (!message.member.roles.cache.some(r => r.name.includes('Kỳ Cựu'))) {
                return message.reply('❌ Chỉ **Kỳ Cựu** mới được sử dụng lệnh này!');
            }

            const targetUser = message.mentions.users.first();
            if (!targetUser) {
                return message.reply('❌ Vui lòng mention user! VD: `?banavt @user`');
            }

            const result = db.banAvatarUser(targetUser.id);
            if (result.success) {
                return message.reply(`✅ Đã **cấm** ${targetUser} đặt avatar tùy chỉnh và xóa avatar hiện tại!`);
            } else {
                return message.reply(`❌ Không tìm thấy user trong database!`);
            }
        }

        // ?unbanavt @user - Gỡ ban avatar cho user
        if (commandName === 'unbanavt') {
            // Kiểm tra quyền Kỳ Cựu
            if (!message.member.roles.cache.some(r => r.name.includes('Kỳ Cựu'))) {
                return message.reply('❌ Chỉ **Kỳ Cựu** mới được sử dụng lệnh này!');
            }

            const targetUser = message.mentions.users.first();
            if (!targetUser) {
                return message.reply('❌ Vui lòng mention user! VD: `?unbanavt @user`');
            }

            const result = db.unbanAvatarUser(targetUser.id);
            if (result.success) {
                return message.reply(`✅ Đã **gỡ cấm** ${targetUser} - có thể đặt avatar lại!`);
            } else {
                return message.reply(`❌ Không tìm thấy user trong database!`);
            }
        }

        // ?xoabc - Delete Bang Chủ
        if (commandName === 'xoabc') {
            return xoabcCommand.execute(message, args);
        }

        // ?xoapbc - Delete Phó Bang Chủ
        if (commandName === 'xoapbc') {
            return xoapbcCommand.execute(message, args);
        }

        // ?listmem, ?dsmem, ?dstv - List active members
        if (['listmem', 'dsmem', 'dstv'].includes(commandName)) {
            return listmemCommand.execute(message, args);
        }

        // ?checkmem, ?kiemtramem - Kiểm tra thành viên đã rời server
        if (['checkmem', 'kiemtramem', 'checkroi'].includes(commandName)) {
            const checkmemCommand = require('../../commands/quanly/checkmem');
            return checkmemCommand.execute(message, args);
        }

        // ?listid, ?listcho - List pending IDs from ?addid
        if (['listid', 'listcho'].includes(commandName)) {
            return listidCommand.execute(message, args);
        }

        // ?listallmem - List ALL members including left
        if (commandName === 'listallmem') {
            return listallmemCommand.execute(message, args);
        }

        // ?roiguild @user - Mark member as left
        if (commandName === 'roiguild') {
            return roiguildCommand.execute(message, args);
        }

        // ?rsrejoin, ?rsrj - Reset rejoin count (Quản Lý only)
        if (['rsrejoin', 'rsrj'].includes(commandName)) {
            return rsrejoinCommand.execute(message, args);
        }

        // ?xoamem - Xóa thành viên khỏi database (BC/PBC/KC)
        if (commandName === 'xoamem') {
            return xoamemCommand.execute(message, args);
        }

        // ?locmem - Lọc thành viên có role LangGia nhưng không trong database
        if (commandName === 'locmem') {
            return locmemCommand.execute(message, args);
        }

        // ?themtien - Add Hạt to user (Quản Lý only)
        if (commandName === 'themtien') {
            return themtienCommand.execute(message, args);
        }

        // ?gieoque, ?xinque, ?xq - Gieo quẻ mỗi ngày
        if (['gieoque', 'xinque', 'xq', 'buxu'].includes(commandName)) {
            // Chỉ cho phép trong kênh đã setgieoque
            const gqChannelId = db.getGieoQueChannelId();
            if (gqChannelId && message.channel.id !== gqChannelId) {
                return message.reply(`❌ Lệnh này chỉ dùng được trong kênh <#${gqChannelId}>!`);
            }
            return gieoqueCommand.execute(message, args);
        }

        // ?cauduyen, ?cd - Cầu duyên (tình yêu)
        if (['cauduyen', 'cd'].includes(commandName)) {
            const gqChannelId = db.getGieoQueChannelId();
            if (gqChannelId && message.channel.id !== gqChannelId) {
                return message.reply(`❌ Lệnh này chỉ dùng được trong kênh <#${gqChannelId}>!`);
            }
            const cauduyenCommand = require('../../commands/gieoque/cauduyen');
            return cauduyenCommand.execute(message, args);
        }

        // ?xoahet - Delete all equipment, items and currency (Quản Lý only)
        if (commandName === 'xoahet') {
            return xoahetCommand.execute(message, args);
        }

        // ?add - Add items to user (owner only)
        if (commandName === 'add') {
            const addItemCommand = require('../../commands/admin/minigame/additem');
            return addItemCommand.execute(message, args);
        }

        // ?resetplayer - Reset all minigame data (owner only)
        if (commandName === 'resetplayer') {
            const resetPlayerCommand = require('../../commands/admin/minigame/resetplayer');
            return resetPlayerCommand.execute(message, args);
        }

        // ?reset - Reset your own minigame data (owner only)
        if (commandName === 'reset') {
            return resetplayerCommand.execute(message, args, 'reset');
        }

        // ?resetplayer @user - Reset a player's minigame data (owner only)
        if (commandName === 'resetplayer') {
            return resetplayerCommand.execute(message, args, 'resetplayer');
        }

        // ?resetallplayer - Reset ALL players' minigame data (owner only)
        if (commandName === 'resetallplayer') {
            const resetAllPlayerCommand = require('../../commands/admin/minigame/resetallplayer');
            return resetAllPlayerCommand.execute(message, args);
        }

        // ?cleardung - Clear dungeon sessions (owner only)
        if (['cleardung', 'dungclear', 'resetdung'].includes(commandName)) {
            return cleardungCommand.execute(message, args);
        }

        // ?xoatoanbodanhsachthanhvien - Delete all members (owner only)
        if (commandName === 'xoatoanbodanhsachthanhvien') {
            return xoaAllCommand.execute(message, args);
        }

        // ?gonah - Special message
        if (commandName === 'gonah') {
            const gonahCommand = require('../../commands/admin/gonah');
            return gonahCommand.execute(message, args);
        }

        // ?nominigame - Block/unblock minigame in channel
        if (commandName === 'nominigame') {
            const nominigameCommand = require('../../commands/admin/nominigame');
            return nominigameCommand.execute(message, args);
        }

        // ?moon - Cấp quyền thấy/kết nối voice channel
        if (commandName === 'moon') {
            const moonCommand = require('../../commands/admin/moon');
            return moonCommand.executeMoon(message, args);
        }

        // ?xmoon - Xóa quyền thấy/kết nối voice channel
        if (commandName === 'xmoon') {
            const moonCommand = require('../../commands/admin/moon');
            return moonCommand.executeXMoon(message, args);
        }

        // [DISABLED] Các lệnh cũ đã thay bằng ?setbooster panel
        // ?boostroom / ?br / ?myroom
        // ?delboostroom / ?dbr
        // ?setboostcategory

        // ?setbooster <Category ID> - Thiết lập Booster Panel + category
        if (commandName === 'setbooster') {
            const setboosterCommand = require('../../commands/booster/setbooster');
            return setboosterCommand.execute(message, args);
        }

        // ?setchannelanh - Set channel làm Phòng Ảnh (Quản Lý only)
        if (['setchannelanh', 'setchannelphonganh', 'phonganh'].includes(commandName)) {
            const setchannelanhCommand = require('../../commands/admin/setchannelanh');
            return setchannelanhCommand.execute(message, args);
        }

        // ?setlevelup - Set kênh nhận thông báo Level Up (Quản Lý only)
        if (['setlevelup', 'setlvup', 'setlvl'].includes(commandName)) {
            const setlevelupCommand = require('../../commands/admin/setlevelup');
            return setlevelupCommand.execute(message, args);
        }

        // ?album - Xem album ảnh của bạn
        if (['album', 'xemanh', 'myalbum', 'anh'].includes(commandName)) {
            // Chỉ role LangGia trở lên mới được dùng
            if (!message.member.roles.cache.some(r => r.name === 'LangGia')) {
                return message.reply('❌ Chỉ thành viên **LangGia** mới được sử dụng lệnh này!');
            }
            const albumCommand = require('../../commands/apps/album');
            return albumCommand.execute(message, args);
        }

        // ?helpphonganh - Hướng dẫn sử dụng Phòng Ảnh
        if (['helpphonganh', 'helppa', 'hdphonganh', 'albumhelp'].includes(commandName)) {
            const helpphonganhCommand = require('../../commands/quanly/helpphonganh');
            return helpphonganhCommand.execute(message, args);
        }

        // ?clearallalbum, ?xoahetalbum, ?delallalbum - Xoá TẤT CẢ ảnh trong Album (Owner only)
        if (['clearallalbum', 'xoahetalbum', 'delallalbum', 'clearalbum'].includes(commandName)) {
            const clearallalbumCommand = require('../../commands/admin/clearallalbum');
            return clearallalbumCommand.execute(message, args);
        }


        // ============== LOTO COMMANDS ==============

        // ?loto, ?lt - Random số lô tô
        if (['loto', 'lt'].includes(commandName)) {
            const lotoCommand = require('../../commands/loto/loto');
            return lotoCommand.execute(message, args);
        }

        // ?lotocheck, ?ltc - Check số đã/chưa đọc
        if (['lotocheck', 'ltc'].includes(commandName)) {
            const lotocheckCommand = require('../../commands/loto/lotocheck');
            return lotocheckCommand.execute(message, args);
        }

        // ?lotoend, ?lte - Kết thúc ván
        if (['lotoend', 'lte'].includes(commandName)) {
            const lotoendCommand = require('../../commands/loto/lotoend');
            return lotoendCommand.execute(message, args);
        }

        // ?lotorollback, ?ltrb - Rollback ván đã end
        if (['lotorollback', 'ltrb'].includes(commandName)) {
            const lotorollbackCommand = require('../../commands/loto/lotorollback');
            return lotorollbackCommand.execute(message, args);
        }

        // ?lotothem, ?ltt - Thêm số vào sàn
        if (['lotothem', 'ltt'].includes(commandName)) {
            const lotothemCommand = require('../../commands/loto/lotothem');
            return lotothemCommand.execute(message, args);
        }

        // ?lotobo, ?ltb - Bỏ số khỏi sàn
        if (['lotobo', 'ltb'].includes(commandName)) {
            const lotoboCommand = require('../../commands/loto/lotobo');
            return lotoboCommand.execute(message, args);
        }

        // ?lotoalbum, ?lta - Xem album lá Loto
        if (['lotoalbum', 'lta'].includes(commandName)) {
            const lotoalbumCommand = require('../../commands/loto/lotoalbum');
            return lotoalbumCommand.execute(message, args);
        }

        // ?lotohelp, ?lth - Hướng dẫn chơi Loto
        if (['lotohelp', 'lth'].includes(commandName)) {
            const lotohelpCommand = require('../../commands/loto/lotohelp');
            return lotohelpCommand.execute(message, args);
        }

        // ============== APPS COMMANDS ==============

        // ?random <min> <max> - Generate random number
        if (commandName === 'random') {
            return randomCommand.execute(message, args);
        }

        // ?rteam, ?rt, ?randomteam - Random chia 2 team
        if (['rteam', 'rt', 'randomteam'].includes(commandName)) {
            const rteamCommand = require('../../commands/apps/rteam');
            return rteamCommand.execute(message, args);
        }

        // ?chon <options> - Random select from options
        if (commandName === 'chon') {
            return chonCommand.execute(message, args);
        }

        // ?join, ?leave, ?stop - TTS Voice commands
        if (['join', 'leave', 'stop'].includes(commandName)) {
            const ttsCommand = require('../../commands/apps/tts');
            return ttsCommand.execute(message, args);
        }

        // ?spam - Tạo chủ đề mới để spam lệnh (hoặc tag vào chủ đề cũ)
        if (commandName === 'spam') {
            try {
                // Xóa tin nhắn ?spam của user
                await message.delete().catch(() => { });

                const { ChannelType } = require('discord.js');
                const threadName = `🔒 ${message.author.username}'s Private Zone`;

                // === Kiểm tra thread cũ còn tồn tại không ===
                let existingThread = null;

                // Fetch active threads
                const activeThreads = await message.channel.threads.fetchActive().catch(() => null);
                if (activeThreads) {
                    existingThread = activeThreads.threads.find(t => t.name === threadName) || null;
                }

                // Nếu không tìm thấy trong active → tìm trong archived
                if (!existingThread) {
                    const archivedThreads = await message.channel.threads.fetchArchived({ type: 'private', fetchAll: true }).catch(() => null);
                    if (archivedThreads) {
                        existingThread = archivedThreads.threads.find(t => t.name === threadName) || null;
                    }
                }

                // === Đã có thread cũ ===
                if (existingThread) {
                    // Un-archive nếu đang archived
                    if (existingThread.archived) {
                        await existingThread.setArchived(false).catch(() => { });
                    }

                    // Đảm bảo user vẫn còn trong thread
                    await existingThread.members.add(message.author.id).catch(() => { });

                    // Tag user vào thread cũ
                    await existingThread.send({
                        content: `👋 ${message.author} Chủ đề riêng của bạn nè~\n` +
                            `🎮 Thoải mái dùng lệnh bot ở đây nhé!`
                    });

                    return;
                }

                // === Chưa có → Tạo thread mới ===
                const thread = await message.channel.threads.create({
                    name: threadName,
                    autoArchiveDuration: 60,
                    type: ChannelType.PrivateThread,
                    invitable: false,
                    reason: `Private spam thread requested by ${message.author.tag}`
                });

                // Thêm user vào thread
                await thread.members.add(message.author.id);

                // Gửi tin nhắn hướng dẫn vào thread
                await thread.send({
                    content: `🔒 **Chủ đề riêng tư của ${message.author}**\n\n` +
                        `✨ Chỉ có bạn và bot thấy được chủ đề này!\n` +
                        `🎮 Thoải mái sử dụng các lệnh bot ở đây nhé~\n` +
                        `⏰ Chủ đề sẽ tự **xóa** sau **1 giờ** không hoạt động.`
                });

                // Set timeout để xóa thread sau 1 giờ không hoạt động
                setTimeout(async () => {
                    try {
                        const fetchedThread = await message.channel.threads.fetch(thread.id).catch(() => null);
                        if (fetchedThread && fetchedThread.archived) {
                            await fetchedThread.delete('Auto-delete after 1 hour inactivity');
                            console.log(`[spam] Deleted inactive thread: ${thread.name}`);
                        }
                    } catch (e) {
                        // Thread có thể đã bị xóa
                    }
                }, 60 * 60 * 1000); // 1 giờ

                return;
            } catch (error) {
                console.error('[spam] Error creating thread:', error);
                const errMsg = await message.channel.send('❌ Không thể tạo chủ đề riêng tư!');
                setTimeout(() => errMsg.delete().catch(() => { }), 3000);
                return;
            }
        }


        // ?voteevent, ?votesukien - Bình chọn lịch sự kiện Guild (legacy)
        if (['voteevent', 'votesukien', 'votelich'].includes(commandName)) {
            const voteeventCommand = require('../../commands/apps/voteevent');
            return voteeventCommand.execute(message, args);
        }

        // ?voteyentiec - Bình chọn giờ Yến Tiệc
        if (commandName === 'voteyentiec') {
            const cmd = require('../../commands/apps/voteyentiec');
            return cmd.execute(message, args);
        }

        // ?votebosssolo, ?voteboss - Bình chọn lịch Boss Solo
        if (['votebosssolo', 'voteboss'].includes(commandName)) {
            const cmd = require('../../commands/apps/votebosssolo');
            return cmd.execute(message, args);
        }

        // ?votepvpsolo, ?votepvp - Bình chọn lịch PvP Solo
        if (['votepvpsolo', 'votepvp'].includes(commandName)) {
            const cmd = require('../../commands/apps/votepvpsolo');
            return cmd.execute(message, args);
        }

        // ?votegioevent, ?votegio - Bình chọn GIỜ sự kiện (legacy)
        if (['votegioevent', 'votegio'].includes(commandName)) {
            const votegioeventCommand = require('../../commands/apps/votegioevent');
            return votegioeventCommand.execute(message, args);
        }

        // ?votengayevent, ?votengay - Bình chọn NGÀY sự kiện (legacy)
        if (['votengayevent', 'votengay'].includes(commandName)) {
            const votengayeventCommand = require('../../commands/apps/votengayevent');
            return votengayeventCommand.execute(message, args);
        }

        // ============== BOSS GUILD COMMANDS ==============

        // ?dsdk, ?dsdangky - Xem danh sách đăng ký trước (+1)
        if (['dsdk', 'dsdangky', 'prereg'].includes(commandName)) {
            const guildId = message.guild.id;
            const preRegs = getPreRegistrations(guildId);

            if (preRegs.length === 0) {
                return message.reply('📭 Chưa có ai đăng ký trước (+1)!');
            }


            const lines = preRegs.map((r, i) => {
                const userData = db.getUserByDiscordId(r.id);
                const gameName = userData?.game_username || null;
                const timeAgo = Math.floor((Date.now() - r.registeredAt) / 60000);
                return `${i + 1}. <@${r.id}>${gameName ? ` (${gameName})` : ''} - ${timeAgo} phút trước`;
            });

            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle('📋 DANH SÁCH ĐĂNG KÝ TRƯỚC (+1)')
                .setDescription(lines.join('\n'))
                .setFooter({ text: `${preRegs.length} người • Danh sách sẽ được clear khi PT chốt` })
                .setTimestamp();

            return message.reply({ embeds: [embed] });
        }

        // ?bossguild, ?bg, ?dkboss, ?dangkyboss - Bắt đầu thông báo Boss Guild
        if (['bossguild', 'bg', 'dkboss', 'dangkyboss'].includes(commandName)) {
            return bossguildCommand.execute(message, args, client);
        }

        // ?lichboss, ?lichguild - Gửi embed lịch Boss Guild
        if (['lichboss', 'lichguild', 'bosschedule'].includes(commandName)) {
            const lichbossCommand = require('../../commands/thongbao/lichboss');
            return lichbossCommand.execute(message, args, client);
        }

        // ?doilichbossguild, ?doilich - Chỉnh sửa lịch Boss Guild
        if (['doilichbossguild', 'doilich', 'editbossschedule'].includes(commandName)) {
            const doilichCommand = require('../../commands/thongbao/doilichbossguild');
            return doilichCommand.execute(message, args, client);
        }

        // ?bgrs, ?bgreset, ?bossguildreset - Reset danh sách đăng ký trước (+1)
        if (['bgrs', 'bgreset', 'bossguildreset'].includes(commandName)) {
            // Chỉ Kỳ Cựu được reset
            if (!message.member.roles.cache.some(r => r.name === 'Kỳ Cựu')) {
                return message.reply('❌ Chỉ **Kỳ Cựu** mới được reset danh sách!');
            }
            const preRegs = getPreRegistrations(guildId);
            const count = preRegs.length;
            clearPreRegistrations(guildId);
            return message.reply(`✅ Đã reset danh sách đăng ký trước! (${count} người đã bị xóa)`);
        }

        // ?lenhbossguild, ?lenhbg, ?lbg - Xem lệnh Boss Guild
        if (['lenhbossguild', 'lenhbg', 'lbg'].includes(commandName)) {
            const { EmbedBuilder } = require('discord.js');
            const prefix = process.env.PREFIX || '?';
            const embed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('👑 LỆNH BOSS GUILD')
                .setDescription('Danh sách lệnh liên quan đến Boss Guild')
                .addFields(
                    {
                        name: '📋 Quản lý Party', value:
                            `\`${prefix}bg\` - Tạo party Boss Guild\n` +
                            `\`${prefix}lichboss\` - Xem lịch Boss\n` +
                            `\`${prefix}doilich\` - Đổi lịch Boss`, inline: false
                    },
                    {
                        name: '📝 Đăng ký trước', value:
                            `\`+1\` - Đăng ký trước (trong kênh)\n` +
                            `\`-1\` - Hủy đăng ký trước\n` +
                            `\`${prefix}dsdk\` - Xem DS đăng ký trước\n` +
                            `\`${prefix}bgrs\` - Reset DS đăng ký`, inline: false
                    }
                )
                .setFooter({ text: 'Lang Gia Các' })
                .setTimestamp();
            return message.reply({ embeds: [embed] });
        }

        // ============== BANG CHIEN COMMANDS ==============

        // ?bangchien, ?bc, ?dangkybangchien - Đăng ký Bang Chiến
        if (['bangchien', 'bc', 'dangkybangchien'].includes(commandName)) {
            return bangchienCommand.execute(message, args, client);
        }

        // ?xemds - Xem danh sách đăng ký đầy đủ (tạm thời, không bị cắt)
        if (commandName === 'xemds') {
            const { bangchienRegistrations, getGuildBangchienKeys } = require('../../utils/bangchienState');

            const guildId = message.guild.id;
            const partyKeys = getGuildBangchienKeys(guildId);

            if (partyKeys.length === 0) {
                return message.reply('❌ Không có party bang chiến nào đang chạy!');
            }

            const partyKey = partyKeys[0];
            const registrations = bangchienRegistrations.get(partyKey) || [];

            if (registrations.length === 0) {
                return message.reply('📭 Chưa có ai đăng ký!');
            }

            // Chia thành nhiều tin nhắn nếu cần
            const lines = registrations.map((r, i) => {
                const userData = db.getUserByDiscordId(r.id);
                const gameName = userData?.game_username || null;
                return `${i + 1}. <@${r.id}>${gameName ? ` (${gameName})` : ''}${r.isLeader ? ' 👑' : ''}`;
            });

            // Gửi theo batch 15 người mỗi tin
            const batchSize = 15;
            for (let i = 0; i < lines.length; i += batchSize) {
                const batch = lines.slice(i, i + batchSize);
                const header = i === 0 ? `📋 **DANH SÁCH ĐĂNG KÝ ĐẦY ĐỦ (${registrations.length} người):**\n\n` : '';
                await message.channel.send(header + batch.join('\n'));
            }
            return;
        }

        // ?listbangchien, ?listbc - Xem chi tiết lần bang chiến gần nhất
        if (['listbangchien', 'listbc'].includes(commandName)) {
            const listbangchienCommand = require('../../commands/bangchien/listbangchien');
            return listbangchienCommand.execute(message, args, client);
        }

        // ?bcend, ?ketthucbc - Kết thúc BC (thay thế bcwin/bcthua)
        if (['bcend', 'ketthucbc', 'endbc'].includes(commandName)) {
            const bcendCommand = require('../../commands/bangchien/bcend');
            return bcendCommand.execute(message, args, client);
        }

        // ?bcql, ?bcquanly - Panel quản lý Bang Chiến (chỉ Leader)
        if (['bcql', 'bcquanly', 'bangchienquanly'].includes(commandName)) {
            const bcquanlyCommand = require('../../commands/bangchien/bcquanly');
            return bcquanlyCommand.execute(message, args, client);
        }

        // ?resetque, ?rsq - Reset lượt gieo quẻ
        if (['resetque', 'rsq'].includes(commandName)) {
            return resetqueCommand.execute(message, args, client);
        }

        // ?huybangchien, ?huybc - Huỷ phiên đăng ký Bang Chiến
        if (['huybangchien', 'huybc'].includes(commandName)) {
            const huybangchienCommand = require('../../commands/bangchien/huybangchien');
            return huybangchienCommand.execute(message, args, client);
        }

        // ?bcswap, ?bcdoi, ?doiteam - Đổi người giữa các team
        if (['bcswap', 'bcdoi', 'doiteam'].includes(commandName)) {
            const bcswapCommand = require('../../commands/bangchien/bcswap');
            return bcswapCommand.execute(message, args, client);
        }

        // ?bcchihuy, ?bcch - Đặt chỉ huy
        if (['bcchihuy', 'bcch', 'setchihuy'].includes(commandName)) {
            const bcchihuyCommand = require('../../commands/bangchien/bcchihuy');
            return bcchihuyCommand.execute(message, args, client);
        }

        // ?bcleader, ?bcld - Đặt leader team
        if (['bcleader', 'bcld', 'setleader'].includes(commandName)) {
            const bcleaderCommand = require('../../commands/bangchien/bcleader');
            return bcleaderCommand.execute(message, args, client);
        }

        // ?bcadd - Thêm người vào danh sách BC
        if (['bcadd', 'bcaddmem', 'thembc'].includes(commandName)) {
            const bcaddCommand = require('../../commands/bangchien/bcadd');
            return bcaddCommand.execute(message, args, client);
        }

        // ?lenhbangchien, ?lenhbc, ?lbc - Xem lệnh bang chiến
        if (['lenhbangchien', 'lenhbc', 'lbc', 'bchelp', 'helpbc'].includes(commandName)) {
            const lenhbcCommand = require('../../commands/bangchien/lenhbangchien');
            return lenhbcCommand.execute(message, args, client);
        }

        // ?bcsize, ?teamsize, ?bcsoluong - Thay đổi số người của các Team BC
        if (['bcsize', 'teamsize', 'bcsoluong'].includes(commandName)) {
            const bcsizeCommand = require('../../commands/bangchien/bcsize');
            return bcsizeCommand.execute(message, args, client);
        }

        // ?bcrole, ?bctanker, ?bcdps, ?bchealer - Xem thành viên theo role
        if (['bcrole', 'bctanker', 'bcdps', 'bchealer'].includes(commandName)) {
            const bcroleCommand = require('../../commands/bangchien/bcrole');
            return bcroleCommand.execute(message, args, client);
        }

        // ?chotbc, ?bcchot - Thêm role Bang Chiến cho mọi người trong danh sách
        if (['chotbc', 'bcchot', 'chotbangchien', 'addbcrole', 'finalize'].includes(commandName)) {
            const bchotCommand = require('../../commands/bangchien/bcchot');
            return bchotCommand.execute(message, args, client);
        }

        // ?nhacnho, ?nn, ?remind - Đăng ký nhận nhắc nhở event
        if (['nhacnho', 'nn', 'remind'].includes(commandName)) {
            const nhacnhoCommand = require('../../commands/thongbao/nhacnho');
            return nhacnhoCommand.execute(message, args, client);
        }

        // ?listthongbao, ?lichguild, ?tgb - Xem lịch sự kiện guild dạng thời gian biểu
        if (['listthongbao', 'lichguild', 'tgb', 'lichsk'].includes(commandName)) {
            const { EmbedBuilder } = require('discord.js');
            const { getWeeklySchedule } = require('../../commands/thongbao/thongbaoguild');

            const guildId = message.guild.id;
            const weeklySchedule = getWeeklySchedule(guildId, true);

            if (!weeklySchedule) {
                return message.reply('📭 Chưa có lịch sự kiện Guild nào!');
            }

            const embed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle('📅 LỊCH SỰ KIỆN TUẦN NÀY')
                .setDescription(weeklySchedule)
                .setTimestamp()
                .setFooter({ text: 'Lang Gia Các' });

            return message.reply({ embeds: [embed] });
        }

        // ============== MINIGAME COMMANDS ==============

        // Check if channel is blocked for minigame
        const { isChannelBlocked } = require('../../commands/admin/nominigame');
        if (isChannelBlocked(message.channel.id)) {
            return; // Không phản hồi minigame trong kênh bị chặn
        }

        // ?bal, ?balance, ?tien, ?hat - Xem số dư
        if (['bal', 'balance', 'tien', 'hat'].includes(commandName)) {
            return balanceCommand.execute(message, args);
        }

        // ?nhua, ?item, ?vatpham - Xem tất cả vật phẩm
        if (['nhua', 'item', 'vatpham'].includes(commandName)) {
            return nhuaCommand.execute(message, args);
        }

        // ?daily - Nhận thưởng hàng ngày
        if (commandName === 'daily') {
            return dailyCommand.executeDaily(message, args);
        }

        // ?weekly - Nhận thưởng hàng tuần
        if (commandName === 'weekly') {
            return dailyCommand.executeWeekly(message, args);
        }

        // ?shop, ?cuahang - Hiển thị shop
        if (['shop', 'cuahang'].includes(commandName)) {
            return shopCommand.execute(message, args);
        }

        // ?buy, ?mua - Mua item
        if (['buy', 'mua'].includes(commandName)) {
            return buyCommand.execute(message, args);
        }

        // ?sell, ?ban - Bán item
        if (commandName === 'sell') {
            const sellCommand = require('../../commands/minigame/sell');
            return sellCommand.execute(message, args);
        }

        // ?nv, ?q, ?quest, ?nhiemvu - Nhiệm vụ
        if (['nv', 'q', 'quest', 'nhiemvu'].includes(commandName)) {
            const questCommand = require('../../commands/minigame/quest');
            return questCommand.execute(message, args);
        }

        // ?info, ?i, ?thongtin, ?tt - Thông tin người chơi
        if (['info', 'i', 'thongtin'].includes(commandName)) {
            const infoCommand = require('../../commands/minigame/info');
            return infoCommand.execute(message, args);
        }

        // ?thanhtuu, ?tt, ?achievements - Thành tựu
        if (['thanhtuu', 'tt', 'achievements', 'ach'].includes(commandName)) {
            const achCommand = require('../../commands/minigame/achievement');
            return achCommand.execute(message, args);
        }

        // ?settitle, ?danhieu - Danh hiệu
        if (['settitle', 'danhieu'].includes(commandName)) {
            const titleCommand = require('../../commands/minigame/title');
            return titleCommand.execute(message, args);
        }

        // ?box, ?hom - Xem và mở box
        if (['box', 'hom'].includes(commandName)) {
            const boxCommand = require('../../commands/minigame/box');
            return boxCommand.execute(message, args);
        }

        // ?dismantle, ?phantach - Phân tách đồ tím
        // ?dismantleall, ?phantachhet, ?pth - Phân tách hết
        if (['dismantle', 'phantach'].includes(commandName)) {
            return dismantleCommand.execute(message, args);
        }
        if (['dismantleall', 'phantachhet', 'pth'].includes(commandName)) {
            return dismantleCommand.execute(message, ['all']);
        }

        // ?inv, ?inventory, ?tuido, ?kho, ?tui, ?bag - Xem kho đồ
        if (['inv', 'inventory', 'tuido', 'kho', 'tui', 'bag'].includes(commandName)) {
            return inventoryCommand.execute(message, args);
        }

        // ?tune, ?nangcap, ?nc - Tune trang bị
        if (['tune', 'nangcap', 'nc'].includes(commandName)) {
            return tuneCommand.execute(message, args);
        }


        // ?buy, ?b - Mua vật phẩm
        if (['buy', 'b'].includes(commandName)) {
            const buyCommand = require('../../commands/minigame/buy');
            return buyCommand.execute(message, args);
        }

        // ?equip, ?gan, ?eq - Gắn trang bị
        if (['equip', 'gan', 'eq'].includes(commandName)) {
            return equipCommand.execute(message, args);
        }

        // ?unequip, ?ue, ?go - Gỡ trang bị
        if (['unequip', 'ue', 'go'].includes(commandName)) {
            const unequipCommand = require('../../commands/minigame/unequip');
            return unequipCommand.execute(message, args);
        }

        // ?lock - Khóa trang bị
        if (commandName === 'lock') {
            const lockCommand = require('../../commands/minigame/lock');
            return lockCommand.execute(message, args);
        }

        // ?ban - Bán đồ (select menu)
        if (commandName === 'ban') {
            return banCommand.execute(message, args);
        }

        // ?trangbi - Xem trang bị đang mặc
        if (commandName === 'trangbi') {
            return equipCommand.executeView(message, args);
        }

        // ?top, ?lb, ?leaderboard, ?bxh - Bảng xếp hạng
        if (['top', 'lb', 'leaderboard', 'bxh'].includes(commandName)) {
            return leaderboardCommand.execute(message, args);
        }

        // ?dungeon, ?dung, ?bicanh - Hệ thống Dungeon
        if (['dungeon', 'dung', 'bicanh'].includes(commandName)) {
            return dungeonCommand.execute(message, args);
        }

        // ?huydung, ?huybicanh, ?roidung - Hủy/Rời dungeon đang chạy
        if (['huydung', 'huybicanh', 'roidung'].includes(commandName)) {
            return dungeonCommand.executeCancel(message, args);
        }

        // ?xem, ?item, ?it - Xem chi tiết item hoặc player
        if (['item', 'it'].includes(commandName)) {
            const xemMinigameCommand = require('../../commands/minigame/xem');
            return xemMinigameCommand.execute(message, args, client);
        }

        // ?xem - Smart command: @user -> info, số -> item
        if (commandName === 'xem') {
            const xemMinigameCommand = require('../../commands/minigame/xem');
            return xemMinigameCommand.execute(message, args, client);
        }

        // ?huongdan, ?hd, ?guide - Hướng dẫn chơi
        if (['huongdan', 'hd', 'guide'].includes(commandName)) {
            const huongdanCommand = require('../../commands/minigame/huongdan');
            return huongdanCommand.execute(message, args);
        }

        // ?lenh, ?cmd, ?commands - Danh sách lệnh ngắn gọn
        if (['lenh', 'cmd', 'commands'].includes(commandName)) {
            const lenhCommand = require('../../commands/minigame/lenh');
            return lenhCommand.execute(message, args);
        }

        // ?look - Xem thông tin item
        if (commandName === 'look') {
            const lookCommand = require('../../commands/minigame/look');
            return lookCommand.execute(message, args);
        }

        // ?use, ?u, ?sudung - Sử dụng item
        if (['use', 'u', 'sudung'].includes(commandName)) {
            const useCommand = require('../../commands/minigame/use');
            return useCommand.execute(message, args);
        }

        // ?daden, ?dd, ?truyen - Chuyển dòng trang bị
        if (['daden', 'dd', 'truyen'].includes(commandName)) {
            const dadenCommand = require('../../commands/minigame/daden');
            return dadenCommand.execute(message, args);
        }

        // ?update - Xem các cập nhật mới
        if (commandName === 'update') {
            const updateCommand = require('../../commands/minigame/update');
            return updateCommand.execute(message, args);
        }

        // ?reset, ?resetplayer - Reset player data (Owner only)
        if (['reset', 'resetplayer'].includes(commandName)) {
            return resetplayerCommand.execute(message, args, commandName);
        }

        // ?donedung - Force complete dungeon (owner only)
        if (commandName === 'donedung') {
            return donedungCommand.execute(message, args);
        }

        // ?addnhuafull - Fill nhựa to max (owner only)
        if (commandName === 'addnhuafull') {
            return addnhuafullCommand.execute(message, args);
        }

        // Xử lý pickrole command (alias: pr)
        if (commandName === 'pickrole' || commandName === 'pr') {
            const { dpsSubTypes, findDpsSubType, getAllDpsRoleNames } = require('../../commands/quanly/pickrole');
            const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

            const guild = message.guild;
            const validRoles = ['dps', 'healer', 'tanker'];
            const roleConfig = {
                'dps': { name: 'DPS', color: 0x0099FF, emoji: '🔵' },
                'healer': { name: 'Healer', color: 0x00FF00, emoji: '🟢' },
                'tanker': { name: 'Tanker', color: 0xFF9900, emoji: '🟠' }
            };

            // Kiểm tra có mention không (pick cho người khác)
            const mentionedUser = message.mentions.members.first();

            if (mentionedUser) {
                // Pick role cho người khác - chỉ Quản Lý được dùng
                const quanLyRole = guild.roles.cache.find(r => r.name === 'Quản Lý');
                if (!quanLyRole || !message.member.roles.cache.has(quanLyRole.id)) {
                    return message.reply({
                        content: '❌ Chỉ **Quản Lý** mới được pick role cho người khác!',
                        allowedMentions: { repliedUser: false }
                    });
                }

                // Lấy role từ arg thứ 2 và dpsType từ arg thứ 3 (nếu có)
                const roleArg = args[1]?.toLowerCase();
                const dpsTypeArg = args[2]?.toLowerCase();

                if (!roleArg || !validRoles.includes(roleArg)) {
                    const dpsTypesHelp = Object.values(dpsSubTypes).map(c => `  • **${c.name}**: \`${c.aliases.join(', ')}\``).join('\n');
                    return message.reply({
                        content: `❌ Cú pháp: \`${prefix}pickrole @user <dps|healer|tanker> [loại_dps]\`\n\n**Ví dụ:**\n\`${prefix}pickrole @Rain healer\`\n\`${prefix}pickrole @Rain dps qd\`\n\n**Loại DPS:**\n${dpsTypesHelp}`,
                        allowedMentions: { repliedUser: false }
                    });
                }

                let selectedRoleConfig = roleConfig[roleArg];

                // Xử lý DPS sub-type nếu có - cấp CẢ DPS + sub-type role
                if (roleArg === 'dps' && dpsTypeArg) {
                    const dpsSubConfig = findDpsSubType(dpsTypeArg);
                    if (!dpsSubConfig) {
                        const dpsTypesHelp = Object.values(dpsSubTypes).map(c => `  • **${c.name}**: \`${c.aliases.join(', ')}\``).join('\n');
                        return message.reply({
                            content: `❌ Loại DPS không hợp lệ!\n\n**Các loại DPS:**\n${dpsTypesHelp}`,
                            allowedMentions: { repliedUser: false }
                        });
                    }

                    const targetMember = mentionedUser;
                    const allRoleNames = ['DPS', 'Healer', 'Tanker', ...getAllDpsRoleNames()];
                    const rolesToRemove = [];
                    for (const roleName of allRoleNames) {
                        const role = guild.roles.cache.find(r => r.name === roleName);
                        if (role && targetMember.roles.cache.has(role.id)) {
                            rolesToRemove.push(role);
                        }
                    }

                    // Chỉ xóa sub-types, không xóa DPS
                    const subTypesToRemove = rolesToRemove.filter(r => r.name !== 'DPS');

                    // Tìm hoặc tạo role DPS chính
                    let dpsRole = guild.roles.cache.find(r => r.name === 'DPS');
                    if (!dpsRole) {
                        dpsRole = await guild.roles.create({
                            name: 'DPS',
                            color: 0x0099FF,
                            reason: 'Tạo role DPS cho hệ thống pickrole'
                        });
                    }

                    // Tìm hoặc tạo role sub-type
                    let subTypeRole = guild.roles.cache.find(r => r.name === dpsSubConfig.name);
                    if (!subTypeRole) {
                        subTypeRole = await guild.roles.create({
                            name: dpsSubConfig.name,
                            color: dpsSubConfig.color,
                            reason: `Tạo role ${dpsSubConfig.name} cho hệ thống pickrole`
                        });
                    }

                    if (subTypesToRemove.length > 0) {
                        await targetMember.roles.remove(subTypesToRemove);
                    }
                    await targetMember.roles.add([dpsRole, subTypeRole]);

                    const successEmbed = new EmbedBuilder()
                        .setColor(dpsSubConfig.color)
                        .setTitle(`🔵 Đã set role thành công!`)
                        .setDescription(`Đã set **DPS** + **${dpsSubConfig.name}** cho ${targetMember}!` +
                            (subTypesToRemove.length > 0 ? `\n\n*Đã xóa role cũ: ${subTypesToRemove.map(r => r.name).join(', ')}*` : ''))
                        .setTimestamp();

                    return message.reply({ embeds: [successEmbed], allowedMentions: { repliedUser: false } });
                }

                // Xử lý Healer/Tanker cho người khác
                const targetMember = mentionedUser;

                try {
                    const allRoleNames = ['DPS', 'Healer', 'Tanker', ...getAllDpsRoleNames()];
                    const rolesToRemove = [];
                    for (const roleName of allRoleNames) {
                        const role = guild.roles.cache.find(r => r.name === roleName);
                        if (role && targetMember.roles.cache.has(role.id)) {
                            rolesToRemove.push(role);
                        }
                    }

                    let targetRole = guild.roles.cache.find(r => r.name === selectedRoleConfig.name);
                    if (!targetRole) {
                        targetRole = await guild.roles.create({
                            name: selectedRoleConfig.name,
                            color: selectedRoleConfig.color,
                            reason: `Tạo role ${selectedRoleConfig.name} cho hệ thống pickrole`
                        });
                    }

                    if (rolesToRemove.length > 0) {
                        await targetMember.roles.remove(rolesToRemove);
                    }
                    await targetMember.roles.add(targetRole);

                    const successEmbed = new EmbedBuilder()
                        .setColor(selectedRoleConfig.color)
                        .setTitle(`${selectedRoleConfig.emoji} Đã set role thành công!`)
                        .setDescription(`Đã set **${selectedRoleConfig.name}** cho ${targetMember}!` +
                            (rolesToRemove.length > 0 ? `\n\n*Đã xóa role cũ: ${rolesToRemove.map(r => r.name).join(', ')}*` : ''))
                        .setTimestamp();

                    return message.reply({ embeds: [successEmbed], allowedMentions: { repliedUser: false } });

                } catch (error) {
                    console.error('[pickrole] Lỗi khi set role cho người khác:', error);
                    return message.reply('❌ Có lỗi xảy ra khi xử lý role!');
                }
            }

            // Pick role cho chính mình
            const roleArg = args[0]?.toLowerCase();
            const dpsTypeArg = args[1]?.toLowerCase();

            // Nếu không có argument → hiển thị buttons để chọn
            if (!roleArg) {
                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('🎮 Chọn Role Của Bạn')
                    .setDescription('Chọn một trong các role dưới đây:\n\n' +
                        '🟢 **Healer** - Hỗ trợ và hồi máu\n' +
                        '🟠 **Tanker** - Chịu đòn và bảo vệ đồng đội\n\n' +
                        '**🔵 DPS - Sát thương chính:**\n' +
                        '🪭 **Quạt Dù** │ 🗡️ **Vô Danh** │ ⚔️ **Song Đao** │ 🔱 **Cửu Kiếm**\n\n' +
                        'ℹ️ *Chọn lại role khác sẽ tự động thay đổi role hiện tại*')
                    .setTimestamp()
                    .setFooter({ text: 'Chọn role trong game của bạn!' });

                // Row 1: DPS sub-types
                const userId = message.author.id;
                const dpsRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`pickrole_dps_quatdu_${userId}`)
                            .setLabel('Quạt Dù')
                            .setEmoji('🪭')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`pickrole_dps_vodanh_${userId}`)
                            .setLabel('Vô Danh')
                            .setEmoji('🗡️')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`pickrole_dps_songdao_${userId}`)
                            .setLabel('Song Đao')
                            .setEmoji('⚔️')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`pickrole_dps_cuukiem_${userId}`)
                            .setLabel('Cửu Kiếm')
                            .setEmoji('🔱')
                            .setStyle(ButtonStyle.Primary)
                    );

                // Row 2: Healer & Tanker
                const otherRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`pickrole_healer_${userId}`)
                            .setLabel('Healer')
                            .setEmoji('🟢')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`pickrole_tanker_${userId}`)
                            .setLabel('Tanker')
                            .setEmoji('🟠')
                            .setStyle(ButtonStyle.Secondary)
                    );

                return message.reply({ embeds: [embed], components: [dpsRow, otherRow] });
            }

            // Kiểm tra nếu roleArg là alias của DPS sub-type (ví dụ: ?pickrole sd)
            const directDpsSubType = findDpsSubType(roleArg);
            if (directDpsSubType) {
                // Coi như user gõ: ?pickrole dps <roleArg>
                const member = message.member;
                const dpsSubConfig = directDpsSubType;

                try {
                    const allRoleNames = ['DPS', 'Healer', 'Tanker', ...getAllDpsRoleNames()];
                    const rolesToRemove = [];
                    for (const roleName of allRoleNames) {
                        const role = guild.roles.cache.find(r => r.name === roleName);
                        if (role && member.roles.cache.has(role.id)) {
                            rolesToRemove.push(role);
                        }
                    }

                    const subTypesToRemove = rolesToRemove.filter(r => r.name !== 'DPS');

                    let dpsRole = guild.roles.cache.find(r => r.name === 'DPS');
                    if (!dpsRole) {
                        dpsRole = await guild.roles.create({
                            name: 'DPS',
                            color: 0x0099FF,
                            reason: 'Tạo role DPS cho hệ thống pickrole'
                        });
                    }

                    let subTypeRole = guild.roles.cache.find(r => r.name === dpsSubConfig.name);
                    if (!subTypeRole) {
                        subTypeRole = await guild.roles.create({
                            name: dpsSubConfig.name,
                            color: dpsSubConfig.color,
                            reason: `Tạo role ${dpsSubConfig.name} cho hệ thống pickrole`
                        });
                    }

                    if (member.roles.cache.has(dpsRole.id) && member.roles.cache.has(subTypeRole.id)) {
                        const embed = new EmbedBuilder()
                            .setColor(dpsSubConfig.color)
                            .setTitle(`🔵 Bạn đã có role này rồi!`)
                            .setDescription(`Bạn đã là **DPS ${dpsSubConfig.name}** rồi!`)
                            .setTimestamp();
                        return message.reply({ embeds: [embed] });
                    }

                    if (subTypesToRemove.length > 0) {
                        await member.roles.remove(subTypesToRemove);
                    }
                    await member.roles.add([dpsRole, subTypeRole]);

                    const successEmbed = new EmbedBuilder()
                        .setColor(dpsSubConfig.color)
                        .setTitle(`🔵 Đã chọn role thành công!`)
                        .setDescription(`Bạn đã chọn role **DPS** + **${dpsSubConfig.name}**!` +
                            (subTypesToRemove.length > 0 ? `\n\n*Đã xóa role cũ: ${subTypesToRemove.map(r => r.name).join(', ')}*` : ''))
                        .setTimestamp();

                    await message.reply({ embeds: [successEmbed] });

                    // Auto-refresh bangchien embed nếu user đang trong party
                    try {
                        const { bangchienNotifications, bangchienRegistrations, getGuildBangchienKeys } = require('../../utils/bangchienState');
                        const { createBangchienEmbed, createBangchienButtons } = require('../../commands/bangchien/bangchien');
                        const guildId = message.guild.id;
                        const odUserId = message.author.id;
                        const partyKeys = getGuildBangchienKeys(guildId);
                        for (const partyKey of partyKeys) {
                            const registrations = bangchienRegistrations.get(partyKey) || [];
                            const isInParty = registrations.some(r => r.id === odUserId);
                            if (isInParty) {
                                const notifData = bangchienNotifications.get(partyKey);
                                if (notifData && notifData.message) {
                                    try { await notifData.message.delete(); } catch (e) { }
                                    const channel = await message.guild.channels.fetch(notifData.channelId).catch(() => null);
                                    if (channel) {
                                        const newEmbed = createBangchienEmbed(partyKey, notifData.leaderName, message.guild);
                                        const newRow = createBangchienButtons(partyKey);
                                        const newMessage = await channel.send({ embeds: [newEmbed], components: [newRow] });
                                        notifData.message = newMessage;
                                        notifData.messageId = newMessage.id;
                                    }
                                }
                                break;
                            }
                        }
                    } catch (e) {
                        console.error('[pickrole alias] Lỗi khi refresh bangchien:', e);
                    }
                    return;
                } catch (error) {
                    console.error('Lỗi khi xử lý pickrole direct DPS:', error);
                    if (error.code === 50013) {
                        return message.reply('❌ Bot không có quyền quản lý roles! Liên hệ admin.');
                    }
                    return message.reply('❌ Có lỗi xảy ra khi xử lý role!');
                }
            }

            // Kiểm tra role hợp lệ
            if (!validRoles.includes(roleArg)) {
                const dpsTypesHelp = Object.values(dpsSubTypes).map(c => `  • **${c.name}**: \`${c.aliases.join(', ')}\``).join('\n');
                return message.reply({
                    content: `❌ Role không hợp lệ! Chọn: \`dps\`, \`healer\`, hoặc \`tanker\`.\n\n**Hoặc dùng lệnh tắt:**\n\`${prefix}pickrole qd\` - DPS Quạt Dù\n\`${prefix}pickrole vd\` - DPS Vô Danh\n\`${prefix}pickrole sd\` - DPS Song Đao\n\`${prefix}pickrole 9k\` - DPS Cửu Kiếm`
                });
            }

            // Xử lý role selection
            const member = message.member;
            let selectedRoleConfig = roleConfig[roleArg];

            // Xử lý DPS sub-type nếu có - cấp CẢ DPS + sub-type role
            if (roleArg === 'dps') {
                if (dpsTypeArg) {
                    const dpsSubConfig = findDpsSubType(dpsTypeArg);
                    if (!dpsSubConfig) {
                        const dpsTypesHelp = Object.values(dpsSubTypes).map(c => `  • **${c.name}**: \`${c.aliases.join(', ')}\``).join('\n');
                        return message.reply({
                            content: `❌ Loại DPS không hợp lệ!\n\n**Các loại DPS:**\n${dpsTypesHelp}\n\n**Ví dụ:** \`${prefix}pickrole dps qd\``
                        });
                    }

                    // Cấp cả DPS + sub-type role
                    try {
                        const allRoleNames = ['DPS', 'Healer', 'Tanker', ...getAllDpsRoleNames()];
                        const rolesToRemove = [];
                        for (const roleName of allRoleNames) {
                            const role = guild.roles.cache.find(r => r.name === roleName);
                            if (role && member.roles.cache.has(role.id)) {
                                rolesToRemove.push(role);
                            }
                        }

                        // Chỉ xóa sub-types, không xóa DPS
                        const subTypesToRemove = rolesToRemove.filter(r => r.name !== 'DPS');

                        // Tìm hoặc tạo role DPS chính
                        let dpsRole = guild.roles.cache.find(r => r.name === 'DPS');
                        if (!dpsRole) {
                            dpsRole = await guild.roles.create({
                                name: 'DPS',
                                color: 0x0099FF,
                                reason: 'Tạo role DPS cho hệ thống pickrole'
                            });
                        }

                        // Tìm hoặc tạo role sub-type
                        let subTypeRole = guild.roles.cache.find(r => r.name === dpsSubConfig.name);
                        if (!subTypeRole) {
                            subTypeRole = await guild.roles.create({
                                name: dpsSubConfig.name,
                                color: dpsSubConfig.color,
                                reason: `Tạo role ${dpsSubConfig.name} cho hệ thống pickrole`
                            });
                        }

                        // Kiểm tra đã có cả 2 chưa
                        if (member.roles.cache.has(dpsRole.id) && member.roles.cache.has(subTypeRole.id)) {
                            const embed = new EmbedBuilder()
                                .setColor(dpsSubConfig.color)
                                .setTitle(`🔵 Bạn đã có role này rồi!`)
                                .setDescription(`Bạn đã là **DPS ${dpsSubConfig.name}** rồi!`)
                                .setTimestamp();
                            return message.reply({ embeds: [embed] });
                        }

                        if (subTypesToRemove.length > 0) {
                            await member.roles.remove(subTypesToRemove);
                        }
                        await member.roles.add([dpsRole, subTypeRole]);

                        const successEmbed = new EmbedBuilder()
                            .setColor(dpsSubConfig.color)
                            .setTitle(`🔵 Đã chọn role thành công!`)
                            .setDescription(`Bạn đã chọn role **DPS** + **${dpsSubConfig.name}**!` +
                                (subTypesToRemove.length > 0 ? `\n\n*Đã xóa role cũ: ${subTypesToRemove.map(r => r.name).join(', ')}*` : ''))
                            .setTimestamp();

                        await message.reply({ embeds: [successEmbed] });

                        // Auto-refresh bangchien
                        try {
                            const { bangchienNotifications, bangchienRegistrations, getGuildBangchienKeys } = require('../../utils/bangchienState');
                            const { createBangchienEmbed, createBangchienButtons } = require('../../commands/bangchien/bangchien');
                            const guildId = message.guild.id;
                            const odUserId = message.author.id;
                            const partyKeys = getGuildBangchienKeys(guildId);
                            for (const partyKey of partyKeys) {
                                const registrations = bangchienRegistrations.get(partyKey) || [];
                                const isInParty = registrations.some(r => r.id === odUserId);
                                if (isInParty) {
                                    const notifData = bangchienNotifications.get(partyKey);
                                    if (notifData && notifData.message) {
                                        try { await notifData.message.delete(); } catch (e) { }
                                        const channel = await message.guild.channels.fetch(notifData.channelId).catch(() => null);
                                        if (channel) {
                                            const newEmbed = createBangchienEmbed(partyKey, notifData.leaderName, message.guild);
                                            const newRow = createBangchienButtons(partyKey);
                                            const newMessage = await channel.send({ embeds: [newEmbed], components: [newRow] });
                                            notifData.message = newMessage;
                                            notifData.messageId = newMessage.id;
                                        }
                                    }
                                    break;
                                }
                            }
                        } catch (e) {
                            console.error('[pickrole prefix DPS] Lỗi khi refresh bangchien:', e);
                        }
                        return;
                    } catch (error) {
                        console.error('Lỗi khi xử lý pickrole DPS:', error);
                        if (error.code === 50013) {
                            return message.reply('❌ Bot không có quyền quản lý roles! Liên hệ admin.');
                        }
                        return message.reply('❌ Có lỗi xảy ra khi xử lý role!');
                    }
                } else {
                    // DPS không có sub-type → hiển thị 4 nút để chọn
                    const userId = message.author.id;
                    const dpsEmbed = new EmbedBuilder()
                        .setColor(0x0099FF)
                        .setTitle('🔵 Chọn Loại DPS')
                        .setDescription('Chọn một trong các loại DPS dưới đây:')
                        .setTimestamp()
                        .setFooter({ text: 'Chọn role DPS của bạn!' });

                    const dpsRow = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`pickrole_dps_quatdu_${userId}`)
                                .setLabel('Quạt Dù')
                                .setEmoji('🪭')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`pickrole_dps_vodanh_${userId}`)
                                .setLabel('Vô Danh')
                                .setEmoji('🗡️')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`pickrole_dps_songdao_${userId}`)
                                .setLabel('Song Đao')
                                .setEmoji('⚔️')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`pickrole_dps_cuukiem_${userId}`)
                                .setLabel('Cửu Kiếm')
                                .setEmoji('🔱')
                                .setStyle(ButtonStyle.Primary)
                        );

                    return message.reply({ embeds: [dpsEmbed], components: [dpsRow] });
                }
            }

            try {
                const allRoleNames = ['DPS', 'Healer', 'Tanker', ...getAllDpsRoleNames()];

                // Tìm và xóa roles cũ
                const rolesToRemove = [];
                for (const roleName of allRoleNames) {
                    const role = guild.roles.cache.find(r => r.name === roleName);
                    if (role && member.roles.cache.has(role.id)) {
                        rolesToRemove.push(role);
                    }
                }

                // Tìm hoặc tạo role mới
                let targetRole = guild.roles.cache.find(r => r.name === selectedRoleConfig.name);
                if (!targetRole) {
                    targetRole = await guild.roles.create({
                        name: selectedRoleConfig.name,
                        color: selectedRoleConfig.color,
                        reason: `Tạo role ${selectedRoleConfig.name} cho hệ thống pickrole`
                    });
                }

                // Kiểm tra nếu đã có role
                if (member.roles.cache.has(targetRole.id)) {
                    const embed = new EmbedBuilder()
                        .setColor(selectedRoleConfig.color)
                        .setTitle(`${selectedRoleConfig.emoji} Bạn đã có role này rồi!`)
                        .setDescription(`Bạn đã là **${selectedRoleConfig.name}** rồi!`)
                        .setTimestamp();

                    return message.reply({ embeds: [embed] });
                }

                // Xóa roles cũ và cấp role mới
                if (rolesToRemove.length > 0) {
                    await member.roles.remove(rolesToRemove);
                }
                await member.roles.add(targetRole);

                // Thông báo thành công
                const successEmbed = new EmbedBuilder()
                    .setColor(selectedRoleConfig.color)
                    .setTitle(`${selectedRoleConfig.emoji} Đã chọn role thành công!`)
                    .setDescription(`Bạn đã chọn role **${selectedRoleConfig.name}**!` +
                        (rolesToRemove.length > 0 ? `\n\n*Đã xóa role cũ: ${rolesToRemove.map(r => r.name).join(', ')}*` : ''))
                    .setTimestamp();

                await message.reply({ embeds: [successEmbed] });

                // Auto-refresh bangchien embed nếu user đang trong party
                try {
                    const { bangchienNotifications, bangchienRegistrations, getGuildBangchienKeys } = require('../../utils/bangchienState');
                    const { createBangchienEmbed, createBangchienButtons } = require('../../commands/bangchien/bangchien');

                    const guildId = message.guild.id;
                    const odUserId = message.author.id;
                    const partyKeys = getGuildBangchienKeys(guildId);

                    for (const partyKey of partyKeys) {
                        const registrations = bangchienRegistrations.get(partyKey) || [];
                        const isInParty = registrations.some(r => r.id === odUserId);

                        if (isInParty) {
                            const notifData = bangchienNotifications.get(partyKey);
                            if (notifData && notifData.message) {
                                try { await notifData.message.delete(); } catch (e) { }

                                // Lấy channel gốc từ notifData, không dùng message.channel
                                const channel = await message.guild.channels.fetch(notifData.channelId).catch(() => null);
                                if (channel) {
                                    const newEmbed = createBangchienEmbed(partyKey, notifData.leaderName, message.guild);
                                    const newRow = createBangchienButtons(partyKey);
                                    const newMessage = await channel.send({ embeds: [newEmbed], components: [newRow] });

                                    notifData.message = newMessage;
                                    notifData.messageId = newMessage.id;
                                }
                            }
                            break;
                        }
                    }
                } catch (e) {
                    console.error('[pickrole prefix] Lỗi khi refresh bangchien:', e);
                }

            } catch (error) {
                console.error('Lỗi khi xử lý pickrole:', error);

                if (error.code === 50013) {
                    return message.reply('❌ Bot không có quyền quản lý roles! Liên hệ admin.');
                }

                return message.reply('❌ Có lỗi xảy ra khi xử lý role!');
            }
        }
    }
};


