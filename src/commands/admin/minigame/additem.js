/**
 * ?add - Add items to user (Admin only)
 * ?add @user <item> <amount> - Add to mentioned user
 * ?add <item> <amount> - Add to self
 */

const { EmbedBuilder } = require('discord.js');
const { getItem } = require('../../../utils/itemRegistry');
const economyDb = require('../../../database/economy');

// Owner ID - only this person can use the command
const OWNER_ID = '395151484179841024'; // User's ID

async function execute(message, args) {
    // Check permission
    if (message.author.id !== OWNER_ID) {
        return message.reply('❌ Bạn không có quyền sử dụng lệnh này!');
    }

    if (args.length < 2) {
        return message.reply('❌ Cú pháp: `.add @user <item> <số lượng>` hoặc `.add <item> <số lượng>`\nVí dụ: `.add @Rain tinhthevang 5` hoặc `.add boxt1 10`');
    }

    let targetUser = message.author;
    let itemArg, amountArg;

    // Check if first arg is a mention
    if (message.mentions.users.size > 0) {
        targetUser = message.mentions.users.first();
        itemArg = args[1];
        amountArg = args[2];
    } else {
        itemArg = args[0];
        amountArg = args[1];
    }

    // Special case: slot (không cần qua itemRegistry)
    if (itemArg.toLowerCase() === 'slot') {
        const amount = parseInt(amountArg);
        if (isNaN(amount) || amount <= 0) {
            return message.reply('❌ Số lượng phải là số dương!');
        }

        const userId = targetUser.id;
        economyDb.addInvSlots(userId, amount);
        const newAmount = economyDb.getInvSlots(userId);

        const isSelf = targetUser.id === message.author.id;
        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
            .setColor('#22C55E')
            .setTitle('✅ Thêm Slot Kho Thành Công')
            .setDescription(`📦 **Slot Kho** +${amount.toLocaleString()}`)
            .addFields(
                { name: '👤 Người nhận', value: isSelf ? 'Bạn' : `<@${targetUser.id}>`, inline: true },
                { name: '📊 Slot hiện tại', value: `**${newAmount.toLocaleString()}**`, inline: true }
            )
            .setFooter({ text: `Admin: ${message.author.username}` })
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    // Validate item
    const item = getItem(itemArg);
    if (!item) {
        return message.reply(`❌ Không tìm thấy item \`${itemArg}\`!\nDùng \`.look\` để xem danh sách items.\n💡 Hoặc dùng \`?add slot <số>\` để thêm slot kho.`);
    }

    // Validate amount
    const amount = parseInt(amountArg);
    if (isNaN(amount) || amount <= 0) {
        return message.reply('❌ Số lượng phải là số dương!');
    }

    // Add item based on type
    const userId = targetUser.id;
    let success = false;
    let newAmount = 0;

    switch (item.dbField) {
        case 'hat':
            economyDb.addHat(userId, amount);
            success = true;
            newAmount = economyDb.getOrCreateEconomy(userId).hat;
            break;
        case 'enhancement_stone_t1':
            economyDb.addStoneT1(userId, amount);
            success = true;
            newAmount = economyDb.getOrCreateEconomy(userId).enhancement_stone_t1;
            break;
        case 'thach_am':
            economyDb.addThachAm(userId, amount);
            success = true;
            newAmount = economyDb.getOrCreateEconomy(userId).thach_am;
            break;
        case 'boxes_t1':
            economyDb.addBoxesT1(userId, amount);
            success = true;
            newAmount = economyDb.getOrCreateEconomy(userId).boxes_t1;
            break;
        case 'nhua_cung':
            economyDb.addNhuaCung(userId, amount);
            success = true;
            newAmount = economyDb.getOrCreateEconomy(userId).nhua_cung;
            break;
        case 'da_t1_khac_an':
            economyDb.addDaT1KhacAn(userId, amount);
            success = true;
            newAmount = economyDb.getOrCreateEconomy(userId).da_t1_khac_an;
            break;
        case 'thach_am_khac_an':
            economyDb.addThachAmKhacAn(userId, amount);
            success = true;
            newAmount = economyDb.getOrCreateEconomy(userId).thach_am_khac_an;
            break;
        case 'lcp':
            economyDb.addLcp(userId, amount);
            success = true;
            newAmount = economyDb.getOrCreateEconomy(userId).lcp;
            break;
        case 'lcpcl':
            economyDb.addLcpcl(userId, amount);
            success = true;
            newAmount = economyDb.getOrCreateEconomy(userId).lcpcl;
            break;
        case 'nhua':
            // Special case: add nhua directly
            const eco = economyDb.getOrCreateEconomy(userId);
            const currentNhua = economyDb.getCurrentNhua(userId).current;
            const newNhua = Math.min(economyDb.MAX_NHUA, currentNhua + amount);
            economyDb.db.prepare('UPDATE economy SET nhua = ?, nhua_updated_at = ? WHERE discord_id = ?')
                .run(newNhua, new Date().toISOString(), userId);
            success = true;
            newAmount = newNhua;
            break;
        case 'slot':
            // Add inventory slots
            economyDb.addInvSlots(userId, amount);
            success = true;
            newAmount = economyDb.getOrCreateEconomy(userId).inv_slots || 500;
            break;
        case 'bua_khac_yeu':
            economyDb.addBuaKhacYeu(userId, amount);
            success = true;
            newAmount = economyDb.getOrCreateEconomy(userId).bua_khac_yeu || 0;
            break;
        case 'black_stone_empty':
            economyDb.addBlackStone(userId, amount);
            success = true;
            newAmount = economyDb.getOrCreateEconomy(userId).black_stone_empty || 0;
            break;
        default:
            return message.reply(`❌ Item **${item.name}** không thể thêm được!`);
    }

    if (success) {
        const isSelf = targetUser.id === message.author.id;
        const embed = new EmbedBuilder()
            .setColor('#22C55E')
            .setTitle('✅ Thêm Item Thành Công')
            .setDescription(`${item.icon} **${item.name}** x${amount}`)
            .addFields(
                { name: '👤 Người nhận', value: isSelf ? 'Bạn' : `<@${targetUser.id}>`, inline: true },
                { name: '📊 Số lượng hiện tại', value: `**${newAmount.toLocaleString()}**`, inline: true }
            )
            .setFooter({ text: `Admin: ${message.author.username}` })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    }
}

module.exports = { execute };


