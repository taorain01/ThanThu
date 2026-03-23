const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { weeklyNotifications, dayNames } = require('../../utils/notificationState');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('listthongbao')
        .setDescription('Xem danh sách thông báo của server'),

    async execute(interaction) {
        // Lấy tất cả notifications của guild này, tương tự thongbaoguild.js
        const guildId = interaction.guild.id;
        const allNotifications = [];
        let index = 1;

        for (const [id, notification] of weeklyNotifications) {
            if (notification.guildId === guildId) {
                allNotifications.push({ index, id, ...notification });
                index++;
            }
        }

        if (allNotifications.length === 0) {
            return interaction.reply({
                content: '📭 Server chưa có thông báo nào!'
            });
        }

        // Phân loại notifications
        const guildNotifications = allNotifications.filter(n => n.isGuildMission);
        const regularNotifications = allNotifications.filter(n => !n.isGuildMission);

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📋 Danh sách thông báo server')
            .setDescription(`Server có **${allNotifications.length}** thông báo`)
            .setTimestamp()
            .setFooter({ text: '/huythongbao <số> để hủy | /suathongbao <số> để sửa' });

        // Hiển thị Guild notifications trước (nổi bật)
        if (guildNotifications.length > 0) {
            embed.addFields({
                name: '⭐ Thông báo Guild',
                value: '━━━━━━━━━━━━━━━━',
                inline: false
            });

            // Group theo loại mission (Yến Tiệc trên cùng)
            const missionTypes = ['YenTiec', 'BossSolo', 'PvpSolo', 'BangChien'];
            const missionLabels = {
                'YenTiec': '🎉 Yến Tiệc',
                'BossSolo': '⚔️ Boss Solo',
                'PvpSolo': '🏆 PvP Solo',
                'BangChien': '🏰 bc'
            };

            let addedSeparator = false;
            for (const missionType of missionTypes) {
                const missionNotifs = guildNotifications.filter(n => n.missionType === missionType);
                if (missionNotifs.length > 0) {
                    // Thêm separator nếu không phải loại đầu tiên
                    if (addedSeparator) {
                        embed.addFields({
                            name: '\u200B',
                            value: '────────────────',
                            inline: false
                        });
                    }
                    addedSeparator = true;

                    for (const notification of missionNotifs) {
                        const timeStr = `${notification.hours.toString().padStart(2, '0')}h${notification.minutes.toString().padStart(2, '0')}`;
                        let scheduleInfo;
                        if (notification.isDaily) {
                            scheduleInfo = `Mỗi ngày lúc ${timeStr}`;
                        } else {
                            scheduleInfo = `${dayNames[notification.thu]} lúc ${timeStr}`;
                        }

                        embed.addFields({
                            name: `#${notification.index} - ${missionLabels[missionType]}`,
                            value: scheduleInfo,
                            inline: true
                        });
                    }
                }
            }
        }

        // Hiển thị Regular notifications (dưới)
        if (regularNotifications.length > 0) {
            embed.addFields({
                name: '📌 Thông báo khác',
                value: '━━━━━━━━━━━━━━━━',
                inline: false
            });

            for (const notification of regularNotifications) {
                const timeStr = `${notification.hours.toString().padStart(2, '0')}h${notification.minutes.toString().padStart(2, '0')}`;

                let scheduleInfo;
                let typeLabel;

                if (notification.isOneTime) {
                    const dateStr = `${notification.day.toString().padStart(2, '0')}/${notification.month.toString().padStart(2, '0')}/${notification.year}`;
                    scheduleInfo = `${dateStr} lúc ${timeStr}`;
                    typeLabel = '🔔 Một lần';
                } else {
                    scheduleInfo = `${dayNames[notification.thu]} lúc ${timeStr}`;
                    typeLabel = '🔄 Hàng tuần';
                }

                embed.addFields({
                    name: `#${notification.index} - ${typeLabel}`,
                    value: scheduleInfo,
                    inline: true
                });
            }
        }

        await interaction.reply({ embeds: [embed] });
    }
};


