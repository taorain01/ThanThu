const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { assignEventRole, removeEventRole } = require('../../utils/roleManager');

// Mapping alias -> roleType
const roleAliases = {
    'yentiec': 'YenTiec',
    'yt': 'YenTiec',
    'pvpsolo': 'PvpSolo',
    'pvp': 'PvpSolo',
    'ps': 'PvpSolo',
    'bosssolo': 'BossSolo',
    'boss': 'BossSolo',
    'bs': 'BossSolo',
    'bangchien': 'BangChien',
    'bc': 'BangChien',
    'all': 'AllEvents',
    'tatca': 'AllEvents',
    'remove': 'RemoveAll',
    'xoa': 'RemoveAll',
    'huy': 'RemoveAll'
};

// Role info for display
const roleInfo = {
    'YenTiec': { name: 'Yến Tiệc (@yt)', emoji: '🎉' },
    'PvpSolo': { name: 'PvP Solo (@ps)', emoji: '🏆' },
    'BossSolo': { name: 'Boss Solo (@bs)', emoji: '⚔️' },
    'BangChien': { name: 'Bang Chiến (@bc)', emoji: '⚔️' },
    'AllEvents': { name: 'Tất cả event', emoji: '🌟' },
    'RemoveAll': { name: 'Hủy tất cả nhắc nhở', emoji: '🔕' }
};

module.exports = {
    name: 'nhacnho',
    aliases: ['nn', 'remind'],
    description: 'Đăng ký nhận nhắc nhở event Guild',

    async execute(message, args, client) {
        const member = message.member;

        // Nếu không có argument -> hiển thị select menu
        if (!args.length) {
            const menu = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('event_role_select')
                        .setPlaceholder('Chọn event bạn muốn nhận nhắc nhở...')
                        .addOptions(
                            {
                                label: 'Nhắc nhở Boss Solo',
                                description: 'Nhận thông báo khi có Boss Solo (role @bs)',
                                value: 'BossSolo',
                                emoji: '⚔️'
                            },
                            {
                                label: 'Nhắc nhở PvP Solo',
                                description: 'Nhận thông báo khi có PvP Solo (role @ps)',
                                value: 'PvpSolo',
                                emoji: '🏆'
                            },
                            {
                                label: 'Nhắc nhở Yến Tiệc',
                                description: 'Nhận thông báo khi có Yến Tiệc (role @yt)',
                                value: 'YenTiec',
                                emoji: '🎉'
                            },
                            // BangChien option removed - BC registration handled by separate ?bc command
                            {
                                label: 'Nhắc nhở TOÀN BỘ event',
                                description: 'Nhận thông báo cho tất cả event Guild',
                                value: 'AllEvents',
                                emoji: '🌟'
                            },
                            {
                                label: 'Huỷ TOÀN BỘ nhắc nhở event',
                                description: 'Xóa tất cả role nhắc nhở (@bs, @ps, @yt)',
                                value: 'RemoveAll',
                                emoji: '🔕'
                            }
                        )
                );

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🔔 Đăng ký nhắc nhở Event Guild')
                .setDescription('Chọn event bạn muốn nhận thông báo nhắc nhở từ menu bên dưới.')
                .setFooter({ text: 'Menu này sẽ hết hạn sau 60 giây' })
                .setTimestamp();

            return message.reply({ embeds: [embed], components: [menu] });
        }

        // Có argument -> xử lý trực tiếp
        const input = args[0].toLowerCase();
        const roleType = roleAliases[input];

        if (!roleType) {
            return message.reply({
                content: `❌ Không tìm thấy event \`${input}\`!\n\n**Event hợp lệ:** \`yt\`, \`ps\`, \`bs\`, \`bc\`, \`all\`, \`remove\``,
                allowedMentions: { repliedUser: false }
            });
        }

        try {
            let result;
            if (roleType === 'RemoveAll') {
                result = await removeEventRole(member, 'AllEvents');
            } else {
                result = await assignEventRole(member, roleType);
            }

            const info = roleInfo[roleType];
            const embed = new EmbedBuilder()
                .setColor(result.success ? 0x00FF00 : 0xFF0000)
                .setTitle(`${info.emoji} ${result.success ? 'Thành công!' : 'Lỗi'}`)
                .setDescription(result.message)
                .setTimestamp();

            return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });

        } catch (error) {
            console.error('[nhacnho] Lỗi:', error);
            return message.reply({
                content: '❌ Có lỗi xảy ra khi xử lý. Vui lòng thử lại sau!',
                allowedMentions: { repliedUser: false }
            });
        }
    }
};
