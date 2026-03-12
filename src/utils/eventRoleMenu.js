const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

/**
 * Tạo Select Menu để user đăng ký nhận role nhắc nhở event
 */
function createEventRoleMenu() {
    const menu = new ActionRowBuilder()
        .addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('event_role_select')
                .setPlaceholder('Đăng ký nhận nhắc nhở cho event sau...')
                .addOptions(
                    {
                        label: 'Nhắc nhở Boss Solo',
                        description: 'Nhận thông báo khi có Boss Solo (Breaking Army)',
                        value: 'BossSolo',
                        emoji: '⚔️'
                    },
                    {
                        label: 'Nhắc nhở PvP Solo',
                        description: 'Nhận thông báo khi có PvP Solo (Test Your Skill)',
                        value: 'PvpSolo',
                        emoji: '🏆'
                    },
                    {
                        label: 'Nhắc nhở Yến Tiệc',
                        description: 'Nhận thông báo khi có Yến Tiệc (Guild Party)',
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
                        description: 'Xóa tất cả role nhắc nhở (Boss @bs, PvP @ps, Yến Tiệc @yt)',
                        value: 'RemoveAll',
                        emoji: '🔕'
                    }
                )
        );

    return menu;
}

module.exports = { createEventRoleMenu };


