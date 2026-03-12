/**
 * ?daily / ?weekly - Nhận thưởng hàng ngày/tuần
 */

const { EmbedBuilder } = require('discord.js');
const economyDb = require('../../database/economy');

async function execute(message, args, type = 'daily') {
    let result;
    let title, rewardText, baseAmount;

    if (type === 'daily') {
        result = economyDb.claimDaily(message.author.id);
        title = '📅 Daily Reward';
        rewardText = '2,000 🌾';
        baseAmount = 2000;
    } else {
        result = economyDb.claimWeekly(message.author.id);
        title = '📆 Weekly Reward';
        rewardText = '10,000 🌾';
        baseAmount = 10000;
    }

    if (!result.success) {
        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle(`❌ ${title}`)
            .setDescription(result.message)
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    // RARE DROPS: 0.5% chance for each item (matching boss10)
    const rareDrops = [];
    const DROP_RATE = 0.005; // 0.5%

    // Roll for each rare item
    if (Math.random() < DROP_RATE) {
        economyDb.addNhuaCung(message.author.id, 1);
        rareDrops.push('💊 Nhựa Cứng');
    }
    if (Math.random() < DROP_RATE) {
        economyDb.addBlackStone(message.author.id, 1);
        rareDrops.push('🌑 Đá Đen');
    }
    if (Math.random() < DROP_RATE) {
        economyDb.addLcp(message.author.id, 1);
        rareDrops.push('🔥 Lửa Cầu Phúc');
    }
    if (Math.random() < DROP_RATE) {
        economyDb.addDaT1KhacAn(message.author.id, 1);
        rareDrops.push('💠 Tinh Thể Vàng');
    }
    if (Math.random() < DROP_RATE) {
        economyDb.addThachAmKhacAn(message.author.id, 1);
        rareDrops.push('🔷 Thạch Âm Vàng');
    }
    if (Math.random() < DROP_RATE) {
        economyDb.addLcpcl(message.author.id, 1);
        rareDrops.push('🔥 LCP Cỡ Lớn');
    }
    if (Math.random() < DROP_RATE) {
        economyDb.addBuaKhacYeu(message.author.id, 1);
        rareDrops.push('📜 Bùa Khắc Yêu');
    }

    const eco = economyDb.getOrCreateEconomy(message.author.id);

    let description = `Bạn đã nhận **${rewardText}**!`;

    if (rareDrops.length > 0) {
        description += '\n\n🎁 **RARE DROP!**\n' + rareDrops.map(item => `+1 ${item}`).join('\n');
    }

    const embed = new EmbedBuilder()
        .setColor(rareDrops.length > 0 ? 0xF1C40F : 0x2ECC71)
        .setTitle(`✅ ${title}`)
        .setDescription(description)
        .addFields(
            { name: '💰 Số dư hiện tại', value: `${eco.hat.toLocaleString()} 🌾`, inline: true }
        )
        .setFooter({ text: rareDrops.length > 0 ? '✨ May mắn! Nhận được item hiếm!' : '0.5% tỉ lệ nhận rare item' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

// Wrapper functions
async function executeDaily(message, args) {
    return execute(message, args, 'daily');
}

async function executeWeekly(message, args) {
    return execute(message, args, 'weekly');
}

module.exports = {
    execute: executeDaily,
    executeDaily,
    executeWeekly
};


