/**
 * ?locmem command - Filter members with LangGia role not in database
 * Usage: ?locmem
 * 
 * Lists all members with @LangGia role who are NOT in:
 * - users table (added via ?addmem)
 * 
 * Allows admin to select members to keep, then removes role from the rest.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const db = require('../../database/db');

// Check if user has high-level role (BC, PBC, KC)
function hasHighLevelRole(member) {
    return member.roles.cache.some(role =>
        role.name === 'Quản Lý' || role.name === 'Kỳ Cựu'
    );
}

/**
 * Execute locmem command
 * @param {Message} message - Discord message
 * @param {Array} args - Command arguments
 */
async function execute(message, args) {
    // Permission check - only BC, PBC, KC
    if (!hasHighLevelRole(message.member)) {
        return message.channel.send('❌ Bạn không có quyền thực hiện lệnh này! Yêu cầu role: **Quản Lý** hoặc **Kỳ Cựu**');
    }

    // Find LangGia role
    const langGiaRole = message.guild.roles.cache.find(r => r.name === 'LangGia');
    if (!langGiaRole) {
        return message.channel.send('❌ Không tìm thấy role **LangGia** trong server!');
    }

    // Get all members with LangGia role
    await message.guild.members.fetch(); // Ensure cache is populated
    const membersWithRole = langGiaRole.members;

    if (membersWithRole.size === 0) {
        return message.channel.send('ℹ️ Không có ai có role **LangGia**!');
    }

    // Get discord_ids of ACTIVE users only (not left)
    // Users with left_at should NOT have LangGia role
    const allUsers = db.getAllUsers();
    const activeDbDiscordIds = new Set(
        allUsers
            .filter(u => !u.left_at) // Chỉ lấy user chưa rời guild
            .map(u => u.discord_id)
    );

    // Filter members not in active database (EXCLUDE BOTS)
    const invalidMembers = [];
    membersWithRole.forEach(member => {
        // Skip bots - they should never be in the filter list
        if (member.user.bot) return;

        if (!activeDbDiscordIds.has(member.id)) {
            invalidMembers.push({
                id: member.id,
                username: member.user.username,
                displayName: member.displayName,
                joinedAt: member.joinedAt
            });
        }
    });

    if (invalidMembers.length === 0) {
        const embed = new EmbedBuilder()
            .setColor(0x00D166)
            .setTitle('✅ Không có thành viên nào cần lọc!')
            .setDescription(`Tất cả ${membersWithRole.size} người có role **LangGia** đều có trong database.`);
        return message.channel.send({ embeds: [embed] });
    }

    // Store pending action in client
    if (!message.client.pendingLocmem) {
        message.client.pendingLocmem = new Map();
    }

    const sessionId = `${message.author.id}_${Date.now()}`;
    const keepList = new Set(); // Members to keep

    message.client.pendingLocmem.set(sessionId, {
        invalidMembers,
        keepList,
        authorId: message.author.id,
        langGiaRoleId: langGiaRole.id,
        page: 0
    });

    // Auto-cleanup after 5 minutes
    setTimeout(() => {
        message.client.pendingLocmem?.delete(sessionId);
    }, 5 * 60 * 1000);

    // Send initial message
    await sendLocmemPage(message, sessionId, 0);
}

/**
 * Send paginated locmem message
 */
async function sendLocmemPage(message, sessionId, page) {
    const data = message.client.pendingLocmem.get(sessionId);
    if (!data) return;

    const { invalidMembers, keepList } = data;
    const itemsPerPage = 10;
    const totalPages = Math.ceil(invalidMembers.length / itemsPerPage);
    const startIdx = page * itemsPerPage;
    const endIdx = Math.min(startIdx + itemsPerPage, invalidMembers.length);
    const pageMembers = invalidMembers.slice(startIdx, endIdx);

    // Build embed
    const embed = new EmbedBuilder()
        .setColor(0xF59E0B)
        .setTitle('⚠️ Lọc thành viên không có trong Database')
        .setDescription([
            `Tìm thấy **${invalidMembers.length}** người có role @LangGia nhưng **không có** trong database.`,
            '',
            `📋 **Danh sách (Trang ${page + 1}/${totalPages}):**`,
            ...pageMembers.map((m, i) => {
                const kept = keepList.has(m.id) ? '✅' : '❌';
                const joinedStr = m.joinedAt ? `<t:${Math.floor(m.joinedAt.getTime() / 1000)}:R>` : 'N/A';
                return `${kept} ${startIdx + i + 1}. <@${m.id}> - ${m.displayName} (vào server ${joinedStr})`;
            }),
            '',
            `🔒 **Giữ lại:** ${keepList.size}/${invalidMembers.length}`,
            '',
            '💡 Dùng menu bên dưới để chọn người **giữ lại** role.'
        ].join('\n'))
        .setFooter({ text: `Session: ${sessionId.split('_')[1]}` });

    // Build select menu for current page members
    const selectOptions = pageMembers.map((m, i) => ({
        label: m.displayName.slice(0, 100),
        description: `@${m.username}`.slice(0, 100),
        value: m.id,
        default: keepList.has(m.id)
    }));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`locmem_select_${sessionId}`)
        .setPlaceholder('Chọn người muốn GIỮ LẠI role...')
        .setMinValues(0)
        .setMaxValues(selectOptions.length)
        .addOptions(selectOptions);

    const selectRow = new ActionRowBuilder().addComponents(selectMenu);

    // Build buttons
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`locmem_prev_${sessionId}`)
            .setLabel('◀️ Trước')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId(`locmem_next_${sessionId}`)
            .setLabel('Sau ▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1),
        new ButtonBuilder()
            .setCustomId(`locmem_confirm_${sessionId}`)
            .setLabel(`🗑️ Xoá role (${invalidMembers.length - keepList.size} người)`)
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`locmem_cancel_${sessionId}`)
            .setLabel('❌ Huỷ')
            .setStyle(ButtonStyle.Secondary)
    );

    // Update data page
    data.page = page;

    const components = [selectRow, buttons];

    // Send or edit message
    if (data.messageId) {
        try {
            const msg = await message.channel.messages.fetch(data.messageId);
            await msg.edit({ embeds: [embed], components });
        } catch (e) {
            const sent = await message.channel.send({ embeds: [embed], components });
            data.messageId = sent.id;
        }
    } else {
        const sent = await message.channel.send({ embeds: [embed], components });
        data.messageId = sent.id;
    }
}

/**
 * Handle interaction for locmem command
 */
async function handleInteraction(interaction) {
    const customId = interaction.customId;

    // Parse customId
    if (customId.startsWith('locmem_select_')) {
        const sessionId = customId.replace('locmem_select_', '');
        const data = interaction.client.pendingLocmem?.get(sessionId);

        if (!data) {
            return interaction.reply({ content: '❌ Phiên làm việc đã hết hạn!', ephemeral: true });
        }

        if (interaction.user.id !== data.authorId) {
            return interaction.reply({ content: '❌ Chỉ người dùng lệnh mới được thao tác!', ephemeral: true });
        }

        // Update keep list based on current page selections
        const selectedIds = interaction.values;
        const pageMembers = data.invalidMembers.slice(
            data.page * 10,
            Math.min((data.page + 1) * 10, data.invalidMembers.length)
        );

        // Clear current page selections first
        pageMembers.forEach(m => data.keepList.delete(m.id));

        // Add newly selected
        selectedIds.forEach(id => data.keepList.add(id));

        // Update the message
        await interaction.deferUpdate();
        await sendLocmemPageFromInteraction(interaction, sessionId, data.page);

    } else if (customId.startsWith('locmem_prev_')) {
        const sessionId = customId.replace('locmem_prev_', '');
        const data = interaction.client.pendingLocmem?.get(sessionId);

        if (!data || interaction.user.id !== data.authorId) {
            return interaction.reply({ content: '❌ Không có quyền!', ephemeral: true });
        }

        await interaction.deferUpdate();
        await sendLocmemPageFromInteraction(interaction, sessionId, data.page - 1);

    } else if (customId.startsWith('locmem_next_')) {
        const sessionId = customId.replace('locmem_next_', '');
        const data = interaction.client.pendingLocmem?.get(sessionId);

        if (!data || interaction.user.id !== data.authorId) {
            return interaction.reply({ content: '❌ Không có quyền!', ephemeral: true });
        }

        await interaction.deferUpdate();
        await sendLocmemPageFromInteraction(interaction, sessionId, data.page + 1);

    } else if (customId.startsWith('locmem_confirm_')) {
        const sessionId = customId.replace('locmem_confirm_', '');
        const data = interaction.client.pendingLocmem?.get(sessionId);

        if (!data) {
            return interaction.reply({ content: '❌ Phiên làm việc đã hết hạn!', ephemeral: true });
        }

        if (interaction.user.id !== data.authorId) {
            return interaction.reply({ content: '❌ Chỉ người dùng lệnh mới được xác nhận!', ephemeral: true });
        }

        await interaction.deferUpdate();

        // Remove role from members not in keepList
        const toRemove = data.invalidMembers.filter(m => !data.keepList.has(m.id));
        const langGiaRole = interaction.guild.roles.cache.get(data.langGiaRoleId);

        let removed = 0;
        let failed = 0;
        const failedNames = [];

        for (const m of toRemove) {
            try {
                const member = await interaction.guild.members.fetch(m.id);
                await member.roles.remove(langGiaRole);
                removed++;
            } catch (e) {
                failed++;
                failedNames.push(m.displayName);
            }
        }

        // Cleanup
        interaction.client.pendingLocmem.delete(sessionId);

        // Result embed
        const resultEmbed = new EmbedBuilder()
            .setColor(removed > 0 ? 0x00D166 : 0xE74C3C)
            .setTitle('🗑️ Đã xoá role LangGia')
            .setDescription([
                `✅ **Đã xoá:** ${removed} người`,
                `🔒 **Giữ lại:** ${data.keepList.size} người`,
                failed > 0 ? `❌ **Lỗi:** ${failed} người (${failedNames.slice(0, 5).join(', ')}${failedNames.length > 5 ? '...' : ''})` : ''
            ].filter(Boolean).join('\n'))
            .setFooter({ text: `Thực hiện bởi ${interaction.user.username}` })
            .setTimestamp();

        await interaction.editReply({ embeds: [resultEmbed], components: [] });

    } else if (customId.startsWith('locmem_cancel_')) {
        const sessionId = customId.replace('locmem_cancel_', '');
        const data = interaction.client.pendingLocmem?.get(sessionId);

        if (!data || interaction.user.id !== data.authorId) {
            return interaction.reply({ content: '❌ Không có quyền!', ephemeral: true });
        }

        interaction.client.pendingLocmem.delete(sessionId);
        await interaction.update({ content: '❌ Đã huỷ thao tác lọc thành viên.', embeds: [], components: [] });
    }
}

/**
 * Helper to send page from interaction context
 */
async function sendLocmemPageFromInteraction(interaction, sessionId, page) {
    const data = interaction.client.pendingLocmem.get(sessionId);
    if (!data) return;

    const { invalidMembers, keepList } = data;
    const itemsPerPage = 10;
    const totalPages = Math.ceil(invalidMembers.length / itemsPerPage);
    const startIdx = page * itemsPerPage;
    const endIdx = Math.min(startIdx + itemsPerPage, invalidMembers.length);
    const pageMembers = invalidMembers.slice(startIdx, endIdx);

    // Build embed
    const embed = new EmbedBuilder()
        .setColor(0xF59E0B)
        .setTitle('⚠️ Lọc thành viên không có trong Database')
        .setDescription([
            `Tìm thấy **${invalidMembers.length}** người có role @LangGia nhưng **không có** trong database.`,
            '',
            `📋 **Danh sách (Trang ${page + 1}/${totalPages}):**`,
            ...pageMembers.map((m, i) => {
                const kept = keepList.has(m.id) ? '✅' : '❌';
                const joinedStr = m.joinedAt ? `<t:${Math.floor(m.joinedAt.getTime() / 1000)}:R>` : 'N/A';
                return `${kept} ${startIdx + i + 1}. <@${m.id}> - ${m.displayName} (vào server ${joinedStr})`;
            }),
            '',
            `🔒 **Giữ lại:** ${keepList.size}/${invalidMembers.length}`,
            '',
            '💡 Dùng menu bên dưới để chọn người **giữ lại** role.'
        ].join('\n'))
        .setFooter({ text: `Session: ${sessionId.split('_')[1]}` });

    // Build select menu for current page members
    const selectOptions = pageMembers.map((m, i) => ({
        label: m.displayName.slice(0, 100),
        description: `@${m.username}`.slice(0, 100),
        value: m.id,
        default: keepList.has(m.id)
    }));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`locmem_select_${sessionId}`)
        .setPlaceholder('Chọn người muốn GIỮ LẠI role...')
        .setMinValues(0)
        .setMaxValues(selectOptions.length)
        .addOptions(selectOptions);

    const selectRow = new ActionRowBuilder().addComponents(selectMenu);

    // Build buttons
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`locmem_prev_${sessionId}`)
            .setLabel('◀️ Trước')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId(`locmem_next_${sessionId}`)
            .setLabel('Sau ▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1),
        new ButtonBuilder()
            .setCustomId(`locmem_confirm_${sessionId}`)
            .setLabel(`🗑️ Xoá role (${invalidMembers.length - keepList.size} người)`)
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`locmem_cancel_${sessionId}`)
            .setLabel('❌ Huỷ')
            .setStyle(ButtonStyle.Secondary)
    );

    // Update data page
    data.page = page;

    await interaction.editReply({ embeds: [embed], components: [selectRow, buttons] });
}

module.exports = { execute, handleInteraction };
