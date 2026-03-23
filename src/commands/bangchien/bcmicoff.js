/**
 * ?bcmicoff / ?tatmic - Tắt mic cho người dùng trong voice BC
 * Khi dùng "all": tắt mic role BC + LangGia, nhưng giữ mic cho Leader & Chỉ Huy
 * Chỉ Kỳ Cựu và Quản Lý được sử dụng
 */

const { EmbedBuilder } = require('discord.js');

const BC_VOICE_CHANNEL_ID = '1451262767603519528';
const ALLOWED_ROLES = ['Kỳ Cựu', 'Quản Lý'];

module.exports = {
    name: 'bcmicoff',
    aliases: ['bcmute', 'bcnomic', 'tatmic'],
    description: 'Tắt mic cho người trong room voice BC',

    async execute(message, args, client) {
        // Kiểm tra quyền
        const hasPermission = ALLOWED_ROLES.some(roleName => {
            const role = message.guild.roles.cache.find(r => r.name === roleName);
            return role && message.member.roles.cache.has(role.id);
        });

        if (!hasPermission) {
            return message.reply('❌ Chỉ **Kỳ Cựu** và **Quản Lý** mới được sử dụng lệnh này!');
        }

        // Lấy voice channel
        const voiceChannel = message.guild.channels.cache.get(BC_VOICE_CHANNEL_ID);
        if (!voiceChannel) {
            return message.reply('❌ Không tìm thấy voice channel BC!');
        }

        // Xử lý ?tatmic all / ?bcmicoff all - tắt mic cho role BC và LangGia, giữ mic leader/chỉ huy
        if (args[0]?.toLowerCase() === 'all') {
            const db = require('../../database/db');
            const guildId = message.guild.id;

            // Lấy danh sách Leader và Chỉ Huy từ tất cả phiên BC đang active
            const exemptUserIds = new Set();
            const activeSessions = db.getActiveBangchienByGuild(guildId);
            for (const session of activeSessions) {
                if (session.leader_id) exemptUserIds.add(session.leader_id);
                if (session.commander_id) exemptUserIds.add(session.commander_id);
                if (session.team1_leader_id) exemptUserIds.add(session.team1_leader_id);
                if (session.team2_leader_id) exemptUserIds.add(session.team2_leader_id);
                if (session.team3_leader_id) exemptUserIds.add(session.team3_leader_id);
                if (session.team4_leader_id) exemptUserIds.add(session.team4_leader_id);
            }

            const BC_ROLE_NAMES = ['bc', 'LangGia'];
            let successRoles = [];
            let failRoles = [];

            for (const roleName of BC_ROLE_NAMES) {
                const role = message.guild.roles.cache.find(r => r.name === roleName);
                if (role) {
                    try {
                        await voiceChannel.permissionOverwrites.edit(role.id, {
                            Speak: false
                        });
                        successRoles.push(roleName);
                    } catch (e) {
                        failRoles.push(roleName);
                    }
                } else {
                    failRoles.push(`${roleName} (không tìm thấy)`);
                }
            }

            // Cấp lại quyền Speak cho Leader & Chỉ Huy (ghi đè permission cá nhân)
            let exemptNames = [];
            for (const userId of exemptUserIds) {
                try {
                    await voiceChannel.permissionOverwrites.edit(userId, {
                        Speak: true,
                        Connect: true
                    });
                    const member = await message.guild.members.fetch(userId).catch(() => null);
                    if (member) exemptNames.push(member.displayName);
                } catch (e) {
                    // Bỏ qua lỗi
                }
            }

            const exemptText = exemptNames.length > 0
                ? `\n🎖️ Giữ mic: ${exemptNames.join(', ')}`
                : '';

            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('🔇 ĐÃ TẮT MIC CHO TẤT CẢ')
                .setDescription(`Đã tắt mic trong voice BC cho các role:\n✅ ${successRoles.join(', ') || 'Không có'}${failRoles.length > 0 ? `\n❌ ${failRoles.join(', ')}` : ''}${exemptText}`)
                .setFooter({ text: `Bởi ${message.author.username}` })
                .setTimestamp();

            await message.reply({ embeds: [embed] });
            console.log(`[bcmicoff] ${message.author.username} tắt mic cho roles: ${successRoles.join(', ')}${exemptNames.length > 0 ? ` | Giữ mic: ${exemptNames.join(', ')}` : ''}`);
            return;
        }

        // Lấy người được mention hoặc ID
        let targetUser = message.mentions.members.first();
        if (!targetUser && args[0]) {
            try {
                targetUser = await message.guild.members.fetch(args[0]);
            } catch (e) {
                return message.reply('❌ Không tìm thấy người dùng!');
            }
        }

        if (!targetUser) {
            return message.reply('❌ Cách dùng:\n`?tatmic @user` - Tắt mic cho 1 người\n`?tatmic all` - Tắt mic tất cả (giữ mic Leader/Chỉ Huy)');
        }

        try {
            // Tắt quyền Speak cho user trong voice channel
            await voiceChannel.permissionOverwrites.edit(targetUser.id, {
                Speak: false
            });

            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('🔇 ĐÃ TẮT MIC')
                .setDescription(`Đã tắt mic cho **${targetUser.displayName}** (<@${targetUser.id}>) trong voice BC.`)
                .setFooter({ text: `Bởi ${message.author.username}` })
                .setTimestamp();

            await message.reply({ embeds: [embed] });

            console.log(`[bcmicoff] ${message.author.username} tắt mic của ${targetUser.user.username}`);

        } catch (error) {
            console.error('[bcmicoff] Lỗi:', error);
            return message.reply('❌ Lỗi khi tắt quyền mic: ' + error.message);
        }
    }
};
