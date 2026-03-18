const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { bossNotifications, bossRegistrations, MAX_PARTIES_PER_GUILD, getGuildPartyKeys, getUserRegisteredParty, bossChannels, bossSchedule, getPreRegistrations, clearPreRegistrations, bossRefreshTimers, BOSS_REFRESH_DEBOUNCE, bossAutoCloseTimers, BOSS_AUTO_CLOSE_DURATION, finalizedParties } = require('../../utils/bossState');

// Hàm tính thời gian đến buổi boss tiếp theo
function getNextBossSession() {
    const now = new Date();
    const vnOffset = 7 * 60;
    const localOffset = now.getTimezoneOffset();
    const vnNow = new Date(now.getTime() + (localOffset + vnOffset) * 60 * 1000);

    let closest = null;
    let closestDiff = Infinity;

    for (const schedule of bossSchedule) {
        let daysUntil = schedule.dayOfWeek - vnNow.getDay();
        if (daysUntil < 0) daysUntil += 7;

        const nextDate = new Date(vnNow);
        nextDate.setDate(vnNow.getDate() + daysUntil);
        nextDate.setHours(schedule.hour, schedule.minute, 0, 0);

        if (daysUntil === 0 && nextDate <= vnNow) {
            nextDate.setDate(nextDate.getDate() + 7);
        }

        const diff = nextDate.getTime() - vnNow.getTime();
        if (diff < closestDiff) {
            closestDiff = diff;
            closest = {
                date: nextDate,
                schedule: schedule,
                diff: diff
            };
        }
    }

    return closest;
}

// Hàm format countdown
function formatCountdown(ms) {
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));

    if (days > 0) {
        return `${days} ngày ${hours} giờ ${minutes} phút`;
    } else if (hours > 0) {
        return `${hours} giờ ${minutes} phút`;
    }
    return `${minutes} phút`;
}

// Tạo chuỗi lịch từ bossSchedule (CN ở cuối)
function getScheduleText() {
    return bossSchedule
        .sort((a, b) => {
            // CN (0) xuống cuối, còn lại sort theo thứ tự bình thường
            const orderA = a.dayOfWeek === 0 ? 7 : a.dayOfWeek;
            const orderB = b.dayOfWeek === 0 ? 7 : b.dayOfWeek;
            return orderA - orderB;
        })
        .map(s => `• ${s.name.padEnd(10)} ${s.hour}:${s.minute.toString().padStart(2, '0')}`)
        .join('\n');
}

// Tạo embed thông báo boss (có danh sách đăng ký, chia team 10 người)
function createBossEmbed(partyKey, leaderName) {
    const nextSession = getNextBossSession();
    const registrations = bossRegistrations.get(partyKey) || [];
    const db = require('../../database/db');

    // Format danh sách với tên in-game, chia team
    let registrationList = '_Chưa có ai đăng ký_';
    if (registrations.length > 0) {
        const TEAM_SIZE = 10;
        const teams = [];

        // Chia thành các team
        for (let i = 0; i < registrations.length; i += TEAM_SIZE) {
            const teamMembers = registrations.slice(i, i + TEAM_SIZE);
            const teamNumber = Math.floor(i / TEAM_SIZE) + 1;
            teams.push({ number: teamNumber, members: teamMembers, startIndex: i });
        }

        // Format từng team
        registrationList = teams.map(team => {
            const teamHeader = teams.length > 1 ? `**Team ${team.number}:**\n` : '';
            const memberList = team.members.map((r, idx) => {
                const globalIdx = team.startIndex + idx + 1;
                const userData = db.getUserByDiscordId(r.id);
                const gameName = userData?.game_username || null;
                const nameDisplay = gameName ? `<@${r.id}> (${gameName})` : `<@${r.id}>`;
                return `${globalIdx}. ${nameDisplay}${r.isLeader ? ' 👑' : ''}`;
            }).join('\n');
            return teamHeader + memberList;
        }).join('\n\n');
    }

    // Tính số team
    const teamCount = Math.ceil(registrations.length / 10);
    const teamInfo = teamCount > 1 ? ` (${teamCount} team)` : '';

    const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('👑 LỊCH ĐI BOSS GUILD')
        .setDescription('Đăng ký tham gia đi boss guild cùng bang hội!')
        .addFields(
            {
                name: '📅 Lịch Boss Guild',
                value: '```\n' + getScheduleText() + '\n```\n_*Thời gian có thể sớm hoặc trễ hơn_',
                inline: false
            },
            {
                name: '⏰ Buổi tiếp theo',
                value: `**${nextSession.schedule.name}** - còn **${formatCountdown(nextSession.diff)}**`,
                inline: true
            },
            {
                name: `👥 Đã đăng ký (${registrations.length} người)${teamInfo}`,
                value: registrationList,
                inline: true
            }
        )
        .setFooter({ text: `Leader: ${leaderName} • Tự đóng sau 1 tiếng • Chat +1 hoặc xin slot để tham gia` })
        .setTimestamp();

    return embed;
}

// Tạo embed chỉ có lịch (sau khi chốt)
function createScheduleOnlyEmbed() {
    const nextSession = getNextBossSession();

    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('👑 LỊCH ĐI BOSS GUILD')
        .setDescription('**Lang Gia**\nXem lịch đi boss guild của bang hội')
        .addFields(
            {
                name: '📅 Lịch Boss Guild',
                value: '```\n' + getScheduleText() + '\n```\n_*Thời gian có thể sớm hoặc trễ hơn_',
                inline: false
            },
            {
                name: '⏰ Buổi tiếp theo',
                value: `**${nextSession.schedule.name}** - còn **${formatCountdown(nextSession.diff)}**`,
                inline: false
            }
        )
        .setFooter({ text: '💡 Chat "+1" hoặc "xin slot" để đăng ký • Kỳ Cựu sẽ tag bạn khi tạo party' })
        .setTimestamp();

    return embed;
}

// Tạo buttons (không có nút Dừng)
function createButtons(partyKey) {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`boss_join_${partyKey}`)
                .setLabel('✅ Tham gia')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`boss_leave_${partyKey}`)
                .setLabel('❌ Hủy đăng ký')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`boss_finalize_${partyKey}`)
                .setLabel('🏁 Chốt DS')
                .setStyle(ButtonStyle.Primary)
        );

    return row;
}

module.exports = {
    name: 'bossguild',
    aliases: ['dkboss', 'dangkyboss'],
    description: 'Tạo party đăng ký Boss Guild (Kỳ Cựu)',

    async execute(message, args, client) {
        // Kiểm tra quyền - chỉ Kỳ Cựu được sử dụng
        if (!message.member.roles.cache.some(r => r.name === 'Kỳ Cựu')) {
            return message.reply('❌ Bạn cần role **Kỳ Cựu** để sử dụng lệnh này!');
        }

        const guildId = message.guild.id;
        const leaderId = message.author.id;
        const leaderName = message.author.username;
        const partyKey = `${guildId}_${leaderId}`;

        // Kiểm tra user đã có party đang chạy chưa
        if (bossNotifications.has(partyKey)) {
            return message.reply('⚠️ Bạn đã có party đang chạy! Chốt danh sách party cũ trước.');
        }

        // Kiểm tra số party hiện tại của guild
        const currentParties = getGuildPartyKeys(guildId);
        if (currentParties.length >= MAX_PARTIES_PER_GUILD) {
            return message.reply(`⚠️ Đã có ${MAX_PARTIES_PER_GUILD} party đang chạy! Đợi 1 party chốt xong.`);
        }

        // Kiểm tra user đã đăng ký party khác chưa
        const existingParty = getUserRegisteredParty(guildId, leaderId);
        if (existingParty) {
            return message.reply('⚠️ Bạn đã đăng ký party khác! Hủy đăng ký trước.');
        }

        // Khởi tạo danh sách đăng ký với Leader là người đầu tiên
        bossRegistrations.set(partyKey, [{
            id: leaderId,
            username: leaderName,
            joinedAt: Date.now(),
            isLeader: true
        }]);

        // Gửi embed đầu tiên
        const embed = createBossEmbed(partyKey, leaderName);
        const row = createButtons(partyKey);
        const sentMessage = await message.channel.send({ embeds: [embed], components: [row] });

        // Tag những người đã đăng ký trước (+1)
        const preRegs = getPreRegistrations(guildId);
        if (preRegs.length > 0) {
            const db = require('../../database/db');
            const mentionList = preRegs.map(r => {
                const userData = db.getUserByDiscordId(r.id);
                const gameName = userData?.game_username || null;
                return gameName ? `<@${r.id}> (${gameName})` : `<@${r.id}>`;
            });

            await message.channel.send({
                content: `📢 **Tag người đã đăng ký trước (${preRegs.length}):**\n${mentionList.join('\n')}\n\n_Bấm nút ✅ Tham gia bên trên để tham gia party!_`
            });

            console.log(`[bossguild] Tagged ${preRegs.length} pre-registered users`);
        }

        // Xóa tin nhắn lệnh
        try { await message.delete(); } catch (e) { }

        // Lưu thông tin party (không còn interval 15 phút)
        bossNotifications.set(partyKey, {
            channelId: message.channel.id,
            leaderId,
            leaderName,
            messageId: sentMessage.id,
            message: sentMessage,
            startTime: Date.now()
        });

        // Đăng ký kênh này để theo dõi hoạt động
        bossChannels.set(guildId, message.channel.id);
        const db = require('../../database/db');
        db.setBossChannelId(guildId, message.channel.id);

        console.log(`[bossguild] ${leaderName} tạo party tại ${message.guild.name} (${currentParties.length + 1}/${MAX_PARTIES_PER_GUILD})`);

        // ═══ Auto-close sau 1 tiếng ═══
        const autoCloseTimeout = setTimeout(async () => {
            try {
                const notifData = bossNotifications.get(partyKey);
                if (!notifData) {
                    bossAutoCloseTimers.delete(partyKey);
                    return; // Đã chốt thủ công rồi
                }

                const registrations = bossRegistrations.get(partyKey) || [];
                const channel = await client.channels.fetch(notifData.channelId);

                if (registrations.length > 0) {
                    // Gửi embed chốt danh sách
                    const db = require('../../database/db');
                    const participantList = registrations.map((r, i) => {
                        const userData = db.getUserByDiscordId(r.id);
                        const gameName = userData?.game_username || null;
                        const nameDisplay = gameName ? `<@${r.id}> (${gameName})` : `<@${r.id}>`;
                        return `${i + 1}. ${nameDisplay}${r.isLeader ? ' 👑' : ''}`;
                    }).join('\n');

                    const finalEmbed = new EmbedBuilder()
                        .setColor(0xFFA500)
                        .setTitle('⏰ TỰ ĐỘNG CHỐT DANH SÁCH ĐI BOSS!')
                        .setDescription(`**Party đã hết thời gian (1 tiếng)**\n\n**Danh sách tham gia (${registrations.length} người):**\n` + participantList)
                        .setFooter({ text: '💡 Leader reply tin này để tag • ?lichboss để xem lịch' })
                        .setTimestamp();

                    const finalMessage = await channel.send({ embeds: [finalEmbed] });

                    // Lưu danh sách để reply tag sau
                    finalizedParties.set(finalMessage.id, {
                        leaderId: notifData.leaderId,
                        participants: registrations.map(r => ({ id: r.id, username: r.username })),
                        guildId: partyKey.split('_')[0],
                        channelId: notifData.channelId,
                        createdAt: Date.now()
                    });
                } else {
                    await channel.send('⏰ Party boss guild đã hết thời gian (1 tiếng) mà không có ai đăng ký.');
                }

                // Xóa embed đăng ký cũ
                try {
                    if (notifData.message) await notifData.message.delete();
                } catch (e) { }

                // Gửi embed lịch mới
                const scheduleEmbed = createScheduleOnlyEmbed();
                await channel.send({ embeds: [scheduleEmbed] });

                // Dọn dữ liệu party
                bossNotifications.delete(partyKey);
                bossRegistrations.delete(partyKey);
                clearPreRegistrations(partyKey.split('_')[0]);

                // Clear refresh timer nếu có
                if (bossRefreshTimers.has(partyKey)) {
                    clearTimeout(bossRefreshTimers.get(partyKey));
                    bossRefreshTimers.delete(partyKey);
                }

                console.log(`[bossguild] Auto-closed party of ${leaderName} sau 1 tiếng`);
            } catch (error) {
                console.error('[bossguild] Lỗi auto-close:', error);
            } finally {
                bossAutoCloseTimers.delete(partyKey);
            }
        }, BOSS_AUTO_CLOSE_DURATION);

        bossAutoCloseTimers.set(partyKey, autoCloseTimeout);
    },

    // Export functions
    createBossEmbed,
    createScheduleOnlyEmbed,
    createButtons,
    getNextBossSession,
    formatCountdown,

    // Hàm refresh embed khi có tin nhắn mới trong channel (debounced 5 phút)
    async refreshBossEmbed(client, channelId) {
        // Tìm party trong channel này
        let targetPartyKey = null;
        let targetNotifData = null;

        for (const [partyKey, notifData] of bossNotifications) {
            if (notifData.channelId === channelId) {
                targetPartyKey = partyKey;
                targetNotifData = notifData;
                break;
            }
        }

        if (!targetPartyKey || !targetNotifData) return;

        // Clear timer cũ nếu có
        if (bossRefreshTimers.has(targetPartyKey)) {
            clearTimeout(bossRefreshTimers.get(targetPartyKey));
        }

        // Set timer mới (debounce 5 phút)
        const timeoutId = setTimeout(async () => {
            try {
                const notifData = bossNotifications.get(targetPartyKey);
                if (!notifData) {
                    bossRefreshTimers.delete(targetPartyKey);
                    return;
                }

                // Xóa tin nhắn cũ
                try {
                    if (notifData.message) await notifData.message.delete();
                } catch (e) { }

                // Gửi tin nhắn mới
                const channel = await client.channels.fetch(notifData.channelId);
                const newEmbed = createBossEmbed(targetPartyKey, notifData.leaderName);
                const newRow = createButtons(targetPartyKey);
                const newMessage = await channel.send({ embeds: [newEmbed], components: [newRow] });

                // Cập nhật reference
                notifData.messageId = newMessage.id;
                notifData.message = newMessage;

                console.log(`[bossguild] Refreshed embed for ${notifData.leaderName}`);
            } catch (error) {
                console.error('[bossguild] Lỗi khi refresh:', error);
            } finally {
                bossRefreshTimers.delete(targetPartyKey);
            }
        }, BOSS_REFRESH_DEBOUNCE);

        bossRefreshTimers.set(targetPartyKey, timeoutId);
    }
};
