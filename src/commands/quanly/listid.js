/**
 * ?listid command - List pending IDs from ?addid
 * Aliases: ?listcho
 * 
 * Shows paginated list of pending game IDs waiting to be linked
 * Max 10 entries per page with prev/next buttons
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database/db');

const ITEMS_PER_PAGE = 10;

/**
 * Build pending IDs list embed
 */
function buildEmbed(pendingIds, page, totalPages) {
    const start = page * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, pendingIds.length);
    const pageItems = pendingIds.slice(start, end);

    const embed = new EmbedBuilder()
        .setColor(0xF59E0B)
        .setTitle('Danh sach cho (?addid)')
        .setDescription(`Tong: **${pendingIds.length}** UID dang cho`)
        .setFooter({ text: `Trang ${page + 1}/${totalPages}` })
        .setTimestamp();

    // Build list
    let list = '';
    pageItems.forEach((pending, index) => {
        const num = start + index + 1;
        const joinDateStr = pending.joined_at
            ? `<t:${Math.floor(new Date(pending.joined_at).getTime() / 1000)}:d>`
            : '';

        list += `**${num}. ${pending.game_username}** \`${pending.game_uid}\`\n`;
        if (joinDateStr) list += `  Vao: ${joinDateStr}\n`;
    });

    // Add list field (value cannot be empty or exceed 1024 chars)
    let listValue = list.trim() || 'Khong co UID nao trong danh sach cho';
    if (listValue.length > 1020) {
        listValue = listValue.substring(0, 1017) + '...';
    }
    embed.addFields({ name: 'Danh sach', value: listValue });
    embed.addFields({
        name: 'Huong dan',
        value: 'Dung `?addmem @user <uid>` de link Discord voi UID'
    });

    return embed;
}

/**
 * Build navigation buttons
 */
function buildButtons(page, totalPages) {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`listid_prev_${page}`)
                .setLabel('Truoc')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`listid_next_${page}`)
                .setLabel('Sau')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1)
        );
    return row;
}

/**
 * Execute listid command
 */
async function execute(message, args) {
    // Get pending IDs from database
    let pendingIds = [];
    try {
        pendingIds = db.db.prepare('SELECT * FROM pending_ids ORDER BY added_at DESC').all();
    } catch (e) {
        // Table might not exist yet
        console.error('Error fetching pending_ids:', e);
    }

    if (pendingIds.length === 0) {
        return message.channel.send('Danh sach cho trong!\nDung `?addid <uid> <ten_game>` de them UID vao danh sach cho.');
    }

    const totalPages = Math.ceil(pendingIds.length / ITEMS_PER_PAGE);
    const embed = buildEmbed(pendingIds, 0, totalPages);
    const buttons = totalPages > 1 ? buildButtons(0, totalPages) : null;

    const messageOptions = { embeds: [embed] };
    if (buttons) messageOptions.components = [buttons];

    await message.channel.send(messageOptions);
}

/**
 * Handle button interaction
 */
async function handleButton(interaction) {
    try {
        const [, action, pageStr] = interaction.customId.split('_');
        let page = parseInt(pageStr) || 0;

        // Get pending IDs from database
        let pendingIds = [];
        try {
            pendingIds = db.db.prepare('SELECT * FROM pending_ids ORDER BY added_at DESC').all();
        } catch (e) {
            console.error('Error fetching pending_ids:', e);
        }

        if (action === 'prev') page--;
        if (action === 'next') page++;

        const totalPages = Math.ceil(pendingIds.length / ITEMS_PER_PAGE) || 1;
        page = Math.max(0, Math.min(page, totalPages - 1));

        const embed = buildEmbed(pendingIds, page, totalPages);
        const buttons = totalPages > 1 ? buildButtons(page, totalPages) : null;

        const updateOptions = { embeds: [embed] };
        if (buttons) updateOptions.components = [buttons];
        else updateOptions.components = [];

        await interaction.update(updateOptions);
    } catch (error) {
        console.error('[listid] Button error:', error);
        await interaction.reply({ content: 'Co loi xay ra!', ephemeral: true }).catch(() => { });
    }
}

module.exports = { execute, handleButton };
