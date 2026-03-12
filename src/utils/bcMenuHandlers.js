/**
 * bcMenuHandlers.js
 * Xử lý ephemeral menu cho Bang Chiến multi-day
 * Khi user bấm nút "📋 Đăng ký BANG CHIẾN" -> hiển thị menu riêng cho họ
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { DAY_CONFIG, getDayFromPartyKey, getDayNameWithDate } = require('./bangchienState');

const BC_ROLE_NAME = 'Bang Chiến 30vs30';

/**
 * Tạo ephemeral menu cho user
 * Hiển thị trạng thái đăng ký của user cho cả 2 ngày
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 * @returns {{ embed: EmbedBuilder, components: ActionRowBuilder[] }}
 */
function createBcMenu(guildId, userId) {
    const db = require('../database/db');

    // Lấy sessions của 2 ngày
    const satSession = db.getActiveBangchienByDay(guildId, 'sat');
    const sunSession = db.getActiveBangchienByDay(guildId, 'sun');

    // Kiểm tra user đã đăng ký chưa
    const isInSat = satSession ? isUserInSession(satSession, userId) : false;
    const isInSun = sunSession ? isUserInSession(sunSession, userId) : false;

    // Kiểm tra user có phải regular không
    const isRegularSat = db.isBcRegular(guildId, userId, 'sat');
    const isRegularSun = db.isBcRegular(guildId, userId, 'sun');

    const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('📋 ĐĂNG KÝ BANG CHIẾN')
        .setDescription('Chọn ngày bạn muốn tham gia. Bấm **Luôn tham gia** để tự động đăng ký mỗi tuần.');

    // Thứ 7 - với ngày cụ thể
    const satDateStr = getDayNameWithDate('sat');
    let satStatus = '';
    if (!satSession) {
        satStatus = `📅 **${satDateStr}** - _Chưa mở_`;
    } else {
        const total = getSessionTotal(satSession);
        satStatus = `📅 **${satDateStr}** (${total}/30)\n`;
        satStatus += isInSat ? '✅ Bạn đã đăng ký' : '⭕ Bạn chưa đăng ký';
        if (isRegularSat) satStatus += ' 🔄';
    }
    embed.addFields({ name: '\u200b', value: satStatus, inline: false });

    // Chủ Nhật - với ngày cụ thể
    const sunDateStr = getDayNameWithDate('sun');
    let sunStatus = '';
    if (!sunSession) {
        // DEBUG: List all active sessions to see what's wrong
        const allSessions = db.getActiveBangchienByGuild(guildId);
        const debugStr = allSessions.map(s => `[${s.day || 'null'}]`).join(', ');
        sunStatus = `📅 **${sunDateStr}** - _Chưa mở_ (Debug: ${allSessions.length} active found: ${debugStr})`;
    } else {
        const total = getSessionTotal(sunSession);
        sunStatus = `📅 **${sunDateStr}** (${total}/30)\n`;
        sunStatus += isInSun ? '✅ Bạn đã đăng ký' : '⭕ Bạn chưa đăng ký';
        if (isRegularSun) sunStatus += ' 🔄';
    }
    embed.addFields({ name: '\u200b', value: sunStatus, inline: false });

    embed.setFooter({ text: '🔄 = Luôn tham gia • Menu này chỉ bạn thấy' });

    // Buttons cho Thứ 7
    const satRow = new ActionRowBuilder();
    if (satSession) {
        if (isInSat) {
            satRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`bcmenu_leave_sat_${guildId}`)
                    .setLabel('❌ Hủy T7')
                    .setStyle(ButtonStyle.Secondary)
            );
        } else {
            satRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`bcmenu_join_sat_${guildId}`)
                    .setLabel('✅ Tham gia T7')
                    .setStyle(ButtonStyle.Success)
            );
        }
        satRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`bcmenu_regular_sat_${guildId}`)
                .setLabel(isRegularSat ? '🔄 Bỏ luôn T7' : '🔄 Luôn T7')
                .setStyle(isRegularSat ? ButtonStyle.Secondary : ButtonStyle.Primary)
        );
    }

    // Buttons cho Chủ Nhật
    const sunRow = new ActionRowBuilder();
    if (sunSession) {
        if (isInSun) {
            sunRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`bcmenu_leave_sun_${guildId}`)
                    .setLabel('❌ Hủy CN')
                    .setStyle(ButtonStyle.Secondary)
            );
        } else {
            sunRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`bcmenu_join_sun_${guildId}`)
                    .setLabel('✅ Tham gia CN')
                    .setStyle(ButtonStyle.Success)
            );
        }
        sunRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`bcmenu_regular_sun_${guildId}`)
                .setLabel(isRegularSun ? '🔄 Bỏ luôn CN' : '🔄 Luôn CN')
                .setStyle(isRegularSun ? ButtonStyle.Secondary : ButtonStyle.Primary)
        );
    }

    // Close button
    const closeRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`bcmenu_close_${guildId}`)
                .setLabel('🚪 Đóng')
                .setStyle(ButtonStyle.Danger)
        );

    const components = [];
    if (satRow.components.length > 0) components.push(satRow);
    if (sunRow.components.length > 0) components.push(sunRow);
    components.push(closeRow);

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
            const newEmbed = createOverviewEmbed(guildId);
            const newRow = createOverviewButton(guildId);
            const editOptions = { embeds: [newEmbed] };
            if (newRow) editOptions.components = [newRow];
            else editOptions.components = [];
            await overviewData.message.edit(editOptions);
        } catch (e) {
            console.error('[bcMenu] Error refreshing overview:', e.message);
        }
    };

    // bc_regular_sat_{guildId} / bc_regular_sun_{guildId} từ overview (toggle quick)
    if (customId.startsWith('bc_regular_sat_') || customId.startsWith('bc_regular_sun_')) {
        const day = customId.includes('_sat_') ? 'sat' : 'sun';
        const isRegular = db.isBcRegular(guildId, userId, day);

        if (isRegular) {
            db.removeBcRegular(guildId, userId, day);
            await interaction.reply({
                content: `✅ Đã tắt "Luôn tham gia" ${DAY_CONFIG[day].name}.`,
                ephemeral: true
            });
        } else {
            db.addBcRegular(guildId, userId, username, day);

            // Auto-join session hiện tại nếu có
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
                    // Cấp role BC khi auto-join
                    try {
                        let bcRole = interaction.guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
                        if (!bcRole) bcRole = await interaction.guild.roles.create({ name: BC_ROLE_NAME, color: 0xE74C3C, reason: 'BC role' });
                        const member = await interaction.guild.members.fetch(userId).catch(() => null);
                        if (bcRole && member && !member.roles.cache.has(bcRole.id)) await member.roles.add(bcRole);
                    } catch (e) { console.error('[bcMenu] Lỗi cấp role BC (regular):', e.message); }
                }
            }

            await interaction.reply({
                content: `✅ Đã bật "Luôn tham gia" ${DAY_CONFIG[day].name}.${autoJoinMsg}`,
                ephemeral: true
            });
        }

        // Refresh overview
        await refreshOverview();
        return true;
    }

    // Các handlers còn lại dùng biến đã khai báo ở trên

    // bc_viewdetail_{guildId} → Hiện menu chọn ngày để xem danh sách
    if (customId.startsWith('bc_viewdetail_')) {
        const satSession = db.getActiveBangchienByDay(guildId, 'sat');
        const sunSession = db.getActiveBangchienByDay(guildId, 'sun');

        const satTotal = satSession ? getSessionTotal(satSession) : 0;
        const sunTotal = sunSession ? getSessionTotal(sunSession) : 0;

        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('🔍 XEM DANH SÁCH BANG CHIẾN')
            .setDescription('Chọn ngày để xem danh sách chi tiết:')
            .addFields(
                { name: `📅 ${getDayNameWithDate('sat')}`, value: satSession ? `👥 ${satTotal}/30 người` : '_Chưa mở_', inline: true },
                { name: `📅 ${getDayNameWithDate('sun')}`, value: sunSession ? `👥 ${sunTotal}/30 người` : '_Chưa mở_', inline: true }
            )
            .setFooter({ text: 'Menu này chỉ bạn thấy' });

        const row = new ActionRowBuilder();
        if (satSession) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`bc_viewlist_sat_${guildId}`)
                    .setLabel(`📋 Xem T7 (${satTotal})`)
                    .setStyle(ButtonStyle.Primary)
            );
        }
        if (sunSession) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`bc_viewlist_sun_${guildId}`)
                    .setLabel(`📋 Xem CN (${sunTotal})`)
                    .setStyle(ButtonStyle.Primary)
            );
        }
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`bcmenu_close_${guildId}`)
                .setLabel('🚪 Đóng')
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        return true;
    }

    // bc_viewlist_sat_{guildId} / bc_viewlist_sun_{guildId} → Hiện danh sách chi tiết
    if (customId.startsWith('bc_viewlist_')) {
        const day = customId.includes('_sat_') ? 'sat' : 'sun';
        const session = db.getActiveBangchienByDay(guildId, day);

        if (!session) {
            await interaction.update({ content: `❌ Chưa có phiên BC ${DAY_CONFIG[day].name}.`, embeds: [], components: [] });
            return true;
        }

        // Sử dụng createBangchienEmbed giống như ?bc t7
        const { createBangchienEmbed } = require('../commands/bangchien/bangchien');
        const embed = createBangchienEmbed(session.party_key, session.leader_name, interaction.guild);

        // Thêm footer để biết đây là ephemeral
        embed.setFooter({ text: 'Menu này chỉ bạn thấy • Hôm nay lúc ' + new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) });

        const backRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`bc_viewdetail_${guildId}`)
                    .setLabel('⬅️ Quay lại')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`bcmenu_close_${guildId}`)
                    .setLabel('🚪 Đóng')
                    .setStyle(ButtonStyle.Danger)
            );

        await interaction.update({ embeds: [embed], components: [backRow] });
        return true;
    }

    // bc_menu_{guildId} → Mở menu
    if (customId.startsWith('bc_menu_')) {
        const { embed, components } = createBcMenu(guildId, userId);
        await interaction.reply({ embeds: [embed], components, ephemeral: true });
        return true;
    }

    // bcmenu_close
    if (customId.startsWith('bcmenu_close_')) {
        await interaction.update({ content: '✅ Đã đóng menu.', embeds: [], components: [] });
        return true;
    }

    // bcmenu_join_sat / bcmenu_join_sun
    if (customId.startsWith('bcmenu_join_')) {
        const day = customId.includes('_sat_') ? 'sat' : 'sun';
        const session = db.getActiveBangchienByDay(guildId, day);

        if (!session) {
            await interaction.update({ content: `❌ Chưa có phiên BC ${DAY_CONFIG[day].name}.`, embeds: [], components: [] });
            return true;
        }

        // Kiểm tra đã đăng ký chưa
        if (isUserInSession(session, userId)) {
            const { embed, components } = createBcMenu(guildId, userId);
            await interaction.update({ content: `⚠️ Bạn đã đăng ký ${DAY_CONFIG[day].name} rồi!`, embeds: [embed], components });
            return true;
        }

        // Thêm vào session
        const result = db.addBangchienParticipant(session.party_key, {
            id: userId,
            username: username,
            joinedAt: Date.now(),
            isLeader: false
        });

        if (result.success) {
            // Cập nhật memory
            const regs = bangchienRegistrations.get(session.party_key) || [];
            regs.push({ id: userId, username, joinedAt: Date.now(), isLeader: false });
            bangchienRegistrations.set(session.party_key, regs);

            // Cấp role Bang Chiến 30vs30 ngay khi tham gia
            try {
                let bcRole = interaction.guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
                if (!bcRole) bcRole = await interaction.guild.roles.create({ name: BC_ROLE_NAME, color: 0xE74C3C, reason: 'BC role' });
                if (bcRole && !interaction.member.roles.cache.has(bcRole.id)) await interaction.member.roles.add(bcRole);
            } catch (e) { console.error('[bcMenu] Lỗi cấp role BC:', e.message); }

            const { embed, components } = createBcMenu(guildId, userId);
            await interaction.update({
                content: `✅ Đã đăng ký ${DAY_CONFIG[day].name}! (${result.team})`,
                embeds: [embed],
                components
            });
            await refreshOverview(); // Cập nhật overview ngay lập tức
        } else {
            await interaction.update({ content: `❌ Lỗi: ${result.error}`, embeds: [], components: [] });
        }
        return true;
    }

    // bcmenu_leave_sat / bcmenu_leave_sun
    if (customId.startsWith('bcmenu_leave_')) {
        const day = customId.includes('_sat_') ? 'sat' : 'sun';
        const session = db.getActiveBangchienByDay(guildId, day);

        if (!session) {
            await interaction.update({ content: `❌ Chưa có phiên BC ${DAY_CONFIG[day].name}.`, embeds: [], components: [] });
            return true;
        }

        // Xóa khỏi session
        const result = db.removeBangchienParticipant(session.party_key, userId);

        if (result.success) {
            // Cập nhật memory
            const regs = bangchienRegistrations.get(session.party_key) || [];
            const updated = regs.filter(r => r.id !== userId);
            bangchienRegistrations.set(session.party_key, updated);

            // Xóa role Bang Chiến 30vs30 khi hủy đăng ký
            try {
                const bcRole = interaction.guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
                if (bcRole && interaction.member.roles.cache.has(bcRole.id)) await interaction.member.roles.remove(bcRole);
            } catch (e) { console.error('[bcMenu] Lỗi xóa role BC:', e.message); }

            const { embed, components } = createBcMenu(guildId, userId);
            await interaction.update({
                content: `✅ Đã hủy đăng ký ${DAY_CONFIG[day].name}!`,
                embeds: [embed],
                components
            });
            await refreshOverview(); // Cập nhật overview ngay lập tức
        } else {
            await interaction.update({ content: `❌ Lỗi: ${result.error || 'Không tìm thấy'}`, embeds: [], components: [] });
        }
        return true;
    }

    // bcmenu_regular_sat / bcmenu_regular_sun (toggle)
    if (customId.startsWith('bcmenu_regular_')) {
        const day = customId.includes('_sat_') ? 'sat' : 'sun';
        const isRegular = db.isBcRegular(guildId, userId, day);

        if (isRegular) {
            // TẮT "Luôn tham gia" - chỉ xóa regular, KHÔNG xóa khỏi session hiện tại
            db.removeBcRegular(guildId, userId, day);
            const { embed, components } = createBcMenu(guildId, userId);
            await interaction.update({
                content: `✅ Đã tắt "Luôn tham gia" cho ${DAY_CONFIG[day].name}. Đăng ký tuần này vẫn giữ nguyên.`,
                embeds: [embed],
                components
            });
            await refreshOverview(); // Cập nhật overview
        } else {
            // BẬT "Luôn tham gia"
            db.addBcRegular(guildId, userId, username, day);

            // Auto-join session hiện tại nếu có và chưa join
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
                    // Cập nhật memory
                    const regs = bangchienRegistrations.get(session.party_key) || [];
                    regs.push({ id: userId, username, joinedAt: Date.now(), isLeader: false, isRegular: true });
                    bangchienRegistrations.set(session.party_key, regs);
                    autoJoinMessage = ` Đã tự động đăng ký ${DAY_CONFIG[day].name} tuần này!`;
                    // Cấp role BC khi auto-join từ regular
                    try {
                        let bcRole = interaction.guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
                        if (!bcRole) bcRole = await interaction.guild.roles.create({ name: BC_ROLE_NAME, color: 0xE74C3C, reason: 'BC role' });
                        if (bcRole && !interaction.member.roles.cache.has(bcRole.id)) await interaction.member.roles.add(bcRole);
                    } catch (e) { console.error('[bcMenu] Lỗi cấp role BC (regular):', e.message); }
                }
            }

            const { embed, components } = createBcMenu(guildId, userId);
            await interaction.update({
                content: `✅ Đã bật "Luôn tham gia" cho ${DAY_CONFIG[day].name}.${autoJoinMessage}`,
                embeds: [embed],
                components
            });
            await refreshOverview(); // Cập nhật overview
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
