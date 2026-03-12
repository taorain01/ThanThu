/**
 * Lệnh ?serverbot - Hiển thị danh sách server bot đang ở
 * Chỉ owner mới dùng được
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

const OWNER_ID = '395151484179841024';
const SERVERS_PER_PAGE = 10;

async function execute(message, args) {
    // Chỉ owner mới dùng được
    if (message.author.id !== OWNER_ID) {
        return; // Im lặng, không phản hồi
    }

    const guilds = message.client.guilds.cache;
    const totalServers = guilds.size;
    const totalPages = Math.ceil(totalServers / SERVERS_PER_PAGE);

    const page = parseInt(args[0]) || 1;
    const currentPage = Math.min(Math.max(1, page), totalPages);

    await showServerPage(message, currentPage, totalPages, guilds);
}

async function showServerPage(message, page, totalPages, guilds, isUpdate = false, interaction = null) {
    const start = (page - 1) * SERVERS_PER_PAGE;
    const end = start + SERVERS_PER_PAGE;

    const guildArray = [...guilds.values()];
    const pageGuilds = guildArray.slice(start, end);

    let description = '';
    pageGuilds.forEach((guild, index) => {
        const num = start + index + 1;
        description += `**${num}.** ${guild.name}\n`;
        description += `   👥 ${guild.memberCount} members • 🆔 \`${guild.id}\`\n\n`;
    });

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`🌐 Danh sách Server (${guilds.size} servers)`)
        .setDescription(description || 'Không có server nào.')
        .setFooter({ text: `Trang ${page}/${totalPages} • Chọn server bên dưới để tạo invite` })
        .setTimestamp();

    // Navigation buttons
    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`serverbot_prev_${page}`)
            .setEmoji('◀️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 1),
        new ButtonBuilder()
            .setCustomId(`serverbot_page`)
            .setLabel(`${page}/${totalPages}`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`serverbot_next_${page}`)
            .setEmoji('▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages)
    );

    // Server select menu for invite creation
    const selectOptions = pageGuilds.map((guild, index) => ({
        label: guild.name.slice(0, 100),
        description: `${guild.memberCount} members`,
        value: guild.id
    }));

    const components = [navRow];

    if (selectOptions.length > 0) {
        const selectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`serverbot_invite_select_${page}`)
                .setPlaceholder('🔗 Chọn server để tạo invite...')
                .addOptions(selectOptions)
        );
        components.push(selectRow);
    }

    if (isUpdate && interaction) {
        await interaction.update({ embeds: [embed], components });
    } else {
        await message.reply({ embeds: [embed], components });
    }
}

// Handle button interactions
async function handleButton(interaction) {
    if (!interaction.customId.startsWith('serverbot_')) return false;

    // Chỉ owner mới được tương tác
    if (interaction.user.id !== OWNER_ID) {
        await interaction.reply({ content: '❌ Bạn không có quyền!', ephemeral: true });
        return true;
    }

    const parts = interaction.customId.split('_');
    const action = parts[1];
    const currentPage = parseInt(parts[2]) || 1;

    if (action === 'prev' || action === 'next') {
        const newPage = action === 'prev' ? currentPage - 1 : currentPage + 1;

        const guilds = interaction.client.guilds.cache;
        const totalPages = Math.ceil(guilds.size / SERVERS_PER_PAGE);

        await showServerPage(null, newPage, totalPages, guilds, true, interaction);
    }

    return true;
}

// Handle select menu for invite creation
async function handleSelectMenu(interaction) {
    if (!interaction.customId.startsWith('serverbot_invite_select_')) return false;

    // Chỉ owner mới được tương tác
    if (interaction.user.id !== OWNER_ID) {
        await interaction.reply({ content: '❌ Bạn không có quyền!', ephemeral: true });
        return true;
    }

    const guildId = interaction.values[0];
    const guild = interaction.client.guilds.cache.get(guildId);

    if (!guild) {
        await interaction.reply({ content: '❌ Không tìm thấy server!', ephemeral: true });
        return true;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        // Tìm channel có quyền tạo invite
        const channels = guild.channels.cache.filter(
            ch => ch.type === 0 && // Text channel
                ch.permissionsFor(guild.members.me)?.has('CreateInstantInvite')
        );

        if (channels.size === 0) {
            await interaction.editReply({
                content: `❌ Bot không có quyền tạo invite trong server **${guild.name}**!`
            });
            return true;
        }

        const channel = channels.first();
        const invite = await channel.createInvite({
            maxAge: 86400, // 24 hours
            maxUses: 1,
            unique: true
        });

        await interaction.editReply({
            content: `✅ **Invite cho ${guild.name}:**\n` +
                `🔗 ${invite.url}\n` +
                `⏱️ Hết hạn sau 24h • Max uses: 1`
        });

    } catch (error) {
        console.error('[Serverbot] Invite error:', error.message);
        await interaction.editReply({
            content: `❌ Không thể tạo invite: ${error.message}`
        });
    }

    return true;
}

module.exports = {
    execute,
    handleButton,
    handleSelectMenu
};
