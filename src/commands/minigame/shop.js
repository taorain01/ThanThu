/**
 * ?shop - Hiển thị shop (mua)
 * ?sell - Mở trang bán
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const economyDb = require('../../database/economy');
const ICONS = require('../../config/icons');

const SHOP_ITEMS = {
    box: {
        id: 1,
        name: '📦 Box Tier 1',
        price: 100,
        currency: 'hat',
        description: 'Mở ra 1 trang bị Tier 1'
    },
    lcp: {
        id: 3,
        name: '🔥 Lửa Cầu Phúc',
        price: 10000,
        currency: 'hat',
        description: '+100% tỉ lệ Vàng từ Box (3h)'
    }
};

// Tạo embed Mua
function createBuyEmbed(eco, userId) {
    // Đếm đồ vàng chưa mặc
    const items = economyDb.getUserEquipment(userId);
    const goldCount = items.filter(i => i.rarity === 'gold' && !i.is_equipped).length;

    // Tính giá slot
    const slotPurchaseCount = economyDb.getSlotPurchaseCount(userId);
    const slotPrice = economyDb.getSlotPrice(slotPurchaseCount);
    const currentSlots = economyDb.getInvSlots(userId);

    return new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('🛒 SHOP - MUA')
        .setDescription('Dùng `?buy <id> [số lượng]` để mua')
        .addFields(
            {
                name: '`[1]` 📦 Box Tier 1',
                value: '> 🌾 **100 Hạt**\n> Mở ra 1 trang bị T1',
                inline: true
            },
            {
                name: `\`[2]\` ${ICONS.rarity.gold} Mua Đồ Vàng`,
                value: `> Phí: **3 đồ Vàng**\n> Bạn có: **${goldCount}** ${ICONS.rarity.gold}`,
                inline: true
            },
            {
                name: '`[3]` 🔥 Lửa Cầu Phúc',
                value: `> 🌾 **10.000 Hạt**\n> +100% Vàng Box | +5% Vàng Dung (3h)`,
                inline: true
            },
            {
                name: '`[4]` 🌑 Đá Đen',
                value: `> 💎 **200 Đá T1**\n> Chuyển 1 dòng vàng (40%)`,
                inline: true
            },
            {
                name: '`[5]` 🎒 Mở Rộng Kho',
                value: `> 🌾 **${slotPrice.toLocaleString()} Hạt**\n> +100 slot (có: ${currentSlots})`,
                inline: true
            },
            {
                name: '┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄',
                value: `🌾 **${eco.hat.toLocaleString()}** | 💎 **${(eco.enhancement_stone_t1 || 0).toLocaleString()}** | 🌑 **${eco.black_stone_empty || 0}**`,
                inline: false
            }
        )
        .setFooter({ text: '?buy 1-5 hoặc ?b 1-5 • Giá slot: 5k→10k→20k theo lần mua' })
        .setTimestamp();
}

// Tạo embed Bán
function createSellEmbed(eco) {
    // Đếm đồ tím
    const purpleCount = eco.purple_count || 0;

    return new EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle('💰 SHOP - BÁN')
        .setDescription('Dùng `?sell <id> [số lượng]` để bán')
        .addFields(
            {
                name: '`[1]` 🔮 Bán Thạch Âm',
                value: `> 1 cục → **5,000 Hạt**\n> Bạn có: **${eco.thach_am}** cục`,
                inline: true
            },
            {
                name: `\`[2]\` ${ICONS.rarity.purple} Bán Đồ Tím`,
                value: `> Theo Mastery (max **150 Hạt**/món)\n> Bán ngẫu nhiên từ kho`,
                inline: true
            },
            {
                name: '┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄',
                value: `🌾 Hạt: **${eco.hat.toLocaleString()}** | 🔮 Thạch Âm: **${eco.thach_am}**`,
                inline: false
            }
        )
        .setFooter({ text: '?sell 1 5 (bán 5 Thạch Âm) • ?sell 2 10 (bán 10 đồ Tím)' })
        .setTimestamp();
}

// Tạo navigation buttons
function createShopButtons(currentTab, userId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`shop_buy_${userId}`)
            .setLabel('🛒 Mua')
            .setStyle(currentTab === 'buy' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(currentTab === 'buy'),
        new ButtonBuilder()
            .setCustomId(`shop_sell_${userId}`)
            .setLabel('💰 Bán')
            .setStyle(currentTab === 'sell' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(currentTab === 'sell')
    );
}

async function execute(message, args) {
    const userId = message.author.id;
    const eco = economyDb.getOrCreateEconomy(userId);

    let currentTab = 'buy';

    const embed = createBuyEmbed(eco, userId);
    const buttons = createShopButtons(currentTab, userId);

    const reply = await message.reply({ embeds: [embed], components: [buttons] });

    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === userId,
        time: 60000
    });

    collector.on('collect', async (interaction) => {
        const freshEco = economyDb.getOrCreateEconomy(userId);

        if (interaction.customId === `shop_buy_${userId}`) {
            currentTab = 'buy';
            await interaction.update({
                embeds: [createBuyEmbed(freshEco, userId)],
                components: [createShopButtons(currentTab, userId)]
            });
        } else if (interaction.customId === `shop_sell_${userId}`) {
            currentTab = 'sell';
            await interaction.update({
                embeds: [createSellEmbed(freshEco)],
                components: [createShopButtons(currentTab, userId)]
            });
        }
    });

    collector.on('end', async () => {
        try { await reply.edit({ components: [] }); } catch (e) { }
    });
}

// Lệnh ?sell mở thẳng trang bán
async function executeSell(message, args) {
    const userId = message.author.id;
    const eco = economyDb.getOrCreateEconomy(userId);

    let currentTab = 'sell';

    const embed = createSellEmbed(eco);
    const buttons = createShopButtons(currentTab, userId);

    const reply = await message.reply({ embeds: [embed], components: [buttons] });

    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === userId,
        time: 60000
    });

    collector.on('collect', async (interaction) => {
        const freshEco = economyDb.getOrCreateEconomy(userId);

        if (interaction.customId === `shop_buy_${userId}`) {
            currentTab = 'buy';
            await interaction.update({
                embeds: [createBuyEmbed(freshEco, userId)],
                components: [createShopButtons(currentTab, userId)]
            });
        } else if (interaction.customId === `shop_sell_${userId}`) {
            currentTab = 'sell';
            await interaction.update({
                embeds: [createSellEmbed(freshEco)],
                components: [createShopButtons(currentTab, userId)]
            });
        }
    });

    collector.on('end', async () => {
        try { await reply.edit({ components: [] }); } catch (e) { }
    });
}

module.exports = { execute, executeSell, SHOP_ITEMS, createSellEmbed, createBuyEmbed };


