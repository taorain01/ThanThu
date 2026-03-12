/**
 * ?listallmem command - List ALL members (including left members)
 * Shows paginated list with BC first, then PBC, KC, and mem
 * Max 10 members per page with prev/next/random buttons
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
 * Sort members: LEFT members at END, then by position priority
 */
function sortMembers(members) {
    return members.sort((a, b) => {
        // FIRST: All active members before ALL left members
        const aLeft = a.left_at ? 1 : 0;
        const bLeft = b.left_at ? 1 : 0;
        if (aLeft !== bLeft) return aLeft - bLeft;

        // Then: sort by position priority (BC -> PBC -> KC -> MEM)
        const priorityA = getPositionPriority(a.position);
        const priorityB = getPositionPriority(b.position);
        if (priorityA !== priorityB) return priorityA - priorityB;

        // Same priority and status, sort by name
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
function buildEmbed(members, page, totalPages, isRandom = false) {
    const start = page * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, members.length);
    const pageMems = members.slice(start, end);

    const activeCount = members.filter(m => !m.left_at && !m.discord_id?.startsWith('pending_')).length;
    const leftCount = members.filter(m => m.left_at).length;
    let pendingCount = 0;
    try { pendingCount = db.db.prepare('SELECT COUNT(*) as c FROM pending_ids').get()?.c || 0; } catch (e) { }
    const totalCount = activeCount + pendingCount;

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`Danh sach TAT CA thanh vien Lang Gia ${isRandom ? '(Random)' : ''}`)
        .setDescription(`Discord: **${activeCount}** | Chua Discord: **${pendingCount}** | Tong: **${totalCount}** | Da roi: **${leftCount}**`)
        .setFooter({ text: `Trang ${page + 1}/${totalPages}` })
        .setTimestamp();

    // Build compact list with larger font
    let list = '';
    pageMems.forEach((mem, index) => {
        const posDisplay = getPositionDisplay(mem.position);
        const num = start + index + 1;
        const leftIndicator = mem.left_at ? ' *(Đã rời)*' : '';
        const uid = mem.game_uid ? `(${mem.game_uid})` : '';
        // Show: number, emoji, position name, mention, game name, UID, left status
        list += `**${num}. ${posDisplay.emoji} ${posDisplay.name}** <@${mem.discord_id}> - **${mem.game_username || 'N/A'}** ${uid}${leftIndicator}\n`;
    });

    embed.addFields({ name: '\u200B', value: list || 'Không có thành viên' });

    return embed;
}

/**
 * Build navigation buttons
 */
function buildButtons(page, totalPages, isRandom = false) {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`listallmem_prev_${page}_${isRandom ? 'r' : 'n'}`)
                .setLabel('◀ Trước')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`listallmem_next_${page}_${isRandom ? 'r' : 'n'}`)
                .setLabel('Sau ▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1),
            new ButtonBuilder()
                .setCustomId(`listallmem_random_${page}`)
                .setLabel('🎲 Random')
                .setStyle(ButtonStyle.Primary)
        );
    return row;
}

/**
 * Execute listallmem command (ALL members including left)
 */
async function execute(message, args) {
    const allMembers = db.getAllUsers(); // Get ALL members including left

    if (allMembers.length === 0) {
        return message.channel.send('📋 Chưa có thành viên nào trong danh sách!');
    }

    // Sort by position priority
    const sortedMembers = sortMembers(allMembers);
    const totalPages = Math.ceil(sortedMembers.length / ITEMS_PER_PAGE);

    const embed = buildEmbed(sortedMembers, 0, totalPages, false);
    const buttons = buildButtons(0, totalPages, false);

    await message.channel.send({ embeds: [embed], components: [buttons] });
}

/**
 * Handle button interaction
 */
async function handleButton(interaction) {
    const [, action, pageStr, mode] = interaction.customId.split('_');
    let page = parseInt(pageStr) || 0;

    const allMembers = db.getAllUsers(); // Get ALL members including left
    let members;
    let isRandom = mode === 'r';

    if (action === 'random') {
        // Shuffle members
        members = shuffleArray(allMembers);
        isRandom = true;
        page = 0;
    } else {
        // Keep current order based on mode
        members = isRandom ? shuffleArray(allMembers) : sortMembers(allMembers);

        if (action === 'prev') page--;
        if (action === 'next') page++;
    }

    const totalPages = Math.ceil(members.length / ITEMS_PER_PAGE);
    page = Math.max(0, Math.min(page, totalPages - 1));

    const embed = buildEmbed(members, page, totalPages, isRandom);
    const buttons = buildButtons(page, totalPages, isRandom);

    await interaction.update({ embeds: [embed], components: [buttons] });
}

module.exports = { execute, handleButton };


