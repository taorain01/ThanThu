/**
 * ?use - Sử dụng item tiêu hao
 * ?use nhuacung / ?use 6 - Hồi 60 Nhựa
 * ?use tinhthevang / ?use 7 - Đảm bảo dòng tune tiếp theo là Đề Cử Vàng
 * ?use thachamvang / ?use 8 - Đảm bảo dòng cuối tune là Vàng
 */

const { EmbedBuilder } = require('discord.js');
const { getItem } = require('../../utils/itemRegistry');
const economyDb = require('../../database/economy');

async function execute(message, args) {
    const userId = message.author.id;

    // Nếu không có args → hiển thị danh sách vật phẩm có thể dùng
    if (args.length === 0) {
        return showUsableItems(message, userId);
    }

    const itemId = args[0].toLowerCase();

    // Special aliases that bypass itemRegistry
    if (itemId === 'dd') {
        const dadenCommand = require('./daden');
        return dadenCommand.execute(message, args.slice(1));
    }

    const item = getItem(itemId);

    if (!item) {
        return message.reply(`❌ Không tìm thấy item \`${itemId}\`!\nDùng \`?look\` để xem danh sách.`);
    }

    // Xử lý theo loại item
    switch (item.id) {
        case 'nhuacung':
            return useNhuaCung(message, userId, args.slice(1));
        case 'tinhthevang':
            return useTinhTheVang(message, userId);
        case 'thachamvang':
            return useThachAmVang(message, userId);
        case 'lcp':
        case 'luacauphuc':
            return useBlessingFire(message, userId, 'lcp', args.slice(1));
        case 'lcpcl':
        case 'luacauphuccolon':
            return useBlessingFire(message, userId, 'lcpcl', args.slice(1));
        case 'daden':
            // Redirect to daden command
            const dadenCommand = require('./daden');
            return dadenCommand.execute(message, args.slice(1));
        default:
            return message.reply(`❌ Item **${item.name}** không thể sử dụng trực tiếp!`);
    }
}

/**
 * Hiển thị select menu các vật phẩm có thể sử dụng
 */
async function showUsableItems(message, userId) {
    const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder } = require('discord.js');

    const eco = economyDb.getOrCreateEconomy(userId);
    const lcpCounts = economyDb.getLcpCounts(userId);
    const blessingStatus = economyDb.getBlessingFireStatus(userId);

    // Tạo danh sách options cho select menu
    const options = [];

    if (eco.nhua_cung > 0) {
        options.push(new StringSelectMenuOptionBuilder()
            .setLabel(`💊 Nhựa Cứng (${eco.nhua_cung})`)
            .setDescription('Hồi 60 Nhựa')
            .setValue('nhuacung'));
    }
    if (eco.da_t1_khac_an > 0) {
        options.push(new StringSelectMenuOptionBuilder()
            .setLabel(`💠 Tinh Thể Vàng (${eco.da_t1_khac_an})`)
            .setDescription('Dòng tune tiếp theo = Đề Cử Vàng')
            .setValue('tinhthevang'));
    }
    if (eco.thach_am_khac_an > 0) {
        options.push(new StringSelectMenuOptionBuilder()
            .setLabel(`🔷 Thạch Âm Vàng (${eco.thach_am_khac_an})`)
            .setDescription('Dòng cuối tune = Vàng')
            .setValue('thachamvang'));
    }
    if (lcpCounts.lcp > 0) {
        options.push(new StringSelectMenuOptionBuilder()
            .setLabel(`🔥 Lửa Cầu Phúc (${lcpCounts.lcp})`)
            .setDescription('+100% drop Vàng, 3 tiếng')
            .setValue('lcp'));
    }
    if (lcpCounts.lcpcl > 0) {
        options.push(new StringSelectMenuOptionBuilder()
            .setLabel(`🔥 LCP Cỡ Lớn (${lcpCounts.lcpcl})`)
            .setDescription('+200% drop Vàng, 3 tiếng')
            .setValue('lcpcl'));
    }
    if ((eco.black_stone_empty || 0) > 0) {
        options.push(new StringSelectMenuOptionBuilder()
            .setLabel(`🌑 Đá Đen (${eco.black_stone_empty})`)
            .setDescription('Chuyển dòng trang bị (40%)')
            .setValue('daden'));
    }
    // Tạo embed tổng quan với danh sách text
    let lines = ['**📜 Vật phẩm sử dụng được:**', ''];

    // Hiển thị text items
    if (eco.nhua_cung > 0) {
        lines.push(`💊 **Nhựa Cứng**: ${eco.nhua_cung} • \`?use nhuacung\``);
    }
    if (eco.da_t1_khac_an > 0) {
        lines.push(`💠 **Tinh Thể Vàng**: ${eco.da_t1_khac_an} • \`?use tinhthevang\``);
    }
    if (eco.thach_am_khac_an > 0) {
        lines.push(`🔷 **Thạch Âm Vàng**: ${eco.thach_am_khac_an} • \`?use thachamvang\``);
    }
    if (lcpCounts.lcp > 0) {
        lines.push(`🔥 **Lửa Cầu Phúc**: ${lcpCounts.lcp} • \`?use lcp\``);
    }
    if (lcpCounts.lcpcl > 0) {
        lines.push(`🔥 **LCP Cỡ Lớn**: ${lcpCounts.lcpcl} • \`?use lcpcl\``);
    }
    if ((eco.black_stone_empty || 0) > 0) {
        lines.push(`🌑 **Đá Đen**: ${eco.black_stone_empty} • \`?use daden\``);
    }

    if (lines.length === 2) {
        lines.push('_Không có vật phẩm nào!_');
    }

    // Hiển thị trạng thái đang đốt
    if (blessingStatus.active) {
        const remaining = Math.ceil((blessingStatus.expiresAt - new Date()) / 1000 / 60);
        const hours = Math.floor(remaining / 60);
        const mins = remaining % 60;
        const timeText = hours > 0 ? `${hours}h${mins}p` : `${mins}p`;
        const typeName = blessingStatus.type === 'lcpcl' ? 'LCP Cỡ Lớn' : 'Lửa Cầu Phúc';
        lines.push('');
        lines.push(`🔥 **Đang đốt ${typeName}** (+${blessingStatus.bonusPercent}%, còn ${timeText})`);
    }

    const embed = new EmbedBuilder()
        .setColor(blessingStatus.active ? (blessingStatus.type === 'lcpcl' ? 0xFF4500 : 0xFFA07A) : 0xE67E22)
        .setTitle('🎒 Sử Dụng Vật Phẩm')
        .setDescription(lines.join('\n'))
        .setTimestamp();

    if (options.length === 0) {
        embed.setDescription('_Không có vật phẩm nào có thể sử dụng!_');
        embed.setFooter({ text: 'Nhận item từ Daily, Box, shop...' });
        return message.reply({ embeds: [embed] });
    }

    // Tạo select menu
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`use_item_${userId}`)
        .setPlaceholder('📦 Chọn vật phẩm để sử dụng...')
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    embed.setFooter({ text: 'Chọn item bên dưới để sử dụng' });

    const reply = await message.reply({ embeds: [embed], components: [row] });

    // Collector
    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === userId,
        time: 60000
    });

    collector.on('collect', async (interaction) => {
        const selectedItem = interaction.values[0];

        // Xử lý từng loại item
        switch (selectedItem) {
            case 'nhuacung':
                await interaction.update({ components: [] });
                return useNhuaCung(message, userId);
            case 'tinhthevang':
                await interaction.update({ components: [] });
                return useTinhTheVang(message, userId);
            case 'thachamvang':
                await interaction.update({ components: [] });
                return useThachAmVang(message, userId);
            case 'lcp':
                await interaction.update({ components: [] });
                return useBlessingFire(message, userId, 'lcp', []);
            case 'lcpcl':
                await interaction.update({ components: [] });
                return useBlessingFire(message, userId, 'lcpcl', []);
            case 'daden':
                await interaction.update({ components: [] });
                const dadenCommand = require('./daden');
                return dadenCommand.execute(message, []);
            default:
                await interaction.reply({ content: '❌ Item không hợp lệ!', ephemeral: true });
        }
    });

    collector.on('end', async () => {
        try { await reply.edit({ components: [] }); } catch (e) { }
    });
}

/**
 * Sử dụng Nhựa Cứng - Hồi 60 Nhựa mỗi cái
 * @param {Array} extraArgs - [quantity] optional
 */
async function useNhuaCung(message, userId, extraArgs = []) {
    const eco = economyDb.getOrCreateEconomy(userId);
    const nhuaCung = eco.nhua_cung || 0;

    if (nhuaCung <= 0) {
        return message.reply('❌ Bạn không có **Nhựa Cứng** nào!\\nNhận từ Daily Quest hiếm hoặc phần thưởng đặc biệt.');
    }

    // Parse quantity (default 1)
    let quantity = 1;
    if (extraArgs.length > 0) {
        quantity = parseInt(extraArgs[0]);
        if (isNaN(quantity) || quantity < 1) {
            return message.reply('❌ Số lượng không hợp lệ! Dùng: `?use nhuacung <số lượng>`');
        }
    }

    // Check if user has enough
    if (quantity > nhuaCung) {
        return message.reply(`❌ Bạn chỉ có **${nhuaCung}** Nhựa Cứng! Không đủ để dùng **${quantity}** cái.`);
    }

    // Kiểm tra nhựa hiện tại
    const nhuaInfo = economyDb.getCurrentNhua(userId);
    const MAX_NHUA = economyDb.MAX_NHUA;

    if (nhuaInfo.current >= MAX_NHUA) {
        return message.reply(`❌ Nhựa đã đầy **${nhuaInfo.current}/${MAX_NHUA}**! Không cần dùng Nhựa Cứng.`);
    }

    // Tính số lượng thực tế cần dùng (không lãng phí)
    const maxNeeded = Math.ceil((MAX_NHUA - nhuaInfo.current) / 60);
    const actualQuantity = Math.min(quantity, maxNeeded);

    if (actualQuantity < quantity) {
        message.channel.send(`💡 Chỉ cần **${actualQuantity}** Nhựa Cứng để đầy. Tự động điều chỉnh!`);
    }

    // Tính số nhựa sẽ hồi (mỗi cái +60, không vượt quá max)
    const totalRegen = actualQuantity * 60;
    const regenAmount = Math.min(totalRegen, MAX_NHUA - nhuaInfo.current);

    // Trừ Nhựa Cứng và cộng Nhựa
    economyDb.subtractNhuaCung(userId, actualQuantity);

    // Cộng nhựa trực tiếp vào database
    const newNhua = Math.min(MAX_NHUA, nhuaInfo.current + regenAmount);
    economyDb.db.prepare('UPDATE economy SET nhua = ?, nhua_updated_at = ? WHERE discord_id = ?')
        .run(newNhua, new Date().toISOString(), userId);

    const embed = new EmbedBuilder()
        .setColor('#22C55E')
        .setTitle('💊 Sử Dụng Nhựa Cứng')
        .setDescription(`Đã dùng **${actualQuantity}** Nhựa Cứng!\\n\\n**+${regenAmount}** Nhựa hồi phục!`)
        .addFields(
            { name: '💧 Nhựa hiện tại', value: `**${newNhua}/${MAX_NHUA}**`, inline: true },
            { name: '💊 Nhựa Cứng còn lại', value: `**${nhuaCung - actualQuantity}**`, inline: true }
        )
        .setFooter({ text: '?dung để vào dungeon' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

/**
 * Sử dụng Tinh Thể Vàng - Đảm bảo dòng tune tiếp theo là Đề Cử Vàng
 */
async function useTinhTheVang(message, userId) {
    const eco = economyDb.getOrCreateEconomy(userId);
    const tinhTheVang = eco.da_t1_khac_an || 0;

    if (tinhTheVang <= 0) {
        return message.reply('❌ Bạn không có **Tinh Thể Vàng** nào!\nNhận từ Daily Quest hiếm (0.25%).');
    }

    // Trừ Tinh Thể Vàng
    economyDb.subtractDaT1KhacAn(userId, 1);

    // Set buff flag
    economyDb.setTuneGoldBuff(userId, true);

    const embed = new EmbedBuilder()
        .setColor('#F1C40F')
        .setTitle('💠 Tinh Thể Vàng Đã Kích Hoạt!')
        .setDescription('**Hiệu ứng:** Dòng tune tiếp theo sẽ là **Đề Cử Vàng**!')
        .addFields(
            { name: '⚡ Trạng thái', value: '`ACTIVE` - Sẵn sàng tune', inline: true },
            { name: '💠 Còn lại', value: `**${tinhTheVang - 1}**`, inline: true }
        )
        .setFooter({ text: '?tune <id> để sử dụng hiệu ứng ngay!' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

/**
 * Sử dụng Thạch Âm Vàng - Đảm bảo dòng cuối tune là Vàng
 */
async function useThachAmVang(message, userId) {
    const eco = economyDb.getOrCreateEconomy(userId);
    const thachAmVang = eco.thach_am_khac_an || 0;

    if (thachAmVang <= 0) {
        return message.reply('❌ Bạn không có **Thạch Âm Vàng** nào!\nNhận từ Daily Quest hiếm (0.25%).');
    }

    // Trừ Thạch Âm Vàng
    economyDb.subtractThachAmKhacAn(userId, 1);

    // Set buff flag
    economyDb.setFinalLineGoldBuff(userId, true);

    const embed = new EmbedBuilder()
        .setColor('#3B82F6')
        .setTitle('🔷 Thạch Âm Vàng Đã Kích Hoạt!')
        .setDescription('**Hiệu ứng:** Dòng cuối (dòng 5) tune tiếp theo sẽ là **Vàng**!')
        .addFields(
            { name: '⚡ Trạng thái', value: '`ACTIVE` - Sẵn sàng tune dòng cuối', inline: true },
            { name: '🔷 Còn lại', value: `**${thachAmVang - 1}**`, inline: true }
        )
        .setFooter({ text: '?tune <id> 5 để sử dụng hiệu ứng ngay!' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

/**
 * Sử dụng Lửa Cầu Phúc (LCP) hoặc Lửa Cầu Phúc Cỡ Lớn (LCPCL)
 * - LCP: +100% tỉ lệ mở gear Vàng từ Box, 3 tiếng
 * - LCPCL: +200% tỉ lệ mở gear Vàng từ Box, 3 tiếng
 * - ?use lcp 10 - dùng 10 cái, cộng dồn thời gian nếu cùng loại
 * - ?use lcp auto - tự động xài khi buff hết
 */
async function useBlessingFire(message, userId, type, extraArgs = []) {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

    // Parse arguments: có thể là số (quantity), "auto", hoặc "auto off"
    let quantity = 1;
    let isAutoMode = false;
    let isAutoOff = false;

    if (extraArgs.length > 0) {
        const firstArg = extraArgs[0].toLowerCase();
        if (firstArg === 'auto') {
            isAutoMode = true;
            // Check for "off" as second arg: ?use lcp auto off
            if (extraArgs.length > 1 && extraArgs[1].toLowerCase() === 'off') {
                isAutoOff = true;
            }
        } else {
            const parsed = parseInt(firstArg);
            if (!isNaN(parsed) && parsed > 0) {
                quantity = parsed;
            }
        }
    }

    const lcpCounts = economyDb.getLcpCounts(userId);
    const currentStatus = economyDb.getBlessingFireStatus(userId);
    const typeName = type === 'lcpcl' ? 'Lửa Cầu Phúc Cỡ Lớn' : 'Lửa Cầu Phúc';
    const shortName = type === 'lcpcl' ? 'Lửa Cầu Phúc Cỡ Lớn' : 'Lửa Cầu Phúc';
    const bonusPercent = type === 'lcpcl' ? 200 : 100;
    const itemCount = type === 'lcpcl' ? lcpCounts.lcpcl : lcpCounts.lcp;

    // Kiểm tra có item không
    if (itemCount <= 0) {
        return message.reply(`❌ Bạn không có **${typeName}** nào!`);
    }

    // ====== BULK MODE (quantity > 1) - xử lý ngay, cộng dồn nếu cùng loại ======
    if (quantity > 1) {
        const actualQty = Math.min(quantity, itemCount);

        // Nếu đang có buff khác loại, hỏi xác nhận
        if (currentStatus.active && currentStatus.type !== type) {
            const remaining = Math.ceil((currentStatus.expiresAt - new Date()) / 1000 / 60);
            const hours = Math.floor(remaining / 60);
            const mins = remaining % 60;
            const timeText = hours > 0 ? `${hours}h${mins}p` : `${mins}p`;
            const currentTypeName = currentStatus.type === 'lcpcl' ? 'Lửa Cầu Phúc Cỡ Lớn' : 'Lửa Cầu Phúc';

            const confirmEmbed = new EmbedBuilder()
                .setColor('#E67E22')
                .setTitle('⚠️ Buff khác loại đang hoạt động!')
                .setDescription([
                    `Bạn đang có buff **${currentTypeName}** (+${currentStatus.bonusPercent}%)`,
                    `Còn **${timeText}** nữa mới hết.`,
                    '',
                    `Đốt **${actualQty} ${shortName}** sẽ **thay thế** buff cũ!`,
                    `Thời gian mới: **${actualQty * 3} tiếng**`
                ].join('\n'))
                .setTimestamp();

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`lcp_bulk_confirm_${userId}_${type}_${actualQty}`)
                    .setLabel(`🔥 Đốt ${actualQty} ${shortName}`)
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`lcp_cancel_${userId}`)
                    .setLabel('❌ Hủy')
                    .setStyle(ButtonStyle.Secondary)
            );

            const reply = await message.reply({ embeds: [confirmEmbed], components: [buttons] });
            setupBulkCollector(reply, userId, type, actualQty);
            return;
        }

        // Cùng loại hoặc không có buff - đốt ngay
        return activateAndReplyBulk(message, userId, type, actualQty, typeName, shortName, bonusPercent, currentStatus);
    }

    // ====== AUTO MODE ======
    if (isAutoMode) {
        const currentAutoType = economyDb.getLcpAuto(userId);

        // Handle "off" command or toggle off if same type already set
        if (isAutoOff || currentAutoType === type) {
            economyDb.setLcpAuto(userId, null);
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor(0x95A5A6)
                    .setTitle('🔥 Auto Fire - TẮT')
                    .setDescription(`Đã **tắt** chế độ tự động đốt ${shortName}.`)
                    .setTimestamp()
                ]
            });
        }

        // Turn on auto mode (this will disable the other type if set)
        const otherType = type === 'lcp' ? 'lcpcl' : 'lcp';
        const otherTypeName = type === 'lcp' ? 'Lửa Cầu Phúc Cỡ Lớn' : 'Lửa Cầu Phúc';
        const hadOtherAuto = currentAutoType === otherType;

        economyDb.setLcpAuto(userId, type);

        let description = [];
        description.push(`Đã **BẬT** chế độ tự động đốt **${shortName}**!`);

        if (hadOtherAuto) {
            description.push(`*(Auto ${otherTypeName} đã được TẮT)*`);
        }
        description.push('');

        if (currentStatus.active) {
            const remaining = Math.ceil((currentStatus.expiresAt - new Date()) / 1000 / 60);
            const hours = Math.floor(remaining / 60);
            const mins = remaining % 60;
            const timeText = hours > 0 ? `${hours}h${mins}p` : `${mins}p`;
            description.push(`Đang có buff **${currentStatus.type === 'lcpcl' ? 'Lửa Cầu Phúc Cỡ Lớn' : 'Lửa Cầu Phúc'}** (còn ${timeText}).`);
            description.push(`Sẽ tự động đốt **${shortName}** khi buff hết!`);
        } else {
            description.push('Hiện không có buff đang hoạt động.');
            description.push(`Dùng \`?use ${type.toLowerCase()}\` để đốt ngay.`);
        }

        description.push('');
        description.push(`📦 ${shortName} còn: **${itemCount}**`);
        description.push('');
        description.push(`💡 Dùng \`?use ${type.toLowerCase()} auto\` lần nữa để tắt.`);

        return message.reply({
            embeds: [new EmbedBuilder()
                .setColor(type === 'lcpcl' ? '#FF4500' : '#FFA07A')
                .setTitle(`🔥 Auto Fire - ${shortName} - BẬT`)
                .setDescription(description.join('\n'))
                .setFooter({ text: '⚠️ Lưu ý: Auto sẽ tự đốt khi buff hết (nếu còn item)' })
                .setTimestamp()
            ]
        });
    }

    // ====== KIỂM TRA ĐANG CÓ BUFF ======
    if (currentStatus.active) {
        const remaining = Math.ceil((currentStatus.expiresAt - new Date()) / 1000 / 60);
        const hours = Math.floor(remaining / 60);
        const mins = remaining % 60;
        const timeText = hours > 0 ? `${hours}h${mins}p` : `${mins}p`;
        const currentTypeName = currentStatus.type === 'lcpcl' ? 'Lửa Cầu Phúc Cỡ Lớn' : 'Lửa Cầu Phúc';

        // Hỏi xác nhận
        const confirmEmbed = new EmbedBuilder()
            .setColor('#E67E22')
            .setTitle('⚠️ Đang có Lửa đang đốt!')
            .setDescription([
                `Bạn đang đốt **${currentTypeName}** (+${currentStatus.bonusPercent}%)`,
                `Còn **${timeText}** nữa mới hết.`,
                '',
                `Bạn có muốn đốt **${shortName}** (+${bonusPercent}%) ngay bây giờ?`,
                '> ⚠️ Buff cũ sẽ bị **mất** và thời gian sẽ **reset về 3 tiếng**!'
            ].join('\n'))
            .setTimestamp();

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`lcp_confirm_${userId}_${type}`)
                .setLabel('🔥 Đốt đè')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`lcp_cancel_${userId}`)
                .setLabel('❌ Hủy')
                .setStyle(ButtonStyle.Secondary)
        );

        const reply = await message.reply({ embeds: [confirmEmbed], components: [buttons] });

        const collector = reply.createMessageComponentCollector({
            filter: i => i.user.id === userId,
            time: 30000
        });

        collector.on('collect', async (interaction) => {
            if (interaction.customId === `lcp_confirm_${userId}_${type}`) {
                collector.stop();
                await activateAndReply(interaction, userId, type, typeName, shortName, bonusPercent, true);
            } else if (interaction.customId === `lcp_cancel_${userId}`) {
                await interaction.update({
                    embeds: [new EmbedBuilder().setColor(0x95A5A6).setTitle('❌ Đã hủy')],
                    components: []
                });
                collector.stop();
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time' && collected.size === 0) {
                await reply.edit({ components: [] }).catch(() => { });
            }
        });

        return;
    }

    // ====== KHÔNG CÓ BUFF - ĐỐT NGAY ======
    return activateAndReply(message, userId, type, typeName, shortName, bonusPercent);
}

/**
 * Kích hoạt và trả về embed thành công
 */
async function activateAndReply(context, userId, type, typeName, shortName, bonusPercent, isInteraction = false, quantity = 1) {
    const result = economyDb.activateBlessingFire(userId, type, quantity);

    if (!result.success) {
        const content = `❌ ${result.message}`;
        if (isInteraction) {
            return context.update({ content, embeds: [], components: [] });
        }
        return context.reply(content);
    }

    const remainingMinutes = Math.ceil((result.expiresAt - new Date()) / 1000 / 60);
    const hours = Math.floor(remainingMinutes / 60);
    const mins = remainingMinutes % 60;
    const timeText = hours > 0 ? `${hours} tiếng ${mins} phút` : `${mins} phút`;
    const lcpCounts = economyDb.getLcpCounts(userId);

    const isStacked = quantity > 1 || result.usedCount > 1;
    const usedText = result.usedCount > 1 ? `**${result.usedCount}** ${shortName}` : shortName;

    const embed = new EmbedBuilder()
        .setColor(type === 'lcpcl' ? '#FF4500' : '#FFA07A')
        .setTitle(`🔥 ${typeName}`)
        .setDescription([
            `Đã đốt ${usedText} thành công!`,
            '',
            `📈 **Hiệu quả:** +${bonusPercent}% tỉ lệ mở gear Vàng từ Box`,
            `⏱️ **Thời gian còn:** ${timeText}`,
            '',
            isStacked ? '> ✅ Thời gian đã được cộng dồn!' : '',
            '> ⚠️ Hiệu quả không cộng dồn giữa LCP và LCPCL'
        ].filter(Boolean).join('\n'))
        .addFields(
            { name: '🔥 Lửa Cầu Phúc còn', value: `${lcpCounts.lcp}`, inline: true },
            { name: '🔥 LCP Cỡ Lớn còn', value: `${lcpCounts.lcpcl}`, inline: true }
        )
        .setTimestamp();

    if (isInteraction) {
        return context.update({ embeds: [embed], components: [] });
    }
    return context.reply({ embeds: [embed] });
}

/**
 * Bulk mode helper - activate và reply với quantity > 1
 */
async function activateAndReplyBulk(context, userId, type, quantity, typeName, shortName, bonusPercent, currentStatus, isInteraction = false) {
    const result = economyDb.activateBlessingFire(userId, type, quantity);

    if (!result.success) {
        const content = `❌ ${result.message}`;
        if (isInteraction) {
            return context.update({ content, embeds: [], components: [] });
        }
        return context.reply(content);
    }

    const remainingMinutes = Math.ceil((result.expiresAt - new Date()) / 1000 / 60);
    const hours = Math.floor(remainingMinutes / 60);
    const mins = remainingMinutes % 60;
    const timeText = hours > 0 ? `${hours} tiếng ${mins} phút` : `${mins} phút`;
    const lcpCounts = economyDb.getLcpCounts(userId);

    // Check if stacked (same type buff was active)
    const wasStacked = currentStatus && currentStatus.active && currentStatus.type === type;

    const embed = new EmbedBuilder()
        .setColor(type === 'lcpcl' ? '#FF4500' : '#FFA07A')
        .setTitle(`🔥 ${typeName}`)
        .setDescription([
            `Đã đốt **${result.usedCount}** ${shortName} thành công!`,
            '',
            `📈 **Hiệu quả:** +${bonusPercent}% tỉ lệ mở gear Vàng từ Box`,
            `⏱️ **Thời gian còn:** ${timeText}`,
            `⏱️ **Thêm:** +${result.usedCount * 3} tiếng`,
            '',
            wasStacked ? '> ✅ Thời gian đã được cộng dồn!' : '> 🔄 Buff mới đã được kích hoạt!'
        ].join('\n'))
        .addFields(
            { name: '🔥 Lửa Cầu Phúc còn', value: `${lcpCounts.lcp}`, inline: true },
            { name: '🔥 LCP Cỡ Lớn còn', value: `${lcpCounts.lcpcl}`, inline: true }
        )
        .setTimestamp();

    if (isInteraction) {
        return context.update({ embeds: [embed], components: [] });
    }
    return context.reply({ embeds: [embed] });
}

/**
 * Setup collector cho bulk confirm button
 */
function setupBulkCollector(reply, userId, type, quantity) {
    const typeName = type === 'lcpcl' ? 'Lửa Cầu Phúc Cỡ Lớn' : 'Lửa Cầu Phúc';
    const shortName = type === 'lcpcl' ? 'Lửa Cầu Phúc Cỡ Lớn' : 'Lửa Cầu Phúc';
    const bonusPercent = type === 'lcpcl' ? 200 : 100;

    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === userId,
        time: 30000
    });

    collector.on('collect', async (interaction) => {
        if (interaction.customId.startsWith(`lcp_bulk_confirm_${userId}_${type}_`)) {
            collector.stop();
            await activateAndReplyBulk(interaction, userId, type, quantity, typeName, shortName, bonusPercent, null, true);
        } else if (interaction.customId === `lcp_cancel_${userId}`) {
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0x95A5A6).setTitle('❌ Đã hủy')],
                components: []
            });
            collector.stop();
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            await reply.edit({ components: [] }).catch(() => { });
        }
    });
}

module.exports = { execute };



