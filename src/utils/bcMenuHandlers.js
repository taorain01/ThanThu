/**
 * bcMenuHandlers.js
 * Xử lý ephemeral menu cho Bang Chiến multi-day
 * Khi user bấm nút "📌 Đăng ký BANG CHIẾN" -> hiển thị menu riêng cho họ
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { DAY_CONFIG, getDayFromPartyKey, getDayNameWithDate, getNextDayDate } = require('./bangchienState');
const { syncBCSession, formatActiveSession, syncBcRegular, removeBcRegular } = require('./supabaseSync');

const BC_ROLE_NAME = 'bc';

/**
 * Sắp xếp danh sách ngày theo ngày gần nhất (ngày sắp đến trước)
 * Dùng getNextDayDate để tính khoảng cách thực tế từ hôm nay
 * @param {string[]} days - Mảng các key ngày ('mon', 'tue', ...)
 * @returns {string[]} Mảng đã được sắp xếp theo ngày gần nhất
 */
function sortDaysByNearest(days) {
    return [...days].sort((a, b) => {
        const dateA = getNextDayDate(a);
        const dateB = getNextDayDate(b);
        return dateA.getTime() - dateB.getTime();
    });
}

// Helper: Sync session lên Supabase sau khi SQLite thay đổi
async function syncSessionToSupabase(guildId, partyKey, guild = null) {
    try {
        const supaSync = require('./supabaseSync');
        if (!supaSync.isReady()) return;
        const db = require('../database/db');
        const session = db.getActiveBangchien(partyKey);
        if (!session) return;
        const formatted = supaSync.formatActiveSession(session, db, guild);
        if (formatted) {
            await supaSync.syncBCSession(guildId, session.day || 'sat', formatted);
            console.log(`[bcMenu] ✅ Đã sync session ${session.day} lên Supabase`);
        }
    } catch (e) {
        console.error('[bcMenu] Lỗi sync Supabase:', e.message);
    }
}

/**
 * Helper: Parse day từ customId dynamic
 * VD: "bcmenu_join_mon_123456" → "mon"
 *     "bcmenu_leave_sat_123456" → "sat"
 */
function parseDayFromCustomId(customId) {
    const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    for (const d of dayKeys) {
        if (customId.includes(`_${d}_`)) return d;
    }
    return null;
}

/**
 * Tạo menu đăng ký BC (ephemeral) - DYNAMIC tất cả ngày
 */
function createBcMenu(guildId, userId) {
    const db = require('../database/db');
    const { PRIMARY_DAYS } = require('./bangchienState');

    const dayShortLabels = {
        'mon': 'T2', 'tue': 'T3', 'wed': 'T4', 'thu': 'T5',
        'fri': 'T6', 'sat': 'T7', 'sun': 'CN'
    };

    // Lấy TẤT CẢ sessions active
    const allSessions = db.getActiveBangchienByGuild(guildId);
    const sessionMap = {};
    allSessions.forEach(s => { if (s.day) sessionMap[s.day] = s; });

    const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('📌 ĐĂNG KÝ BANG CHIẾN')
        .setDescription('Chọn ngày bạn muốn tham gia. Bấm **Luôn tham gia** để tự động đăng ký mỗi tuần.');

    // Sắp xếp theo ngày gần nhất (ngày sắp đến trước)
    const daysToShow = sortDaysByNearest([...new Set([...PRIMARY_DAYS, ...Object.keys(sessionMap)])]);

    const actionRows = [];

    for (const day of daysToShow) {
        const session = sessionMap[day];
        const dateStr = getDayNameWithDate(day);
        const isInDay = session ? isUserInSession(session, userId) : false;
        const isPrimaryDay = DAY_CONFIG[day]?.primary === true;
        const isRegularDay = isPrimaryDay ? db.isBcRegular(guildId, userId, day) : false;
        const shortLabel = dayShortLabels[day] || day.toUpperCase();

        let status = '';
        if (!session) {
            status = `📅 **${dateStr}** - _Chưa mở_`;
        } else {
            const total = getSessionTotal(session);
            status = `📅 **${dateStr}** (${total}/30)\n`;
            status += isInDay ? '✅ Bạn đã đăng ký' : '🔘 Bạn chưa đăng ký';
            if (isRegularDay) status += ' 📌';
        }
        embed.addFields({ name: '\u200b', value: status, inline: false });

        // Buttons cho ngày này (nếu có session, max 4 rows)
        if (session && actionRows.length < 4) {
            const row = new ActionRowBuilder();
            if (isInDay) {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`bcmenu_leave_${day}_${guildId}`)
                        .setLabel(`❌ Hủy ${shortLabel}`)
                        .setStyle(ButtonStyle.Secondary)
                );
            } else {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`bcmenu_join_${day}_${guildId}`)
                        .setLabel(`✅ Tham gia ${shortLabel}`)
                        .setStyle(ButtonStyle.Success)
                );
            }
            if (isPrimaryDay) {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`bcmenu_regular_${day}_${guildId}`)
                        .setLabel(isRegularDay ? `📌 Bỏ luôn ${shortLabel}` : `📌 Luôn ${shortLabel}`)
                        .setStyle(isRegularDay ? ButtonStyle.Secondary : ButtonStyle.Primary)
                );
            }
            actionRows.push(row);
        }
    }

    embed.setFooter({ text: '📌 = Luôn tham gia | Menu này chỉ bạn thấy' });

    const closeRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`bcmenu_close_${guildId}`)
                .setLabel('🔴 Đóng')
                .setStyle(ButtonStyle.Danger)
        );

    const components = [...actionRows, closeRow];
    return { embed, components };
}

/**
 * Kiểm tra user có trong session không
 */
function isUserInSession(session, userId) {
    const allMembers = [
        ...(session.team_attack1 || []),
        ...(session.team_attack2 || []),
        ...(session.team_defense || []),
        ...(session.team_forest || []),
        ...(session.waiting_list || [])
    ];
    return allMembers.some(m => m.id === userId);
}

/**
 * Tính tổng số người trong session
 */
function getSessionTotal(session) {
    return (session.team_attack1?.length || 0) +
        (session.team_attack2?.length || 0) +
        (session.team_defense?.length || 0) +
        (session.team_forest?.length || 0);
}

/**
 * Xử lý button từ ephemeral menu
 * @param {ButtonInteraction} interaction
 * @returns {boolean} - true nếu đã xử lý
 */
async function handleBcMenuButton(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('bcmenu_') && !customId.startsWith('bc_menu_') && !customId.startsWith('bc_regular_') && !customId.startsWith('bc_viewdetail_') && !customId.startsWith('bc_viewlist_')) return false;

    // DEFER NGAY LẬP TỨC
    try {
        if (customId.startsWith('bc_menu_')) {
            await interaction.deferReply({ ephemeral: true });
        } else if (customId.startsWith('bc_viewdetail_')) {
            const isEphemeralMsg = interaction.message?.flags?.has(64);
            if (isEphemeralMsg) {
                await interaction.deferUpdate();
            } else {
                await interaction.deferReply({ ephemeral: true });
            }
        } else if (customId.startsWith('bc_regular_')) {
            await interaction.deferReply({ ephemeral: true });
        } else {
            await interaction.deferUpdate();
        }
    } catch (e) {
        console.error(`[bcMenu] Defer failed cho ${customId}:`, e.message);
        return true;
    }

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const db = require('../database/db');
    const { bangchienRegistrations, bangchienOverviews } = require('./bangchienState');

    // Helper: Refresh overview embed
    const refreshOverview = async () => {
        const overviewData = bangchienOverviews.get(guildId);
        if (!overviewData || !overviewData.message) return;

        try {
            const { createOverviewEmbed, createOverviewButton } = require('../commands/bangchien/bangchien');
            const newEmbed = createOverviewEmbed(guildId, interaction.guild);
            const newRow = createOverviewButton(guildId);
            const editOptions = { embeds: [newEmbed] };
            if (newRow) editOptions.components = [newRow];
            else editOptions.components = [];
            await overviewData.message.edit(editOptions);
        } catch (e) {
            console.error('[bcMenu] Error refreshing overview:', e.message);
        }
    };

    // bc_regular_{day}_{guildId} từ overview (toggle quick)
    if (customId.startsWith('bc_regular_')) {
        const day = parseDayFromCustomId(customId);
        if (!day || !DAY_CONFIG[day]) return true;
        if (DAY_CONFIG[day]?.primary !== true) {
            await interaction.editReply({ content: '⚠️ "Luôn tham gia" chỉ áp dụng cho Thứ 7 và Chủ Nhật.' });
            return true;
        }
        const isRegular = db.isBcRegular(guildId, userId, day);

        if (isRegular) {
            db.removeBcRegular(guildId, userId, day);
            await removeBcRegular(guildId, userId, day); // Sync Supabase
            await interaction.editReply({
                content: `✅ Đã tắt "Luôn tham gia" ${DAY_CONFIG[day].name}.`
            });
        } else {
            db.addBcRegular(guildId, userId, username, day);
            await syncBcRegular(guildId, userId, username, day); // Sync Supabase

            let autoJoinMsg = '';
            const session = db.getActiveBangchienByDay(guildId, day);
            if (session && !isUserInSession(session, userId)) {
                const result = db.addBangchienParticipant(session.party_key, {
                    id: userId,
                    username: username,
                    joinedAt: Date.now(),
                    isLeader: false,
                    isRegular: true
                });
                if (result.success) {
                    const regs = bangchienRegistrations.get(session.party_key) || [];
                    regs.push({ id: userId, username, joinedAt: Date.now(), isLeader: false, isRegular: true });
                    bangchienRegistrations.set(session.party_key, regs);
                    autoJoinMsg = ` Đã tự động đăng ký ${DAY_CONFIG[day].name}!`;
                    await syncSessionToSupabase(guildId, session.party_key, interaction.guild);
                    try {
                        let bcRole = interaction.guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
                        if (!bcRole) bcRole = await interaction.guild.roles.create({ name: BC_ROLE_NAME, color: 0xE74C3C, reason: 'BC role' });
                        const member = await interaction.guild.members.fetch(userId).catch(() => null);
                        if (bcRole && member && !member.roles.cache.has(bcRole.id)) await member.roles.add(bcRole);
                    } catch (e) { console.error('[bcMenu] Lỗi cấp role BC (regular):', e.message); }
                }
            }

            await interaction.editReply({
                content: `✅ Đã bật "Luôn tham gia" ${DAY_CONFIG[day].name}.${autoJoinMsg}`
            });
        }

        await refreshOverview();
        return true;
    }

    // bc_viewdetail_{guildId} → Hiện menu chọn ngày để xem danh sách
    if (customId.startsWith('bc_viewdetail_')) {
        const allSessions = db.getActiveBangchienByGuild(guildId);
        const sessionMap = {};
        allSessions.forEach(s => { if (s.day) sessionMap[s.day] = s; });

        const dayShortLabels = { 'mon': 'T2', 'tue': 'T3', 'wed': 'T4', 'thu': 'T5', 'fri': 'T6', 'sat': 'T7', 'sun': 'CN' };
        // Sắp xếp theo ngày gần nhất (ngày sắp đến trước)
        const activeDays = sortDaysByNearest(Object.keys(sessionMap));

        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('📋 XEM DANH SÁCH BANG CHIẾN')
            .setDescription('Chọn ngày để xem danh sách chi tiết:');

        for (const day of activeDays) {
            const total = getSessionTotal(sessionMap[day]);
            embed.addFields({
                name: `📅 ${getDayNameWithDate(day)}`,
                value: `👥 ${total}/30 người`,
                inline: true
            });
        }

        if (activeDays.length === 0) {
            embed.setDescription('Chưa có phiên Bang Chiến nào đang mở.');
        }

        embed.setFooter({ text: 'Menu này chỉ bạn thấy' });

        const row = new ActionRowBuilder();
        for (const day of activeDays) {
            if (row.components.length >= 4) break;
            const total = getSessionTotal(sessionMap[day]);
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`bc_viewlist_${day}_${guildId}`)
                    .setLabel(`📋 Xem ${dayShortLabels[day] || day} (${total})`)
                    .setStyle(ButtonStyle.Primary)
            );
        }
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`bcmenu_close_${guildId}`)
                .setLabel('🔴 Đóng')
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
        return true;
    }

    // bc_viewlist_{day}_{guildId} → Hiện danh sách chi tiết
    if (customId.startsWith('bc_viewlist_')) {
        const day = parseDayFromCustomId(customId);
        if (!day) { await interaction.editReply({ content: '❌ Ngày không hợp lệ.', embeds: [], components: [] }); return true; }

        const session = db.getActiveBangchienByDay(guildId, day);
        if (!session) {
            await interaction.editReply({ content: `❌ Chưa có phiên BC ${DAY_CONFIG[day]?.name || day}.`, embeds: [], components: [] });
            return true;
        }

        const { createBangchienEmbed } = require('../commands/bangchien/bangchien');
        const embed = createBangchienEmbed(session.party_key, session.leader_name, interaction.guild);
        embed.setFooter({ text: 'Menu này chỉ bạn thấy | Hôm nay lúc ' + new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) });

        const shortLabel = { mon: 'T2', tue: 'T3', wed: 'T4', thu: 'T5', fri: 'T6', sat: 'T7', sun: 'CN' }[day] || day.toUpperCase();
        const isInDay = isUserInSession(session, userId);
        const isRegularDay = db.isBcRegular(guildId, userId, day);

        // Row 1: nút đăng ký/hủy + luôn tham gia
        const actionRow = new ActionRowBuilder();
        if (isInDay) {
            actionRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`bcmenu_leave_${day}_${guildId}`)
                    .setLabel(`❌ Hủy đăng ký ${shortLabel}`)
                    .setStyle(ButtonStyle.Secondary)
            );
        } else {
            actionRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`bcmenu_join_${day}_${guildId}`)
                    .setLabel(`✅ Đăng ký ${shortLabel}`)
                    .setStyle(ButtonStyle.Success)
            );
        }
        if (DAY_CONFIG[day]?.primary === true) {
            actionRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`bcmenu_regular_${day}_${guildId}`)
                    .setLabel(isRegularDay ? `📌 Bỏ luôn ${shortLabel}` : `📌 Luôn ${shortLabel}`)
                    .setStyle(isRegularDay ? ButtonStyle.Secondary : ButtonStyle.Primary)
            );
        }

        // Row 2: điều hướng
        const backRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`bc_viewdetail_${guildId}`)
                    .setLabel('⬅️ Quay lại')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`bcmenu_close_${guildId}`)
                    .setLabel('🔴 Đóng')
                    .setStyle(ButtonStyle.Danger)
            );

        await interaction.editReply({ embeds: [embed], components: [actionRow, backRow] });
        return true;
    }


    // bc_menu_{guildId} → Mở menu
    if (customId.startsWith('bc_menu_')) {
        const { embed, components } = createBcMenu(guildId, userId);
        await interaction.editReply({ embeds: [embed], components });
        return true;
    }

    // bcmenu_close
    if (customId.startsWith('bcmenu_close_')) {
        await interaction.editReply({ content: '✅ Đã đóng menu.', embeds: [], components: [] });
        return true;
    }

    // bcmenu_join_{day}_{guildId} - DYNAMIC
    if (customId.startsWith('bcmenu_join_')) {
        const day = parseDayFromCustomId(customId);
        if (!day || !DAY_CONFIG[day]) { await interaction.editReply({ content: '❌ Ngày không hợp lệ.', embeds: [], components: [] }); return true; }

        const session = db.getActiveBangchienByDay(guildId, day);
        if (!session) {
            await interaction.editReply({ content: `❌ Chưa có phiên BC ${DAY_CONFIG[day].name}.`, embeds: [], components: [] });
            return true;
        }

        if (isUserInSession(session, userId)) {
            const { embed, components } = createBcMenu(guildId, userId);
            await interaction.editReply({ content: `⚠️ Bạn đã đăng ký ${DAY_CONFIG[day].name} rồi!`, embeds: [embed], components });
            return true;
        }

        const result = db.addBangchienParticipant(session.party_key, {
            id: userId,
            username: username,
            joinedAt: Date.now(),
            isLeader: false
        });

        if (result.success) {
            const regs = bangchienRegistrations.get(session.party_key) || [];
            regs.push({ id: userId, username, joinedAt: Date.now(), isLeader: false });
            bangchienRegistrations.set(session.party_key, regs);

            try {
                let bcRole = interaction.guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
                if (!bcRole) bcRole = await interaction.guild.roles.create({ name: BC_ROLE_NAME, color: 0xE74C3C, reason: 'BC role' });
                if (bcRole && !interaction.member.roles.cache.has(bcRole.id)) await interaction.member.roles.add(bcRole);
            } catch (e) { console.error('[bcMenu] Lỗi cấp role BC:', e.message); }

            const { embed, components } = createBcMenu(guildId, userId);
            await interaction.editReply({
                content: `✅ Đã đăng ký ${DAY_CONFIG[day].name}! (${result.team})`,
                embeds: [embed],
                components
            });
            await refreshOverview();
            await syncSessionToSupabase(guildId, session.party_key, interaction.guild);
        } else {
            await interaction.editReply({ content: `❌ Lỗi: ${result.error}`, embeds: [], components: [] });
        }
        return true;
    }

    // bcmenu_leave_{day}_{guildId} - DYNAMIC
    if (customId.startsWith('bcmenu_leave_')) {
        const day = parseDayFromCustomId(customId);
        if (!day || !DAY_CONFIG[day]) { await interaction.editReply({ content: '❌ Ngày không hợp lệ.', embeds: [], components: [] }); return true; }

        const session = db.getActiveBangchienByDay(guildId, day);
        if (!session) {
            await interaction.editReply({ content: `❌ Chưa có phiên BC ${DAY_CONFIG[day].name}.`, embeds: [], components: [] });
            return true;
        }

        const result = db.removeBangchienParticipant(session.party_key, userId);

        if (result.success) {
            const regs = bangchienRegistrations.get(session.party_key) || [];
            const updated = regs.filter(r => r.id !== userId);
            bangchienRegistrations.set(session.party_key, updated);

            try {
                const bcRole = interaction.guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
                if (bcRole && interaction.member.roles.cache.has(bcRole.id)) await interaction.member.roles.remove(bcRole);
            } catch (e) { console.error('[bcMenu] Lỗi xóa role BC:', e.message); }

            const { embed, components } = createBcMenu(guildId, userId);
            await interaction.editReply({
                content: `✅ Đã hủy đăng ký ${DAY_CONFIG[day].name}!`,
                embeds: [embed],
                components
            });
            await refreshOverview();
            await syncSessionToSupabase(guildId, session.party_key, interaction.guild);
        } else {
            await interaction.editReply({ content: `❌ Lỗi: ${result.error || 'Không tìm thấy'}`, embeds: [], components: [] });
        }
        return true;
    }

    // bcmenu_regular_{day}_{guildId} (toggle) - DYNAMIC
    if (customId.startsWith('bcmenu_regular_')) {
        const day = parseDayFromCustomId(customId);
        if (!day || !DAY_CONFIG[day]) { await interaction.editReply({ content: '❌ Ngày không hợp lệ.', embeds: [], components: [] }); return true; }

        const isRegular = db.isBcRegular(guildId, userId, day);

        if (isRegular) {
            db.removeBcRegular(guildId, userId, day);
            const { embed, components } = createBcMenu(guildId, userId);
            await interaction.editReply({
                content: `✅ Đã tắt "Luôn tham gia" cho ${DAY_CONFIG[day].name}. Đăng ký tuần này vẫn giữ nguyên.`,
                embeds: [embed],
                components
            });
            await refreshOverview();
        } else {
            db.addBcRegular(guildId, userId, username, day);

            let autoJoinMessage = '';
            const session = db.getActiveBangchienByDay(guildId, day);
            if (session && !isUserInSession(session, userId)) {
                const result = db.addBangchienParticipant(session.party_key, {
                    id: userId,
                    username: username,
                    joinedAt: Date.now(),
                    isLeader: false,
                    isRegular: true
                });

                if (result.success) {
                    const regs = bangchienRegistrations.get(session.party_key) || [];
                    regs.push({ id: userId, username, joinedAt: Date.now(), isLeader: false, isRegular: true });
                    bangchienRegistrations.set(session.party_key, regs);
                    autoJoinMessage = ` Đã tự động đăng ký ${DAY_CONFIG[day].name} tuần này!`;
                    await syncSessionToSupabase(guildId, session.party_key, interaction.guild);
                    try {
                        let bcRole = interaction.guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
                        if (!bcRole) bcRole = await interaction.guild.roles.create({ name: BC_ROLE_NAME, color: 0xE74C3C, reason: 'BC role' });
                        if (bcRole && !interaction.member.roles.cache.has(bcRole.id)) await interaction.member.roles.add(bcRole);
                    } catch (e) { console.error('[bcMenu] Lỗi cấp role BC (regular):', e.message); }
                }
            }

            const { embed, components } = createBcMenu(guildId, userId);
            await interaction.editReply({
                content: `✅ Đã bật "Luôn tham gia" cho ${DAY_CONFIG[day].name}.${autoJoinMessage}`,
                embeds: [embed],
                components
            });
            await refreshOverview();
        }
        return true;
    }

    return false;
}

module.exports = {
    createBcMenu,
    handleBcMenuButton,
    isUserInSession,
    getSessionTotal
};
