/**
 * Ephemeral Bang Chien registration menu.
 * Uses exact session party keys so multiple sessions on the same day do not collide.
 */

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder
} = require('discord.js');
const {
    DAY_CONFIG,
    PRIMARY_DAYS,
    LEAGUE_TIME,
    normalizeBcTime,
    isLeagueSession,
    getDayNameWithDate,
    getNextDayDate
} = require('./bangchienState');
const bangchienRoster = require('./bangchienRoster');

const BC_ROLE_NAME = 'bc';
const pendingBcMenuSelections = new Map();

function menuStateKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function getSessionTotal(session) {
    return bangchienRoster.getRosterCounts(session).active;
}

function getAllSessionMembers(session) {
    return bangchienRoster.getAllRosterMembers(session);
}

function isUserInSession(session, userId) {
    return getAllSessionMembers(session).some(m => String(m.id) === String(userId));
}

function isUserInAnyActiveSession(guildId, userId) {
    const db = require('../database/db');
    return db.getActiveBangchienByGuild(guildId).some(session => isUserInSession(session, userId));
}

function getSessionLabel(session) {
    const dayLabel = DAY_CONFIG[session.day]?.name || session.day || '?';
    const time = normalizeBcTime(session.time || LEAGUE_TIME);
    const badge = isLeagueSession(session) ? ' LEAGUE' : '';
    const note = session.note && !/^league$/i.test(String(session.note)) ? ` - ${session.note}` : '';
    return `${dayLabel} ${time}${badge}${note}`;
}

function sortSessionsForMenu(sessions) {
    return [...sessions].sort((a, b) => {
        const aWeekend = PRIMARY_DAYS.includes(a.day);
        const bWeekend = PRIMARY_DAYS.includes(b.day);
        const aBucket = aWeekend ? (isLeagueSession(a) ? 0 : 1) : 2;
        const bBucket = bWeekend ? (isLeagueSession(b) ? 0 : 1) : 2;
        if (aBucket !== bBucket) return aBucket - bBucket;

        const dayDiff = getNextDayDate(a.day).getTime() - getNextDayDate(b.day).getTime();
        if (dayDiff !== 0) return dayDiff;
        return normalizeBcTime(a.time || LEAGUE_TIME).localeCompare(normalizeBcTime(b.time || LEAGUE_TIME));
    });
}

function buildInitialSelection(guildId, userId, sessions) {
    const key = menuStateKey(guildId, userId);
    if (pendingBcMenuSelections.has(key)) return new Set(pendingBcMenuSelections.get(key));
    return new Set(sessions.filter(session => isUserInSession(session, userId)).map(session => session.party_key));
}

function createBcMenu(guildId, userId) {
    const db = require('../database/db');
    const sessions = sortSessionsForMenu(db.getActiveBangchienByGuild(guildId));
    const selected = buildInitialSelection(guildId, userId, sessions);
    const joinedCount = sessions.filter(s => isUserInSession(s, userId)).length;

    const embed = new EmbedBuilder()
        .setColor(joinedCount > 0 ? 0x22C55E : 0xFFD700)
        .setTitle('⚔️  Đăng Ký Bang Chiến')
        .setDescription(
            sessions.length > 0
                ? '> 🟢 Bấm chọn các trận muốn tham gia trong dropdown bên dưới.\n> Rồi bấm **✔ Xác nhận** để lưu thay đổi.'
                : '> Chưa có phiên Bang Chiến nào đang mở.'
        );

    if (sessions.length > 0) {
        // Group theo ngày, giữ thứ tự đúng
        const byDay = {};
        const dayOrder = [];
        for (const s of sessions.slice(0, 10)) {
            if (!byDay[s.day]) { byDay[s.day] = []; dayOrder.push(s.day); }
            byDay[s.day].push(s);
        }

        for (const day of dayOrder) {
            const dayHeader = getDayNameWithDate(day);
            const lines = byDay[day].map(s => {
                const total   = getSessionTotal(s);
                const joined  = isUserInSession(s, userId);
                const league  = isLeagueSession(s);
                const timeStr = normalizeBcTime(s.time || LEAGUE_TIME);
                const noteRaw = s.note && !/^league$/i.test(String(s.note)) ? String(s.note) : '';
                const typeBadge = league ? ' · `LEAGUE`' : (noteRaw ? ` · \`${noteRaw}\`` : '');

                if (joined) {
                    return `✅ **${timeStr}**${typeBadge}  \`${total}/30\`  ← _Đã đăng ký_`;
                }
                return `▫️ **${timeStr}**${typeBadge}  \`${total}/30\``;
            });

            embed.addFields({
                name: `📅 ${dayHeader}`,
                value: lines.join('\n'),
                inline: false
            });
        }

        embed.setFooter({
            text: joinedCount > 0
                ? `✅ Đã đăng ký ${joinedCount}/${sessions.length} trận  •  Bỏ tích trận nào để hủy đăng ký`
                : `Chưa đăng ký trận nào  •  Tổng ${sessions.length} trận đang mở`
        });
    }

    const components = [];
    if (sessions.length > 0) {
        const options = sessions.slice(0, 25).map(session => ({
            label: getSessionLabel(session).slice(0, 100),
            value: session.party_key,
            description: `${getDayNameWithDate(session.day)} — ${getSessionTotal(session)}/30 người`.slice(0, 100),
            default: selected.has(session.party_key)
        }));

        components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`bcmenu_select_${guildId}`)
                .setPlaceholder('Chọn trận Bang Chiến…')
                .setMinValues(0)
                .setMaxValues(Math.max(1, options.length))
                .addOptions(options)
        ));

        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`bcmenu_apply_${guildId}`)
                .setLabel('✔  Xác nhận')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`bcmenu_close_${guildId}`)
                .setLabel('Đóng')
                .setStyle(ButtonStyle.Secondary)
        ));
    } else {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`bcmenu_close_${guildId}`)
                .setLabel('Đóng')
                .setStyle(ButtonStyle.Secondary)
        ));
    }

    return { embed, components };
}

async function syncSessionToSupabase(guildId, partyKey, guild = null) {
    try {
        const supaSync = require('./supabaseSync');
        if (!supaSync.isReady()) return;
        const db = require('../database/db');
        const session = db.getActiveBangchien(partyKey);
        if (!session) return;
        const formatted = supaSync.formatActiveSession(session, db, guild);
        if (formatted) {
            formatted.time = normalizeBcTime(session.time || LEAGUE_TIME);
            await supaSync.syncBCSession(guildId, session.day || 'sat', formatted);
        }
    } catch (e) {
        console.error('[bcMenu] Supabase sync failed:', e.message);
    }
}

async function refreshOverview(interaction, guildId) {
    const { bangchienOverviews } = require('./bangchienState');
    const overviewData = bangchienOverviews.get(guildId);
    if (!overviewData || !overviewData.message) return;

    try {
        const { createOverviewEmbed, createOverviewButton } = require('../commands/bangchien/bangchien');
        const newEmbed = createOverviewEmbed(guildId, interaction.guild);
        const newRow = createOverviewButton(guildId);
        await overviewData.message.edit({
            embeds: [newEmbed],
            components: newRow ? [newRow] : []
        });
    } catch (e) {
        console.error('[bcMenu] Refresh overview failed:', e.message);
    }
}

function getBcRoleForInteraction(interaction) {
    let userRole = null;
    let subRoleName = '';
    const member = interaction.member;
    const dpsSubTypeRoles = ['Quạt Dù', 'Vô Danh', 'Song Đao', 'Cửu Kiếm', 'Dù Roi', 'Hoành Đao/Mđ'];

    const healerRole = interaction.guild.roles.cache.find(r => r.name === 'Healer');
    if (healerRole && member.roles.cache.has(healerRole.id)) userRole = 'Healer';

    if (!userRole) {
        const tankerRole = interaction.guild.roles.cache.find(r => r.name === 'Tanker');
        if (tankerRole && member.roles.cache.has(tankerRole.id)) userRole = 'Tanker';
    }

    if (!userRole) {
        for (const subTypeName of dpsSubTypeRoles) {
            const subRole = interaction.guild.roles.cache.find(r => r.name === subTypeName);
            if (subRole && member.roles.cache.has(subRole.id)) {
                userRole = 'DPS';
                subRoleName = subTypeName;
                break;
            }
        }
    }

    if (!userRole) {
        const dpsRole = interaction.guild.roles.cache.find(r => r.name === 'DPS');
        if (dpsRole && member.roles.cache.has(dpsRole.id)) userRole = 'DPS';
    }

    return { userRole: userRole || 'DPS', subRoleName };
}

async function ensureBcRole(interaction) {
    try {
        let bcRole = interaction.guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
        if (!bcRole) {
            bcRole = await interaction.guild.roles.create({ name: BC_ROLE_NAME, color: 0xE74C3C, reason: 'BC role' });
        }
        if (bcRole && !interaction.member.roles.cache.has(bcRole.id)) {
            await interaction.member.roles.add(bcRole);
        }
    } catch (e) {
        console.error('[bcMenu] Add BC role failed:', e.message);
    }
}

async function removeBcRoleIfUnused(interaction, guildId, userId) {
    if (isUserInAnyActiveSession(guildId, userId)) return;
    try {
        const bcRole = interaction.guild.roles.cache.find(r => r.name === BC_ROLE_NAME);
        if (bcRole && interaction.member.roles.cache.has(bcRole.id)) {
            await interaction.member.roles.remove(bcRole);
        }
    } catch (e) {
        console.error('[bcMenu] Remove BC role failed:', e.message);
    }
}

async function applyMenuSelection(interaction, guildId, userId) {
    const db = require('../database/db');
    const { bangchienRegistrations } = require('./bangchienState');
    const sessions = sortSessionsForMenu(db.getActiveBangchienByGuild(guildId));
    const key = menuStateKey(guildId, userId);
    const selected = pendingBcMenuSelections.has(key)
        ? new Set(pendingBcMenuSelections.get(key))
        : buildInitialSelection(guildId, userId, sessions);

    const userInfo = db.getUserByDiscordId(userId);
    const gameName = userInfo?.game_username || '';
    const { userRole, subRoleName } = getBcRoleForInteraction(interaction);
    const changedPartyKeys = [];
    let joinedCount = 0;
    let leftCount = 0;
    const errors = [];
    const joinedLabels = [];
    const leftLabels = [];

    for (const session of sessions) {
        const wantsJoin = selected.has(session.party_key);
        const isJoined = isUserInSession(session, userId);

        if (wantsJoin && !isJoined) {
            const participantData = {
                id: userId,
                username: interaction.user.username,
                gn: gameName,
                name: gameName || interaction.user.username,
                role: userRole,
                sub: subRoleName,
                joinedAt: Date.now(),
                isLeader: false
            };
            const result = db.addBangchienParticipant(session.party_key, participantData, guildId);
            if (result.success) {
                const regs = bangchienRegistrations.get(session.party_key) || [];
                regs.push(participantData);
                bangchienRegistrations.set(session.party_key, regs);
                changedPartyKeys.push(session.party_key);
                joinedCount++;
                joinedLabels.push(getSessionLabel(session));
            } else {
                errors.push(`${getSessionLabel(session)}: ${result.error || 'không thể đăng ký'}`);
            }
        }

        if (!wantsJoin && isJoined) {
            const result = db.removeBangchienParticipant(session.party_key, userId);
            if (result.success) {
                const regs = bangchienRegistrations.get(session.party_key) || [];
                bangchienRegistrations.set(session.party_key, regs.filter(r => String(r.id) !== String(userId)));
                changedPartyKeys.push(session.party_key);
                leftCount++;
                leftLabels.push(getSessionLabel(session));
            } else {
                errors.push(`${getSessionLabel(session)}: ${result.error || 'không thể hủy'}`);
            }
        }
    }

    if (joinedCount > 0) await ensureBcRole(interaction);
    if (leftCount > 0) await removeBcRoleIfUnused(interaction, guildId, userId);

    for (const partyKey of [...new Set(changedPartyKeys)]) {
        await syncSessionToSupabase(guildId, partyKey, interaction.guild);
    }
    if (changedPartyKeys.length > 0) await refreshOverview(interaction, guildId);

    pendingBcMenuSelections.delete(key);

    // Tạo thông báo chi tiết
    const lines = [];
    if (joinedLabels.length > 0) {
        lines.push(`✅ **Đã đăng ký ${joinedCount} trận:**`);
        for (const label of joinedLabels) lines.push(`  • ${label}`);
    }
    if (leftLabels.length > 0) {
        lines.push(`🚫 **Đã hủy đăng ký ${leftCount} trận:**`);
        for (const label of leftLabels) lines.push(`  • ${label}`);
    }
    if (lines.length === 0) lines.push('ℹ️ Không có thay đổi nào.');
    if (errors.length > 0) lines.push(`⚠️ Lỗi: ${errors.slice(0, 2).join('; ')}`);

    return lines.join('\n');
}

async function showRecurringDisabled(interaction) {
    const content = 'Chức năng đăng ký định kỳ đang tạm thời tắt. Hãy dùng menu đăng ký để chọn từng trận.';
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content, embeds: [], components: [] });
    } else {
        await interaction.reply({ content, ephemeral: true });
    }
}

async function handleBcMenuSelect(interaction) {
    if (!interaction.customId.startsWith('bcmenu_select_')) return false;
    await interaction.deferUpdate();

    const guildId = interaction.guild.id;
    const key = menuStateKey(guildId, interaction.user.id);
    pendingBcMenuSelections.set(key, new Set(interaction.values || []));

    const { embed, components } = createBcMenu(guildId, interaction.user.id);
    await interaction.editReply({ embeds: [embed], components });
    return true;
}

async function handleBcMenuButton(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('bcmenu_') &&
        !customId.startsWith('bc_menu_') &&
        !customId.startsWith('bc_' + 'reg' + 'ular_') &&
        !customId.startsWith('bc_viewdetail_') &&
        !customId.startsWith('bc_viewlist_')) {
        return false;
    }

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    if (customId.startsWith('bc_' + 'reg' + 'ular_') || customId.startsWith('bcmenu_' + 'reg' + 'ular_')) {
        await interaction.deferReply({ ephemeral: true });
        await showRecurringDisabled(interaction);
        return true;
    }

    if (customId.startsWith('bc_menu_')) {
        await interaction.deferReply({ ephemeral: true });
        const { embed, components } = createBcMenu(guildId, userId);
        await interaction.editReply({ embeds: [embed], components });
        return true;
    }

    if (customId.startsWith('bc_viewdetail_')) {
        await interaction.deferReply({ ephemeral: true });
        const db = require('../database/db');
        const sessions = sortSessionsForMenu(db.getActiveBangchienByGuild(guildId));
        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('DANH SÁCH BANG CHIẾN')
            .setDescription(sessions.length ? 'Chọn một trận để xem danh sách chi tiết.' : 'Chưa có phiên Bang Chiến nào đang mở.');

        const rows = [];
        let row = new ActionRowBuilder();
        for (const session of sessions.slice(0, 24)) {
            if (row.components.length >= 5) {
                rows.push(row);
                row = new ActionRowBuilder();
            }
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`bc_viewlist_${session.party_key}`)
                    .setLabel(`${getSessionLabel(session)} (${getSessionTotal(session)})`.slice(0, 80))
                    .setStyle(ButtonStyle.Primary)
            );
        }
        if (row.components.length > 0) rows.push(row);
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`bcmenu_close_${guildId}`)
                .setLabel('Dong')
                .setStyle(ButtonStyle.Secondary)
        ));
        await interaction.editReply({ embeds: [embed], components: rows });
        return true;
    }

    await interaction.deferUpdate();

    if (customId.startsWith('bcmenu_close_')) {
        pendingBcMenuSelections.delete(menuStateKey(guildId, userId));
        await interaction.editReply({ content: 'Đã đóng menu.', embeds: [], components: [] });
        return true;
    }

    if (customId.startsWith('bcmenu_apply_')) {
        const summary = await applyMenuSelection(interaction, guildId, userId);
        const { embed, components } = createBcMenu(guildId, userId);
        await interaction.editReply({ content: summary, embeds: [embed], components });
        return true;
    }

    if (customId.startsWith('bc_viewlist_')) {
        const db = require('../database/db');
        const partyKey = customId.replace('bc_viewlist_', '');
        const session = db.getActiveBangchien(partyKey);
        if (!session) {
            await interaction.editReply({ content: 'Phiên Bang Chiến này không còn tồn tại.', embeds: [], components: [] });
            return true;
        }

        const { createBangchienEmbed } = require('../commands/bangchien/bangchien');
        const embed = createBangchienEmbed(session.party_key, session.leader_name, interaction.guild);
        const { embed: menuEmbed, components } = createBcMenu(guildId, userId);
        await interaction.editReply({ embeds: [embed, menuEmbed], components });
        return true;
    }

    return false;
}

module.exports = {
    createBcMenu,
    handleBcMenuButton,
    handleBcMenuSelect,
    isUserInSession,
    getSessionTotal
};
