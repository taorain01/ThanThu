/**
 * ?inv / ?inventory / ?tuido / ?kho - Xem kho đồ
 * UI mới: Phân trang, sắp xếp theo mastery, hiển thị chi tiết dòng vàng
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const economyDb = require('../../database/economy');
const { SLOTS, getPlayerClass, isDeCu } = require('../../utils/classSystem');
const { calculateEquipmentMastery, formatLine } = require('../../utils/tuneSystem');
const ICONS = require('../../config/icons');

// Dynamic inventory slots from database
function getMaxInventory(userId) {
    return economyDb.getInvSlots(userId);
}
const ITEMS_PER_PAGE = 5; // Changed from 10 to 5 for better readability

async function execute(message, args) {
    const userId = message.author.id;
    const playerClass = getPlayerClass(message.member);

    // Lấy tất cả equipment
    const items = economyDb.getUserEquipment(userId);

    if (items.length === 0) {
        return message.reply('❌ Kho đồ trống!\nDùng `?buy box` để mua box hoặc `?dung` để đi dungeon.');
    }

    // Tính mastery cho mỗi item và sắp xếp
    const itemsWithMastery = items.map(item => ({
        ...item,
        mastery: calculateEquipmentMastery(item, playerClass)
    }));

    // Phân loại: Gold trước, Purple sau, sắp xếp theo mastery giảm dần
    const goldItems = itemsWithMastery
        .filter(i => i.rarity === 'gold')
        .sort((a, b) => b.mastery - a.mastery);
    const purpleItems = itemsWithMastery
        .filter(i => i.rarity === 'purple')
        .sort((a, b) => b.mastery - a.mastery);

    // Ghép lại: Gold trên, Purple dưới
    const sortedItems = [...goldItems, ...purpleItems];

    // Tính inventory items (không đang mặc) để phân trang
    const inventoryOnlyItems = sortedItems.filter(i => !i.is_equipped);
    const totalPages = Math.max(1, Math.ceil(inventoryOnlyItems.length / ITEMS_PER_PAGE));

    // Bắt đầu từ trang 1
    let currentPage = 0;

    const createPageEmbed = (page) => {
        const eco = economyDb.getOrCreateEconomy(userId);

        // Phân loại items
        const equippedItems = itemsWithMastery.filter(i => i.is_equipped);
        const inventoryItems = itemsWithMastery.filter(i => !i.is_equipped);

        // Sort inventory: Vàng trước (theo mastery), Equipped vàng, Tím sau
        const goldInv = inventoryItems.filter(i => i.rarity === 'gold').sort((a, b) => b.mastery - a.mastery);
        const goldEquipped = equippedItems.filter(i => i.rarity === 'gold').sort((a, b) => b.mastery - a.mastery);
        const purpleInv = inventoryItems.filter(i => i.rarity === 'purple').sort((a, b) => b.mastery - a.mastery);

        // Gộp: Vàng trong kho → Vàng đang mặc → Tím trong kho
        const sortedAll = [...goldInv, ...goldEquipped, ...purpleInv];

        // Tính tổng mastery đang mặc
        let totalEquippedMastery = 0;
        for (const item of equippedItems) {
            totalEquippedMastery += item.mastery;
        }

        // Progress bar
        const maxMastery = 10000;
        const masteryPercent = Math.min(totalEquippedMastery / maxMastery, 1);
        const filledBlocks = Math.round(masteryPercent * 10);
        const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(10 - filledBlocks);

        // Số items mỗi trang: Trang 1 = 5, Trang sau = 10
        const isFirstPage = page === 0;
        const itemsThisPage = isFirstPage ? ITEMS_PER_PAGE : 10;

        // Tính offset cho trang sau
        let start, end;
        if (isFirstPage) {
            start = 0;
            end = ITEMS_PER_PAGE;
        } else {
            // Trang 2+: bắt đầu sau 5 items đầu, mỗi trang 10 items
            start = ITEMS_PER_PAGE + (page - 1) * 10;
            end = start + 10;
        }

        const pageItems = sortedAll.slice(start, end);

        let description = '';

        // ===== HEADER (chỉ trang 1) =====
        if (isFirstPage) {
            const MAX_INVENTORY = getMaxInventory(userId);
            description += `📦 **${items.length}/${MAX_INVENTORY}** món\n`;
            description += `⚔️ Mastery: **${totalEquippedMastery}**/${maxMastery} \`${progressBar}\`\n`;
            description += `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n`;
        }

        // ===== EQUIPMENT LIST (COMPACT MODE) =====
        if (pageItems.length > 0) {
            for (const item of pageItems) {
                const slot = SLOTS[item.slot];
                const locked = item.is_locked ? '🔒' : '';
                const rarityIcon = item.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;
                const equippedMark = item.is_equipped ? '✅' : '';

                // Đếm số dòng vàng và số dòng Đề Cử
                const allLines = [...(item.lines || []), item.final_line].filter(Boolean);
                const goldCount = allLines.filter(l => l.rarity === 'gold').length;
                const deCuCount = allLines.filter(l => isDeCu(l.stat, playerClass)).length;

                // Format compact: ID | Tên | Slot | Mastery | Badges
                const badges = [];
                if (goldCount > 0) badges.push(`${goldCount}${ICONS.rarity.gold}`);
                if (deCuCount > 0) badges.push(`${deCuCount}${ICONS.rarity.starDecu}`);
                const badgeStr = badges.length > 0 ? ` [${badges.join(' ')}]` : '';

                // Hiển thị compact
                description += `${rarityIcon} \`${String(item.id).padStart(6, '0')}\` **${item.name}** ${slot.icon} ⭑\`${item.mastery}\`${badgeStr}${equippedMark}${locked}\n`;
            }
        } else {
            description += `*Không có trang bị*\n`;
        }


        // ===== MATERIALS (chỉ trang 1) =====
        if (isFirstPage) {
            description += `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n`;
            description += `💎 \`[1]\` Đá T1: **${eco.enhancement_stone_t1}**\n`;
            description += `🔮 \`[2]\` Thạch Âm: **${eco.thach_am}**\n`;
            description += `📦 \`[3]\` Box T1: **${eco.boxes_t1 || 0}**\n`;

            if (eco.da_t1_khac_an > 0) description += `💠 \`[7]\` Tinh Thể Vàng: **${eco.da_t1_khac_an}**\n`;
            if (eco.thach_am_khac_an > 0) description += `🔷 \`[8]\` Thạch Âm Vàng: **${eco.thach_am_khac_an}**\n`;
            if (eco.nhua_cung > 0) description += `💊 \`[5]\` Nhựa Cứng: **${eco.nhua_cung}**\n`;

            // Legend note
            description += `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n`;
            description += `${ICONS.rarity.gold}=Vàng ${ICONS.rarity.starDecu}=ĐềCử • \`?xem <id>\` để xem chi tiết`;
        }

        // Tính tổng số trang: trang 1 có 5 items, các trang sau có 10
        const remainingAfterFirst = Math.max(0, sortedAll.length - ITEMS_PER_PAGE);
        const actualTotalPages = sortedAll.length <= ITEMS_PER_PAGE ? 1 : 1 + Math.ceil(remainingAfterFirst / 10);

        return new EmbedBuilder()
            .setColor(goldItems.length > 0 ? '#F1C40F' : '#9B59B6')
            .setTitle('🎒 Kho Đồ')
            .setDescription(description)
            .setFooter({ text: `Trang ${page + 1}/${actualTotalPages}` })
            .setTimestamp();
    };

    const createNavigationRow = (page) => {
        const buttons = [];

        // Nút trang trước
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`invprev_${userId}`)
                .setLabel('◀ Trước')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0)
        );

        // Nút trang sau
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`invnext_${userId}`)
                .setLabel('Sau ▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1)
        );

        // Nút phân tách nếu có đồ tím
        if (purpleItems.length > 0) {
            buttons.push(
                new ButtonBuilder()
                    .setCustomId(`invdismantle_${userId}`)
                    .setLabel(`🔨 Phân tách (${purpleItems.length})`)
                    .setStyle(ButtonStyle.Danger)
            );
        }

        return new ActionRowBuilder().addComponents(...buttons);
    };

    const reply = await message.reply({
        embeds: [createPageEmbed(currentPage)],
        components: [createNavigationRow(currentPage)]
    });

    // Collector
    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === userId,
        time: 120000
    });

    collector.on('collect', async (btnInt) => {
        try {
            if (btnInt.customId === `invprev_${userId}`) {
                currentPage = Math.max(0, currentPage - 1);
                await btnInt.update({
                    embeds: [createPageEmbed(currentPage)],
                    components: [createNavigationRow(currentPage)]
                });
            } else if (btnInt.customId === `invnext_${userId}`) {
                currentPage = Math.min(totalPages - 1, currentPage + 1);
                await btnInt.update({
                    embeds: [createPageEmbed(currentPage)],
                    components: [createNavigationRow(currentPage)]
                });
            } else if (btnInt.customId === `invdismantle_${userId}`) {
                // Phân tách tất cả đồ tím
                const currentPurple = economyDb.getUserPurpleEquipment(userId);
                let dismantled = 0;
                let stoneGained = 0;

                for (const item of currentPurple) {
                    economyDb.deleteEquipment(item.id);
                    economyDb.addStoneT1(userId, 1);
                    dismantled++;
                    stoneGained += 1;
                }

                const dismantleEmbed = new EmbedBuilder()
                    .setColor('#3B82F6')
                    .setTitle('🔨 Phân tách hoàn tất!')
                    .setDescription(`Đã phân tách **${dismantled}** đồ Tím`)
                    .addFields({ name: '💎 Đá T1 nhận được', value: `\`+${stoneGained}\``, inline: true })
                    .setTimestamp();

                // Quest progress
                let completedQuests = [];
                if (dismantled > 0) {
                    const { updateQuestProgress } = require('../../utils/questSystem');
                    completedQuests = updateQuestProgress(userId, 'items_dismantled', dismantled);
                }

                await btnInt.update({ embeds: [dismantleEmbed], components: [] });

                // Send quest notifications
                if (completedQuests && completedQuests.length > 0) {
                    const { sendQuestNotifications } = require('../../utils/questSystem');
                    await sendQuestNotifications(btnInt.channel, userId, completedQuests);
                }

                collector.stop('dismantled');
            }
        } catch (error) {
            if (error.code === 10062 || error.code === 40060) {
                try { await reply.edit({ components: [] }); } catch (e) { }
            } else {
                console.error('[inventory] Lỗi xử lý nút:', error.message);
            }
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'time') {
            await reply.edit({ components: [] }).catch(() => { });
        }
    });
}

module.exports = { execute, getMaxInventory };


