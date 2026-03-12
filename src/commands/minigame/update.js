/**
 * ?update - Hiển thị các cập nhật mới của bot
 */

const { EmbedBuilder } = require('discord.js');

const UPDATES = [
    {
        version: '12.01.2026',
        name: 'Thêm Đá Đen & Bulk Tune',
        changes: [
            '🌑 **Đá Đen** - Hệ thống truyền dòng mới',
            '  • `?td <id>` / `?daden` - Truyền dòng 40% thành công',
            '  • Chi phí tăng 1.5x mỗi lần truyền cùng dòng',
            '  • Mua: `?buy 4` hoặc `?buy daden` (200 Đá T1)',
            '',
            '⚡ **Bulk Tune** - Tune nhiều đồ cùng lúc',
            '  • `?tune 1-10` - Tune 1-10 đồ lên 5 dòng',
            '  • `?tune all` - Tune tất cả đồ vàng chưa full',
            '',
            '📦 **Slot Kho Động**',
            '  • Giới hạn kho có thể tăng (mặc định 500)',
            '  • Bỏ giới hạn mua 100 box/lần',
            '',
            '🎒 **Lệnh mới**',
            '  • `?dd`, `?truyen` - Alias truyền dòng',
            '  • `?u` - Alias cho `?use`'
        ]
    },
    {
        version: '11.01.2026',
        name: 'Tối Ưu Hóa',
        changes: [
            '🔧 Các tính năng cơ bản đã ổn định',
            '📊 Hệ thống Mastery và Tune',
            '🏰 Dungeon Solo/Coop/Boss',
            '📋 Daily/Weekly Quests'
        ]
    }
];

async function execute(message, args) {
    const latestUpdate = UPDATES[0];

    const embed = new EmbedBuilder()
        .setColor('#3B82F6')
        .setTitle(`📋 Cập Nhật Bot - v${latestUpdate.version}`)
        .setDescription(`**${latestUpdate.name}**\n\n${latestUpdate.changes.join('\n')}`)
        .setFooter({ text: `Dùng ?help để xem danh sách lệnh` })
        .setTimestamp();

    // Thêm lịch sử cập nhật trước đó
    if (UPDATES.length > 1) {
        const previousUpdates = UPDATES.slice(1, 3).map(u =>
            `**v${u.version}** - ${u.name}`
        ).join('\n');

        embed.addFields({
            name: '📜 Lịch sử cập nhật',
            value: previousUpdates,
            inline: false
        });
    }

    return message.reply({ embeds: [embed] });
}

module.exports = { execute };
