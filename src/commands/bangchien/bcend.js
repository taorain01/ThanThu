/**
 * ?bcend - Kết thúc Bang Chiến (MULTI-DAY)
 * - Xóa role BC
 * - Tự động lưu Team Thủ/Rừng vào preset cho lần sau
 * - Xóa dữ liệu session
 * Dùng: ?bcend, ?bcend t7, ?bcend cn
 */

const { EmbedBuilder } = require('discord.js');
const { DAY_CONFIG, parseDayArg } = require('../../utils/bangchienState');

const BC_ROLE_NAME = 'bc';

module.exports = {
    name: 'bcend',
    aliases: ['ketthucbc', 'endbc'],
    description: 'Kết thúc BC. Dùng: ?bcend t7 hoặc ?bcend cn',

    async execute(message, args, client) {
        const db = require('../../database/db');
        const {
            bangchienNotifications,
            bangchienRegistrations,
            bangchienFinalizedParties,
            bangchienChannels,
            getGuildBangchienKeys
        } = require('../../utils/bangchienState');

        const guildId = message.guild.id;

        // Kiểm tra quyền (Quản Lý hoặc owner)
        const OWNER_ID = '395151484179841024';
        const quanLyRole = message.guild.roles.cache.find(r => r.name === 'Quản Lý');
        const isQuanLy = quanLyRole && message.member.roles.cache.has(quanLyRole.id);

        if (message.author.id !== OWNER_ID && !isQuanLy) {
            return message.reply('❌ Chỉ Quản Lý mới được kết thúc BC!');
        }

        // Parse day từ args (MULTI-DAY)
        const day = parseDayArg(args);

        // ═══════════════════════════════════════════════════════════════════
        // OWNER CÓ THỂ END TẤT CẢ BC CÙNG LÚC
        // ═══════════════════════════════════════════════════════════════════
        const isOwner = message.author.id === OWNER_ID;
        const activeSessions = db.getActiveBangchienByGuild(guildId);

        // Nếu là OWNER và không chỉ định ngày → end TẤT CẢ sessions
        if (isOwner && !day && activeSessions.length > 0) {
            // ===== BƯỚC XÁC NHẬN =====
            const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            const confirmEmbed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('⚠️ XÁC NHẬN KẾT THÚC TẤT CẢ BC')
                .setDescription(`Bạn có chắc muốn kết thúc **${activeSessions.length}** phiên BC?\n\n⏰ Tự động hủy sau 30 giây.`);

            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`bcend_confirm_all_${message.author.id}`)
                        .setLabel('✅ Xác Nhận')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(`bcend_cancel_all_${message.author.id}`)
                        .setLabel('❌ Hủy')
                        .setStyle(ButtonStyle.Secondary)
                );

            const confirmMsg = await message.reply({ embeds: [confirmEmbed], components: [confirmRow] });

            try {
                const filter = i => i.user.id === message.author.id &&
                    (i.customId === `bcend_confirm_all_${message.author.id}` || i.customId === `bcend_cancel_all_${message.author.id}`);
                const confirmation = await confirmMsg.awaitMessageComponent({ filter, time: 30000 });

                if (confirmation.customId === `bcend_cancel_all_${message.author.id}`) {
                    await confirmMsg.delete().catch(() => { });
                    return message.reply({ content: '❌ Đã hủy.', allowedMentions: { repliedUser: false } });
                }

                await confirmMsg.delete().catch(() => { });
            } catch (e) {
                await confirmMsg.delete().catch(() => { });
                return message.reply({ content: '⏰ Hết thời gian xác nhận.', allowedMentions: { repliedUser: false } });
            }
            // ===== KẾT THÚC BƯỚC XÁC NHẬN =====

            const processingMsg = await message.reply(`⏳ Đang kết thúc **${activeSessions.length}** phiên BC...`);

            let totalRolesRemoved = 0;
            let sessionsEnded = [];

            for (const session of activeSessions) {
                const sessionDay = session.day || null;

                // Lấy participants
                const participants = [
                    ...(session.team_attack1 || []),
                    ...(session.team_attack2 || []),
                    ...(session.team_defense || []),
                    ...(session.team_forest || [])
                ];

                // Auto-save Team Thủ/Rừng vào preset
                const teamDefense = session.team_defense || [];
                const teamForest = session.team_forest || [];

                if (teamDefense.length > 0) {
                    const currentPresetThu = db.getBcPreset(guildId, 'thu', sessionDay || 'sat');
                    const newPresetThu = [...currentPresetThu];
                    for (const p of teamDefense) {
                        if (!newPresetThu.some(m => m.id === p.id)) {
                            newPresetThu.push({ id: p.id, username: p.username });
                        }
                    }
                    db.setBcPreset(guildId, 'thu', newPresetThu, sessionDay || 'sat');
                }

                if (teamForest.length > 0) {
                    const currentPresetRung = db.getBcPreset(guildId, 'rung', sessionDay || 'sat');
                    const newPresetRung = [...currentPresetRung];
                    for (const p of teamForest) {
                        if (!newPresetRung.some(m => m.id === p.id)) {
                            newPresetRung.push({ id: p.id, username: p.username });
                        }
                    }
                    db.setBcPreset(guildId, 'rung', newPresetRung, sessionDay || 'sat');
                }

                // Xóa role BC
                const bcRole = message.guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
                if (bcRole && participants.length > 0) {
                    for (const p of participants) {
                        try {
                            const member = await message.guild.members.fetch({ user: p.id, force: true }).catch(() => null);
                            if (member && member.roles.cache.has(bcRole.id)) {
                                await member.roles.remove(bcRole);
                                totalRolesRemoved++;
                            }
                        } catch (e) { }
                    }
                }

                // Xóa memory data
                const partyKey = session.party_key;
                const notifData = bangchienNotifications.get(partyKey);
                if (notifData) {
                    if (notifData.intervalId) clearInterval(notifData.intervalId);
                    try { if (notifData.message) await notifData.message.delete(); } catch (e) { }
                }
                bangchienNotifications.delete(partyKey);
                bangchienRegistrations.delete(partyKey);

                // Xóa từ DB
                db.deleteActiveBangchien(partyKey);

                sessionsEnded.push(DAY_CONFIG[sessionDay]?.name || 'Unknown');
                console.log(`[bcend] Owner đã xóa session: ${partyKey}`);
            }

            // Xóa channels và overview
            bangchienChannels.delete(guildId);

            // Xóa finalized parties
            for (const [msgId, data] of bangchienFinalizedParties.entries()) {
                if (data.guildId === guildId) {
                    bangchienFinalizedParties.delete(msgId);
                }
            }

            await processingMsg.delete().catch(() => { });

            // Gửi thông báo
            const embed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('✅ ĐÃ KẾT THÚC TẤT CẢ BANG CHIẾN!')
                .setDescription(`⚔️ **${message.author.username}** đã kết thúc tất cả BC.`)
                .addFields(
                    { name: '📋 Sessions đã end', value: sessionsEnded.join(', ') || 'N/A', inline: true },
                    { name: '🔴 Đã xóa role', value: `${totalRolesRemoved} người`, inline: true }
                )
                .setTimestamp();

            await message.reply({ embeds: [embed] });

            // Cập nhật lịch tuần
            try {
                const { refreshScheduleEmbed } = require('../thongbao/thongbaoguild');
                await refreshScheduleEmbed(client, guildId, message.channel.id, 'edit');
                console.log(`[bcend] Owner đã cập nhật lịch tuần sau khi end ALL BC`);
            } catch (e) {
                console.log('[bcend] Không thể cập nhật lịch tuần:', e.message);
            }

            console.log(`[bcend] OWNER ${message.author.username} kết thúc TẤT CẢ BC (${sessionsEnded.length} sessions, ${totalRolesRemoved} roles removed)`);
            return;
        }

        // ═══════════════════════════════════════════════════════════════════
        // LOGIC CŨ: End 1 session cụ thể
        // ═══════════════════════════════════════════════════════════════════

        // Lấy session từ DB
        let session = null;
        let isActive = false;

        if (day) {
            session = db.getActiveBangchienByDay(guildId, day);
            if (!session) {
                return message.reply(`❌ Không có phiên BC ${DAY_CONFIG[day].name} đang chạy!`);
            }
            isActive = true;
        } else {
            // Không chỉ định ngày → lấy session đầu tiên
            const history = db.getBangchienHistory(guildId, 1);

            if (activeSessions.length > 0) {
                session = activeSessions[0];
                isActive = true;
            } else if (history.length > 0) {
                session = history[0];
            }
        }

        if (!session) {
            return message.reply('📭 Không có bang chiến nào để kết thúc!');
        }

        const sessionDay = session.day || null;
        const dayName = sessionDay ? DAY_CONFIG[sessionDay]?.name : 'BC';

        // ===== BƯỚC XÁC NHẬN CHO 1 SESSION =====
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const confirmEmbed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle(`⚠️ XÁC NHẬN KẾT THÚC ${dayName.toUpperCase()}`)
            .setDescription(`Bạn có chắc muốn kết thúc BC **${dayName}**?\n\n⏰ Tự động hủy sau 30 giây.`);

        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`bcend_confirm_${message.author.id}`)
                    .setLabel('✅ Xác Nhận')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`bcend_cancel_${message.author.id}`)
                    .setLabel('❌ Hủy')
                    .setStyle(ButtonStyle.Secondary)
            );

        const confirmMsg = await message.reply({ embeds: [confirmEmbed], components: [confirmRow] });

        try {
            const filter = i => i.user.id === message.author.id &&
                (i.customId === `bcend_confirm_${message.author.id}` || i.customId === `bcend_cancel_${message.author.id}`);
            const confirmation = await confirmMsg.awaitMessageComponent({ filter, time: 30000 });

            if (confirmation.customId === `bcend_cancel_${message.author.id}`) {
                await confirmMsg.delete().catch(() => { });
                return message.reply({ content: '❌ Đã hủy.', allowedMentions: { repliedUser: false } });
            }

            await confirmMsg.delete().catch(() => { });
        } catch (e) {
            await confirmMsg.delete().catch(() => { });
            return message.reply({ content: '⏰ Hết thời gian xác nhận.', allowedMentions: { repliedUser: false } });
        }
        // ===== KẾT THÚC BƯỚC XÁC NHẬN =====

        // ====== AUTO-SAVE TEAM THỦ/RỪNG TO PRESET ======
        let teamDefense = [];
        let teamForest = [];

        if (isActive) {
            teamDefense = session.team_defense || [];
            teamForest = session.team_forest || [];
        } else {
            teamDefense = typeof session.team_defense === 'string' ? JSON.parse(session.team_defense || '[]') : session.team_defense || [];
            teamForest = typeof session.team_forest === 'string' ? JSON.parse(session.team_forest || '[]') : session.team_forest || [];
        }

        let presetSaved = { thu: 0, rung: 0 };

        // Lưu Team Thủ vào preset (theo ngày)
        if (teamDefense.length > 0) {
            const currentPresetThu = db.getBcPreset(guildId, 'thu', sessionDay || 'sat');
            const newPresetThu = [...currentPresetThu];
            for (const p of teamDefense) {
                if (!newPresetThu.some(m => m.id === p.id)) {
                    newPresetThu.push({ id: p.id, username: p.username });
                }
            }
            db.setBcPreset(guildId, 'thu', newPresetThu, sessionDay || 'sat');
            presetSaved.thu = teamDefense.length;
        }

        // Lưu Team Rừng vào preset (theo ngày)
        if (teamForest.length > 0) {
            const currentPresetRung = db.getBcPreset(guildId, 'rung', sessionDay || 'sat');
            const newPresetRung = [...currentPresetRung];
            for (const p of teamForest) {
                if (!newPresetRung.some(m => m.id === p.id)) {
                    newPresetRung.push({ id: p.id, username: p.username });
                }
            }
            db.setBcPreset(guildId, 'rung', newPresetRung, sessionDay || 'sat');
            presetSaved.rung = teamForest.length;
        }

        // Lấy danh sách người tham gia để xóa role
        let participants = [];
        if (isActive) {
            participants = [
                ...(session.team_attack1 || []),
                ...(session.team_attack2 || []),
                ...(session.team_defense || []),
                ...(session.team_forest || [])
            ];
        } else if (session.team_defense && session.team_offense) {
            participants = [...session.team_defense, ...session.team_offense];
        } else if (session.participants) {
            participants = session.participants.slice(0, session.participant_count);
        }

        // Xóa role Bang Chiến 30vs30
        const bcRole = message.guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
        let removedCount = 0;

        if (bcRole && participants.length > 0) {
            const processingMsg = await message.reply('⏳ Đang xóa role BC và lưu preset...');

            for (const p of participants) {
                try {
                    const member = await message.guild.members.fetch({ user: p.id, force: true }).catch(() => null);
                    if (member && member.roles.cache.has(bcRole.id)) {
                        await member.roles.remove(bcRole);
                        removedCount++;
                    }
                } catch (e) { }
            }

            await processingMsg.delete().catch(() => { });
        }

        // Xóa dữ liệu memory - CHỈ xóa session cụ thể, không xóa hết
        const targetPartyKey = session.party_key;
        if (targetPartyKey) {
            const notifData = bangchienNotifications.get(targetPartyKey);
            if (notifData) {
                if (notifData.intervalId) clearInterval(notifData.intervalId);
                try {
                    if (notifData.message) await notifData.message.delete();
                } catch (e) { }
            }
            bangchienNotifications.delete(targetPartyKey);
            bangchienRegistrations.delete(targetPartyKey);
        }

        // Chỉ xóa bangchienChannels nếu không còn session nào khác
        const remainingKeys = getGuildBangchienKeys(guildId);
        if (remainingKeys.length === 0) {
            bangchienChannels.delete(guildId);
        }

        // Xóa từ bangchienFinalizedParties
        for (const [msgId, data] of bangchienFinalizedParties.entries()) {
            if (data.leaderId === session.leader_id && data.guildId === guildId) {
                bangchienFinalizedParties.delete(msgId);
            }
        }

        // Xóa session từ DB - CHỈ xóa session cụ thể
        if (targetPartyKey) {
            db.deleteActiveBangchien(targetPartyKey);
            console.log(`[bcend] Đã xóa session: ${targetPartyKey}`);
        }
        if (session && session.id && !isActive) {
            db.deleteBangchienSession(session.id);
        }

        // Gửi thông báo kết thúc
        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('✅ BANG CHIẾN ĐÃ KẾT THÚC!')
            .setDescription(`⚔️ Bang Chiến của **${session.leader_name}** đã kết thúc.`)
            .addFields(
                { name: '👥 Số người đã đi', value: `${participants.length} người`, inline: true },
                { name: '🔴 Đã xóa role', value: `${removedCount} người`, inline: true }
            )
            .setTimestamp();

        await message.reply({ embeds: [embed] });

        // Cập nhật lịch tuần (xóa BC khỏi lịch)
        try {
            const { refreshScheduleEmbed } = require('../thongbao/thongbaoguild');
            await refreshScheduleEmbed(client, guildId, message.channel.id, 'edit');
            console.log(`[bcend] Đã cập nhật lịch tuần sau khi end BC`);
        } catch (e) {
            console.log('[bcend] Không thể cập nhật lịch tuần:', e.message);
        }

        console.log(`[bcend] ${message.author.username} kết thúc BC (${removedCount} role removed, preset: thu=${presetSaved.thu} rung=${presetSaved.rung})`);
    }
};
