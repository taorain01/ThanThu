/**
 * ═══════════════════════════════════════════════════════════════════════════
 * pickroleHandlers.js - Handlers cho các nút chọn Role (DPS/Healer/Tanker)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Handlers:
 *   - pickrole_* : Chọn role trong game (DPS, Healer, Tanker, DPS sub-types)
 * 
 * DPS Sub-types:
 *   - pickrole_dps_quatdu   : Quạt Dù
 *   - pickrole_dps_vodanh   : Vô Danh
 *   - pickrole_dps_songdao  : Song Đao
 *   - pickrole_dps_cuukicem : Cửu Kiếm
 * 
 * Được import vào: src/events/client/interactionCreate.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

const { EmbedBuilder, MessageFlags } = require('discord.js');
const { bangchienNotifications, bangchienRegistrations, getGuildBangchienKeys } = require('./bangchienState');
const { createBangchienEmbed, createBangchienButtons } = require('../commands/bangchien/bangchien');

/**
 * Xử lý tất cả button interactions liên quan đến chọn role
 * @param {ButtonInteraction} interaction 
 * @param {Client} client 
 * @returns {boolean} true nếu đã xử lý, false nếu không phải handler này
 */
async function handleButton(interaction, client) {
    const customId = interaction.customId;

    // Chỉ xử lý pickrole buttons
    if (!customId.startsWith('pickrole_')) {
        return false;
    }

    try {
        // Import DPS sub-types config từ pickrole.js
        const { dpsSubTypes, getAllDpsRoleNames } = require('../commands/quanly/pickrole');

        const parts = customId.split('_');
        // Có thể là:
        // - ['pickrole', 'dps', 'quatdu'] hoặc ['pickrole', 'dps', 'quatdu', 'userId'] - DPS sub-type
        // - ['pickrole', 'healer'] hoặc ['pickrole', 'healer', 'userId'] - Healer/Tanker

        let roleType = parts[1]; // 'dps', 'healer', 'tanker'
        let dpsSubType = null;
        let authorizedUserId = null;

        // Xác định nếu là DPS sub-type
        if (roleType === 'dps' && parts.length >= 3) {
            const possibleDpsType = parts[2];
            // Kiểm tra nếu parts[2] là DPS sub-type (không phải userId)
            if (dpsSubTypes[possibleDpsType]) {
                dpsSubType = possibleDpsType;
                authorizedUserId = parts[3]; // userId nếu có
            } else {
                // parts[2] là userId (old format pickrole_dps_userId)
                authorizedUserId = parts[2];
            }
        } else {
            // Healer/Tanker: pickrole_healer hoặc pickrole_healer_userId
            authorizedUserId = parts[2];
        }

        // Kiểm tra quyền: Nếu có userId trong customId (từ prefix), chỉ người đó mới dùng được
        if (authorizedUserId && interaction.user.id !== authorizedUserId) {
            return interaction.reply({
                content: '❌ Chỉ người dùng lệnh mới có thể chọn role!',
                flags: MessageFlags.Ephemeral
            });
        }

        const member = interaction.member;
        const guild = interaction.guild;

        // Tên và màu của roles cơ bản
        let roleConfig = {
            'dps': { name: 'DPS', color: 0x0099FF, emoji: '🔵' },
            'healer': { name: 'Healer', color: 0x00FF00, emoji: '🟢' },
            'tanker': { name: 'Tanker', color: 0xFF9900, emoji: '🟠' }
        };

        // Override nếu là DPS sub-type
        if (roleType === 'dps' && dpsSubType && dpsSubTypes[dpsSubType]) {
            const subConfig = dpsSubTypes[dpsSubType];
            roleConfig['dps'] = { name: subConfig.name, color: subConfig.color, emoji: subConfig.emoji };
        }

        const selectedRole = roleConfig[roleType];

        if (!selectedRole) {
            return interaction.reply({
                content: '❌ Role không hợp lệ!',
                flags: MessageFlags.Ephemeral
            });
        }

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
                .setDescription(`<@${interaction.user.id}> đã là **${selectedRole.name}** rồi!`)
                .setTimestamp()
                .setFooter({ text: 'Dùng ?pr hoặc /pickrole để chọn lại role khác' });

            return interaction.update({
                embeds: [embed],
                components: []
            });
        }

        // Xóa các roles cũ (chỉ xóa sub-types nếu đang chọn DPS)
        if (roleType === 'dps' && dpsSubType) {
            const subTypesToRemove = rolesToRemove.filter(r => r.name !== 'DPS');
            if (subTypesToRemove.length > 0) {
                await member.roles.remove(subTypesToRemove);
            }
        } else if (rolesToRemove.length > 0) {
            await member.roles.remove(rolesToRemove);
        }

        // Cấp role mới - nếu là DPS sub-type thì cấp CẢ 2 role (DPS + sub-type)
        if (roleType === 'dps' && dpsSubType && dpsSubTypes[dpsSubType]) {
            // Tìm hoặc tạo role DPS chính
            let mainDpsRole = guild.roles.cache.find(r => r.name === 'DPS');
            if (!mainDpsRole) {
                mainDpsRole = await guild.roles.create({
                    name: 'DPS',
                    color: 0x0099FF,
                    reason: 'Tạo role DPS cho hệ thống pickrole'
                });
            }
            // Cấp cả DPS + sub-type role
            await member.roles.add([mainDpsRole, targetRole]);
        } else {
            await member.roles.add(targetRole);
        }

        // Thông báo thành công - Cập nhật embed gốc
        const roleDisplayName = (roleType === 'dps' && dpsSubType)
            ? `**DPS** + **${selectedRole.name}**`
            : `**${selectedRole.name}**`;
        const removedRolesText = (roleType === 'dps' && dpsSubType)
            ? rolesToRemove.filter(r => r.name !== 'DPS').map(r => r.name).join(', ')
            : rolesToRemove.map(r => r.name).join(', ');

        const successEmbed = new EmbedBuilder()
            .setColor(selectedRole.color)
            .setTitle(`${selectedRole.emoji} Đã chọn role thành công!`)
            .setDescription(`<@${interaction.user.id}> đã chọn role ${roleDisplayName}!` +
                (removedRolesText ? `\n\n*Đã xóa role cũ: ${removedRolesText}*` : ''))
            .setTimestamp()
            .setFooter({ text: 'Dùng ?pr hoặc /pickrole để chọn lại role khác' });

        await interaction.update({
            embeds: [successEmbed],
            components: []  // Xóa buttons sau khi pick xong
        });

        // Auto-refresh bangchien embed nếu user đang trong party
        try {
            const guildId = interaction.guild.id;
            const userId = interaction.user.id;
            const partyKeys = getGuildBangchienKeys(guildId);
            const db = require('../database/db');
            const { listbcDetailMessages, getDayFromPartyKey } = require('./bangchienState');
            const listbcCommand = require('../commands/bangchien/listbangchien');

            for (const partyKey of partyKeys) {
                const registrations = bangchienRegistrations.get(partyKey) || [];
                const isInParty = registrations.some(r => r.id === userId);

                if (isInParty) {
                    // Refresh ?bc embed
                    const notifData = bangchienNotifications.get(partyKey);
                    if (notifData && notifData.message) {
                        try { await notifData.message.delete(); } catch (e) { }

                        // Lấy channel gốc từ notifData, không dùng interaction.channel
                        const channel = await interaction.guild.channels.fetch(notifData.channelId).catch(() => null);
                        if (channel) {
                            const newEmbed = createBangchienEmbed(partyKey, notifData.leaderName, interaction.guild);
                            const newRow = createBangchienButtons(partyKey);
                            const newMessage = await channel.send({ embeds: [newEmbed], components: [newRow] });

                            notifData.message = newMessage;
                            notifData.messageId = newMessage.id;
                        }
                    }

                    // Refresh ?listbc embed nếu có
                    const day = getDayFromPartyKey(partyKey);
                    if (day) {
                        const listbcKey = `${guildId}_${day}`;
                        const storedData = listbcDetailMessages.get(listbcKey);

                        if (storedData && storedData.message) {
                            const freshSession = db.getActiveBangchienByDay(guildId, day);
                            if (freshSession) {
                                let newEmbed = null;
                                let newComponents = [];

                                const fakeMessage = {
                                    guild: interaction.guild,
                                    channel: interaction.channel,
                                    reply: async (options) => {
                                        newEmbed = options.embeds?.[0];
                                        newComponents = options.components || [];
                                    }
                                };

                                await listbcCommand.showDetailedSession(fakeMessage, freshSession, true, day, true);

                                if (newEmbed) {
                                    try {
                                        await storedData.message.edit({ embeds: [newEmbed], components: newComponents });
                                        console.log(`[pickroleHandlers] Refreshed listbc embed for ${listbcKey}`);
                                    } catch (e) {
                                        listbcDetailMessages.delete(listbcKey);
                                    }
                                }
                            }
                        }
                    }
                    break;
                }
            }
        } catch (e) {
            console.error('[pickroleHandlers] Lỗi khi refresh bangchien:', e);
        }

        return true;

    } catch (error) {
        console.error('[pickroleHandlers] Error:', error);

        // Kiểm tra lỗi phổ biến
        if (error.code === 50013) {
            await interaction.reply({
                content: '❌ Bot không có quyền quản lý roles! Liên hệ admin để cấp quyền "Manage Roles" cho bot.',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '❌ Có lỗi xảy ra khi xử lý role. Vui lòng thử lại sau!',
                flags: MessageFlags.Ephemeral
            });
        }
        return true;
    }
}

module.exports = {
    handleButton
};
