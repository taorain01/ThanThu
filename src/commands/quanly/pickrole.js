const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

// DPS Sub-types config với aliases - tên role KHÔNG có prefix "DPS"
const dpsSubTypes = {
    'quatdu': { name: 'Quạt Dù', color: 0x9B59B6, emoji: '🪭', aliases: ['quat', 'quatdu', 'du', 'qd'] },
    'vodanh': { name: 'Vô Danh', color: 0x3498DB, emoji: '🗡️', aliases: ['vodanh', 'vo danh', 'vd'] },
    'songdao': { name: 'Song Đao', color: 0xE74C3C, emoji: '⚔️', aliases: ['sd', 'song dao', 'songdao'] },
    'cuukiem': { name: 'Cửu Kiếm', color: 0xF39C12, emoji: '🔱', aliases: ['9k', 'cuukiem', 'ck', 'cuu kiem'] }
};

// Helper function: Tìm DPS sub-type từ input
function findDpsSubType(input) {
    if (!input) return null;
    const normalizedInput = input.toLowerCase().trim();

    for (const [key, config] of Object.entries(dpsSubTypes)) {
        if (config.aliases.includes(normalizedInput)) {
            return { key, ...config };
        }
    }
    return null;
}

// Lấy tất cả DPS sub-type role names (không bao gồm "DPS")
function getAllDpsRoleNames() {
    return Object.values(dpsSubTypes).map(config => config.name);
}

// Tạo helper function để xử lý role
async function handleRoleSelection(interaction, roleType, dpsType = null) {
    const member = interaction.member;
    const guild = interaction.guild;

    try {
        // Tên và màu của roles cơ bản
        const roleConfig = {
            'dps': { name: 'DPS', color: 0x0099FF, emoji: '🔵' },
            'healer': { name: 'Healer', color: 0x00FF00, emoji: '🟢' },
            'tanker': { name: 'Tanker', color: 0xFF9900, emoji: '🟠' }
        };

        // Tất cả role names cần xóa (bao gồm cả DPS sub-types)
        const allRoleNames = ['DPS', 'Healer', 'Tanker', ...getAllDpsRoleNames()];

        // Tìm tất cả roles trong server cần xóa
        const rolesToRemove = [];
        for (const roleName of allRoleNames) {
            const role = guild.roles.cache.find(r => r.name === roleName);
            if (role && member.roles.cache.has(role.id)) {
                rolesToRemove.push(role);
            }
        }

        // Xử lý DPS với sub-type - cấp CẢ "DPS" + role sub-type
        if (roleType.toLowerCase() === 'dps' && dpsType) {
            const dpsSubConfig = findDpsSubType(dpsType);
            if (!dpsSubConfig) {
                const validAliases = Object.values(dpsSubTypes).map(c => `**${c.name}**: \`${c.aliases.join(', ')}\``).join('\n');
                return interaction.reply({
                    content: `❌ Loại DPS không hợp lệ!\n\n**Các loại DPS hợp lệ:**\n${validAliases}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            // Tìm hoặc tạo role DPS chính
            let dpsRole = guild.roles.cache.find(r => r.name === 'DPS');
            if (!dpsRole) {
                dpsRole = await guild.roles.create({
                    name: 'DPS',
                    color: 0x0099FF,
                    reason: 'Tạo role DPS cho hệ thống pickrole'
                });
            }

            // Tìm hoặc tạo role sub-type
            let subTypeRole = guild.roles.cache.find(r => r.name === dpsSubConfig.name);
            if (!subTypeRole) {
                subTypeRole = await guild.roles.create({
                    name: dpsSubConfig.name,
                    color: dpsSubConfig.color,
                    reason: `Tạo role ${dpsSubConfig.name} cho hệ thống pickrole`
                });
            }

            // Kiểm tra nếu đã có cả 2 roles
            if (member.roles.cache.has(dpsRole.id) && member.roles.cache.has(subTypeRole.id)) {
                const embed = new EmbedBuilder()
                    .setColor(dpsSubConfig.color)
                    .setTitle(`🔵 Bạn đã có role này rồi!`)
                    .setDescription(`Bạn đã là **DPS ${dpsSubConfig.name}** rồi!`)
                    .setTimestamp();

                return interaction.reply({
                    embeds: [embed],
                    flags: MessageFlags.Ephemeral
                });
            }

            // Xóa các roles cũ (chỉ xóa sub-types, giữ DPS nếu đang chọn DPS)
            const subTypesToRemove = rolesToRemove.filter(r => r.name !== 'DPS');
            if (subTypesToRemove.length > 0) {
                await member.roles.remove(subTypesToRemove);
            }

            // Cấp cả 2 roles
            await member.roles.add([dpsRole, subTypeRole]);

            // Thông báo thành công
            const successEmbed = new EmbedBuilder()
                .setColor(dpsSubConfig.color)
                .setTitle(`🔵 Đã chọn role thành công!`)
                .setDescription(`Bạn đã chọn role **DPS** + **${dpsSubConfig.name}**!` +
                    (subTypesToRemove.length > 0 ? `\n\n*Đã xóa role cũ: ${subTypesToRemove.map(r => r.name).join(', ')}*` : ''))
                .setTimestamp();

            await interaction.reply({
                embeds: [successEmbed],
                flags: MessageFlags.Ephemeral
            });

            // Auto-refresh bangchien embed nếu user đang trong party (CHỈ Thứ 7)
            try {
                const { bangchienNotifications, bangchienRegistrations, getGuildBangchienKeys, getDayFromPartyKey } = require('../../utils/bangchienState');
                const { createBangchienEmbed, createBangchienButtons } = require('../../commands/bangchien/bangchien');

                const guildId = interaction.guild.id;
                const partyKeys = getGuildBangchienKeys(guildId);

                for (const partyKey of partyKeys) {
                    // CHỈ refresh Thứ 7
                    if (getDayFromPartyKey(partyKey) !== 'sat') continue;

                    const registrations = bangchienRegistrations.get(partyKey) || [];
                    const isInParty = registrations.some(r => r.id === member.id);

                    if (isInParty) {
                        const notifData = bangchienNotifications.get(partyKey);
                        if (notifData && notifData.message) {
                            try { await notifData.message.delete(); } catch (e) { }
                            const channel = await interaction.guild.channels.fetch(notifData.channelId).catch(() => null);
                            if (channel) {
                                const newEmbed = createBangchienEmbed(partyKey, notifData.leaderName, interaction.guild);
                                const newRow = createBangchienButtons(partyKey);
                                const newMessage = await channel.send({ embeds: [newEmbed], components: [newRow] });
                                notifData.message = newMessage;
                                notifData.messageId = newMessage.id;
                            }
                        }
                        break;
                    }
                }
            } catch (e) {
                console.error('[pickrole DPS] Lỗi khi refresh bangchien:', e);
            }
            return;
        }

        // Xử lý Healer/Tanker (không thay đổi)
        const selectedRole = roleConfig[roleType.toLowerCase()];
        if (!selectedRole) {
            return interaction.reply({
                content: '❌ Role không hợp lệ! Chọn: dps, healer, hoặc tanker.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Tìm role được chọn
        let targetRole = guild.roles.cache.find(r => r.name === selectedRole.name);

        // Nếu role chưa tồn tại, tạo role mới
        if (!targetRole) {
            targetRole = await guild.roles.create({
                name: selectedRole.name,
                color: selectedRole.color,
                reason: `Tạo role ${selectedRole.name} cho hệ thống pickrole`
            });
        }

        // Kiểm tra nếu đã có role này
        if (member.roles.cache.has(targetRole.id)) {
            const embed = new EmbedBuilder()
                .setColor(selectedRole.color)
                .setTitle(`${selectedRole.emoji} Bạn đã có role này rồi!`)
                .setDescription(`Bạn đã là **${selectedRole.name}** rồi!`)
                .setTimestamp();

            return interaction.reply({
                embeds: [embed],
                flags: MessageFlags.Ephemeral
            });
        }

        // Xóa các roles cũ
        if (rolesToRemove.length > 0) {
            await member.roles.remove(rolesToRemove);
        }

        // Cấp role mới
        await member.roles.add(targetRole);

        // Thông báo thành công
        const successEmbed = new EmbedBuilder()
            .setColor(selectedRole.color)
            .setTitle(`${selectedRole.emoji} Đã chọn role thành công!`)
            .setDescription(`Bạn đã chọn role **${selectedRole.name}**!` +
                (rolesToRemove.length > 0 ? `\n\n*Đã xóa role cũ: ${rolesToRemove.map(r => r.name).join(', ')}*` : ''))
            .setTimestamp();

        await interaction.reply({
            embeds: [successEmbed],
            flags: MessageFlags.Ephemeral
        });

        // Auto-refresh bangchien embed nếu user đang trong party (CHỈ Thứ 7)
        try {
            const { bangchienNotifications, bangchienRegistrations, getGuildBangchienKeys, getDayFromPartyKey } = require('../../utils/bangchienState');
            const { createBangchienEmbed, createBangchienButtons } = require('../../commands/bangchien/bangchien');

            const guildId = interaction.guild.id;
            const userId = interaction.user.id;
            const partyKeys = getGuildBangchienKeys(guildId);

            for (const partyKey of partyKeys) {
                // CHỈ refresh Thứ 7
                if (getDayFromPartyKey(partyKey) !== 'sat') continue;

                const registrations = bangchienRegistrations.get(partyKey) || [];
                const isInParty = registrations.some(r => r.id === userId);

                if (isInParty) {
                    const notifData = bangchienNotifications.get(partyKey);
                    if (notifData && notifData.message) {
                        // Xóa tin nhắn cũ
                        try { await notifData.message.delete(); } catch (e) { }

                        // Gửi tin nhắn mới với role cập nhật - LUÔN dùng channel gốc
                        const channel = await interaction.guild.channels.fetch(notifData.channelId).catch(() => null);
                        if (channel) {
                            const newEmbed = createBangchienEmbed(partyKey, notifData.leaderName, interaction.guild);
                            const newRow = createBangchienButtons(partyKey);
                            const newMessage = await channel.send({ embeds: [newEmbed], components: [newRow] });

                            notifData.message = newMessage;
                            notifData.messageId = newMessage.id;
                        }
                    }
                    break; // Chỉ 1 party mỗi guild
                }
            }
        } catch (e) {
            console.error('[pickrole] Lỗi khi refresh bangchien:', e);
        }

    } catch (error) {
        console.error('Lỗi khi xử lý pickrole:', error);

        // Kiểm tra lỗi phổ biến
        if (error.code === 50013) {
            return interaction.reply({
                content: '❌ Bot không có quyền quản lý roles! Liên hệ admin để cấp quyền "Manage Roles" cho bot.',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.reply({
            content: '❌ Có lỗi xảy ra khi xử lý role. Vui lòng thử lại sau!',
            flags: MessageFlags.Ephemeral
        });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pickrole')
        .setDescription('Chọn role cho bản thân (DPS, Healer, Tanker)')
        .addStringOption(option =>
            option.setName('role')
                .setDescription('Chọn role chính')
                .setRequired(false)
                .addChoices(
                    { name: '🔵 DPS - Sát thương chính', value: 'dps' },
                    { name: '🟢 Healer - Hỗ trợ và hồi máu', value: 'healer' },
                    { name: '🟠 Tanker - Chịu đòn và bảo vệ đội', value: 'tanker' }
                )
        )
        .addStringOption(option =>
            option.setName('dpstype')
                .setDescription('Loại DPS (chỉ dùng khi chọn DPS)')
                .setRequired(false)
                .addChoices(
                    { name: '🪭 Quạt Dù', value: 'quatdu' },
                    { name: '🗡️ Vô Danh', value: 'vodanh' },
                    { name: '⚔️ Song Đao', value: 'songdao' },
                    { name: '🔱 Cửu Kiếm', value: 'cuukiem' }
                )
        ),

    async execute(interaction) {
        const roleChoice = interaction.options.getString('role');
        const dpsTypeChoice = interaction.options.getString('dpstype');

        // Nếu có chọn role trực tiếp
        if (roleChoice) {
            await handleRoleSelection(interaction, roleChoice, dpsTypeChoice);
            return;
        }

        // Không chọn role → Hiển thị menu buttons
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🎮 Chọn Role Của Bạn')
            .setDescription('Chọn một trong các role dưới đây:\n\n' +
                '🟢 **Healer** - Hỗ trợ và hồi máu\n' +
                '🟠 **Tanker** - Chịu đòn và bảo vệ đồng đội\n\n' +
                '**🔵 DPS - Sát thương chính:**\n' +
                '🪭 **Quạt Dù** │ 🗡️ **Vô Danh** │ ⚔️ **Song Đao** │ 🔱 **Cửu Kiếm**\n\n' +
                'ℹ️ *Chọn lại role khác sẽ tự động thay đổi role hiện tại*')
            .setTimestamp()
            .setFooter({ text: 'Chọn role trong game của bạn!' });

        // Row 1: DPS sub-types
        const dpsRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('pickrole_dps_quatdu')
                    .setLabel('Quạt Dù')
                    .setEmoji('🪭')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('pickrole_dps_vodanh')
                    .setLabel('Vô Danh')
                    .setEmoji('🗡️')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('pickrole_dps_songdao')
                    .setLabel('Song Đao')
                    .setEmoji('⚔️')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('pickrole_dps_cuukiem')
                    .setLabel('Cửu Kiếm')
                    .setEmoji('🔱')
                    .setStyle(ButtonStyle.Primary)
            );

        // Row 2: Healer & Tanker
        const otherRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('pickrole_healer')
                    .setLabel('Healer')
                    .setEmoji('🟢')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('pickrole_tanker')
                    .setLabel('Tanker')
                    .setEmoji('🟠')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.reply({
            embeds: [embed],
            components: [dpsRow, otherRow]
        });
    },

    // Export các functions cần thiết
    handleRoleSelection,
    findDpsSubType,
    dpsSubTypes,
    getAllDpsRoleNames
};


