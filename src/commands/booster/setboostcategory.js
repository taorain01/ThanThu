/**
 * ?setboostcategory <Category ID>
 * Admin only: Set category nơi Boost Room sẽ được tạo
 */

const { EmbedBuilder, ChannelType } = require('discord.js');
const db = require('../../database/db');

async function execute(message, args) {
    // Kiểm tra quyền Quản Lý
    const quanLyRole = message.guild.roles.cache.find(r => r.name === 'Quản Lý');
    const isQuanLy = quanLyRole && message.member.roles.cache.has(quanLyRole.id);
    const isAdmin = message.member.permissions.has('Administrator');

    if (!isQuanLy && !isAdmin) {
        return message.reply('❌ Chỉ **Quản Lý** hoặc **Admin** mới được sử dụng lệnh này!');
    }

    if (args.length === 0) {
        // Hiện category hiện tại
        const currentId = db.getBoostCategoryId(message.guild.id);
        if (currentId) {
            const cat = message.guild.channels.cache.get(currentId);
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#3B82F6')
                    .setTitle('📁 Boost Room Category')
                    .setDescription(`Category hiện tại: **${cat ? cat.name : 'Không tìm thấy'}** (\`${currentId}\`)\n\nDùng \`?setboostcategory <ID>\` để thay đổi.`)
                ]
            });
        }
        return message.reply('❌ Chưa set category!\n**Cách dùng:** `?setboostcategory <Category ID>`');
    }

    const categoryId = args[0];
    const category = message.guild.channels.cache.get(categoryId);

    if (!category || category.type !== ChannelType.GuildCategory) {
        return message.reply('❌ ID không hợp lệ hoặc không phải category!\nCopy ID category (Right click → Copy Channel ID).');
    }

    db.setBoostCategoryId(message.guild.id, categoryId);

    return message.reply({
        embeds: [new EmbedBuilder()
            .setColor('#22C55E')
            .setTitle('✅ Đã set Boost Room Category')
            .setDescription(`Category: **${category.name}** (\`${categoryId}\`)\n\nTất cả Boost Room mới sẽ được tạo trong category này.`)
        ]
    });
}

module.exports = { execute };
