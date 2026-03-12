/**
 * ?box - Xem số box và mở box
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const economyDb = require('../../database/economy');
const { createBoxOpenUI, openBoxesAnimated, openBoxesInstant } = require('../../utils/boxOpening');

async function execute(message, args) {
    const userId = message.author.id;
    const eco = economyDb.getOrCreateEconomy(userId);
    const boxCount = eco.boxes_t1 || 0;

    // Quick buy: ?box <số_lượng> - Mua và mở nhanh
    const quickBuyQty = parseInt(args[0]);
    if (!isNaN(quickBuyQty) && quickBuyQty > 0) {
        const cost = 100 * quickBuyQty;

        if (eco.hat < cost) {
            return message.reply(`❌ Không đủ Hạt! Cần **${cost.toLocaleString()}** 🌾, bạn có **${eco.hat.toLocaleString()}** 🌾`);
        }

        // Check inventory space
        const maxInv = economyDb.getInvSlots(userId);
        const currentEquip = economyDb.countUserEquipment(userId);
        const freeSlots = maxInv - currentEquip;

        if (freeSlots < quickBuyQty) {
            return message.reply(`❌ Không đủ chỗ trong kho! Cần **${quickBuyQty}** slot trống, bạn có **${freeSlots}** slot.\n💡 Dùng \`?phantach\` để phân tách đồ hoặc \`?buy 5\` để mở rộng kho.`);
        }

        // Mua box
        economyDb.subtractHat(userId, cost);
        economyDb.addBoxesT1(userId, quickBuyQty);
        economyDb.logTransaction(userId, 'buy', `Box Tier 1 x${quickBuyQty}`, -cost);

        // Trừ box và mở ngay
        economyDb.subtractBoxesT1(userId, quickBuyQty);

        // Mở instant
        const { EmbedBuilder: EB } = require('discord.js');
        const processingEmbed = new EB()
            .setColor('#F59E0B')
            .setTitle('⏳ Đang xử lý...')
            .setDescription(`Đang mua **${quickBuyQty}** box và mở...`)
            .setTimestamp();

        const reply = await message.reply({ embeds: [processingEmbed] });

        // Pass reply message trực tiếp để tránh vấn đề với fake interaction
        await openBoxesInstant(null, quickBuyQty, userId, reply);
        return;
    }

    // Nếu không có box -> hiển thị nút mua 10 và mở
    if (boxCount === 0) {
        const hatCount = eco.hat || 0;
        const cost = 1000; // 10 box * 100 Hạt
        const canAfford = hatCount >= cost;

        const embed = new EmbedBuilder()
            .setColor(canAfford ? '#F59E0B' : '#EF4444')
            .setTitle('📦 Hòm của bạn')
            .setDescription([
                `Bạn không có box nào!`,
                '',
                `💰 **Hạt hiện có:** ${hatCount.toLocaleString()}`,
                `📦 **Giá 10 Box:** 1.000 Hạt`,
                '',
                canAfford
                    ? '✅ Bấm nút bên dưới để mua 10 box và mở ngay!'
                    : '❌ Không đủ Hạt! Đi `?dung` để farm thêm.'
            ].join('\n'))
            .setFooter({ text: canAfford ? 'Mua và mở ngay!' : '?dung để vào dungeon farm Hạt' })
            .setTimestamp();

        if (canAfford) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`buy10open_${userId}`)
                    .setLabel('💰 Mua 10 & Mở nhanh')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`buy10open_anim_${userId}`)
                    .setLabel('🎰 Mua 10 & Mở từng cái')
                    .setStyle(ButtonStyle.Primary)
            );

            const reply = await message.reply({ embeds: [embed], components: [row] });

            const collector = reply.createMessageComponentCollector({
                filter: i => i.user.id === userId && i.customId.startsWith('buy10open'),
                time: 60000
            });

            collector.on('collect', async (interaction) => {
                try {
                    collector.stop('buy');

                    // Re-check balance
                    const currentEco = economyDb.getOrCreateEconomy(userId);
                    if (currentEco.hat < cost) {
                        return interaction.reply({ content: '❌ Không đủ Hạt!', ephemeral: true });
                    }

                    // Mua box
                    economyDb.subtractHat(userId, cost);
                    economyDb.addBoxesT1(userId, 10);
                    economyDb.logTransaction(userId, 'buy', 'Box Tier 1 x10', -cost);

                    // Trừ box ngay và mở
                    economyDb.subtractBoxesT1(userId, 10);

                    if (interaction.customId.includes('_anim_')) {
                        await openBoxesAnimated(interaction, 10, userId);
                    } else {
                        await openBoxesInstant(interaction, 10, userId);
                    }
                } catch (error) {
                    console.error('[box] Error buy & open:', error.message);
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    await reply.edit({ components: [] }).catch(() => { });
                }
            });
        } else {
            await message.reply({ embeds: [embed] });
        }
        return;
    }

    const { embed, row } = createBoxOpenUI(userId, boxCount);

    if (!row) {
        return message.reply({ embeds: [embed] });
    }

    const reply = await message.reply({ embeds: [embed], components: [row] });

    // Collector cho buttons
    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === userId && (i.customId.startsWith('box10_') || i.customId.startsWith('boxall_')),
        time: 60000
    });

    collector.on('collect', async (interaction) => {
        try {
            const currentEco = economyDb.getOrCreateEconomy(userId);
            const currentBoxes = currentEco.boxes_t1 || 0;

            if (currentBoxes <= 0) {
                return interaction.reply({ content: '❌ Bạn không còn box nào!', ephemeral: true });
            }

            collector.stop('open');

            if (interaction.customId.startsWith('box10_')) {
                const toOpen = Math.min(10, currentBoxes);
                economyDb.subtractBoxesT1(userId, toOpen);
                await openBoxesAnimated(interaction, toOpen, userId);
            } else if (interaction.customId.startsWith('boxall_')) {
                economyDb.subtractBoxesT1(userId, currentBoxes);
                await openBoxesInstant(interaction, currentBoxes, userId);
            }
        } catch (error) {
            if (error.code === 10062 || error.code === 40060) {
                try { await reply.edit({ components: [] }); } catch (e) { }
            } else {
                console.error('[box] Lỗi xử lý nút:', error.message);
            }
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            await reply.edit({ components: [] }).catch(() => { });
        }
    });
}

module.exports = { execute };


