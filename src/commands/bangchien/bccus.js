/**
 * ?bccus - Bang Chiến Custom (Tự Do)
 * Tạo session BC bất kỳ lúc nào, hoàn toàn độc lập với BC T7/CN
 * 
 * Cách dùng:
 *   ?bccus       → Tạo session mới hoặc hiển thị session đang mở
 *   ?bccus end   → Kết thúc session
 *   ?bccus huy   → Hủy session
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const {
    bangchienNotifications,
    bangchienRegistrations,
    bangchienChannels,
    bangchienFinalizedParties,
    getGuildBangchienKeys,
    createPartyKey,
    DAY_CONFIG,
    autoCleanupExpiredSessions
} = require('../../utils/bangchienState');

const BC_ROLE_NAME = 'bc';

module.exports = {
    name: 'bccus',
    aliases: ['bangchiencustom'],
    description: 'Bang Chiến Tự Do. Dùng: ?bccus, ?bccus end, ?bccus huy',

    async execute(message, args, client) {
        const guildId = message.guild.id;
        const leaderId = message.author.id;
        const leaderName = message.author.username;
        const db = require('../../database/db');

        // Dọn session hết hạn trước khi xử lý
        await autoCleanupExpiredSessions(client, guildId);

        // ═══════════════════════════════════════════════════════════════════
        // SUBCOMMAND: ?bccus end → Kết thúc session
        // ═══════════════════════════════════════════════════════════════════
        if (args[0]?.toLowerCase() === 'end') {
            return this.handleEnd(message, client);
        }

        // ═══════════════════════════════════════════════════════════════════
        // SUBCOMMAND: ?bccus huy → Hủy session
        // ═══════════════════════════════════════════════════════════════════
        if (args[0]?.toLowerCase() === 'huy' || args[0]?.toLowerCase() === 'huỷ') {
            return this.handleCancel(message, client);
        }

        // ═══════════════════════════════════════════════════════════════════
        // CASE 1: Session custom đang mở → hiển thị lại
        // ═══════════════════════════════════════════════════════════════════
        const existingSession = db.getActiveBangchienByDay(guildId, 'custom');

        if (existingSession) {
            const partyKey = existingSession.party_key;

            // Khôi phục vào memory nếu cần (sau restart)
            if (!bangchienNotifications.has(partyKey)) {
                console.log(`[bccus] Khôi phục session custom từ DB: ${partyKey}`);
                const allParticipants = [
                    ...(existingSession.team_attack1 || []),
                    ...(existingSession.team_attack2 || []),
                    ...(existingSession.team_defense || []),
                    ...(existingSession.team_forest || []),
                    ...(existingSession.waiting_list || [])
                ];
                bangchienRegistrations.set(partyKey, allParticipants);

                // Fetch members vào cache
                try {
                    const memberIds = allParticipants.map(p => p.id);
                    if (memberIds.length > 0) await message.guild.members.fetch({ user: memberIds, force: true });
                } catch (e) { }
            }

            // Gửi lại embed
            const { createBangchienEmbed } = require('./bangchien');
            const embed = createBangchienEmbed(partyKey, existingSession.leader_name, message.guild);

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`bccus_join_${partyKey}`)
                        .setLabel('✅ Tham gia')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`bccus_leave_${partyKey}`)
                        .setLabel('❌ Hủy đăng ký')
                        .setStyle(ButtonStyle.Secondary)
                );

            // Xóa embed cũ nếu có
            const notifData = bangchienNotifications.get(partyKey);
            if (notifData?.message) {
                try { await notifData.message.delete(); } catch (e) { }
            }

            // Xóa lệnh + gửi embed mới
            try { await message.delete(); } catch (e) { }
            const newMsg = await message.channel.send({ embeds: [embed], components: [row] });

            // Cập nhật reference
            bangchienNotifications.set(partyKey, {
                ...(notifData || {}),
                channelId: message.channel.id,
                messageId: newMsg.id,
                message: newMsg,
                leaderId: existingSession.leader_id,
                leaderName: existingSession.leader_name,
                day: 'custom'
            });

            console.log(`[bccus] ${leaderName} hiển thị lại session custom tại ${message.guild.name}`);
            return;
        }

        // ═══════════════════════════════════════════════════════════════════
        // CASE 2: Tạo session mới (Kỳ Cựu/Quản Lý/Whitelist)
        // ═══════════════════════════════════════════════════════════════════

        // Kiểm tra quyền
        const kyCuuRole = message.guild.roles.cache.find(r => r.name === 'Kỳ Cựu');
        const quanLyRole = message.guild.roles.cache.find(r => r.name === 'Quản Lý');
        const OWNER_ID = '395151484179841024';

        const isKyCuu = kyCuuRole && message.member.roles.cache.has(kyCuuRole.id);
        const isQuanLy = quanLyRole && message.member.roles.cache.has(quanLyRole.id);
        const isOwner = message.author.id === OWNER_ID;

        // Kiểm tra whitelist từ bccusperm
        const bccuspermCommand = require('./bccusperm');
        const isWhitelisted = bccuspermCommand.isWhitelisted(db, leaderId);

        if (!isKyCuu && !isQuanLy && !isOwner && !isWhitelisted) {
            return message.reply({
                content: '❌ Bạn không có quyền mở BC Tự Do!\nLiên hệ **Quản Lý** để được thêm vào danh sách.',
                allowedMentions: { repliedUser: false }
            });
        }

        // Xác nhận tạo
        const confirmEmbed = new EmbedBuilder()
            .setColor(DAY_CONFIG.custom.color)
            .setTitle('🎯 XÁC NHẬN TẠO BC TỰ DO')
            .setDescription(
                `**${leaderName}** muốn mở đăng ký **BC Tự Do**.\n\n` +
                `📋 Session sẽ tự hết hạn sau **24 giờ**.\n` +
                `⏰ Bạn có 30 giây để xác nhận.`
            )
            .setFooter({ text: 'Nhấn Xác Nhận để tiếp tục' });

        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`bccus_confirm_${leaderId}`)
                    .setLabel('✅ Xác Nhận')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`bccus_cancel_${leaderId}`)
                    .setLabel('❌ Hủy')
                    .setStyle(ButtonStyle.Danger)
            );

        const confirmMsg = await message.reply({ embeds: [confirmEmbed], components: [confirmRow] });

        // Chờ xác nhận
        try {
            const filter = i => i.user.id === leaderId &&
                (i.customId === `bccus_confirm_${leaderId}` || i.customId === `bccus_cancel_${leaderId}`);
            const confirmation = await confirmMsg.awaitMessageComponent({ filter, time: 30000 });

            if (confirmation.customId === `bccus_cancel_${leaderId}`) {
                await confirmMsg.delete().catch(() => { });
                return message.reply({ content: '❌ Đã hủy tạo BC Tự Do.', allowedMentions: { repliedUser: false } });
            }

            await confirmMsg.delete().catch(() => { });
        } catch (e) {
            await confirmMsg.delete().catch(() => { });
            return message.reply({ content: '⏰ Hết thời gian xác nhận.', allowedMentions: { repliedUser: false } });
        }

        // Tạo party key
        const partyKey = createPartyKey(guildId, 'custom', leaderId);

        // Khởi tạo trong memory
        bangchienRegistrations.set(partyKey, [{
            id: leaderId,
            username: leaderName,
            joinedAt: Date.now(),
            isLeader: true
        }]);

        // Lưu vào DB
        db.createActiveBangchien({
            guildId,
            partyKey,
            leaderId,
            leaderName,
            channelId: message.channel.id,
            messageId: null,
            day: 'custom'
        });

        // Cấp role BC cho leader
        try {
            let bcRole = message.guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
            if (!bcRole) {
                bcRole = await message.guild.roles.create({ name: BC_ROLE_NAME, color: 0xE74C3C, reason: 'BC role' });
            }
            if (bcRole && !message.member.roles.cache.has(bcRole.id)) {
                await message.member.roles.add(bcRole);
            }
        } catch (e) {
            console.error('[bccus] Lỗi cấp role BC cho leader:', e.message);
        }

        // Xóa tin nhắn lệnh
        try { await message.delete(); } catch (e) { }

        // Gửi embed + buttons
        const { createBangchienEmbed } = require('./bangchien');
        const embed = createBangchienEmbed(partyKey, leaderName, message.guild);

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`bccus_join_${partyKey}`)
                    .setLabel('✅ Tham gia')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`bccus_leave_${partyKey}`)
                    .setLabel('❌ Hủy đăng ký')
                    .setStyle(ButtonStyle.Secondary)
            );

        const embedMsg = await message.channel.send({ embeds: [embed], components: [row] });

        // Lưu vào memory
        bangchienNotifications.set(partyKey, {
            intervalId: null,
            channelId: message.channel.id,
            leaderId,
            leaderName,
            messageId: embedMsg.id,
            message: embedMsg,
            startTime: Date.now(),
            day: 'custom'
        });

        bangchienChannels.set(guildId, message.channel.id);

        console.log(`[bccus] ${leaderName} tạo BC Tự Do tại ${message.guild.name}`);
    },

    /**
     * ?bccus end → Kết thúc session custom
     */
    async handleEnd(message, client) {
        const db = require('../../database/db');
        const guildId = message.guild.id;

        // Kiểm tra quyền
        const OWNER_ID = '395151484179841024';
        const quanLyRole = message.guild.roles.cache.find(r => r.name === 'Quản Lý');
        const isQuanLy = quanLyRole && message.member.roles.cache.has(quanLyRole.id);

        const session = db.getActiveBangchienByDay(guildId, 'custom');
        if (!session) {
            return message.reply('📭 Không có phiên BC Tự Do đang chạy!');
        }

        const isLeader = session.leader_id === message.author.id;
        if (!isLeader && !isQuanLy && message.author.id !== OWNER_ID) {
            return message.reply('❌ Chỉ Leader hoặc Quản Lý mới được kết thúc BC Tự Do!');
        }

        // Xác nhận
        const confirmEmbed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('⚠️ XÁC NHẬN KẾT THÚC BC TỰ DO')
            .setDescription('Bạn có chắc muốn kết thúc phiên BC Tự Do?\n\n⏰ Tự động hủy sau 30 giây.');

        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`bccus_end_confirm_${message.author.id}`)
                    .setLabel('✅ Xác Nhận')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`bccus_end_cancel_${message.author.id}`)
                    .setLabel('❌ Hủy')
                    .setStyle(ButtonStyle.Secondary)
            );

        const confirmMsg = await message.reply({ embeds: [confirmEmbed], components: [confirmRow] });

        try {
            const filter = i => i.user.id === message.author.id &&
                (i.customId === `bccus_end_confirm_${message.author.id}` || i.customId === `bccus_end_cancel_${message.author.id}`);
            const confirmation = await confirmMsg.awaitMessageComponent({ filter, time: 30000 });

            if (confirmation.customId === `bccus_end_cancel_${message.author.id}`) {
                await confirmMsg.delete().catch(() => { });
                return message.reply({ content: '❌ Đã hủy.', allowedMentions: { repliedUser: false } });
            }
            await confirmMsg.delete().catch(() => { });
        } catch (e) {
            await confirmMsg.delete().catch(() => { });
            return message.reply({ content: '⏰ Hết thời gian xác nhận.', allowedMentions: { repliedUser: false } });
        }

        const partyKey = session.party_key;

        // Lấy participants để xóa role
        const participants = [
            ...(session.team_attack1 || []),
            ...(session.team_attack2 || []),
            ...(session.team_defense || []),
            ...(session.team_forest || [])
        ];

        // Xóa role BC
        const bcRole = message.guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
        let removedCount = 0;

        if (bcRole && participants.length > 0) {
            const processingMsg = await message.reply('⏳ Đang xóa role BC...');
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

        // Xóa memory data
        const notifData = bangchienNotifications.get(partyKey);
        if (notifData) {
            if (notifData.intervalId) clearInterval(notifData.intervalId);
            try { if (notifData.message) await notifData.message.delete(); } catch (e) { }
        }
        bangchienNotifications.delete(partyKey);
        bangchienRegistrations.delete(partyKey);

        // Xóa finalized parties liên quan
        for (const [msgId, data] of bangchienFinalizedParties.entries()) {
            if (data.guildId === guildId && data.leaderId === session.leader_id) {
                bangchienFinalizedParties.delete(msgId);
            }
        }

        // Chỉ xóa channel mapping nếu không còn session nào khác
        const remainingKeys = getGuildBangchienKeys(guildId);
        if (remainingKeys.filter(k => k !== partyKey).length === 0) {
            bangchienChannels.delete(guildId);
        }

        // Xóa session từ DB
        db.deleteActiveBangchien(partyKey);

        // Thông báo
        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('✅ BC TỰ DO ĐÃ KẾT THÚC!')
            .setDescription(`🎯 BC Tự Do của **${session.leader_name}** đã kết thúc.`)
            .addFields(
                { name: '👥 Số người đã đi', value: `${participants.length} người`, inline: true },
                { name: '🔴 Đã xóa role', value: `${removedCount} người`, inline: true }
            )
            .setTimestamp();

        await message.reply({ embeds: [embed] });
        console.log(`[bccus] ${message.author.username} kết thúc BC Tự Do (${removedCount} role removed)`);
    },

    /**
     * ?bccus huy → Hủy session custom
     */
    async handleCancel(message, client) {
        const db = require('../../database/db');
        const guildId = message.guild.id;

        const session = db.getActiveBangchienByDay(guildId, 'custom');
        if (!session) {
            return message.reply('📭 Không có phiên BC Tự Do đang chạy để hủy!');
        }

        // Kiểm tra quyền
        const hasManagePermission = message.member.permissions.has('ManageGuild');
        const isLeader = session.leader_id === message.author.id;
        if (!isLeader && !hasManagePermission) {
            return message.reply('❌ Chỉ Leader hoặc người có quyền quản lý mới được hủy!');
        }

        const partyKey = session.party_key;
        const registrationCount = (session.team_attack1?.length || 0) +
            (session.team_attack2?.length || 0) +
            (session.team_defense?.length || 0) +
            (session.team_forest?.length || 0) +
            (session.waiting_list?.length || 0);

        // Xóa memory data
        const notifData = bangchienNotifications.get(partyKey);
        if (notifData) {
            if (notifData.intervalId) clearInterval(notifData.intervalId);
            try { if (notifData.message) await notifData.message.delete(); } catch (e) { }
        }
        bangchienNotifications.delete(partyKey);
        bangchienRegistrations.delete(partyKey);

        // Xóa session từ DB
        db.deleteActiveBangchien(partyKey);

        // Xóa channel mapping nếu không còn session
        const remainingSessions = db.getActiveBangchienByGuild(guildId);
        if (remainingSessions.length === 0) {
            bangchienChannels.delete(guildId);
        }

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('✅ Đã hủy BC Tự Do')
            .setDescription(`🎯 **BC Tự Do**: Đã hủy (${registrationCount} người đã đăng ký)`)
            .setFooter({ text: 'Dùng ?bccus để tạo phiên mới' })
            .setTimestamp();

        await message.channel.send({ embeds: [embed] });
        try { await message.delete(); } catch (e) { }

        console.log(`[bccus] ${message.author.username} hủy BC Tự Do (${registrationCount} người)`);
    }
};
