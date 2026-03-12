/**
 * ?listmem command - List all members
 * Aliases: ?dsmem, ?dstv
 * 
 * Shows paginated list with BC first, then PBC, KC, and mem
 * Max 10 members per page with prev/next/random buttons
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('../../database/db');

// Position priority (lower = higher priority)
const POSITION_PRIORITY = {
    bc: 1,
    pbc: 2,
    kc: 3,
    mem: 100
};

// Position display config
const POSITION_CONFIG = {
    bc: { name: 'Bang Chủ', emoji: '👑' },
    pbc: { name: 'Phó Bang Chủ', emoji: '⚔️' },
    kc: { name: 'Kỳ Cựu', emoji: '🏆' },
    mem: { name: 'Thành Viên', emoji: '👤' }
};

const ITEMS_PER_PAGE = 10;

/**
 * Get position priority for sorting
 */
function getPositionPriority(position) {
    const pos = position?.toLowerCase();
    if (POSITION_PRIORITY[pos]) return POSITION_PRIORITY[pos];
    // Custom kc variants get kc priority
    return 3;
}

/**
 * Get position display info
 */
function getPositionDisplay(position) {
    const pos = position?.toLowerCase();
    if (POSITION_CONFIG[pos]) return POSITION_CONFIG[pos];
    return { name: pos?.toUpperCase() || '?', emoji: '🏆' };
}

/**
 * Sort members by position priority
 */
function sortMembers(members) {
    return members.sort((a, b) => {
        const priorityA = getPositionPriority(a.position);
        const priorityB = getPositionPriority(b.position);
        if (priorityA !== priorityB) return priorityA - priorityB;
        // Same priority, sort by name
        return (a.discord_name || '').localeCompare(b.discord_name || '');
    });
}

/**
 * Shuffle array (Fisher-Yates)
 */
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Build member list embed
 */
function buildEmbed(members, page, totalPages, pendingCount = 0, searchHighlight = null) {
    const start = page * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, members.length);
    const pageMems = members.slice(start, end);

    const activeCount = members.filter(m => !m.isPending).length;

    const totalCount = activeCount + pendingCount;
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`Danh sach thanh vien Lang Gia`)
        .setDescription(`Discord: **${activeCount}** | Chua vao Discord: **${pendingCount}** | Tong: **${totalCount}**`)
        .setFooter({ text: `Trang ${page + 1}/${totalPages}` })
        .setTimestamp();

    // Build compact list
    let list = '';
    pageMems.forEach((mem, index) => {
        const num = start + index + 1;

        if (mem.isPending) {
            // Pending entry from ?addid
            const joinDateStr = mem.joined_at
                ? `<t:${Math.floor(new Date(mem.joined_at).getTime() / 1000)}:d>`
                : '';
            list += `**${num}. (Chua link)** **${mem.game_username}** \`${mem.game_uid}\` ${joinDateStr}\n`;
        } else {
            // Regular member
            const posDisplay = getPositionDisplay(mem.position);
            const uid = mem.game_uid ? `(${mem.game_uid})` : '';
            // Highlight if this is the searched member
            const highlight = searchHighlight && (mem.discord_id === searchHighlight || mem.game_uid === searchHighlight) ? '➡️ ' : '';
            list += `${highlight}**${num}. ${posDisplay.emoji} ${posDisplay.name}** <@${mem.discord_id}> - **${mem.game_username || 'N/A'}** ${uid}\n`;
        }
    });

    // Truncate if too long
    if (list.length > 1020) {
        list = list.substring(0, 1017) + '...';
    }

    embed.addFields({ name: 'Danh sach', value: list || 'Khong co thanh vien' });

    return embed;
}

/**
 * Build navigation buttons
 */
function buildButtons(page, totalPages, userId = '') {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`listmem_prev_${page}_${userId}`)
                .setLabel('◀ Trước')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`listmem_next_${page}_${userId}`)
                .setLabel('Sau ▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1),
            new ButtonBuilder()
                .setCustomId(`listmem_search_${page}_${userId}`)
                .setLabel('🔍 Tìm kiếm')
                .setStyle(ButtonStyle.Primary)
        );
    return row;
}

/**
 * Get all members + pending_ids combined (pending at end)
 */
function getAllMembersWithPending() {
    const activeMembers = db.getActiveUsers();
    let pendingIds = [];

    try {
        pendingIds = db.db.prepare('SELECT * FROM pending_ids ORDER BY added_at DESC').all();
    } catch (e) { /* ignore */ }

    // Mark pending entries
    const pendingEntries = pendingIds.map(p => ({
        ...p,
        isPending: true,
        discord_id: 'pending_' + p.game_uid
    }));

    // Sort active members first, then pending at end
    const sorted = sortMembers(activeMembers);
    return { members: [...sorted, ...pendingEntries], pendingCount: pendingEntries.length };
}

/**
 * Execute listmem command (only active members)
 */
async function execute(message, args) {
    const { members, pendingCount } = getAllMembersWithPending();

    if (members.length === 0) {
        return message.channel.send('Chua co thanh vien nao!');
    }

    const totalPages = Math.ceil(members.length / ITEMS_PER_PAGE);
    const embed = buildEmbed(members, 0, totalPages, pendingCount);
    const buttons = buildButtons(0, totalPages, message.author.id);

    await message.channel.send({ embeds: [embed], components: [buttons] });
}

/**
 * Handle button interaction
 */
async function handleButton(interaction) {
    const parts = interaction.customId.split('_');
    const action = parts[1];
    const pageStr = parts[2];
    let page = parseInt(pageStr) || 0;

    // Extract userId from customId (last part)
    const userId = parts[parts.length - 1];

    // Check if the user clicking is the original command user
    if (userId && interaction.user.id !== userId) {
        return interaction.reply({
            content: '❌ Chỉ người sử dụng lệnh mới có thể bấm button này!',
            ephemeral: true
        });
    }

    // Handle search button - show modal
    if (action === 'search') {
        const modal = new ModalBuilder()
            .setCustomId(`listmem_modal_${userId}`)
            .setTitle('Tìm kiếm thành viên');

        const searchInput = new TextInputBuilder()
            .setCustomId('search_query')
            .setLabel('Nhập thông tin tìm kiếm')
            .setPlaceholder('Discord ID, username, tag, tên ingame, UID hoặc số trang')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100);

        const actionRow = new ActionRowBuilder().addComponents(searchInput);
        modal.addComponents(actionRow);

        return interaction.showModal(modal);
    }

    const { members, pendingCount } = getAllMembersWithPending();

    if (action === 'prev') page--;
    if (action === 'next') page++;

    const totalPages = Math.ceil(members.length / ITEMS_PER_PAGE);
    page = Math.max(0, Math.min(page, totalPages - 1));

    const embed = buildEmbed(members, page, totalPages, pendingCount);
    const buttons = buildButtons(page, totalPages, userId);

    await interaction.update({ embeds: [embed], components: [buttons] });
}

/**
 * Find member index by search query
 */
function findMemberIndex(members, query) {
    const q = query.toLowerCase().trim();

    for (let i = 0; i < members.length; i++) {
        const m = members[i];

        // Check discord ID
        if (m.discord_id === q || m.discord_id === query) return { index: i, id: m.discord_id };

        // Check game UID
        if (m.game_uid && (m.game_uid.toString() === q || m.game_uid.toString() === query)) return { index: i, id: m.game_uid };

        // Check discord name (partial match)
        if (m.discord_name && m.discord_name.toLowerCase().includes(q)) return { index: i, id: m.discord_id };

        // Check game username (partial match)
        if (m.game_username && m.game_username.toLowerCase().includes(q)) return { index: i, id: m.discord_id || m.game_uid };
    }

    return null;
}

/**
 * Handle modal submit for search
 */
async function handleModalSubmit(interaction) {
    const parts = interaction.customId.split('_');
    const userId = parts[parts.length - 1];

    // Check if the user submitting is the original command user
    if (userId && interaction.user.id !== userId) {
        return interaction.reply({
            content: '❌ Chỉ người sử dụng lệnh mới có thể tìm kiếm!',
            ephemeral: true
        });
    }

    const query = interaction.fields.getTextInputValue('search_query').trim();
    const { members, pendingCount } = getAllMembersWithPending();
    const totalPages = Math.ceil(members.length / ITEMS_PER_PAGE);

    // Check if query is a page number
    const pageNum = parseInt(query);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
        const page = pageNum - 1;
        const embed = buildEmbed(members, page, totalPages, pendingCount);
        const buttons = buildButtons(page, totalPages, userId);
        return interaction.update({ embeds: [embed], components: [buttons] });
    }

    // Search for member
    const result = findMemberIndex(members, query);

    if (!result) {
        return interaction.reply({
            content: `❌ Không tìm thấy thành viên với thông tin: **${query}**`,
            ephemeral: true
        });
    }

    const page = Math.floor(result.index / ITEMS_PER_PAGE);
    const embed = buildEmbed(members, page, totalPages, pendingCount, result.id);
    const buttons = buildButtons(page, totalPages, userId);

    await interaction.update({ embeds: [embed], components: [buttons] });
}

module.exports = { execute, handleButton, handleModalSubmit };


