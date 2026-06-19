const { EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../../database/db');
const { isAllowedGuildId } = require('../../config/guildAccess');
const { hasLangGiaRole } = require('../../utils/langGiaRole');

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
const xoamemNgoaiServerCommand = require('../../commands/quanly/xoamemngoaiserver');
const syncNgayVaoCommand = require('../../commands/quanly/syncngayvao');
const addidCommand = require('../../commands/quanly/addid');
const locmemCommand = require('../../commands/quanly/locmem');

// Import admin commands
const xoaAllCommand = require('../../commands/admin/thongbao/xoatoanbodanhsachthanhvien');

// Import apps commands
const randomCommand = require('../../commands/apps/random');
const chonCommand = require('../../commands/apps/chon');

// Import gieoque commands
const gieoqueCommand = require('../../commands/gieoque/gieoque');
const setgieoqueCommand = require('../../commands/gieoque/setgieoque');
const resetqueCommand = require('../../commands/gieoque/resetque');
const checkapiCommand = require('../../commands/admin/checkapi');

// State for timeouts/reminders
// Map<channelId, timeoutId>
const gieoqueReminders = new Map();
const GIEOQUE_INACTIVITY_TIME = 60 * 60 * 1000; // 1 giá»
// DĂ¹ng shared state tá»« weeklyState Ä‘á»ƒ cáº£ inactivity timer vĂ  weekly scheduler cĂ¹ng track
const {
    lastGieoQueGuideWeekly: lastGieoQueGuide,
    gieoQueGuideSentWeek,
    getCurrentWeekMonday8AM
} = require('../../utils/weeklyState');


// Import thongbao commands
const bossguildCommand = require('../../commands/thongbao/bossguild');
const bangchienCommand = require('../../commands/bangchien/bangchien');
const { finalizedParties, scheduleTimers, bossChannels, lastScheduleEmbed, PRE_REGISTER_CHANNEL_ID, addPreRegistration, removePreRegistration, getPreRegistrations, clearPreRegistrations } = require('../../utils/bossState');
const { bangchienFinalizedParties } = require('../../utils/bangchienState');
const { createScheduleOnlyEmbed } = require('../../commands/thongbao/bossguild');
// Thá»i gian chá» trÆ°á»›c khi gá»­i schedule embed
const SCHEDULE_DELAY_NORMAL = 60 * 60 * 1000; // 1 giá» khi khĂ´ng cĂ³ party
const SCHEDULE_DELAY_ACTIVE = 15 * 60 * 1000; // 15 phĂºt khi cĂ³ party Ä‘ang má»Ÿ


module.exports = {
    name: 'messageCreate',
    async execute(message, client) {
        // Bá» qua náº¿u lĂ  bot
        if (message.author.bot) return;
        if (!isAllowedGuildId(message.guild?.id)) return;

        // ============== BOOSTER VIP ROOM â€” Gá»i tĂªn/tag bot Ä‘á»ƒ má»Ÿ báº£ng Ä‘iá»u khiá»ƒn ==============
        const { handleBotMention } = require('../../utils/boosterVoiceHandlers');
        const botMentionHandled = await handleBotMention(message, client);
        if (botMentionHandled) return;

        const guildId = message.guild?.id;
        const prefix = process.env.PREFIX || '?';

        // ============== PRIVATE TROLL TTS COMMAND ==============
        // Owner-only remote TTS: can be typed from any readable text channel.
        if (message.content.startsWith(prefix)) {
            const commandBody = message.content.slice(prefix.length).trim();
            const firstSpaceIndex = commandBody.search(/\s/);
            const earlyCommandName = (firstSpaceIndex === -1 ? commandBody : commandBody.slice(0, firstSpaceIndex)).toLowerCase();

            if (earlyCommandName === 'troll') {
                const trollCommand = require('../../commands/apps/troll');
                if (trollCommand.canUse(message)) {
                    const trollText = firstSpaceIndex === -1 ? '' : commandBody.slice(firstSpaceIndex).trim();
                    return trollCommand.execute(message, trollText ? [trollText] : []);
                }
            }
        }

        // ============== BOSS CHANNEL RESTORATION ==============
        if (guildId && !bossChannels.has(guildId)) {
            const savedBossChannel = db.getBossChannelId(guildId);
            if (savedBossChannel) {
                bossChannels.set(guildId, savedBossChannel);
            }
        }

        // ============== TTS AUTO-READ (tin nháº¯n báº¯t Ä‘áº§u báº±ng .) ==============
        if (message.content.startsWith('.') && message.content.length > 1) {
            const ttsService = require('../../utils/ttsService');

            if (guildId && ttsService.isConnected(guildId)) {
                // Kiá»ƒm tra xem cĂ³ Ä‘ang chÆ¡i loto trong kĂªnh nĂ y khĂ´ng
                const lotoState = require('../../commands/loto/lotoState');
                const activeLotoChannelId = lotoState.getActiveLotoChannelId(guildId);

                if (activeLotoChannelId && message.channel.id === activeLotoChannelId) {
                    // Kiá»ƒm tra cĂ³ Ä‘ang KINH check khĂ´ng â†’ cho phĂ©p TTS
                    const lotoHandlers = require('../../utils/lotoHandlers');
                    if (lotoHandlers.isKinhChecking(guildId)) {
                        // Äang KINH check â†’ cho phĂ©p TTS hoáº¡t Ä‘á»™ng
                        const botConnection = ttsService.getConnection(guildId);
                        const userVoiceChannel = message.member?.voice?.channel;
                        if (botConnection && userVoiceChannel && botConnection.joinConfig.channelId === userVoiceChannel.id) {
                            const textToSpeak = message.content.slice(1).trim();
                            if (textToSpeak) {
                                ttsService.speak(guildId, textToSpeak);
                            }
                        }
                        return; // KhĂ´ng xá»­ lĂ½ nhÆ° command
                    }
                    // KhĂ´ng Ä‘ang KINH â†’ xoĂ¡ lá»‡nh TTS, khĂ´ng Ä‘á»c
                    return message.delete().catch(() => { });
                }

                // Kiá»ƒm tra user cĂ³ trong cĂ¹ng voice channel vá»›i bot khĂ´ng
                const botConnection = ttsService.getConnection(guildId);
                const userVoiceChannel = message.member?.voice?.channel;

                // Chá»‰ Ä‘á»c náº¿u user Ä‘ang á»Ÿ cĂ¹ng voice channel vá»›i bot
                if (botConnection && userVoiceChannel && botConnection.joinConfig.channelId === userVoiceChannel.id) {
                    const textToSpeak = message.content.slice(1).trim();
                    if (textToSpeak) {
                        ttsService.speak(guildId, textToSpeak);
                        // KhĂ´ng react ná»¯a theo yĂªu cáº§u
                    }
                }
                return; // KhĂ´ng xá»­ lĂ½ nhÆ° command
            }
        }


        // ============== TIKTOK LINK CONVERTER (fxTikTok) ==============
        // Tá»± Ä‘á»™ng chuyá»ƒn link TikTok sang fxTikTok Ä‘á»ƒ embed tá»‘t hÆ¡n
        // Gá»­i 2 link (tnktok + tfxktok) Ä‘á»ƒ Ä‘áº£m báº£o Ă­t nháº¥t 1 cĂ¡i embed Ä‘Æ°á»£c
        const tiktokRegex = /https?:\/\/(www\.|vm\.|vt\.)?tiktok\.com\/[^\s]+/gi;
        const tiktokMatches = message.content.match(tiktokRegex);

        if (tiktokMatches && tiktokMatches.length > 0) {
            try {
                let convertedLinks = [];

                for (const link of tiktokMatches) {
                    // XĂ³a query parameters Ä‘á»ƒ link gá»n hÆ¡n
                    const cleanLink = link.split('?')[0];

                    // Link live thĂ¬ giá»¯ nguyĂªn domain, chá»‰ rĂºt gá»n
                    if (cleanLink.includes('/live')) {
                        convertedLinks.push(cleanLink);
                    } else {
                        const fixedLink = cleanLink.replace(/(www\.|vm\.|vt\.)?tiktok\.com/i, 'tnktok.com');
                        convertedLinks.push(fixedLink);
                    }
                }

                // Láº¥y ná»™i dung text (khĂ´ng pháº£i link) mĂ  user Ä‘Ă£ gá»­i kĂ¨m
                let extraContent = message.content;
                for (const link of tiktokMatches) {
                    extraContent = extraContent.replace(link, '');
                }
                extraContent = extraContent.trim();

                // Gá»­i link Ä‘Ă£ convert + tag user gá»­i + ná»™i dung kĂ¨m theo
                const userTag = `(${message.author})`;
                const replyContent = extraContent
                    ? `${userTag} ${extraContent}\n${convertedLinks.join('\n')}`
                    : `${userTag}\n${convertedLinks.join('\n')}`;

                // XĂ³a tin nháº¯n gá»‘c vĂ  gá»­i tin má»›i
                await message.delete().catch(() => { });
                await message.channel.send(replyContent);

                console.log(`[TikTok] Converted ${tiktokMatches.length} link(s) for ${message.author.username}`);
                return; // KhĂ´ng xá»­ lĂ½ thĂªm
            } catch (e) {
                console.error('[TikTok] Error converting link:', e.message);
            }
        }

        // ============== YOUTUBE LINK CONVERTER (Koutube) ==============
        // Tá»± Ä‘á»™ng chuyá»ƒn link YouTube sang koutube.com Ä‘á»ƒ embed tá»‘t hÆ¡n trĂªn Discord
        // Gá»­i 2 link (koutube + youtu.be) Ä‘á»ƒ Ä‘áº£m báº£o Ă­t nháº¥t 1 cĂ¡i embed Ä‘Æ°á»£c
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

                // Gá»­i link Ä‘Ă£ convert + tag user gá»­i
                const userTag = `(${message.author})`;
                const replyContent = `${userTag}\n${convertedLinks.join('\n')}`;

                // XĂ³a tin nháº¯n gá»‘c vĂ  gá»­i tin má»›i
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
        // Kiá»ƒm tra tin nháº¯n +1/-1 trong kĂªnh Ä‘Äƒng kĂ½ trÆ°á»›c

        if (guildId && (message.channel.id === PRE_REGISTER_CHANNEL_ID || (bossChannels.has(guildId) && bossChannels.get(guildId) === message.channel.id))) {
            const content = message.content.trim();
            const contentLower = content.toLowerCase();

            // Kiá»ƒm tra cĂ¡c cĂ¡ch Ä‘Äƒng kĂ½: +1 (cĂ³ thá»ƒ kĂ¨m text), xin slot, xin 1 slot, cho slot, cho 1 slot
            // Match: "+1", "+1 vá»›i", "+1 boss guild tá»‘i nay", "xin slot", "cho slot", etc.
            const isRegistration = content.startsWith('+1') ||
                contentLower.includes('xin slot') ||
                contentLower.includes('xin 1 slot') ||
                contentLower.includes('cho slot') ||
                contentLower.includes('cho 1 slot');

            if (isRegistration) {
                // Kiá»ƒm tra role LangGia
                if (!hasLangGiaRole(message.member)) {
                    try { await message.react('â“'); } catch (e) { }
                    return;
                }

                // Kiá»ƒm tra cĂ³ party Ä‘ang má»Ÿ khĂ´ng
                const { getGuildPartyKeys, bossNotifications, bossRegistrations } = require('../../utils/bossState');
                const partyKeys = getGuildPartyKeys(guildId);

                if (partyKeys.length > 0) {
                    // CĂ³ party Ä‘ang má»Ÿ - thĂªm trá»±c tiáº¿p vĂ o party
                    const partyKey = partyKeys[0]; // Láº¥y party Ä‘áº§u tiĂªn
                    let registrations = bossRegistrations.get(partyKey) || [];

                    // Kiá»ƒm tra Ä‘Ă£ Ä‘Äƒng kĂ½ chÆ°a
                    if (registrations.some(r => r.id === message.author.id)) {
                        try { await message.react('â ï¸'); } catch (e) { }
                        return;
                    }

                    // ThĂªm vĂ o party
                    registrations.push({
                        id: message.author.id,
                        username: message.author.username,
                        joinedAt: Date.now(),
                        isLeader: false
                    });
                    bossRegistrations.set(partyKey, registrations);

                    try { await message.react('âœ…'); } catch (e) { }

                    // Cáº­p nháº­t embed ngay láº­p tá»©c (xĂ³a cÅ©, gá»­i má»›i)
                    const notifData = bossNotifications.get(partyKey);
                    if (notifData) {
                        try {
                            // XĂ³a embed cÅ©
                            if (notifData.message) await notifData.message.delete();
                        } catch (e) { }

                        // Gá»­i embed má»›i
                        const newEmbed = bossguildCommand.createBossEmbed(partyKey, notifData.leaderName);
                        const newRow = bossguildCommand.createButtons(partyKey);
                        const newMessage = await message.channel.send({ embeds: [newEmbed], components: [newRow] });

                        // Cáº­p nháº­t reference
                        notifData.messageId = newMessage.id;
                        notifData.message = newMessage;
                    }
                    return;
                }

                // KhĂ´ng cĂ³ party Ä‘ang má»Ÿ - thĂªm vĂ o danh sĂ¡ch chá»
                const added = addPreRegistration(guildId, message.author.id, message.author.username);
                try {
                    if (added) {
                        await message.react('đŸ‘');
                    } else {
                        // ÄĂ£ Ä‘Äƒng kĂ½ rá»“i
                        await message.react('â ï¸');
                    }
                } catch (e) {
                    // Lá»—i react - bá» qua
                }
                return; // KhĂ´ng xá»­ lĂ½ nhÆ° command
            }

            if (content === '-1') {
                // Kiá»ƒm tra role LangGia
                if (!hasLangGiaRole(message.member)) {
                    try { await message.react('â“'); } catch (e) { }
                    return;
                }

                // Kiá»ƒm tra cĂ³ party Ä‘ang má»Ÿ khĂ´ng
                const { getGuildPartyKeys, bossRegistrations } = require('../../utils/bossState');
                const partyKeys = getGuildPartyKeys(guildId);

                if (partyKeys.length > 0) {
                    // CĂ³ party Ä‘ang má»Ÿ - xĂ³a khá»i party
                    const partyKey = partyKeys[0];
                    let registrations = bossRegistrations.get(partyKey) || [];
                    const user = registrations.find(r => r.id === message.author.id);

                    if (user) {
                        // KhĂ´ng cho leader há»§y
                        if (user.isLeader) {
                            try { await message.react('đŸ«'); } catch (e) { }
                            return;
                        }
                        registrations = registrations.filter(r => r.id !== message.author.id);
                        bossRegistrations.set(partyKey, registrations);
                        try { await message.react('âŒ'); } catch (e) { }

                        // Cáº­p nháº­t embed ngay láº­p tá»©c (xĂ³a cÅ©, gá»­i má»›i)
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
                        try { await message.react('â“'); } catch (e) { }
                    }
                    return;
                }

                // KhĂ´ng cĂ³ party - xĂ³a khá»i danh sĂ¡ch chá»
                const removed = removePreRegistration(guildId, message.author.id);
                try {
                    if (removed) {
                        await message.react('âŒ');
                    } else {
                        // KhĂ´ng cĂ³ trong danh sĂ¡ch
                        await message.react('â“');
                    }
                } catch (e) {
                    // Lá»—i react - bá» qua
                }
                return; // KhĂ´ng xá»­ lĂ½ nhÆ° command
            }
        }

        // ============== ALBUM AUTO-SAVE (vá»›i Cloudinary + ImgBB fallback) ==============
        // Tá»± Ä‘á»™ng lÆ°u áº£nh khi gá»­i vĂ o PhĂ²ng áº¢nh

        const albumChannelId = db.getAlbumChannelId();
        if (albumChannelId && message.channel.id === albumChannelId && message.attachments.size > 0) {
            const imageService = require('../../utils/imageService');

            for (const attachment of message.attachments.values()) {
                // Bá» qua áº£nh spoiler
                if (attachment.spoiler) {
                    console.log(`[Album] Skipping spoiler image: ${attachment.name}`);
                    continue;
                }

                if (attachment.contentType?.startsWith('image/')) {
                    let imageUrl = attachment.url;

                    // Upload lĂªn cloud Ä‘á»ƒ cĂ³ link vÄ©nh viá»…n (Cloudinary â†’ ImgBB fallback)
                    if (imageService.isConfigured()) {
                        try {
                            await message.react('â³'); // Äang upload
                            const uploadResult = await imageService.uploadFromUrl(attachment.url);
                            if (uploadResult.success) {
                                imageUrl = uploadResult.url;
                                console.log(`[Album] Uploaded via ${uploadResult.service}: ${imageUrl}`);
                            } else {
                                console.warn(`[Album] Upload failed, using Discord URL: ${uploadResult.error}`);
                            }
                            // XĂ³a reaction â³
                            try { await message.reactions.cache.get('â³')?.remove(); } catch (e) { }
                        } catch (e) {
                            console.error('[Album] Upload error:', e.message);
                        }
                    }

                    const result = db.addAlbumImage(message.author.id, imageUrl, message.id);
                    if (result.success) {
                        try { await message.react('đŸ“¸'); } catch (e) { }
                    } else if (result.error === 'limit') {
                        try { await message.react('â ï¸'); } catch (e) { }
                    }
                }
            }
        }

        // ============== DEBOUNCED SCHEDULE EMBED ==========================
        // Kiá»ƒm tra náº¿u tin nháº¯n trong kĂªnh boss guild Ä‘Ă£ Ä‘Æ°á»£c Ä‘Äƒng kĂ½
        const channelId = message.channel.id;
        const isPrefixCommandForRouting = message.content.startsWith(prefix);
        const routingCommandName = isPrefixCommandForRouting
            ? message.content.slice(prefix.length).trim().split(/ +/)[0]?.toLowerCase()
            : '';
        const isBangchienCommand = ['bangchien', 'bc', 'dangkybangchien'].includes(routingCommandName);

        const {
            bangchienOverviews: bcOverviews,
            bangchienChannels: bcChannels
        } = require('../../utils/bangchienState');
        const bcOverviewData = bcOverviews.get(guildId);
        const configuredBcChannelId = db.getConfig ? db.getConfig(`bc_channel_${guildId}`) : null;
        const trackedBcChannelId = bcChannels.get(guildId);
        if (
            bcOverviewData?.channelId === channelId ||
            configuredBcChannelId === channelId ||
            trackedBcChannelId === channelId
        ) {
            bangchienCommand.refreshBcOverviewDebounced(client, guildId, channelId);
        }

        if (bossChannels.has(guildId) && bossChannels.get(guildId) === channelId) {
            const { getGuildPartyKeys } = require('../../utils/bossState');

            // Refresh boss embed náº¿u cĂ³ party Ä‘ang má»Ÿ (debounced 5 phĂºt)
            const activeParties = getGuildPartyKeys(guildId);
            if (activeParties.length > 0) {
                bossguildCommand.refreshBossEmbed(client, channelId);
            }

            // XĂ³a timer cÅ© náº¿u cĂ³
            const existingTimer = scheduleTimers.get(channelId);
            if (existingTimer) {
                clearTimeout(existingTimer.timeoutId);
            }

            // Náº¿u cĂ³ party Ä‘ang má»Ÿ, KHĂ”NG sá»­ dá»¥ng timer Ä‘á»ƒ gá»­i schedule ná»¯a (chá»‰ dĂ¹ng refreshBossEmbed á»Ÿ trĂªn)
            // Náº¿u KHĂ”NG cĂ³ party, má»›i dĂ¹ng timer 60 phĂºt Ä‘á»ƒ gá»­i lá»‹ch
            if (activeParties.length > 0) {
                if (!isBangchienCommand) return;
            } else {
                const delay = SCHEDULE_DELAY_NORMAL;

            // Äáº·t timer má»›i
            const timeoutId = setTimeout(async () => {
                try {
                    const channel = await client.channels.fetch(channelId);
                    if (channel) {
                        // XĂ³a embed lá»‹ch cÅ© náº¿u cĂ³
                        const oldEmbedId = lastScheduleEmbed.get(channelId);
                        if (oldEmbedId) {
                            try {
                                const oldMessage = await channel.messages.fetch(oldEmbedId);
                                if (oldMessage) await oldMessage.delete();
                            } catch (e) { /* Embed cÅ© cĂ³ thá»ƒ Ä‘Ă£ bá»‹ xĂ³a */ }
                        }

                        // Gá»­i embed lá»‹ch má»›i
                        const scheduleEmbed = createScheduleOnlyEmbed();
                        const newMessage = await channel.send({ embeds: [scheduleEmbed] });

                        // LÆ°u message ID má»›i
                        lastScheduleEmbed.set(channelId, newMessage.id);

                        console.log(`[Schedule] Gá»­i embed lá»‹ch sau ${delay / 60000} phĂºt táº¡i ${channel.name}`);
                    }
                    scheduleTimers.delete(channelId);
                } catch (e) {
                    console.error('[Schedule] Lá»—i khi gá»­i embed:', e);
                }
            }, delay);

                scheduleTimers.set(channelId, { timeoutId, lastActivity: Date.now(), delay });
            }
        }

        // ============== DEBOUNCED BC OVERVIEW REFRESH ==========================
        // Kiá»ƒm tra náº¿u tin nháº¯n trong kĂªnh BC overview â†’ debounce refresh 5 phĂºt
        // ============== REPLY TO TAG (Boss Guild) ==============
        // Kiá»ƒm tra náº¿u reply vĂ o embed chá»‘t danh sĂ¡ch boss
        if (message.reference && message.reference.messageId) {
            const refMessageId = message.reference.messageId;
            const partyData = finalizedParties.get(refMessageId);

            if (partyData) {
                // Chá»‰ leader má»›i Ä‘Æ°á»£c tag
                if (message.author.id === partyData.leaderId) {


                    // Táº¡o danh sĂ¡ch tag vá»›i tĂªn in-game
                    const mentionList = partyData.participants.map(p => {
                        const userData = db.getUserByDiscordId(p.id);
                        const gameName = userData?.game_username || null;
                        return gameName ? `<@${p.id}> (${gameName})` : `<@${p.id}>`;
                    });

                    const mentions = mentionList.join('\n');

                    // Gá»­i tin nháº¯n tag
                    await message.channel.send({
                        content: `${mentions}\n\nđŸ”” **${message.content || 'VĂ o game Ä‘i!'}**`
                    });

                    // XĂ³a tin nháº¯n reply cá»§a leader (tĂ¹y chá»n)
                    try { await message.delete(); } catch (e) { }

                    return;
                }
            }
        }

        // ============== REPLY TO TAG (Bang Chiáº¿n) ==============
        // Kiá»ƒm tra náº¿u reply vĂ o embed chá»‘t danh sĂ¡ch bang chiáº¿n
        if (message.reference && message.reference.messageId) {
            const refMessageId = message.reference.messageId;

            // TĂ¬m trong memory trÆ°á»›c, náº¿u khĂ´ng cĂ³ thĂ¬ tĂ¬m database
            let partyData = bangchienFinalizedParties.get(refMessageId);

            if (!partyData) {
                // Fallback: tĂ¬m trong database
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
                // Chá»‰ leader má»›i Ä‘Æ°á»£c tag
                if (message.author.id === partyData.leaderId) {


                    // Táº¡o danh sĂ¡ch tag vá»›i tĂªn in-game
                    const mentionList = partyData.participants.map(p => {
                        const userData = db.getUserByDiscordId(p.id);
                        const gameName = userData?.game_username || null;
                        return gameName ? `<@${p.id}> (${gameName})` : `<@${p.id}>`;
                    });

                    const mentions = mentionList.join('\n');

                    // Gá»­i tin nháº¯n tag
                    await message.channel.send({
                        content: `${mentions}\n\nâ”ï¸ **${message.content || 'VĂ o game Ä‘i bang chiáº¿n!'}**`
                    });

                    // XĂ³a tin nháº¯n reply cá»§a leader
                    try { await message.delete(); } catch (e) { }

                    return;
                }
            }
        }

        // ============== LOTO CHANNEL AUTO-DELETE ==============
        // Khi Ä‘ang chÆ¡i loto trong kĂªnh, xoĂ¡ táº¥t cáº£ tin nháº¯n khĂ´ng pháº£i lá»‡nh loto
        const lotoState = require('../../commands/loto/lotoState');
        if (guildId) {
            const activeLotoChannelId = lotoState.getActiveLotoChannelId(guildId);
            if (activeLotoChannelId && message.channel.id === activeLotoChannelId) {
                // Cho phĂ©p tin nháº¯n cĂ³ áº£nh Ä‘Ă­nh kĂ¨m (Ä‘á»ƒ gá»­i áº£nh lĂ¡ Ä‘Ă£ Ä‘Ă¡nh dáº¥u)
                if (message.attachments.size > 0) {
                    // CĂ³ áº£nh â†’ cho phĂ©p
                    return;
                }

                // Danh sĂ¡ch lá»‡nh loto Ä‘Æ°á»£c phĂ©p
                const lotoCommands = ['loto', 'lt', 'lotocheck', 'ltc', 'lotoend', 'lte',
                    'lotorollback', 'ltrb', 'lotothem', 'ltt', 'lotobo', 'ltb',
                    'lotoalbum', 'lta', 'lotohelp', 'lth'];

                if (message.content.startsWith(prefix)) {
                    const tempArgs = message.content.slice(prefix.length).trim().split(/ +/);
                    const tempCmd = tempArgs[0]?.toLowerCase();
                    if (!lotoCommands.includes(tempCmd)) {
                        // KhĂ´ng pháº£i lá»‡nh loto â†’ xoĂ¡
                        return message.delete().catch(() => { });
                    }
                } else {
                    // KhĂ´ng pháº£i command vĂ  khĂ´ng cĂ³ áº£nh â†’ xoĂ¡
                    return message.delete().catch(() => { });
                }
            }
        }

        // ============== Cáº¤P ROLE THĂ”NG MINH ==============
        // PhĂ¢n tĂ­ch tin nháº¯n trong kĂªnh cáº¥p role (so khá»›p text)
        const { handleCaproleMessage } = require('../../utils/caproleHandler');
        const caproleHandled = await handleCaproleMessage(message, client);
        if (caproleHandled) return;

        // ============== EXP TEXT CHAT ==============
        // Cá»™ng EXP má»—i tin nháº¯n (â‰¥3 kĂ½ tá»±, khĂ´ng pháº£i command, cooldown 60s)
        if (message.content.length >= 3 && !message.content.startsWith(prefix)) {
            try {
                const { addTextExp, getLevelReward, LEVEL_REWARDS } = require('../../database/exp');
                const { EmbedBuilder } = require('discord.js');
                const expResult = addTextExp(message.author.id);

                if (expResult.success && expResult.levelUp) {
                    const reward = getLevelReward(expResult.newLevel);

                    // GĂ¡n role thÆ°á»Ÿng náº¿u cĂ³
                    if (reward) {
                        try {
                            let role = message.guild.roles.cache.find(r => r.name === reward.roleName);
                            if (!role) {
                                role = await message.guild.roles.create({
                                    name: reward.roleName,
                                    reason: `EXP Level ${expResult.newLevel} reward`
                                });
                            }
                            await message.member.roles.add(role);

                            // XĂ³a role level cÅ© (tháº¥p hÆ¡n)
                            const levelKeys = Object.keys(LEVEL_REWARDS).map(Number).sort((a, b) => a - b);
                            for (const lv of levelKeys) {
                                if (lv < expResult.newLevel && LEVEL_REWARDS[lv]) {
                                    const oldRole = message.guild.roles.cache.find(r => r.name === LEVEL_REWARDS[lv].roleName);
                                    if (oldRole && message.member.roles.cache.has(oldRole.id)) {
                                        await message.member.roles.remove(oldRole);
                                    }
                                }
                            }
                        } catch (e) {
                            console.error('[EXP] Lá»—i gĂ¡n role:', e.message);
                        }
                    }

                    // Gá»­i thĂ´ng bĂ¡o vĂ o kĂªnh Ä‘Ă£ set (náº¿u cĂ³)
                    const levelUpChannelId = db.getLevelUpChannelId();
                    if (levelUpChannelId) {
                        try {
                            const levelUpChannel = await client.channels.fetch(levelUpChannelId);
                            if (levelUpChannel) {
                                const levelEmojis = ['đŸŒ±', 'â”ï¸', 'đŸ—¡ï¸', 'đŸ›¡ï¸', 'đŸ‘‘', 'đŸŒŸ', 'đŸ’', 'đŸ”¥'];
                                const emoji = levelEmojis[Math.min(Math.floor(expResult.newLevel / 10), levelEmojis.length - 1)];
                                const displayName = message.member?.displayName || message.author.username;

                                const embed = new EmbedBuilder()
                                    .setColor(0x00E5FF)
                                    .setAuthor({
                                        name: displayName,
                                        iconURL: message.author.displayAvatarURL({ size: 64 })
                                    })
                                    .setTitle(`${emoji} LĂªn Cáº¥p!`)
                                    .setDescription(`**${displayName}** Ä‘Ă£ Ä‘áº¡t **Level ${expResult.newLevel}**! đŸ‰`)
                                    .addFields(
                                        { name: 'đŸ“ Level', value: `${expResult.oldLevel} â†’ **${expResult.newLevel}**`, inline: true },
                                        { name: 'đŸ·ï¸ Loáº¡i', value: 'đŸ’¬ Chat', inline: true }
                                    )
                                    .setTimestamp()
                                    .setFooter({ text: 'Lang Gia CĂ¡c â€¢ Há»‡ thá»‘ng EXP' });

                                if (reward) {
                                    embed.addFields({
                                        name: 'đŸ Pháº§n thÆ°á»Ÿng',
                                        value: `Role **${reward.roleName}**`,
                                        inline: false
                                    });
                                    embed.setColor(0xFFD700); // VĂ ng cho milestone
                                }

                                await levelUpChannel.send({ embeds: [embed] });
                            }
                        } catch (e) {
                            console.error('[EXP] Lá»—i gá»­i thĂ´ng bĂ¡o level up:', e.message);
                        }
                    }
                }
            } catch (e) {
                // KhĂ´ng log lá»—i EXP Ä‘á»ƒ trĂ¡nh spam console
            }
        }

        // Kiá»ƒm tra cĂ³ báº¯t Ä‘áº§u vá»›i prefix khĂ´ng
        if (!message.content.startsWith(prefix)) return;

        // Parse command vĂ  args
        const args = message.content.slice(prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        // ============== MUTE CHECK (Äáº·t á»Ÿ Ä‘Ă¢y Ä‘á»ƒ cháº·n Táº¤T Cáº¢ lá»‡nh trá»« muteall) ==============
        // ?muteall - Block/unblock ALL commands in channel (luĂ´n cho phĂ©p Ä‘á»ƒ cĂ³ thá»ƒ unmute)
        if (commandName === 'muteall') {
            const muteallCommand = require('../../commands/admin/muteall');
            return muteallCommand.execute(message, args);
        }

        // ?serverbot - Danh sĂ¡ch server bot Ä‘ang á»Ÿ (owner only)
        if (commandName === 'serverbot') {
            const serverbotCommand = require('../../commands/admin/serverbot');
            return serverbotCommand.execute(message, args);
        }

        // Check if channel is muted (cháº·n Táº¤T Cáº¢ lá»‡nh khĂ¡c)
        const { isChannelMuted } = require('../../commands/admin/muteall');
        if (isChannelMuted(message.channel.id)) {
            return; // KhĂ´ng pháº£n há»“i báº¥t ká»³ lá»‡nh nĂ o trong kĂªnh bá»‹ mute
        }

        // ============== MEMBER MANAGEMENT COMMANDS ==============

        // ?tongrole - Xem tá»•ng sá»‘ role trong server (Owner only)
        if (commandName === 'tongrole') {
            const tongroleCommand = require('../../commands/quanly/tongrole');
            return tongroleCommand.execute(message, args);
        }

        // ?addhelp - Show help
        if (commandName === 'addhelp') {
            return addhelpCommand.execute(message, args);
        }

        // ?lenhquanly, ?qlcmd, ?admincmd - Danh sĂ¡ch lá»‡nh quáº£n lĂ½
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

        // ============== GIEO QUE INACTIVITY REMINDER (1 láº§n/tuáº§n, reset 8h sĂ¡ng thá»© 2) ==============
        // Sau 8h sĂ¡ng thá»© Hai: tin nháº¯n cuá»‘i cĂ¹ng trong kĂªnh â†’ 1 giá» khĂ´ng hoáº¡t Ä‘á»™ng â†’ gá»­i hÆ°á»›ng dáº«n
        // Má»—i tin nháº¯n má»›i sáº½ RESET timer (debounce), chá»‰ gá»­i sau tin nháº¯n CUá»I CĂ™NG
        // Sau khi Ä‘Ă£ gá»­i, khĂ´ng gá»­i láº¡i cho Ä‘áº¿n 8h sĂ¡ng thá»© Hai tuáº§n sau

        const gieoQueChannelId = db.getGieoQueChannelId();

        if (gieoQueChannelId && message.channel.id === gieoQueChannelId) {
            const currentWeekGQ = getCurrentWeekMonday8AM();

            const dbWeekGQ = db.getConfig(`gq_guide_week_${gieoQueChannelId}`);
            if (dbWeekGQ && !gieoQueGuideSentWeek.has(gieoQueChannelId)) {
                gieoQueGuideSentWeek.set(gieoQueChannelId, dbWeekGQ);
            }
            const lastSentWeekGQ = gieoQueGuideSentWeek.get(gieoQueChannelId);

            // Chá»‰ Ä‘áº·t/reset timer náº¿u chÆ°a gá»­i tuáº§n nĂ y
            if (lastSentWeekGQ !== currentWeekGQ) {
                // XĂ³a timer cÅ© náº¿u cĂ³ (debounce - reset timer má»—i tin nháº¯n má»›i)
                if (gieoqueReminders.has(gieoQueChannelId)) {
                    clearTimeout(gieoqueReminders.get(gieoQueChannelId));
                    gieoqueReminders.delete(gieoQueChannelId);
                }

                // HĂ m thá»±c thi gá»­i nháº¯c nhá»Ÿ
                const sendReminder = async () => {
                    try {
                        const channel = await client.channels.fetch(gieoQueChannelId);
                        if (channel) {
                            // XĂ³a embed hÆ°á»›ng dáº«n cÅ© náº¿u cĂ³
                            const dbGuideId = db.getConfig(`gq_guide_msg_${gieoQueChannelId}`);
                            if (dbGuideId && !lastGieoQueGuide.has(gieoQueChannelId)) {
                                lastGieoQueGuide.set(gieoQueChannelId, dbGuideId);
                            }
                            const oldGuideId = lastGieoQueGuide.get(gieoQueChannelId);
                            if (oldGuideId) {
                                try {
                                    const oldMsg = await channel.messages.fetch(oldGuideId).catch(() => null);
                                    if (oldMsg) await oldMsg.delete();
                                } catch (e) { /* Embed cÅ© cĂ³ thá»ƒ Ä‘Ă£ bá»‹ xĂ³a */ }
                            }

                            const guideEmbed = {
                                color: 0xFFD700, // Gold
                                title: 'đŸ”® Gieo Quáº» & Cáº§u DuyĂªn Má»—i NgĂ y đŸ”®',
                                description: `KĂªnh ${channel} Ä‘Ă£ Ä‘Æ°á»£c thiáº¿t láº­p Ä‘á»ƒ gieo quáº» má»—i ngĂ y!\n\n` +
                                    `đŸ‘‰ **\`?gieoque [cĂ¢u há»i]\`**: Xin quáº» tá»•ng quan (cĂ´ng viá»‡c, tĂ i lá»™c, sá»± nghiá»‡p...).\n` +
                                    `đŸ‘‰ **\`?cauduyen [cĂ¢u há»i]\`**: Xin quáº» tĂ¬nh duyĂªn (cho nam thanh ná»¯ tĂº).\n\n` +
                                    `*VĂ­ dá»¥: \`?gieoque hĂ´m nay cĂ³ may máº¯n khĂ´ng?\`*\n\n` +
                                    `â ï¸ **LÆ°u Ă½:**\n` +
                                    `- Má»—i ngÆ°á»i cĂ³ **1 quáº» cĂ´ng danh** vĂ  **1 quáº» tĂ¬nh duyĂªn** chĂ­nh má»—i ngĂ y; há»i láº¡i trong ngĂ y sáº½ phĂ¡n láº¡i theo quáº» cÅ©.\n` +
                                    `- Náº¿u cĂ³ cĂ¢u há»i cá»¥ thá»ƒ, bot sáº½ bĂ¡m sĂ¡t cĂ¢u há»i Ä‘Ă³.\n` +
                                    `- Core/BĂ¡t Ă‚m chá»‰ hiá»‡n khi há»i vá» core/roll/ná»• vĂ ng; khĂ´ng há»i thĂ¬ khĂ´ng nháº¯c.\n` +
                                    `- Káº¿t quáº£ core cá»§a WWM giá»¯ cá»‘ Ä‘á»‹nh trong thĂ¡ng.`,
                                footer: { text: 'đŸ”® Má»—i ngĂ y má»™t quáº», váº­n may tá»± Ä‘áº¿n! đŸ”®' }
                            };

                            const sentMsg = await channel.send({ embeds: [guideEmbed] });
                            lastGieoQueGuide.set(gieoQueChannelId, sentMsg.id);
                            gieoQueGuideSentWeek.set(gieoQueChannelId, currentWeekGQ);
                            db.setConfig(`gq_guide_week_${gieoQueChannelId}`, currentWeekGQ);
                            db.setConfig(`gq_guide_msg_${gieoQueChannelId}`, sentMsg.id);
                            console.log(`[GieoQue] Sent reminder in ${channel.name} (tuáº§n ${currentWeekGQ})`);

                            gieoqueReminders.delete(gieoQueChannelId);
                        }
                    } catch (e) {
                        console.error('[GieoQue] Reminder error:', e.message);
                    }
                };

                // Set timeout má»›i: 1 giá» sau tin nháº¯n cuá»‘i cĂ¹ng
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

        // ?addrole - Add sub-role (Bang Chá»§)
        if (commandName === 'addrole') {
            const addroleCommand = require('../../commands/quanly/subrole/addrole');
            return addroleCommand.execute(message, args);
        }

        // ?editrole, ?doirole - Edit sub-role (Bang Chá»§)
        if (['editrole', 'doirole'].includes(commandName)) {
            const editroleCommand = require('../../commands/quanly/subrole/editrole');
            return editroleCommand.execute(message, args);
        }

        // ?delrole - Delete sub-role (Bang Chá»§)
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

        // ?role, ?show - Äá»•i display role
        if (['role', 'show'].includes(commandName)) {
            const showCommand = require('../../commands/quanly/subrole/show');
            return showCommand.execute(message, args);
        }

        // ?hideicon, ?anicon - áº¨n display icon
        if (['hideicon', 'anicon'].includes(commandName)) {
            const hideiconCommand = require('../../commands/quanly/subrole/hideicon');
            return hideiconCommand.execute(message, args);
        }

        // ?setroomcaprole - Thiáº¿t láº­p kĂªnh cáº¥p role thĂ´ng minh
        if (commandName === 'setroomcaprole') {
            const setroomcaproleCommand = require('../../commands/quanly/subrole/setroomcaprole');
            return setroomcaproleCommand.execute(message, args);
        }

        // ?mem, ?me - Xem thĂ´ng tin thĂ nh viĂªn (quáº£n lĂ½)
        if (['mem', 'me'].includes(commandName)) {
            // Chá»‰ role LangGia trá»Ÿ lĂªn má»›i Ä‘Æ°á»£c dĂ¹ng
            if (!hasLangGiaRole(message.member)) {
                return message.reply('âŒ Chá»‰ thĂ nh viĂªn **LangGia** má»›i Ä‘Æ°á»£c sá»­ dá»¥ng lá»‡nh nĂ y!');
            }
            return memCommand.execute(message, args);
        }

        // ============== EXP COMMANDS ==============

        // ?rank, ?level, ?xp, ?exp - Xem EXP/level cĂ¡ nhĂ¢n
        if (['rank', 'level', 'xp', 'exp'].includes(commandName)) {
            const rankCommand = require('../../commands/exp/rank');
            return rankCommand.execute(message, args);
        }

        // ?top, ?leaderboard, ?lb, ?bxh - Báº£ng xáº¿p háº¡ng
        if (['top', 'leaderboard', 'lb', 'bxh'].includes(commandName)) {
            const topCommand = require('../../commands/exp/top');
            return topCommand.execute(message, args);
        }

        // ?randomavt, ?rda - Random avatar tá»« album
        if (['randomavt', 'rda'].includes(commandName)) {
            const randomavtCommand = require('../../commands/apps/randomavt');
            return randomavtCommand.execute(message, args);
        }

        // ?dich, ?translate, ?dichtiengviet - Dá»‹ch tin nháº¯n phĂ­a trĂªn sang tiáº¿ng Viá»‡t
        if (['dich', 'translate', 'dichtiengviet'].includes(commandName)) {
            const dichCommand = require('../../commands/apps/dich');
            return dichCommand.execute(message, args);
        }

        // ?setavt, ?setavatar, ?avatar, ?avt - Set custom avatar
        if (['setavt', 'setavatar', 'avatar', 'avt'].includes(commandName)) {
            // Chá»‰ role LangGia trá»Ÿ lĂªn má»›i Ä‘Æ°á»£c dĂ¹ng
            if (!hasLangGiaRole(message.member)) {
                return message.reply('âŒ Chá»‰ thĂ nh viĂªn **LangGia** má»›i Ä‘Æ°á»£c sá»­ dá»¥ng lá»‡nh nĂ y!');
            }
            const setavtCommand = require('../../commands/quanly/setavt');
            return setavtCommand.execute(message, args);
        }

        // ?delavt, ?delavatar, ?removeavt, ?clearavt - XĂ³a custom avatar
        if (['delavt', 'delavatar', 'removeavt', 'removeavatar', 'clearavt'].includes(commandName)) {
            const delavtCommand = require('../../commands/quanly/delavt');
            return delavtCommand.execute(message, args);
        }

        // ?clearallavt, ?xoahetatv, ?delavtall - XĂ³a Táº¤T Cáº¢ custom avatar (Owner only)
        if (['clearallavt', 'xoahetatv', 'delavtall'].includes(commandName)) {
            const clearallavtCommand = require('../../commands/quanly/clearallavt');
            return clearallavtCommand.execute(message, args, client);
        }

        // ?banavt @user - Ban user khĂ´ng Ä‘Æ°á»£c set avatar (Ká»³ Cá»±u trá»Ÿ lĂªn)
        if (commandName === 'banavt') {
            // Kiá»ƒm tra quyá»n Ká»³ Cá»±u
            if (!message.member.roles.cache.some(r => r.name.includes('Ká»³ Cá»±u'))) {
                return message.reply('âŒ Chá»‰ **Ká»³ Cá»±u** má»›i Ä‘Æ°á»£c sá»­ dá»¥ng lá»‡nh nĂ y!');
            }

            const targetUser = message.mentions.users.first();
            if (!targetUser) {
                return message.reply('âŒ Vui lĂ²ng mention user! VD: `?banavt @user`');
            }

            const result = db.banAvatarUser(targetUser.id);
            if (result.success) {
                return message.reply(`âœ… ÄĂ£ **cáº¥m** ${targetUser} Ä‘áº·t avatar tĂ¹y chá»‰nh vĂ  xĂ³a avatar hiá»‡n táº¡i!`);
            } else {
                return message.reply(`âŒ KhĂ´ng tĂ¬m tháº¥y user trong database!`);
            }
        }

        // ?unbanavt @user - Gá»¡ ban avatar cho user
        if (commandName === 'unbanavt') {
            // Kiá»ƒm tra quyá»n Ká»³ Cá»±u
            if (!message.member.roles.cache.some(r => r.name.includes('Ká»³ Cá»±u'))) {
                return message.reply('âŒ Chá»‰ **Ká»³ Cá»±u** má»›i Ä‘Æ°á»£c sá»­ dá»¥ng lá»‡nh nĂ y!');
            }

            const targetUser = message.mentions.users.first();
            if (!targetUser) {
                return message.reply('âŒ Vui lĂ²ng mention user! VD: `?unbanavt @user`');
            }

            const result = db.unbanAvatarUser(targetUser.id);
            if (result.success) {
                return message.reply(`âœ… ÄĂ£ **gá»¡ cáº¥m** ${targetUser} - cĂ³ thá»ƒ Ä‘áº·t avatar láº¡i!`);
            } else {
                return message.reply(`âŒ KhĂ´ng tĂ¬m tháº¥y user trong database!`);
            }
        }

        // ?xoabc - Delete Bang Chá»§
        if (commandName === 'xoabc') {
            return xoabcCommand.execute(message, args);
        }

        // ?xoapbc - Delete PhĂ³ Bang Chá»§
        if (commandName === 'xoapbc') {
            return xoapbcCommand.execute(message, args);
        }

        // ?listmem, ?dsmem, ?dstv - List active members
        if (['listmem', 'dsmem', 'dstv'].includes(commandName)) {
            return listmemCommand.execute(message, args);
        }

        // ?checkmem, ?kiemtramem - Kiá»ƒm tra thĂ nh viĂªn Ä‘Ă£ rá»i server
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

        // ?rsrejoin, ?rsrj - Reset rejoin count (Quáº£n LĂ½ only)
        if (['rsrejoin', 'rsrj'].includes(commandName)) {
            return rsrejoinCommand.execute(message, args);
        }

        // ?xoamem - XĂ³a thĂ nh viĂªn khá»i database (BC/PBC/KC)
        if (commandName === 'xoamem') {
            return xoamemCommand.execute(message, args);
        }

        if (['xoamemngoaiserver', 'donmemngoaiserver', 'cleanmemserver'].includes(commandName)) {
            return xoamemNgoaiServerCommand.execute(message, args);
        }

        // ?locmem - Lá»c thĂ nh viĂªn cĂ³ role LangGia nhÆ°ng khĂ´ng trong database
        if (['syncngayvao', 'dongbongayvao', 'ghidengayvao', 'fixngayvao'].includes(commandName)) {
            return syncNgayVaoCommand.execute(message, args);
        }

        if (commandName === 'locmem') {
            return locmemCommand.execute(message, args);
        }

        // ?gieoque, ?xinque, ?xq - Gieo quáº» má»—i ngĂ y
        if (['gieoque', 'xinque', 'xq', 'buxu'].includes(commandName)) {
            // Chá»‰ cho phĂ©p trong kĂªnh Ä‘Ă£ setgieoque
            const gqChannelId = db.getGieoQueChannelId();
            if (gqChannelId && message.channel.id !== gqChannelId) {
                return message.reply(`âŒ Lá»‡nh nĂ y chá»‰ dĂ¹ng Ä‘Æ°á»£c trong kĂªnh <#${gqChannelId}>!`);
            }
            return gieoqueCommand.execute(message, args);
        }

        // ?cauduyen, ?cd - Cáº§u duyĂªn (tĂ¬nh yĂªu)
        if (['cauduyen', 'cd'].includes(commandName)) {
            const gqChannelId = db.getGieoQueChannelId();
            if (gqChannelId && message.channel.id !== gqChannelId) {
                return message.reply(`âŒ Lá»‡nh nĂ y chá»‰ dĂ¹ng Ä‘Æ°á»£c trong kĂªnh <#${gqChannelId}>!`);
            }
            const cauduyenCommand = require('../../commands/gieoque/cauduyen');
            return cauduyenCommand.execute(message, args);
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

        // [DISABLED] CĂ¡c lá»‡nh cÅ© Ä‘Ă£ thay báº±ng ?setbooster panel
        // ?boostroom / ?br / ?myroom
        // ?delboostroom / ?dbr
        // ?setboostcategory

        // ?setbooster <Category ID> - Thiáº¿t láº­p Booster Panel + category
        if (commandName === 'setbooster') {
            const setboosterCommand = require('../../commands/booster/setbooster');
            return setboosterCommand.execute(message, args);
        }

        // ?addvip - ThĂªm ngÆ°á»i dĂ¹ng vĂ o danh sĂ¡ch VIP Booster Room
        if (commandName === 'addvip') {
            const addvipCommand = require('../../commands/booster/addvip');
            return addvipCommand.execute(message, args, client);
        }

        // ?rmvip - Gá»¡ ngÆ°á»i dĂ¹ng khá»i danh sĂ¡ch VIP Booster Room
        if (commandName === 'rmvip') {
            const rmvipCommand = require('../../commands/booster/rmvip');
            return rmvipCommand.execute(message, args, client);
        }

        // ?setchannelanh - Set channel lĂ m PhĂ²ng áº¢nh (Quáº£n LĂ½ only)
        if (['setchannelanh', 'setchannelphonganh', 'phonganh'].includes(commandName)) {
            const setchannelanhCommand = require('../../commands/admin/setchannelanh');
            return setchannelanhCommand.execute(message, args);
        }

        // ?setlevelup - Set kĂªnh nháº­n thĂ´ng bĂ¡o Level Up (Quáº£n LĂ½ only)
        if (['setlevelup', 'setlvup', 'setlvl'].includes(commandName)) {
            const setlevelupCommand = require('../../commands/admin/setlevelup');
            return setlevelupCommand.execute(message, args);
        }

        // ?album - Xem album áº£nh cá»§a báº¡n
        if (['album', 'xemanh', 'myalbum', 'anh'].includes(commandName)) {
            // Chá»‰ role LangGia trá»Ÿ lĂªn má»›i Ä‘Æ°á»£c dĂ¹ng
            if (!hasLangGiaRole(message.member)) {
                return message.reply('âŒ Chá»‰ thĂ nh viĂªn **LangGia** má»›i Ä‘Æ°á»£c sá»­ dá»¥ng lá»‡nh nĂ y!');
            }
            const albumCommand = require('../../commands/apps/album');
            return albumCommand.execute(message, args);
        }

        // ?helpphonganh - HÆ°á»›ng dáº«n sá»­ dá»¥ng PhĂ²ng áº¢nh
        if (['helpphonganh', 'helppa', 'hdphonganh', 'albumhelp'].includes(commandName)) {
            const helpphonganhCommand = require('../../commands/quanly/helpphonganh');
            return helpphonganhCommand.execute(message, args);
        }

        // ?clearallalbum, ?xoahetalbum, ?delallalbum - XoĂ¡ Táº¤T Cáº¢ áº£nh trong Album (Owner only)
        if (['clearallalbum', 'xoahetalbum', 'delallalbum', 'clearalbum'].includes(commandName)) {
            const clearallalbumCommand = require('../../commands/admin/clearallalbum');
            return clearallalbumCommand.execute(message, args);
        }


        // ============== LOTO COMMANDS ==============

        // ?loto, ?lt - Random sá»‘ lĂ´ tĂ´
        if (['loto', 'lt'].includes(commandName)) {
            const lotoCommand = require('../../commands/loto/loto');
            return lotoCommand.execute(message, args);
        }

        // ?lotocheck, ?ltc - Check sá»‘ Ä‘Ă£/chÆ°a Ä‘á»c
        if (['lotocheck', 'ltc'].includes(commandName)) {
            const lotocheckCommand = require('../../commands/loto/lotocheck');
            return lotocheckCommand.execute(message, args);
        }

        // ?lotoend, ?lte - Káº¿t thĂºc vĂ¡n
        if (['lotoend', 'lte'].includes(commandName)) {
            const lotoendCommand = require('../../commands/loto/lotoend');
            return lotoendCommand.execute(message, args);
        }

        // ?lotorollback, ?ltrb - Rollback vĂ¡n Ä‘Ă£ end
        if (['lotorollback', 'ltrb'].includes(commandName)) {
            const lotorollbackCommand = require('../../commands/loto/lotorollback');
            return lotorollbackCommand.execute(message, args);
        }

        // ?lotothem, ?ltt - ThĂªm sá»‘ vĂ o sĂ n
        if (['lotothem', 'ltt'].includes(commandName)) {
            const lotothemCommand = require('../../commands/loto/lotothem');
            return lotothemCommand.execute(message, args);
        }

        // ?lotobo, ?ltb - Bá» sá»‘ khá»i sĂ n
        if (['lotobo', 'ltb'].includes(commandName)) {
            const lotoboCommand = require('../../commands/loto/lotobo');
            return lotoboCommand.execute(message, args);
        }

        // ?lotoalbum, ?lta - Xem album lĂ¡ Loto
        if (['lotoalbum', 'lta'].includes(commandName)) {
            const lotoalbumCommand = require('../../commands/loto/lotoalbum');
            return lotoalbumCommand.execute(message, args);
        }

        // ?lotohelp, ?lth - HÆ°á»›ng dáº«n chÆ¡i Loto
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

        // ?rt-, ?rteam- - Random chia 2 team sau khi loáº¡i ngÆ°á»i khá»i voice pool
        if (['rt-', 'rteam-', 'randomteam-'].includes(commandName)) {
            const rteamCommand = require('../../commands/apps/rteam');
            return rteamCommand.executeMinus(message, args);
        }

        // ?rt+, ?rteam+ - Random chia 2 team sau khi thĂªm ngÆ°á»i vĂ o voice pool
        if (['rt+', 'rteam+', 'randomteam+'].includes(commandName)) {
            const rteamCommand = require('../../commands/apps/rteam');
            return rteamCommand.executePlus(message, args);
        }

        // ?rrteam, ?rrt - Random láº¡i káº¿t quáº£ chia Ä‘á»™i trÆ°á»›c Ä‘Ă³
        if (['rrteam', 'rrt'].includes(commandName)) {
            const rteamCommand = require('../../commands/apps/rteam');
            return rteamCommand.reroll(message);
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

        // ?spam - Táº¡o chá»§ Ä‘á» má»›i Ä‘á»ƒ spam lá»‡nh (hoáº·c tag vĂ o chá»§ Ä‘á» cÅ©)
        if (commandName === 'spam') {
            try {
                // XĂ³a tin nháº¯n ?spam cá»§a user
                await message.delete().catch(() => { });

                const { ChannelType } = require('discord.js');
                const threadName = `đŸ”’ ${message.author.username}'s Private Zone`;

                // === Kiá»ƒm tra thread cÅ© cĂ²n tá»“n táº¡i khĂ´ng ===
                let existingThread = null;

                // Fetch active threads
                const activeThreads = await message.channel.threads.fetchActive().catch(() => null);
                if (activeThreads) {
                    existingThread = activeThreads.threads.find(t => t.name === threadName) || null;
                }

                // Náº¿u khĂ´ng tĂ¬m tháº¥y trong active â†’ tĂ¬m trong archived
                if (!existingThread) {
                    const archivedThreads = await message.channel.threads.fetchArchived({ type: 'private', fetchAll: true }).catch(() => null);
                    if (archivedThreads) {
                        existingThread = archivedThreads.threads.find(t => t.name === threadName) || null;
                    }
                }

                // === ÄĂ£ cĂ³ thread cÅ© ===
                if (existingThread) {
                    // Un-archive náº¿u Ä‘ang archived
                    if (existingThread.archived) {
                        await existingThread.setArchived(false).catch(() => { });
                    }

                    // Äáº£m báº£o user váº«n cĂ²n trong thread
                    await existingThread.members.add(message.author.id).catch(() => { });

                    // Tag user vĂ o thread cÅ©
                    await existingThread.send({
                        content: `đŸ‘‹ ${message.author} Chá»§ Ä‘á» riĂªng cá»§a báº¡n nĂ¨~\n` +
                            `đŸ® Thoáº£i mĂ¡i dĂ¹ng lá»‡nh bot á»Ÿ Ä‘Ă¢y nhĂ©!`
                    });

                    return;
                }

                // === ChÆ°a cĂ³ â†’ Táº¡o thread má»›i ===
                const thread = await message.channel.threads.create({
                    name: threadName,
                    autoArchiveDuration: 60,
                    type: ChannelType.PrivateThread,
                    invitable: false,
                    reason: `Private spam thread requested by ${message.author.tag}`
                });

                // ThĂªm user vĂ o thread
                await thread.members.add(message.author.id);

                // Gá»­i tin nháº¯n hÆ°á»›ng dáº«n vĂ o thread
                await thread.send({
                    content: `đŸ”’ **Chá»§ Ä‘á» riĂªng tÆ° cá»§a ${message.author}**\n\n` +
                        `âœ¨ Chá»‰ cĂ³ báº¡n vĂ  bot tháº¥y Ä‘Æ°á»£c chá»§ Ä‘á» nĂ y!\n` +
                        `đŸ® Thoáº£i mĂ¡i sá»­ dá»¥ng cĂ¡c lá»‡nh bot á»Ÿ Ä‘Ă¢y nhĂ©~\n` +
                        `â° Chá»§ Ä‘á» sáº½ tá»± **xĂ³a** sau **1 giá»** khĂ´ng hoáº¡t Ä‘á»™ng.`
                });

                // Set timeout Ä‘á»ƒ xĂ³a thread sau 1 giá» khĂ´ng hoáº¡t Ä‘á»™ng
                setTimeout(async () => {
                    try {
                        const fetchedThread = await message.channel.threads.fetch(thread.id).catch(() => null);
                        if (fetchedThread && fetchedThread.archived) {
                            await fetchedThread.delete('Auto-delete after 1 hour inactivity');
                            console.log(`[spam] Deleted inactive thread: ${thread.name}`);
                        }
                    } catch (e) {
                        // Thread cĂ³ thá»ƒ Ä‘Ă£ bá»‹ xĂ³a
                    }
                }, 60 * 60 * 1000); // 1 giá»

                return;
            } catch (error) {
                console.error('[spam] Error creating thread:', error);
                const errMsg = await message.channel.send('âŒ KhĂ´ng thá»ƒ táº¡o chá»§ Ä‘á» riĂªng tÆ°!');
                setTimeout(() => errMsg.delete().catch(() => { }), 3000);
                return;
            }
        }


        // ?vote, ?poll, ?binhchon - BĂ¬nh chá»n tĂ¹y chá»‰nh
        if (['vote', 'poll', 'binhchon'].includes(commandName)) {
            const voteCommand = require('../../commands/apps/vote');
            return voteCommand.execute(message, args);
        }

        // ?voteevent, ?votesukien - BĂ¬nh chá»n lá»‹ch sá»± kiá»‡n Guild (legacy)
        if (['voteevent', 'votesukien', 'votelich'].includes(commandName)) {
            const voteeventCommand = require('../../commands/apps/voteevent');
            return voteeventCommand.execute(message, args);
        }

        // ?voteyentiec - BĂ¬nh chá»n giá» Yáº¿n Tiá»‡c
        if (commandName === 'voteyentiec') {
            const cmd = require('../../commands/apps/voteyentiec');
            return cmd.execute(message, args);
        }

        // ?votebosssolo, ?voteboss - BĂ¬nh chá»n lá»‹ch Boss Solo
        if (['votebosssolo', 'voteboss'].includes(commandName)) {
            const cmd = require('../../commands/apps/votebosssolo');
            return cmd.execute(message, args);
        }

        // ?votepvpsolo, ?votepvp - BĂ¬nh chá»n lá»‹ch PvP Solo
        if (['votepvpsolo', 'votepvp'].includes(commandName)) {
            const cmd = require('../../commands/apps/votepvpsolo');
            return cmd.execute(message, args);
        }

        // ?votegioevent, ?votegio - BĂ¬nh chá»n GIá»œ sá»± kiá»‡n (legacy)
        if (['votegioevent', 'votegio'].includes(commandName)) {
            const votegioeventCommand = require('../../commands/apps/votegioevent');
            return votegioeventCommand.execute(message, args);
        }

        // ?votengayevent, ?votengay - BĂ¬nh chá»n NGĂ€Y sá»± kiá»‡n (legacy)
        if (['votengayevent', 'votengay'].includes(commandName)) {
            const votengayeventCommand = require('../../commands/apps/votengayevent');
            return votengayeventCommand.execute(message, args);
        }

        // ============== BOSS GUILD COMMANDS ==============

        // ?dsdk, ?dsdangky - Xem danh sĂ¡ch Ä‘Äƒng kĂ½ trÆ°á»›c (+1)
        if (['dsdk', 'dsdangky', 'prereg'].includes(commandName)) {
            const guildId = message.guild.id;
            const preRegs = getPreRegistrations(guildId);

            if (preRegs.length === 0) {
                return message.reply('đŸ“­ ChÆ°a cĂ³ ai Ä‘Äƒng kĂ½ trÆ°á»›c (+1)!');
            }


            const lines = preRegs.map((r, i) => {
                const userData = db.getUserByDiscordId(r.id);
                const gameName = userData?.game_username || null;
                const timeAgo = Math.floor((Date.now() - r.registeredAt) / 60000);
                return `${i + 1}. <@${r.id}>${gameName ? ` (${gameName})` : ''} - ${timeAgo} phĂºt trÆ°á»›c`;
            });

            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle('đŸ“‹ DANH SĂCH ÄÄ‚NG KĂ TRÆ¯á»C (+1)')
                .setDescription(lines.join('\n'))
                .setFooter({ text: `${preRegs.length} ngÆ°á»i â€¢ Danh sĂ¡ch sáº½ Ä‘Æ°á»£c clear khi PT chá»‘t` })
                .setTimestamp();

            return message.reply({ embeds: [embed] });
        }

        // ?bossguild, ?bg, ?dkboss, ?dangkyboss - Báº¯t Ä‘áº§u thĂ´ng bĂ¡o Boss Guild
        if (['bossguild', 'bg', 'dkboss', 'dangkyboss'].includes(commandName)) {
            return bossguildCommand.execute(message, args, client);
        }

        // ?lichboss, ?lichguild - Gá»­i embed lá»‹ch Boss Guild
        if (['lichboss', 'lichguild', 'bosschedule'].includes(commandName)) {
            const lichbossCommand = require('../../commands/thongbao/lichboss');
            return lichbossCommand.execute(message, args, client);
        }

        // ?doilichbossguild, ?doilich - Chá»‰nh sá»­a lá»‹ch Boss Guild
        if (['doilichbossguild', 'doilich', 'editbossschedule'].includes(commandName)) {
            const doilichCommand = require('../../commands/thongbao/doilichbossguild');
            return doilichCommand.execute(message, args, client);
        }

        // ?bgrs, ?bgreset, ?bossguildreset - Reset danh sĂ¡ch Ä‘Äƒng kĂ½ trÆ°á»›c (+1)
        if (['bgrs', 'bgreset', 'bossguildreset'].includes(commandName)) {
            // Chá»‰ Ká»³ Cá»±u Ä‘Æ°á»£c reset
            if (!message.member.roles.cache.some(r => r.name === 'Ká»³ Cá»±u')) {
                return message.reply('âŒ Chá»‰ **Ká»³ Cá»±u** má»›i Ä‘Æ°á»£c reset danh sĂ¡ch!');
            }
            const preRegs = getPreRegistrations(guildId);
            const count = preRegs.length;
            clearPreRegistrations(guildId);
            return message.reply(`âœ… ÄĂ£ reset danh sĂ¡ch Ä‘Äƒng kĂ½ trÆ°á»›c! (${count} ngÆ°á»i Ä‘Ă£ bá»‹ xĂ³a)`);
        }

        // ?lenhbossguild, ?lenhbg, ?lbg - Xem lá»‡nh Boss Guild
        if (['lenhbossguild', 'lenhbg', 'lbg'].includes(commandName)) {
            const { EmbedBuilder } = require('discord.js');
            const prefix = process.env.PREFIX || '?';
            const embed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('đŸ‘‘ Lá»†NH BOSS GUILD')
                .setDescription('Danh sĂ¡ch lá»‡nh liĂªn quan Ä‘áº¿n Boss Guild')
                .addFields(
                    {
                        name: 'đŸ“‹ Quáº£n lĂ½ Party', value:
                            `\`${prefix}bg\` - Táº¡o party Boss Guild\n` +
                            `\`${prefix}lichboss\` - Xem lá»‹ch Boss\n` +
                            `\`${prefix}doilich\` - Äá»•i lá»‹ch Boss`, inline: false
                    },
                    {
                        name: 'đŸ“ ÄÄƒng kĂ½ trÆ°á»›c', value:
                            `\`+1\` - ÄÄƒng kĂ½ trÆ°á»›c (trong kĂªnh)\n` +
                            `\`-1\` - Há»§y Ä‘Äƒng kĂ½ trÆ°á»›c\n` +
                            `\`${prefix}dsdk\` - Xem DS Ä‘Äƒng kĂ½ trÆ°á»›c\n` +
                            `\`${prefix}bgrs\` - Reset DS Ä‘Äƒng kĂ½`, inline: false
                    }
                )
                .setFooter({ text: 'Lang Gia CĂ¡c' })
                .setTimestamp();
            return message.reply({ embeds: [embed] });
        }

        // ============== BANG CHIEN COMMANDS ==============

        // ?bangchien, ?bc, ?dangkybangchien - ÄÄƒng kĂ½ Bang Chiáº¿n
        if (['bangchien', 'bc', 'dangkybangchien'].includes(commandName)) {
            return bangchienCommand.execute(message, args, client);
        }

        // ?xemds - Xem danh sĂ¡ch Ä‘Äƒng kĂ½ Ä‘áº§y Ä‘á»§ (táº¡m thá»i, khĂ´ng bá»‹ cáº¯t)
        if (commandName === 'xemds') {
            const { bangchienRegistrations, getGuildBangchienKeys } = require('../../utils/bangchienState');

            const guildId = message.guild.id;
            const partyKeys = getGuildBangchienKeys(guildId);

            if (partyKeys.length === 0) {
                return message.reply('âŒ KhĂ´ng cĂ³ party bang chiáº¿n nĂ o Ä‘ang cháº¡y!');
            }

            const partyKey = partyKeys[0];
            const registrations = bangchienRegistrations.get(partyKey) || [];

            if (registrations.length === 0) {
                return message.reply('đŸ“­ ChÆ°a cĂ³ ai Ä‘Äƒng kĂ½!');
            }

            // Chia thĂ nh nhiá»u tin nháº¯n náº¿u cáº§n
            const lines = registrations.map((r, i) => {
                const userData = db.getUserByDiscordId(r.id);
                const gameName = userData?.game_username || null;
                return `${i + 1}. <@${r.id}>${gameName ? ` (${gameName})` : ''}${r.isLeader ? ' đŸ‘‘' : ''}`;
            });

            // Gá»­i theo batch 15 ngÆ°á»i má»—i tin
            const batchSize = 15;
            for (let i = 0; i < lines.length; i += batchSize) {
                const batch = lines.slice(i, i + batchSize);
                const header = i === 0 ? `đŸ“‹ **DANH SĂCH ÄÄ‚NG KĂ Äáº¦Y Äá»¦ (${registrations.length} ngÆ°á»i):**\n\n` : '';
                await message.channel.send(header + batch.join('\n'));
            }
            return;
        }

        // ?listbangchien, ?listbc - ÄĂ£ Ä‘Ă³ng, giá»¯ renderer ná»™i bá»™ cho cĂ¡c message cÅ©
        if (['listbangchien', 'listbc'].includes(commandName)) {
            return message.reply({
                content: 'âŒ Lá»‡nh `?listbc` Ä‘Ă£ Ä‘Ă³ng. DĂ¹ng `?bc` Ä‘á»ƒ xem/Ä‘Äƒng kĂ½ hoáº·c `?bcql` Ä‘á»ƒ quáº£n lĂ½ Bang Chiáº¿n.',
                allowedMentions: { repliedUser: false }
            });
        }

        // ?bcend, ?ketthucbc - Káº¿t thĂºc BC (thay tháº¿ bcwin/bcthua)
        if (['bcend', 'ketthucbc', 'endbc'].includes(commandName)) {
            const bcendCommand = require('../../commands/bangchien/bcend');
            return bcendCommand.execute(message, args, client);
        }

        // ?bcql, ?bcquanly - Panel quáº£n lĂ½ Bang Chiáº¿n (chá»‰ Leader)
        if (['bcql', 'bcquanly', 'bangchienquanly'].includes(commandName)) {
            const bcquanlyCommand = require('../../commands/bangchien/bcquanly');
            return bcquanlyCommand.execute(message, args, client);
        }

        // ?resetque, ?rsq - Reset lÆ°á»£t gieo quáº»
        if (['resetque', 'rsq'].includes(commandName)) {
            return resetqueCommand.execute(message, args, client);
        }

        // ?huybangchien, ?huybc - Huá»· phiĂªn Ä‘Äƒng kĂ½ Bang Chiáº¿n
        if (['huybangchien', 'huybc'].includes(commandName)) {
            const huybangchienCommand = require('../../commands/bangchien/huybangchien');
            return huybangchienCommand.execute(message, args, client);
        }

        // ?bcswap, ?bcdoi, ?doiteam - Äá»•i ngÆ°á»i giá»¯a cĂ¡c team
        if (['bcswap', 'bcdoi', 'doiteam'].includes(commandName)) {
            const bcswapCommand = require('../../commands/bangchien/bcswap');
            return bcswapCommand.execute(message, args, client);
        }

        // ?bcchihuy, ?bcch - Äáº·t chá»‰ huy
        if (['bcchihuy', 'bcch', 'setchihuy'].includes(commandName)) {
            const bcchihuyCommand = require('../../commands/bangchien/bcchihuy');
            return bcchihuyCommand.execute(message, args, client);
        }

        // ?bcleader, ?bcld - Äáº·t leader team
        if (['bcleader', 'bcld', 'setleader'].includes(commandName)) {
            const bcleaderCommand = require('../../commands/bangchien/bcleader');
            return bcleaderCommand.execute(message, args, client);
        }

        // ?bcadd - ThĂªm ngÆ°á»i vĂ o danh sĂ¡ch BC
        if (['bcadd', 'bcaddmem', 'thembc'].includes(commandName)) {
            const bcaddCommand = require('../../commands/bangchien/bcadd');
            return bcaddCommand.execute(message, args, client);
        }

        // ?lenhbangchien, ?lenhbc, ?lbc - Xem lá»‡nh bang chiáº¿n
        if (['lenhbangchien', 'lenhbc', 'lbc', 'bchelp', 'helpbc'].includes(commandName)) {
            const lenhbcCommand = require('../../commands/bangchien/lenhbangchien');
            return lenhbcCommand.execute(message, args, client);
        }

        // ?bcsize, ?teamsize, ?bcsoluong - Thay Ä‘á»•i sá»‘ ngÆ°á»i cá»§a cĂ¡c Team BC
        if (['bcsize', 'teamsize', 'bcsoluong'].includes(commandName)) {
            const bcsizeCommand = require('../../commands/bangchien/bcsize');
            return bcsizeCommand.execute(message, args, client);
        }

        // ?setbc, ?setbangchien, ?bcchannel - Set kĂªnh BC máº·c Ä‘á»‹nh
        if (['setbc', 'setbangchien', 'bcchannel'].includes(commandName)) {
            const setbcCommand = require('../../commands/bangchien/setbc');
            return setbcCommand.execute(message, args, client);
        }

        // ?bcrole, ?bctanker, ?bcdps, ?bchealer - Xem thĂ nh viĂªn theo role
        if (['bcrole', 'bctanker', 'bcdps', 'bchealer'].includes(commandName)) {
            const bcroleCommand = require('../../commands/bangchien/bcrole');
            return bcroleCommand.execute(message, args, client);
        }

        // ?chotbc, ?bcchot - ThĂªm role Bang Chiáº¿n cho má»i ngÆ°á»i trong danh sĂ¡ch
        if (['chotbc', 'bcchot', 'chotbangchien', 'addbcrole', 'finalize'].includes(commandName)) {
            const bchotCommand = require('../../commands/bangchien/bcchot');
            return bchotCommand.execute(message, args, client);
        }

        // ?tatmic, ?bcmicoff - Táº¯t mic trong voice BC (giá»¯ mic Leader/Chá»‰ Huy khi all)
        if (['tatmic', 'bcmicoff', 'bcmute', 'bcnomic'].includes(commandName)) {
            const bcmicoffCommand = require('../../commands/bangchien/bcmicoff');
            return bcmicoffCommand.execute(message, args, client);
        }

        // ?momic, ?bcmicon - Báº­t mic trong voice BC
        if (['momic', 'bcmicon', 'bcmic', 'bcspeak'].includes(commandName)) {
            const bcmiconCommand = require('../../commands/bangchien/bcmicon');
            return bcmiconCommand.execute(message, args, client);
        }

        // ?bcmicreset - Reset mic permissions trong voice BC
        if (['bcmicreset', 'resetmic'].includes(commandName)) {
            const bcmicresetCommand = require('../../commands/bangchien/bcmicreset');
            return bcmicresetCommand.execute(message, args, client);
        }

        // ?bcmove, ?bcdoi - Di chuyá»ƒn ngÆ°á»i giá»¯a cĂ¡c team
        if (['bcmove', 'bcdoi', 'dichuyen'].includes(commandName)) {
            const bcmoveCommand = require('../../commands/bangchien/bcmove');
            return bcmoveCommand.execute(message, args, client);
        }

        // ?nhacnho, ?nn, ?remind - ÄÄƒng kĂ½ nháº­n nháº¯c nhá»Ÿ event
        if (['nhacnho', 'nn', 'remind'].includes(commandName)) {
            const nhacnhoCommand = require('../../commands/thongbao/nhacnho');
            return nhacnhoCommand.execute(message, args, client);
        }

        // ?listthongbao, ?lichguild, ?tgb - Xem lá»‹ch sá»± kiá»‡n guild dáº¡ng thá»i gian biá»ƒu
        if (['listthongbao', 'lichguild', 'tgb', 'lichsk'].includes(commandName)) {
            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            const { getWeeklySchedule } = require('../../commands/thongbao/thongbaoguild');

            const guildId = message.guild.id;
            const weeklySchedule = getWeeklySchedule(guildId, true);

            if (!weeklySchedule) {
                return message.reply('đŸ“­ ChÆ°a cĂ³ lá»‹ch sá»± kiá»‡n Guild nĂ o!');
            }

            const embed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle('đŸ“… Lá»CH Sá»° KIá»†N TUáº¦N NĂ€Y')
                .setDescription(weeklySchedule)
                .setTimestamp()
                .setFooter({ text: 'Lang Gia CĂ¡c' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('schedule_english')
                    .setLabel('English')
                    .setEmoji('đŸ‡¬đŸ‡§')
                    .setStyle(ButtonStyle.Secondary)
            );

            return message.reply({ embeds: [embed], components: [row] });
        }

        // Xá»­ lĂ½ pickrole command (alias: pr)
        if (commandName === 'pickrole' || commandName === 'pr') {
            const { dpsSubTypes, findDpsSubType, getAllDpsRoleNames } = require('../../commands/quanly/pickrole');
            const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

            const guild = message.guild;
            const validRoles = ['dps', 'healer', 'tanker'];
            const roleConfig = {
                'dps': { name: 'DPS', color: 0x0099FF, emoji: 'đŸ”µ' },
                'healer': { name: 'Healer', color: 0x00FF00, emoji: 'đŸŸ¢' },
                'tanker': { name: 'Tanker', color: 0xFF9900, emoji: 'đŸŸ ' }
            };

            // Kiá»ƒm tra cĂ³ mention khĂ´ng (pick cho ngÆ°á»i khĂ¡c)
            const mentionedUser = message.mentions.members.first();

            if (mentionedUser) {
                // Pick role cho ngÆ°á»i khĂ¡c - chá»‰ Quáº£n LĂ½ Ä‘Æ°á»£c dĂ¹ng
                const quanLyRole = guild.roles.cache.find(r => r.name === 'Quáº£n LĂ½');
                if (!quanLyRole || !message.member.roles.cache.has(quanLyRole.id)) {
                    return message.reply({
                        content: 'âŒ Chá»‰ **Quáº£n LĂ½** má»›i Ä‘Æ°á»£c pick role cho ngÆ°á»i khĂ¡c!',
                        allowedMentions: { repliedUser: false }
                    });
                }

                // Láº¥y role tá»« arg thá»© 2 vĂ  dpsType tá»« arg thá»© 3 (náº¿u cĂ³)
                const roleArg = args[1]?.toLowerCase();
                const dpsTypeArg = args[2]?.toLowerCase();

                if (!roleArg || !validRoles.includes(roleArg)) {
                    const dpsTypesHelp = Object.values(dpsSubTypes).map(c => `  â€¢ **${c.name}**: \`${c.aliases.join(', ')}\``).join('\n');
                    return message.reply({
                        content: `âŒ CĂº phĂ¡p: \`${prefix}pickrole @user <dps|healer|tanker> [loáº¡i_dps]\`\n\n**VĂ­ dá»¥:**\n\`${prefix}pickrole @Rain healer\`\n\`${prefix}pickrole @Rain dps qd\`\n\n**Loáº¡i DPS:**\n${dpsTypesHelp}`,
                        allowedMentions: { repliedUser: false }
                    });
                }

                let selectedRoleConfig = roleConfig[roleArg];

                // Xá»­ lĂ½ DPS sub-type náº¿u cĂ³ - cáº¥p Cáº¢ DPS + sub-type role
                if (roleArg === 'dps' && dpsTypeArg) {
                    const dpsSubConfig = findDpsSubType(dpsTypeArg);
                    if (!dpsSubConfig) {
                        const dpsTypesHelp = Object.values(dpsSubTypes).map(c => `  â€¢ **${c.name}**: \`${c.aliases.join(', ')}\``).join('\n');
                        return message.reply({
                            content: `âŒ Loáº¡i DPS khĂ´ng há»£p lá»‡!\n\n**CĂ¡c loáº¡i DPS:**\n${dpsTypesHelp}`,
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

                    // Chá»‰ xĂ³a sub-types, khĂ´ng xĂ³a DPS
                    const subTypesToRemove = rolesToRemove.filter(r => r.name !== 'DPS');

                    // TĂ¬m hoáº·c táº¡o role DPS chĂ­nh
                    let dpsRole = guild.roles.cache.find(r => r.name === 'DPS');
                    if (!dpsRole) {
                        dpsRole = await guild.roles.create({
                            name: 'DPS',
                            color: 0x0099FF,
                            reason: 'Táº¡o role DPS cho há»‡ thá»‘ng pickrole'
                        });
                    }

                    // TĂ¬m hoáº·c táº¡o role sub-type
                    let subTypeRole = guild.roles.cache.find(r => r.name === dpsSubConfig.name);
                    if (!subTypeRole) {
                        subTypeRole = await guild.roles.create({
                            name: dpsSubConfig.name,
                            color: dpsSubConfig.color,
                            reason: `Táº¡o role ${dpsSubConfig.name} cho há»‡ thá»‘ng pickrole`
                        });
                    }

                    if (subTypesToRemove.length > 0) {
                        await targetMember.roles.remove(subTypesToRemove);
                    }
                    await targetMember.roles.add([dpsRole, subTypeRole]);

                    const successEmbed = new EmbedBuilder()
                        .setColor(dpsSubConfig.color)
                        .setTitle(`đŸ”µ ÄĂ£ set role thĂ nh cĂ´ng!`)
                        .setDescription(`ÄĂ£ set **DPS** + **${dpsSubConfig.name}** cho ${targetMember}!` +
                            (subTypesToRemove.length > 0 ? `\n\n*ÄĂ£ xĂ³a role cÅ©: ${subTypesToRemove.map(r => r.name).join(', ')}*` : ''))
                        .setTimestamp();

                    return message.reply({ embeds: [successEmbed], allowedMentions: { repliedUser: false } });
                }

                // Xá»­ lĂ½ Healer/Tanker cho ngÆ°á»i khĂ¡c
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
                            reason: `Táº¡o role ${selectedRoleConfig.name} cho há»‡ thá»‘ng pickrole`
                        });
                    }

                    if (rolesToRemove.length > 0) {
                        await targetMember.roles.remove(rolesToRemove);
                    }
                    await targetMember.roles.add(targetRole);

                    const successEmbed = new EmbedBuilder()
                        .setColor(selectedRoleConfig.color)
                        .setTitle(`${selectedRoleConfig.emoji} ÄĂ£ set role thĂ nh cĂ´ng!`)
                        .setDescription(`ÄĂ£ set **${selectedRoleConfig.name}** cho ${targetMember}!` +
                            (rolesToRemove.length > 0 ? `\n\n*ÄĂ£ xĂ³a role cÅ©: ${rolesToRemove.map(r => r.name).join(', ')}*` : ''))
                        .setTimestamp();

                    return message.reply({ embeds: [successEmbed], allowedMentions: { repliedUser: false } });

                } catch (error) {
                    console.error('[pickrole] Lá»—i khi set role cho ngÆ°á»i khĂ¡c:', error);
                    return message.reply('âŒ CĂ³ lá»—i xáº£y ra khi xá»­ lĂ½ role!');
                }
            }

            // Pick role cho chĂ­nh mĂ¬nh
            const roleArg = args[0]?.toLowerCase();
            const dpsTypeArg = args[1]?.toLowerCase();

            // Náº¿u khĂ´ng cĂ³ argument â†’ hiá»ƒn thá»‹ buttons Ä‘á»ƒ chá»n
            if (!roleArg) {
                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('đŸ® Chá»n Role Cá»§a Báº¡n')
                    .setDescription('Chá»n má»™t trong cĂ¡c role dÆ°á»›i Ä‘Ă¢y:\n\n' +
                        'đŸŸ¢ **Healer** - Há»— trá»£ vĂ  há»“i mĂ¡u\n' +
                        'đŸŸ  **Tanker** - Chá»‹u Ä‘Ă²n vĂ  báº£o vá»‡ Ä‘á»“ng Ä‘á»™i\n\n' +
                        '**đŸ”µ DPS - SĂ¡t thÆ°Æ¡ng chĂ­nh:**\n' +
                        'đŸª­ **Quáº¡t DĂ¹** â”‚ đŸ—¡ï¸ **VĂ´ Danh** â”‚ â”ï¸ **Song Äao** â”‚ đŸ”± **Cá»­u Kiáº¿m** â”‚ đŸŒ‚ **DĂ¹ Roi**\n' +
                        'đŸ”ª **HoĂ nh Äao/MÄ‘**\n\n' +
                        'â„¹ï¸ *Chá»n láº¡i role khĂ¡c sáº½ tá»± Ä‘á»™ng thay Ä‘á»•i role hiá»‡n táº¡i*')
                    .setTimestamp()
                    .setFooter({ text: 'Chá»n role trong game cá»§a báº¡n!' });

                // Row 1: DPS sub-types
                const userId = message.author.id;
                const dpsRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`pickrole_dps_quatdu_${userId}`)
                            .setLabel('Quáº¡t DĂ¹')
                            .setEmoji('đŸª­')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`pickrole_dps_vodanh_${userId}`)
                            .setLabel('VĂ´ Danh')
                            .setEmoji('đŸ—¡ï¸')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`pickrole_dps_songdao_${userId}`)
                            .setLabel('Song Äao')
                            .setEmoji('â”ï¸')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`pickrole_dps_cuukiem_${userId}`)
                            .setLabel('Cá»­u Kiáº¿m')
                            .setEmoji('đŸ”±')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`pickrole_dps_duroi_${userId}`)
                            .setLabel('DĂ¹ Roi')
                            .setEmoji('đŸŒ‚')
                            .setStyle(ButtonStyle.Primary)
                    );

                // Row 2: DPS sub-types tiáº¿p (HoĂ nh Äao/MÄ‘)
                const dpsRow2 = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`pickrole_dps_hoanhdao_${userId}`)
                            .setLabel('HoĂ nh Äao/MÄ‘')
                            .setEmoji('đŸ”ª')
                            .setStyle(ButtonStyle.Primary)
                    );

                // Row 3: Healer & Tanker
                const otherRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`pickrole_healer_${userId}`)
                            .setLabel('Healer')
                            .setEmoji('đŸŸ¢')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`pickrole_tanker_${userId}`)
                            .setLabel('Tanker')
                            .setEmoji('đŸŸ ')
                            .setStyle(ButtonStyle.Secondary)
                    );

                return message.reply({ embeds: [embed], components: [dpsRow, dpsRow2, otherRow] });
            }

            // Kiá»ƒm tra náº¿u roleArg lĂ  alias cá»§a DPS sub-type (vĂ­ dá»¥: ?pickrole sd)
            const directDpsSubType = findDpsSubType(roleArg);
            if (directDpsSubType) {
                // Coi nhÆ° user gĂµ: ?pickrole dps <roleArg>
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
                            reason: 'Táº¡o role DPS cho há»‡ thá»‘ng pickrole'
                        });
                    }

                    let subTypeRole = guild.roles.cache.find(r => r.name === dpsSubConfig.name);
                    if (!subTypeRole) {
                        subTypeRole = await guild.roles.create({
                            name: dpsSubConfig.name,
                            color: dpsSubConfig.color,
                            reason: `Táº¡o role ${dpsSubConfig.name} cho há»‡ thá»‘ng pickrole`
                        });
                    }

                    if (member.roles.cache.has(dpsRole.id) && member.roles.cache.has(subTypeRole.id)) {
                        const embed = new EmbedBuilder()
                            .setColor(dpsSubConfig.color)
                            .setTitle(`đŸ”µ Báº¡n Ä‘Ă£ cĂ³ role nĂ y rá»“i!`)
                            .setDescription(`Báº¡n Ä‘Ă£ lĂ  **DPS ${dpsSubConfig.name}** rá»“i!`)
                            .setTimestamp();
                        return message.reply({ embeds: [embed] });
                    }

                    if (subTypesToRemove.length > 0) {
                        await member.roles.remove(subTypesToRemove);
                    }
                    await member.roles.add([dpsRole, subTypeRole]);

                    const successEmbed = new EmbedBuilder()
                        .setColor(dpsSubConfig.color)
                        .setTitle(`đŸ”µ ÄĂ£ chá»n role thĂ nh cĂ´ng!`)
                        .setDescription(`Báº¡n Ä‘Ă£ chá»n role **DPS** + **${dpsSubConfig.name}**!` +
                            (subTypesToRemove.length > 0 ? `\n\n*ÄĂ£ xĂ³a role cÅ©: ${subTypesToRemove.map(r => r.name).join(', ')}*` : ''))
                        .setTimestamp();

                    await message.reply({ embeds: [successEmbed] });

                    // Auto-refresh bangchien + overview + Supabase sync
                    try {
                        const { bangchienNotifications, bangchienRegistrations, getGuildBangchienKeys, getDayFromPartyKey, bangchienOverviews } = require('../../utils/bangchienState');
                        const { createBangchienEmbed, createBangchienButtons, createOverviewEmbed, createOverviewButton } = require('../../commands/bangchien/bangchien');
                        const supaSync = require('../../utils/supabaseSync');
                        const db = require('../../database/db');
                        const guildId = message.guild.id;
                        const odUserId = message.author.id;
                        const partyKeys = getGuildBangchienKeys(guildId);
                        await message.guild.members.fetch(odUserId).catch(() => null);
                        for (const partyKey of partyKeys) {
                            const registrations = bangchienRegistrations.get(partyKey) || [];
                            if (registrations.some(r => r.id === odUserId)) {
                                const notifData = bangchienNotifications.get(partyKey);
                                if (notifData && notifData.message) {
                                    try { await notifData.message.delete(); } catch (e) { }
                                    const channel = await message.guild.channels.fetch(notifData.channelId).catch(() => null);
                                    if (channel) {
                                        const ne = createBangchienEmbed(partyKey, notifData.leaderName, message.guild);
                                        const nr = createBangchienButtons(partyKey);
                                        const nm = await channel.send({ embeds: [ne], components: [nr] });
                                        notifData.message = nm; notifData.messageId = nm.id;
                                    }
                                }
                                if (supaSync.isReady()) {
                                    const day = getDayFromPartyKey(partyKey);
                                    const session = db.getActiveBangchien(partyKey);
                                    if (session) { const f = supaSync.formatActiveSession(session, db, message.guild); if (f) await supaSync.syncBCSession(guildId, day || session.day, f); }
                                }
                            }
                        }
                        const ovd = bangchienOverviews.get(guildId);
                        if (ovd && ovd.message) { try { await ovd.message.edit({ embeds: [createOverviewEmbed(guildId, message.guild)], components: [createOverviewButton(guildId)].filter(Boolean) }); } catch(e){} }
                    } catch (e) {
                        console.error('[pickrole alias] Lá»—i khi refresh bangchien:', e);
                    }
                    return;
                } catch (error) {
                    console.error('Lá»—i khi xá»­ lĂ½ pickrole direct DPS:', error);
                    if (error.code === 50013) {
                        return message.reply('âŒ Bot khĂ´ng cĂ³ quyá»n quáº£n lĂ½ roles! LiĂªn há»‡ admin.');
                    }
                    return message.reply('âŒ CĂ³ lá»—i xáº£y ra khi xá»­ lĂ½ role!');
                }
            }

            // Kiá»ƒm tra role há»£p lá»‡
            if (!validRoles.includes(roleArg)) {
                const dpsTypesHelp = Object.values(dpsSubTypes).map(c => `  â€¢ **${c.name}**: \`${c.aliases.join(', ')}\``).join('\n');
                return message.reply({
                    content: `âŒ Role khĂ´ng há»£p lá»‡! Chá»n: \`dps\`, \`healer\`, hoáº·c \`tanker\`.\n\n**Hoáº·c dĂ¹ng lá»‡nh táº¯t:**\n\`${prefix}pickrole qd\` - DPS Quáº¡t DĂ¹\n\`${prefix}pickrole vd\` - DPS VĂ´ Danh\n\`${prefix}pickrole sd\` - DPS Song Äao\n\`${prefix}pickrole 9k\` - DPS Cá»­u Kiáº¿m\n\`${prefix}pickrole dr\` - DPS DĂ¹ Roi\n\`${prefix}pickrole hd\` - DPS HoĂ nh Äao/MÄ‘`
                });
            }

            // Xá»­ lĂ½ role selection
            const member = message.member;
            let selectedRoleConfig = roleConfig[roleArg];

            // Xá»­ lĂ½ DPS sub-type náº¿u cĂ³ - cáº¥p Cáº¢ DPS + sub-type role
            if (roleArg === 'dps') {
                if (dpsTypeArg) {
                    const dpsSubConfig = findDpsSubType(dpsTypeArg);
                    if (!dpsSubConfig) {
                        const dpsTypesHelp = Object.values(dpsSubTypes).map(c => `  â€¢ **${c.name}**: \`${c.aliases.join(', ')}\``).join('\n');
                        return message.reply({
                            content: `âŒ Loáº¡i DPS khĂ´ng há»£p lá»‡!\n\n**CĂ¡c loáº¡i DPS:**\n${dpsTypesHelp}\n\n**VĂ­ dá»¥:** \`${prefix}pickrole dps qd\``
                        });
                    }

                    // Cáº¥p cáº£ DPS + sub-type role
                    try {
                        const allRoleNames = ['DPS', 'Healer', 'Tanker', ...getAllDpsRoleNames()];
                        const rolesToRemove = [];
                        for (const roleName of allRoleNames) {
                            const role = guild.roles.cache.find(r => r.name === roleName);
                            if (role && member.roles.cache.has(role.id)) {
                                rolesToRemove.push(role);
                            }
                        }

                        // Chá»‰ xĂ³a sub-types, khĂ´ng xĂ³a DPS
                        const subTypesToRemove = rolesToRemove.filter(r => r.name !== 'DPS');

                        // TĂ¬m hoáº·c táº¡o role DPS chĂ­nh
                        let dpsRole = guild.roles.cache.find(r => r.name === 'DPS');
                        if (!dpsRole) {
                            dpsRole = await guild.roles.create({
                                name: 'DPS',
                                color: 0x0099FF,
                                reason: 'Táº¡o role DPS cho há»‡ thá»‘ng pickrole'
                            });
                        }

                        // TĂ¬m hoáº·c táº¡o role sub-type
                        let subTypeRole = guild.roles.cache.find(r => r.name === dpsSubConfig.name);
                        if (!subTypeRole) {
                            subTypeRole = await guild.roles.create({
                                name: dpsSubConfig.name,
                                color: dpsSubConfig.color,
                                reason: `Táº¡o role ${dpsSubConfig.name} cho há»‡ thá»‘ng pickrole`
                            });
                        }

                        // Kiá»ƒm tra Ä‘Ă£ cĂ³ cáº£ 2 chÆ°a
                        if (member.roles.cache.has(dpsRole.id) && member.roles.cache.has(subTypeRole.id)) {
                            const embed = new EmbedBuilder()
                                .setColor(dpsSubConfig.color)
                                .setTitle(`đŸ”µ Báº¡n Ä‘Ă£ cĂ³ role nĂ y rá»“i!`)
                                .setDescription(`Báº¡n Ä‘Ă£ lĂ  **DPS ${dpsSubConfig.name}** rá»“i!`)
                                .setTimestamp();
                            return message.reply({ embeds: [embed] });
                        }

                        if (subTypesToRemove.length > 0) {
                            await member.roles.remove(subTypesToRemove);
                        }
                        await member.roles.add([dpsRole, subTypeRole]);

                        const successEmbed = new EmbedBuilder()
                            .setColor(dpsSubConfig.color)
                            .setTitle(`đŸ”µ ÄĂ£ chá»n role thĂ nh cĂ´ng!`)
                            .setDescription(`Báº¡n Ä‘Ă£ chá»n role **DPS** + **${dpsSubConfig.name}**!` +
                                (subTypesToRemove.length > 0 ? `\n\n*ÄĂ£ xĂ³a role cÅ©: ${subTypesToRemove.map(r => r.name).join(', ')}*` : ''))
                            .setTimestamp();

                        await message.reply({ embeds: [successEmbed] });

                        // Auto-refresh bangchien + overview + Supabase sync
                        try {
                            const { bangchienNotifications, bangchienRegistrations, getGuildBangchienKeys, getDayFromPartyKey, bangchienOverviews } = require('../../utils/bangchienState');
                            const { createBangchienEmbed, createBangchienButtons, createOverviewEmbed, createOverviewButton } = require('../../commands/bangchien/bangchien');
                            const supaSync = require('../../utils/supabaseSync');
                            const db = require('../../database/db');
                            const guildId = message.guild.id;
                            const odUserId = message.author.id;
                            const partyKeys = getGuildBangchienKeys(guildId);
                            await message.guild.members.fetch(odUserId).catch(() => null);
                            for (const partyKey of partyKeys) {
                                const registrations = bangchienRegistrations.get(partyKey) || [];
                                if (registrations.some(r => r.id === odUserId)) {
                                    const notifData = bangchienNotifications.get(partyKey);
                                    if (notifData && notifData.message) {
                                        try { await notifData.message.delete(); } catch (e) { }
                                        const channel = await message.guild.channels.fetch(notifData.channelId).catch(() => null);
                                        if (channel) {
                                            const ne = createBangchienEmbed(partyKey, notifData.leaderName, message.guild);
                                            const nr = createBangchienButtons(partyKey);
                                            const nm = await channel.send({ embeds: [ne], components: [nr] });
                                            notifData.message = nm; notifData.messageId = nm.id;
                                        }
                                    }
                                    if (supaSync.isReady()) {
                                        const day = getDayFromPartyKey(partyKey);
                                        const session = db.getActiveBangchien(partyKey);
                                        if (session) { const f = supaSync.formatActiveSession(session, db, message.guild); if (f) await supaSync.syncBCSession(guildId, day || session.day, f); }
                                    }
                                }
                            }
                            const ovd = bangchienOverviews.get(guildId);
                            if (ovd && ovd.message) { try { await ovd.message.edit({ embeds: [createOverviewEmbed(guildId, message.guild)], components: [createOverviewButton(guildId)].filter(Boolean) }); } catch(e){} }
                        } catch (e) {
                            console.error('[pickrole prefix DPS] Lá»—i khi refresh bangchien:', e);
                        }
                        return;
                    } catch (error) {
                        console.error('Lá»—i khi xá»­ lĂ½ pickrole DPS:', error);
                        if (error.code === 50013) {
                            return message.reply('âŒ Bot khĂ´ng cĂ³ quyá»n quáº£n lĂ½ roles! LiĂªn há»‡ admin.');
                        }
                        return message.reply('âŒ CĂ³ lá»—i xáº£y ra khi xá»­ lĂ½ role!');
                    }
                } else {
                    // DPS khĂ´ng cĂ³ sub-type â†’ hiá»ƒn thá»‹ 4 nĂºt Ä‘á»ƒ chá»n
                    const userId = message.author.id;
                    const dpsEmbed = new EmbedBuilder()
                        .setColor(0x0099FF)
                        .setTitle('đŸ”µ Chá»n Loáº¡i DPS')
                        .setDescription('Chá»n má»™t trong cĂ¡c loáº¡i DPS dÆ°á»›i Ä‘Ă¢y:')
                        .setTimestamp()
                        .setFooter({ text: 'Chá»n role DPS cá»§a báº¡n!' });

                    const dpsRow = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`pickrole_dps_quatdu_${userId}`)
                                .setLabel('Quáº¡t DĂ¹')
                                .setEmoji('đŸª­')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`pickrole_dps_vodanh_${userId}`)
                                .setLabel('VĂ´ Danh')
                                .setEmoji('đŸ—¡ï¸')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`pickrole_dps_songdao_${userId}`)
                                .setLabel('Song Äao')
                                .setEmoji('â”ï¸')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`pickrole_dps_cuukiem_${userId}`)
                                .setLabel('Cá»­u Kiáº¿m')
                                .setEmoji('đŸ”±')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`pickrole_dps_duroi_${userId}`)
                                .setLabel('DĂ¹ Roi')
                                .setEmoji('đŸŒ‚')
                                .setStyle(ButtonStyle.Primary)
                        );

                    return message.reply({ embeds: [dpsEmbed], components: [dpsRow] });
                }
            }

            try {
                const allRoleNames = ['DPS', 'Healer', 'Tanker', ...getAllDpsRoleNames()];

                // TĂ¬m vĂ  xĂ³a roles cÅ©
                const rolesToRemove = [];
                for (const roleName of allRoleNames) {
                    const role = guild.roles.cache.find(r => r.name === roleName);
                    if (role && member.roles.cache.has(role.id)) {
                        rolesToRemove.push(role);
                    }
                }

                // TĂ¬m hoáº·c táº¡o role má»›i
                let targetRole = guild.roles.cache.find(r => r.name === selectedRoleConfig.name);
                if (!targetRole) {
                    targetRole = await guild.roles.create({
                        name: selectedRoleConfig.name,
                        color: selectedRoleConfig.color,
                        reason: `Táº¡o role ${selectedRoleConfig.name} cho há»‡ thá»‘ng pickrole`
                    });
                }

                // Kiá»ƒm tra náº¿u Ä‘Ă£ cĂ³ role
                if (member.roles.cache.has(targetRole.id)) {
                    const embed = new EmbedBuilder()
                        .setColor(selectedRoleConfig.color)
                        .setTitle(`${selectedRoleConfig.emoji} Báº¡n Ä‘Ă£ cĂ³ role nĂ y rá»“i!`)
                        .setDescription(`Báº¡n Ä‘Ă£ lĂ  **${selectedRoleConfig.name}** rá»“i!`)
                        .setTimestamp();

                    return message.reply({ embeds: [embed] });
                }

                // XĂ³a roles cÅ© vĂ  cáº¥p role má»›i
                if (rolesToRemove.length > 0) {
                    await member.roles.remove(rolesToRemove);
                }
                await member.roles.add(targetRole);

                // ThĂ´ng bĂ¡o thĂ nh cĂ´ng
                const successEmbed = new EmbedBuilder()
                    .setColor(selectedRoleConfig.color)
                    .setTitle(`${selectedRoleConfig.emoji} ÄĂ£ chá»n role thĂ nh cĂ´ng!`)
                    .setDescription(`Báº¡n Ä‘Ă£ chá»n role **${selectedRoleConfig.name}**!` +
                        (rolesToRemove.length > 0 ? `\n\n*ÄĂ£ xĂ³a role cÅ©: ${rolesToRemove.map(r => r.name).join(', ')}*` : ''))
                    .setTimestamp();

                await message.reply({ embeds: [successEmbed] });

                // Auto-refresh bangchien + overview + Supabase sync
                try {
                    const { bangchienNotifications, bangchienRegistrations, getGuildBangchienKeys, getDayFromPartyKey, bangchienOverviews } = require('../../utils/bangchienState');
                    const { createBangchienEmbed, createBangchienButtons, createOverviewEmbed, createOverviewButton } = require('../../commands/bangchien/bangchien');
                    const supaSync = require('../../utils/supabaseSync');
                    const db = require('../../database/db');
                    const guildId = message.guild.id;
                    const odUserId = message.author.id;

                    // Force-fetch member má»›i tá»« Discord API
                    await message.guild.members.fetch(odUserId).catch(() => null);

                    // Thá»­ tá»« runtime Map trÆ°á»›c
                    const partyKeys = getGuildBangchienKeys(guildId);
                    let synced = false;

                    for (const partyKey of partyKeys) {
                        const registrations = bangchienRegistrations.get(partyKey) || [];
                        if (registrations.some(r => r.id === odUserId)) {
                            // Refresh embed tá»«ng ngĂ y
                            const notifData = bangchienNotifications.get(partyKey);
                            if (notifData && notifData.message) {
                                try { await notifData.message.delete(); } catch (e) { }
                                const channel = await message.guild.channels.fetch(notifData.channelId).catch(() => null);
                                if (channel) {
                                    const ne = createBangchienEmbed(partyKey, notifData.leaderName, message.guild);
                                    const nr = createBangchienButtons(partyKey);
                                    const nm = await channel.send({ embeds: [ne], components: [nr] });
                                    notifData.message = nm; notifData.messageId = nm.id;
                                }
                            }
                            // Sync Supabase
                            if (supaSync.isReady()) {
                                const day = getDayFromPartyKey(partyKey);
                                const session = db.getActiveBangchien(partyKey);
                                if (session) {
                                    const f = supaSync.formatActiveSession(session, db, message.guild);
                                    if (f) { await supaSync.syncBCSession(guildId, day || session.day, f); synced = true; }
                                }
                            }
                        }
                    }

                    // DB FALLBACK: náº¿u runtime Map rá»—ng (sau bot restart), query DB trá»±c tiáº¿p
                    if (!synced && supaSync.isReady()) {
                        const allSessions = db.getActiveBangchienByGuild(guildId);
                        for (const session of allSessions) {
                            // Kiá»ƒm tra user cĂ³ trong session nĂ y khĂ´ng
                            const allTeams = [...(session.team_attack1||[]), ...(session.team_attack2||[]), ...(session.team_defense||[]), ...(session.team_forest||[])];
                            if (allTeams.some(m => m.id === odUserId)) {
                                const f = supaSync.formatActiveSession(session, db, message.guild);
                                if (f) { await supaSync.syncBCSession(guildId, session.day, f); synced = true; }
                            }
                        }
                        if (synced) console.log(`[pickrole text] âœ… DB fallback: synced Supabase`);
                    }

                    // Refresh overview embed
                    const ovd = bangchienOverviews.get(guildId);
                    if (ovd && ovd.message) {
                        try {
                            await ovd.message.edit({ embeds: [createOverviewEmbed(guildId, message.guild)], components: [createOverviewButton(guildId)].filter(Boolean) });
                        } catch(e) { }
                    }
                } catch (e) {
                    console.error('[pickrole prefix] Lá»—i khi refresh bangchien:', e);
                }

            } catch (error) {
                console.error('Lá»—i khi xá»­ lĂ½ pickrole:', error);

                if (error.code === 50013) {
                    return message.reply('âŒ Bot khĂ´ng cĂ³ quyá»n quáº£n lĂ½ roles! LiĂªn há»‡ admin.');
                }

                return message.reply('âŒ CĂ³ lá»—i xáº£y ra khi xá»­ lĂ½ role!');
            }
        }
    }
};


