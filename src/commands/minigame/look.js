/**
 * ?look - Xem thông tin chi tiết item
 * ?look <id> - Xem item theo ID số hoặc ID chữ
 */

const { EmbedBuilder } = require('discord.js');
const { getItem, getAllItems } = require('../../utils/itemRegistry');
const economyDb = require('../../database/economy');

async function execute(message, args) {
    const userId = message.author.id;

    // Nếu không có args -> hiện danh sách tất cả items
    if (args.length === 0) {
        const items = getAllItems();

        let description = '**Danh sách vật phẩm trong game:**\n\n';
        for (const item of items) {
            description += `\`${item.numId}\` ${item.icon} **${item.name}** (\`${item.id}\`)\n`;
        }
        description += '\n━━━━━━━━━━━━━━━━━━━━━━';
        description += '\n💡 Dùng `?look <id>` để xem chi tiết';
        description += '\n*Ví dụ: `?look 1` hoặc `?look hat`*';

        const embed = new EmbedBuilder()
            .setColor('#3B82F6')
            .setTitle('📦 Danh Sách Vật Phẩm')
            .setDescription(description)
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    // Tìm item theo ID
    const itemId = args[0];
    const item = getItem(itemId);

    if (!item) {
        return message.reply(`❌ Không tìm thấy vật phẩm với ID \`${itemId}\`!\nDùng \`?look\` để xem danh sách.`);
    }

    // Lấy số lượng người chơi đang có
    const eco = economyDb.getOrCreateEconomy(userId);
    let currentAmount = 'N/A';

    if (item.dbField) {
        if (item.dbField === 'nhua') {
            // Nhựa cần tính regen
            const nhuaInfo = economyDb.getCurrentNhua(userId);
            currentAmount = `${nhuaInfo.current}/${nhuaInfo.max}`;
            if (nhuaInfo.regenTime) {
                currentAmount += ` (đầy trong ${nhuaInfo.regenTime})`;
            }
        } else {
            currentAmount = (eco[item.dbField] || 0).toLocaleString();
        }
    }

    const embed = new EmbedBuilder()
        .setColor('#F59E0B')
        .setTitle(`${item.icon} ${item.name}`)
        .setDescription(item.description)
        .addFields(
            { name: '🆔 ID', value: `\`${item.numId}\` hoặc \`${item.id}\``, inline: true },
            { name: '📊 Bạn đang có', value: `**${currentAmount}**`, inline: true },
            { name: '💡 Cách sử dụng', value: item.usage, inline: false }
        )
        .setFooter({ text: `?look để xem tất cả vật phẩm` })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

module.exports = { execute };


