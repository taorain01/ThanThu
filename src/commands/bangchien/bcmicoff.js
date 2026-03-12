/**
 * ?bcmicoff - Tắt mic cho người dùng trong voice BC
 * Chỉ Kỳ Cựu và Quản Lý được sử dụng
 */

const { EmbedBuilder, PermissionsBitField } = require('discord.js');

const BC_VOICE_CHANNEL_ID = '1451262767603519528';
const ALLOWED_ROLES = ['Kỳ Cựu', 'Quản Lý'];

module.exports = {
    name: 'bcmicoff',
    aliases: ['bcmute', 'bcnomic'],
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

        // Lấy người được mention hoặc ID
        let targetUser = message.mentions.members.first();
        if (!targetUser && args[0]) {
            try {
                targetUser = await message.guild.members.fetch(args[0]);
            } catch (e) {
                return message.reply('❌ Không tìm thấy người dùng!');
            }
        }

        // Lấy voice channel
        const voiceChannel = message.guild.channels.cache.get(BC_VOICE_CHANNEL_ID);
        if (!voiceChannel) {
            return message.reply('❌ Không tìm thấy voice channel BC!');
        }

        // Xử lý ?bcmicoff all - tắt mic cho role BC và LangGia
        if (args[0]?.toLowerCase() === 'all') {
            const BC_ROLE_NAMES = ['Bang Chiến 30vs30', 'LangGia'];
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

            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('🔇 ĐÃ TẮT MIC CHO TẤT CẢ')
                .setDescription(`Đã tắt mic trong voice BC cho các role:\n✅ ${successRoles.join(', ') || 'Không có'}${failRoles.length > 0 ? `\n❌ ${failRoles.join(', ')}` : ''}`)
                .setFooter({ text: `Bởi ${message.author.username}` })
                .setTimestamp();

            await message.reply({ embeds: [embed] });
            console.log(`[bcmicoff] ${message.author.username} tắt mic cho roles: ${successRoles.join(', ')}`);
            return;
        }

        if (!targetUser) {
            return message.reply('❌ Cách dùng:\n`?bcmicoff @user` - Tắt mic cho 1 người\n`?bcmicoff all` - Tắt mic cho role BC + LangGia');
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
