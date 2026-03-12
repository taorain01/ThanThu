/**
 * ?bcmicreset - Reset tất cả quyền mic trong voice BC
 * Chỉ Kỳ Cựu và Quản Lý được sử dụng
 */

const { EmbedBuilder, PermissionsBitField } = require('discord.js');

const BC_VOICE_CHANNEL_ID = '1451262767603519528';
const ALLOWED_ROLES = ['Kỳ Cựu', 'Quản Lý'];

module.exports = {
    name: 'bcmicreset',
    aliases: ['bcresetmic', 'bcmicresetall'],
    description: 'Reset tất cả quyền mic trong room voice BC',

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

        try {
            // Lấy tất cả permission overwrites cho users (không phải roles)
            const userOverwrites = voiceChannel.permissionOverwrites.cache.filter(
                overwrite => overwrite.type === 1 // type 1 = member
            );

            let resetCount = 0;
            const resetUsers = [];

            // Xóa tất cả permission overwrites của users
            for (const [id, overwrite] of userOverwrites) {
                try {
                    // Xóa permission overwrite (reset về mặc định)
                    await overwrite.delete();
                    resetCount++;

                    // Lấy username nếu có thể
                    try {
                        const member = await message.guild.members.fetch(id);
                        resetUsers.push(member.displayName);
                    } catch (e) {
                        resetUsers.push(`ID: ${id}`);
                    }
                } catch (e) {
                    console.error(`[bcmicreset] Lỗi reset user ${id}:`, e.message);
                }
            }

            const embed = new EmbedBuilder()
                .setColor(0xFFD700)
                .setTitle('🔄 ĐÃ RESET MIC')
                .setDescription(
                    resetCount > 0
                        ? `Đã reset quyền mic cho **${resetCount}** người trong voice BC.\n\n**Danh sách:**\n${resetUsers.slice(0, 20).join(', ')}${resetUsers.length > 20 ? `\n...và ${resetUsers.length - 20} người khác` : ''}`
                        : 'Không có quyền mic cá nhân nào cần reset.'
                )
                .setFooter({ text: `Bởi ${message.author.username}` })
                .setTimestamp();

            await message.reply({ embeds: [embed] });

            console.log(`[bcmicreset] ${message.author.username} reset mic ${resetCount} người`);

        } catch (error) {
            console.error('[bcmicreset] Lỗi:', error);
            return message.reply('❌ Lỗi khi reset quyền mic: ' + error.message);
        }
    }
};
