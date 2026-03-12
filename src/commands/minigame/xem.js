/**
 * ?xem <id> hoặc ?xem @user - Xem chi tiết item hoặc trang bị người chơi
 * - ?xem -> Xem trang bị của bản thân
 * - ?xem @user -> Xem trang bị của người chơi
 * - ?xem <id> -> Xem chi tiết item
 * Aliases: ?item, ?it
 */

const { EmbedBuilder } = require('discord.js');
const economyDb = require('../../database/economy');
const { SLOTS, getPlayerClass, getClassInfo, isDeCu } = require('../../utils/classSystem');
const { calculateEquipmentMastery, formatLine } = require('../../utils/tuneSystem');
const ICONS = require('../../config/icons');

async function execute(message, args, client) {
    // Nếu không có args -> xem trang bị của bản thân
    if (args.length === 0) {
        return showPlayerProfile(message, message.author);
    }

    // Check if first arg is a mention
    const mentionedUser = message.mentions.users.first();
    if (mentionedUser) {
        return showPlayerProfile(message, mentionedUser);
    }

    // Check if arg is a number (could be item ID or user ID)
    const numArg = args[0];

    // If it's a 6 digit number, could be item ID
    if (/^\d{1,6}$/.test(numArg)) {
        const itemId = parseInt(numArg);
        const item = economyDb.getEquipment(itemId);
        if (item) {
            return showItemDetail(message, itemId);
        }
    }

    // Try to find user by ID (discord user ID is 17-20 digits)
    if (/^\d{17,20}$/.test(numArg)) {
        try {
            const user = await message.client.users.fetch(numArg);
            if (user) {
                return showPlayerProfile(message, user);
            }
        } catch (e) { /* not a valid user ID */ }
    }

    // Try to find user by username
    const searchName = args.join(' ').toLowerCase();
    const members = await message.guild.members.fetch();
    const foundMember = members.find(m =>
        m.user.username.toLowerCase() === searchName ||
        m.user.username.toLowerCase().includes(searchName) ||
        (m.displayName && m.displayName.toLowerCase().includes(searchName))
    );

    if (foundMember) {
        return showPlayerProfile(message, foundMember.user);
    }

    // Last resort: try as item ID
    const itemId = parseInt(args[0]);
    if (!isNaN(itemId)) {
        return showItemDetail(message, itemId);
    }

    return message.reply('❌ Không tìm thấy người chơi hoặc item! Ví dụ: `?xem @Rain` hoặc `?xem 000123`');
}

async function showItemDetail(message, itemId) {
    const item = economyDb.getEquipment(itemId);

    if (!item) {
        return message.reply('❌ Không tìm thấy item với ID này!');
    }

    const playerClass = getPlayerClass(message.member);
    const slot = SLOTS[item.slot];
    const mastery = calculateEquipmentMastery(item, playerClass);
    const rarityColor = item.rarity === 'gold' ? '#F1C40F' : '#9B59B6';
    const rarityIcon = item.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;

    // Đếm dòng đề cử cho mỗi class để xác định "Phù hợp cho"
    const deCuCount = { dps: 0, tanker: 0, healer: 0 };
    const allLines = [...item.lines, item.final_line].filter(Boolean);

    for (const line of allLines) {
        if (isDeCu(line.stat, 'dps')) deCuCount.dps++;
        if (isDeCu(line.stat, 'tanker')) deCuCount.tanker++;
        if (isDeCu(line.stat, 'healer')) deCuCount.healer++;
    }

    // Tìm class phù hợp nhất
    let bestClass = 'dps';
    let maxCount = deCuCount.dps;
    if (deCuCount.tanker > maxCount) { bestClass = 'tanker'; maxCount = deCuCount.tanker; }
    if (deCuCount.healer > maxCount) { bestClass = 'healer'; }

    const classNames = { dps: 'DPS ⚔️', tanker: 'Tanker 🛡️', healer: 'Healer 💚' };
    const recommendedClass = allLines.length > 0 ? classNames[bestClass] : 'Chưa có dòng';

    let linesText = '';
    for (let i = 0; i < item.lines.length; i++) {
        const line = item.lines[i];
        const lineRarity = line.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;
        const deCu = isDeCu(line.stat, playerClass) ? ' `Đề Cử`' : '';
        const valueText = line.value ? `+${line.value}${line.unit || ''}` : '';
        linesText += `${i + 1}. ${lineRarity} ${line.icon} **${line.name}** ${valueText} (${line.percent}%)${deCu}\n`;
    }

    if (item.final_line) {
        const fl = item.final_line;
        const flRarity = fl.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;
        const deCu = isDeCu(fl.stat, playerClass) ? ' `Đề Cử`' : '';
        const valueText = fl.value ? `+${fl.value}${fl.unit || ''}` : '';
        linesText += `${ICONS.rarity.starDecu} ${flRarity} ${fl.icon} **${fl.name}** ${valueText} (${fl.percent}%)${deCu} *[Dòng Cuối]*`;
    }

    const embed = new EmbedBuilder()
        .setColor(rarityColor)
        .setTitle(`${rarityIcon} ${item.name} (${slot.shortName})`)
        .setDescription(`**ID:** \`${String(item.id).padStart(6, '0')}\`\n**Slot:** ${slot.icon} ${slot.name}\n**Tier:** ${item.tier}\n**Độ hiếm:** ${item.rarity === 'gold' ? 'Vàng' : 'Tím'}\n**Phù hợp cho:** ${recommendedClass}`)
        .addFields(
            { name: `📜 Dòng phụ (${item.lines.length}/5)`, value: linesText || 'Không có', inline: false },
            { name: '⚔️ Mastery', value: `\`${mastery}\``, inline: true },
            { name: '📍 Trạng thái', value: item.is_equipped ? '✅ Đang mặc' : '❌ Trong kho', inline: true }
        )
        .setFooter({ text: '?tune <id> để nâng cấp • ?equip <id> để mặc' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

async function showPlayerProfile(message, targetUser) {
    const userId = targetUser.id;
    const member = await message.guild.members.fetch(userId).catch(() => null);
    const playerClass = member ? getPlayerClass(member) : null;
    const classInfo = playerClass ? getClassInfo(playerClass) : null;

    const equippedItems = economyDb.getUserEquipment(userId).filter(i => i.is_equipped);

    // Tính tổng mastery
    let totalMastery = 0;
    for (const item of equippedItems) {
        totalMastery += calculateEquipmentMastery(item, playerClass);
    }

    // Get achievement stats
    let achievementStats = { unlocked: 0, total: 30, percentage: 0 };
    try {
        const { getAchievementStats } = require('../../utils/achievementSystem');
        achievementStats = getAchievementStats(userId);
    } catch (e) { /* ignore */ }

    // Get daily quest completion
    let dailyCompleted = 0;
    try {
        const { getOrGenerateDailyQuests, getOrGenerateWeeklyQuests } = require('../../utils/questSystem');
        const dailyResult = getOrGenerateDailyQuests(userId);
        const weeklyResult = getOrGenerateWeeklyQuests(userId);
        const dailyQuests = dailyResult.quests || dailyResult;
        const weeklyQuests = weeklyResult.quests || weeklyResult;
        const totalDailyCompleted = dailyQuests.filter(q => q.claimed).length;
        dailyCompleted = totalDailyCompleted; // Assign to dailyCompleted
    } catch (e) { /* ignore */ }

    // Build class icon
    const classIcon = classInfo ? classInfo.icon : '👤';
    const className = classInfo ? classInfo.name : 'Chưa chọn phái';

    // Màu theo class
    const embedColor = playerClass === 'dps' ? 0x3498DB
        : playerClass === 'tanker' ? 0xE67E22
            : playerClass === 'healer' ? 0x2ECC71
                : 0x9B59B6;

    // Tạo progress bar cho Mastery (max 10000)
    const maxMastery = 10000;
    const masteryPercent = Math.min(totalMastery / maxMastery, 1);
    const filledBlocks = Math.round(masteryPercent * 10);
    const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(10 - filledBlocks);

    // Slot order cho 2 cột: Phòng Thủ và Tấn Công
    const SLOT_ORDER_TOP = ['mu', 'giap', 'gang', 'giay'];
    const SLOT_ORDER_BOTTOM = ['vukhi', 'vukhiphu', 'khuyentai', 'ngocboi'];

    // Tạo map slot -> item
    const slotMap = {};
    for (const item of equippedItems) {
        slotMap[item.slot] = item;
    }

    // Format cột Phòng Thủ
    let defenseCol = '';
    for (const slotKey of SLOT_ORDER_TOP) {
        const slot = SLOTS[slotKey];
        const item = slotMap[slotKey];
        if (item) {
            const rarityIcon = item.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;
            const mastery = calculateEquipmentMastery(item, playerClass);
            defenseCol += `${rarityIcon} \`${String(item.id).padStart(6, '0')}\` **${item.name}** (${slot.shortName})\n└ Mastery: \`${mastery}\`\n`;
        } else {
            defenseCol += `▫️ ${slot.icon} *Trống*\n`;
        }
    }

    // Format cột Tấn Công
    let attackCol = '';
    for (const slotKey of SLOT_ORDER_BOTTOM) {
        const slot = SLOTS[slotKey];
        const item = slotMap[slotKey];
        if (item) {
            const rarityIcon = item.rarity === 'gold' ? ICONS.rarity.gold : ICONS.rarity.purple;
            const mastery = calculateEquipmentMastery(item, playerClass);
            attackCol += `${rarityIcon} \`${String(item.id).padStart(6, '0')}\` **${item.name}** (${slot.shortName})\n└ Mastery: \`${mastery}\`\n`;
        } else {
            attackCol += `▫️ ${slot.icon} *Trống*\n`;
        }
    }

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`👤 ${targetUser.username}`)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .setDescription(`${classIcon} **${className}** • Mastery: **${totalMastery}**/${maxMastery}\n\`${progressBar}\``)
        .addFields(
            { name: '🛡️ Phòng Thủ', value: defenseCol || '*Trống*', inline: true },
            { name: '⚔️ Tấn Công', value: attackCol || '*Trống*', inline: true },
            {
                name: '📈 Tiến độ',
                value: `🏆 Thành tựu: **${achievementStats.unlocked}/${achievementStats.total}** (${achievementStats.percentage}%)\n📋 NV hôm nay: **${dailyCompleted}/5**`,
                inline: false
            }
        )
        .setFooter({ text: '?nv để xem nhiệm vụ • ?thanhtuu để xem thành tựu' })
        .setTimestamp();

    // Chỉ thêm button nếu có trang bị
    if (equippedItems.length === 0) {
        return await message.reply({ embeds: [embed] });
    }

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`player_stats_${userId}`)
            .setLabel('📊 Xem Tổng Chỉ Số')
            .setStyle(ButtonStyle.Primary)
    );

    const reply = await message.reply({ embeds: [embed], components: [row] });

    // Collector for button
    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === message.author.id && i.customId === `player_stats_${userId}`,
        time: 60000
    });

    collector.on('collect', async (interaction) => {
        // Lấy tất cả stat types
        const { STAT_TYPES, SPECIAL_LINES } = require('../../utils/classSystem');

        // Khởi tạo TẤT CẢ chỉ số = 0
        const statsMap = {};

        // Thêm tất cả stats từ STAT_TYPES
        for (const [key, stat] of Object.entries(STAT_TYPES)) {
            statsMap[key] = {
                name: stat.name,
                icon: stat.icon,
                value: 0,
                unit: stat.unit || '',
                stat: key
            };
        }

        // Thêm tất cả stats từ SPECIAL_LINES
        for (const [key, special] of Object.entries(SPECIAL_LINES)) {
            statsMap[key] = {
                name: special.name,
                icon: special.icon,
                value: 0,
                unit: '',
                stat: key
            };
        }

        // Cộng dồn giá trị từ trang bị
        for (const eq of equippedItems) {
            const allLines = [...(eq.lines || []), eq.final_line].filter(Boolean);
            for (const line of allLines) {
                if (line.stat && statsMap[line.stat]) {
                    statsMap[line.stat].value += line.value || 0;
                }
            }
        }

        // Sắp xếp theo đề cử của class - bao gồm TẤT CẢ 18 stats
        const CLASS_PRIORITY = {
            dps: [
                // Đề cử cho DPS (7)
                'min_attack', 'max_attack', 'critical_rate', 'critical_damage', 'penetration', 'the', 'man',
                // Dòng đặc biệt
                'dps_assault', 'universal_weapon',
                // Còn lại
                'max_hp', 'defense', 'evasion', 'damage_reduction', 'agility', 'momentum', 'affinity_rate',
                'the_luc', 'ngu', 'luc', 'cooldown', 'tank_endurance', 'healer_restore'
            ],
            tanker: [
                // Đề cử cho Tanker (7)
                'max_hp', 'defense', 'evasion', 'damage_reduction', 'agility', 'the_luc', 'ngu',
                // Dòng đặc biệt
                'tank_endurance', 'universal_weapon',
                // Còn lại
                'min_attack', 'max_attack', 'critical_rate', 'critical_damage', 'penetration', 'momentum', 'affinity_rate',
                'the', 'man', 'luc', 'cooldown', 'dps_assault', 'healer_restore'
            ],
            healer: [
                // Đề cử cho Healer (8)
                'critical_rate', 'max_hp', 'damage_reduction', 'agility', 'momentum', 'affinity_rate', 'the', 'cooldown',
                // Dòng đặc biệt
                'healer_restore', 'universal_weapon',
                // Còn lại
                'min_attack', 'max_attack', 'critical_damage', 'penetration', 'defense', 'evasion',
                'the_luc', 'ngu', 'man', 'luc', 'dps_assault', 'tank_endurance'
            ]
        };

        const priority = CLASS_PRIORITY[playerClass] || CLASS_PRIORITY.dps;
        const sortedStats = Object.values(statsMap).sort((a, b) => {
            const aPriority = priority.indexOf(a.stat);
            const bPriority = priority.indexOf(b.stat);
            if (aPriority !== -1 && bPriority === -1) return -1;
            if (aPriority === -1 && bPriority !== -1) return 1;
            if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
            return 0;
        });

        // Format display
        let statsText = '';
        for (const stat of sortedStats) {
            const deCuMark = isDeCu(stat.stat, playerClass) ? ` ${ICONS.rarity.starDecu}` : '';
            const value = Math.round(stat.value * 10) / 10;
            statsText += `${stat.icon} **${stat.name}:** +${value}${stat.unit}${deCuMark}\n`;
        }

        if (!statsText) {
            statsText = '*Chưa có chỉ số nào*';
        }

        const classIcons = { dps: '⚔️ DPS', tanker: '🛡️ Tanker', healer: '💚 Healer' };

        const statsEmbed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle(`📊 Tổng Chỉ Số - ${targetUser.username}`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setDescription(`**Class:** ${classIcons[playerClass] || '❓ Chưa chọn'}\n${ICONS.rarity.starDecu} = Đề Cử cho class\n*Tổng hợp từ ${equippedItems.length} trang bị*`)
            .addFields(
                { name: '📋 Tổng Chỉ Số', value: statsText, inline: false }
            )
            .setFooter({ text: `Tổng Mastery: ${totalMastery} điểm` })
            .setTimestamp();

        await interaction.update({ embeds: [statsEmbed], components: [row] });
    });

    collector.on('end', async () => {
        try { await reply.edit({ components: [] }); } catch (e) { }
    });
}

module.exports = { execute };


