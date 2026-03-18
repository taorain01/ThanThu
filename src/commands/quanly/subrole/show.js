/**
 * ?role / ?show - Đổi display icon hiển thị (Phong cách Võ Lâm)
 * Usage: ?role hoặc ?role <mã>
 * 
 * Flow:
 *   1. Hiện embed "Vô danh môn phái" + select menu (30 giây)
 *   2. Chọn role → embed cập nhật với câu nói vui + vẫn giữ menu
 *   3. Hết 30 giây → embed kết thúc "Con đường chân chính..."
 */

const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const db = require('../../../database/db');
const { getRoleMappings, getSubRoleName, DISPLAY_ROLE_NAME } = require('./addrole');
const { removeAllDisplayRoles, assignDisplayRole } = require('./setrole');

const OWNER_ID = '395151484179841024';
const TIMEOUT_SECONDS = 30;

// ═══════════════════════════════════════════════════════════════
// Câu nói ngẫu nhiên - khi vừa chọn xong role
// ═══════════════════════════════════════════════════════════════
const QUOTES_AFTER_SELECT = [
    'Lòng người khó đoán, danh hiệu còn khó đoán hơn!',
    'Giang hồ hiểm ác, đổi danh hiệu cho vui thôi~',
    'Một bước lên trời, hay chỉ đổi cái tên? 🤔',
    'Mưa gió bất chợt, danh hiệu cũng bất chợt!',
    'Kiếm đã rút ra, danh hiệu đã thay đổi!',
    'Đường xa vạn dặm, bắt đầu từ danh hiệu mới!',
    'Võ lâm chấn động vì một lần đổi danh hiệu...',
    'Người ta đổi áo, ngươi đổi danh hiệu. Cũng hợp lý! 😏',
    'Gió thổi mây bay, danh hiệu đổi thay~',
    'Trời sinh ta ắt có danh hiệu phù hợp!',
    'Nhất kiếm... à nhầm, nhất danh hiệu xưng hùng!',
    'Đổi danh hiệu nhanh hơn đổi chiêu thức! ⚡',
];

// ═══════════════════════════════════════════════════════════════
// Câu kết - khi hết timeout "Con đường chân chính..."
// ═══════════════════════════════════════════════════════════════
const QUOTES_FINAL = [
    'Đường kiếm đã chọn, không quay đầu lại!',
    'Thiên hạ đệ nhất... ít ra là trong lòng ta!',
    'Gió cuốn mây bay, danh hiệu vẫn còn đây!',
    'Một kiếm phá vạn pháp, một danh hiệu định thiên hạ!',
    'Giang hồ lại có thêm một cao thủ!',
    'Danh hiệu đã định, vận mệnh đã an bài.',
    'Từ nay, thiên hạ sẽ nhớ tên ngươi!',
    'Con đường phía trước, chỉ có tiến không có lùi!',
    'Vạn kiếm quy tông, danh hiệu quy nhất!',
    'Trời cao đất rộng, danh hiệu ta là nhất!',
];

function randomQuote(list) {
    return list[Math.floor(Math.random() * list.length)];
}

// ═══════════════════════════════════════════════════════════════
// Tạo select menu options từ danh sách role user có
// ═══════════════════════════════════════════════════════════════
function buildSelectMenuOptions(availableRoles, currentDisplay) {
    const options = availableRoles.map(([code, entry]) => {
        const name = typeof entry === 'string' ? entry : entry.name;
        const emojiId = typeof entry === 'object' ? entry.emojiId : null;
        const isCurrent = currentDisplay === code;

        const option = {
            label: name,
            description: isCurrent ? '⭐ Đang hiển thị' : `Mã: ${code}`,
            value: code,
            default: isCurrent
        };

        if (emojiId) {
            option.emoji = { id: emojiId };
        }

        return option;
    });

    // Thêm option ẩn role
    options.push({
        label: '🔕 Ẩn danh hiệu',
        description: 'Trở về ẩn danh giang hồ',
        value: 'hide_icon',
        emoji: '🔕'
    });

    return options;
}

// ═══════════════════════════════════════════════════════════════
// Tạo embed ban đầu - "Hãy chọn Danh Hiệu"
// ═══════════════════════════════════════════════════════════════
function buildInitialEmbed(user, currentRoleName, currentEmojiStr) {
    const displayName = currentRoleName || 'Vô danh môn phái';
    const iconStr = currentEmojiStr ? `${currentEmojiStr} ` : '';

    return new EmbedBuilder()
        .setColor(0x2B2D31) // Màu tối - huyền bí
        .setAuthor({
            name: `${user.displayName}`,
            iconURL: user.displayAvatarURL({ dynamic: true, size: 64 })
        })
        .setDescription(
            `${iconStr}**${displayName}**\n\n` +
            `⚔️ Hãy chọn **Danh Hiệu** của ngươi`
        )
        .setFooter({ text: '💡 Dùng ?role để đổi danh hiệu' });
}

// ═══════════════════════════════════════════════════════════════
// Tạo embed sau khi chọn role - câu nói vui + "Có muốn thay đổi?"
// ═══════════════════════════════════════════════════════════════
function buildAfterSelectEmbed(user, roleName, emojiStr) {
    const iconStr = emojiStr ? `${emojiStr} ` : '';
    const funnyQuote = randomQuote(QUOTES_AFTER_SELECT);

    return new EmbedBuilder()
        .setColor(0xF1C40F) // Vàng kim - đã chọn
        .setAuthor({
            name: `${user.displayName}`,
            iconURL: user.displayAvatarURL({ dynamic: true, size: 64 })
        })
        .setDescription(
            `${iconStr}**${roleName}**\n\n` +
            `*${funnyQuote}*\n` +
            `Ngươi có muốn thay đổi?`
        )
        .setFooter({ text: '💡 Dùng ?role để đổi danh hiệu' });
}

// ═══════════════════════════════════════════════════════════════
// Tạo embed kết thúc - "Con đường chân chính..."
// ═══════════════════════════════════════════════════════════════
function buildFinalEmbed(user, roleName, emojiStr) {
    const iconStr = emojiStr ? `${emojiStr} ` : '';
    const finalQuote = randomQuote(QUOTES_FINAL);

    return new EmbedBuilder()
        .setColor(0x9B59B6) // Tím - kết thúc
        .setAuthor({
            name: `${user.displayName}`,
            iconURL: user.displayAvatarURL({ dynamic: true, size: 64 })
        })
        .setDescription(
            `Con đường chân chính của **${user.displayName}** là\n\n` +
            `${iconStr}**${roleName}**\n\n` +
            `*${finalQuote}*`
        )
        .setFooter({ text: '💡 Dùng ?role để đổi danh hiệu' });
}

// ═══════════════════════════════════════════════════════════════
// Tạo embed ẩn danh hiệu
// ═══════════════════════════════════════════════════════════════
function buildHiddenEmbed(user) {
    return new EmbedBuilder()
        .setColor(0x2B2D31)
        .setAuthor({
            name: `${user.displayName}`,
            iconURL: user.displayAvatarURL({ dynamic: true, size: 64 })
        })
        .setDescription(
            `Con đường chân chính của **${user.displayName}** là\n\n` +
            `🌫️ **Ẩn danh giang hồ**\n\n` +
            `*Gió không để lại dấu vết, người không để lại danh hiệu...*`
        )
        .setFooter({ text: '💡 Dùng ?role để đổi danh hiệu' });
}

// ═══════════════════════════════════════════════════════════════
// Lấy emoji string từ mapping entry
// ═══════════════════════════════════════════════════════════════
function getEmojiString(code, entry) {
    if (!entry) return '';
    const emojiId = typeof entry === 'object' ? entry.emojiId : null;
    if (emojiId) {
        return `<:sr_${code}:${emojiId}>`;
    }
    return '';
}

// ═══════════════════════════════════════════════════════════════
// EXECUTE - Lệnh ?role / ?show
// ═══════════════════════════════════════════════════════════════
async function execute(message, args) {
    try {
        const code = args[0]?.toLowerCase();

        // === Nếu có mã code → đổi nhanh (giữ logic cũ) ===
        if (code) {
            return executeQuickSwitch(message, code);
        }

        // === Không có args → hiện select menu phong cách Võ Lâm ===
        const mappings = getRoleMappings();
        const userRoles = message.member.roles.cache;

        const availableRoles = Object.entries(mappings).filter(([c, entry]) => {
            const roleName = typeof entry === 'string' ? entry : entry.name;
            return userRoles.some(r => r.name === roleName);
        });

        if (availableRoles.length === 0) {
            return message.channel.send('❌ Ngươi chưa có danh hiệu nào!\nDùng `?listrole` để xem các danh hiệu có thể nhận, rồi post hình chứng minh vào đây để được cấp role nhé!');
        }

        // Lấy display hiện tại
        const currentDisplay = db.getUserDisplay(message.author.id);
        const currentEntry = currentDisplay ? mappings[currentDisplay] : null;
        const currentRoleName = currentEntry
            ? (typeof currentEntry === 'string' ? currentEntry : currentEntry.name)
            : null;
        const currentEmoji = currentEntry ? getEmojiString(currentDisplay, currentEntry) : '';

        // Tạo select menu
        const options = buildSelectMenuOptions(availableRoles, currentDisplay);
        const selectMenu = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`show_role_select_${message.author.id}`)
                    .setPlaceholder('Chọn danh hiệu của ngươi...')
                    .addOptions(options)
            );

        // Embed ban đầu
        const embed = buildInitialEmbed(message.author, currentRoleName, currentEmoji);

        const sentMessage = await message.channel.send({ embeds: [embed], components: [selectMenu] });

        // ═══════════════════════════════════════════════════════════════
        // Collector - 30 giây timeout
        // ═══════════════════════════════════════════════════════════════
        const filter = (i) => {
            return i.customId === `show_role_select_${message.author.id}` &&
                   i.user.id === message.author.id;
        };

        const collector = sentMessage.createMessageComponentCollector({
            filter,
            time: TIMEOUT_SECONDS * 1000,
        });

        // Biến theo dõi role cuối cùng được chọn
        let lastSelectedRole = currentRoleName || 'Vô danh môn phái';
        let lastSelectedEmoji = currentEmoji;
        let wasHidden = false;

        collector.on('collect', async (interaction) => {
            try {
                const selectedValue = interaction.values[0];

                // === Ẩn danh hiệu ===
                if (selectedValue === 'hide_icon') {
                    await removeAllDisplayRoles(interaction.member);
                    db.setUserDisplay(interaction.member.id, 'hidden');
                    
                    try {
                        const cardCache = require('../../utils/memberCardCache');
                        cardCache.invalidateUser(interaction.member.id);
                    } catch (e) { }

                    wasHidden = true;
                    lastSelectedRole = 'Ẩn danh giang hồ';
                    lastSelectedEmoji = '🌫️';

                    const hiddenEmbed = buildAfterSelectEmbed(
                        interaction.user, 'Ẩn danh giang hồ', '🌫️'
                    );

                    // Rebuild options với default mới
                    const newCurrentDisplay = 'hidden';
                    const newOptions = buildSelectMenuOptions(availableRoles, newCurrentDisplay);
                    const newMenu = new ActionRowBuilder()
                        .addComponents(
                            new StringSelectMenuBuilder()
                                .setCustomId(`show_role_select_${message.author.id}`)
                                .setPlaceholder('Chọn danh hiệu của ngươi...')
                                .addOptions(newOptions)
                        );

                    await interaction.update({ embeds: [hiddenEmbed], components: [newMenu] });
                    return;
                }

                // === Chọn role ===
                const entry = mappings[selectedValue];
                if (!entry) {
                    await interaction.reply({
                        content: `❌ Mã \`${selectedValue}\` không tồn tại!`,
                        ephemeral: true
                    });
                    return;
                }

                const roleName = typeof entry === 'string' ? entry : entry.name;
                const emojiStr = getEmojiString(selectedValue, entry);

                // Kiểm tra user có role gốc
                const sourceRole = interaction.guild.roles.cache.find(r => r.name === roleName);
                if (!sourceRole || !interaction.member.roles.cache.has(sourceRole.id)) {
                    await interaction.reply({
                        content: `❌ Ngươi không sở hữu danh hiệu **${roleName}**!`,
                        ephemeral: true
                    });
                    return;
                }

                // Gán display role
                const displayAssigned = await assignDisplayRole(
                    interaction.member, interaction.guild.id, selectedValue
                );

                if (!displayAssigned) {
                    await interaction.reply({
                        content: `⚠️ Không tìm thấy display role cho \`${selectedValue}\`. Liên hệ Bang Chủ!`,
                        ephemeral: true
                    });
                    return;
                }

                // Invalidate cache
                try {
                    const cardCache = require('../../utils/memberCardCache');
                    cardCache.invalidateUser(interaction.member.id);
                } catch (e) { }

                wasHidden = false;
                lastSelectedRole = roleName;
                lastSelectedEmoji = emojiStr;

                // Update embed - câu nói vui + giữ menu
                const afterEmbed = buildAfterSelectEmbed(interaction.user, roleName, emojiStr);

                // Rebuild options với default mới
                const newOptions = buildSelectMenuOptions(availableRoles, selectedValue);
                const newMenu = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`show_role_select_${message.author.id}`)
                            .setPlaceholder('Chọn danh hiệu của ngươi...')
                            .addOptions(newOptions)
                    );

                await interaction.update({ embeds: [afterEmbed], components: [newMenu] });

            } catch (error) {
                console.error('[show] Collector error:', error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ Có lỗi xảy ra!',
                        ephemeral: true
                    });
                }
            }
        });

        // ═══════════════════════════════════════════════════════════════
        // Kết thúc collector - hiện embed "Con đường chân chính..."
        // ═══════════════════════════════════════════════════════════════
        collector.on('end', async () => {
            try {
                let finalEmbed;
                if (wasHidden) {
                    finalEmbed = buildHiddenEmbed(message.author);
                } else {
                    finalEmbed = buildFinalEmbed(message.author, lastSelectedRole, lastSelectedEmoji);
                }

                await sentMessage.edit({ embeds: [finalEmbed], components: [] });
            } catch (e) {
                // Tin nhắn có thể đã bị xóa
            }
        });

    } catch (error) {
        console.error('[show] Error:', error);
        return message.channel.send('❌ Đã xảy ra lỗi!');
    }
}

// ═══════════════════════════════════════════════════════════════
// Quick switch - ?role <mã> (logic cũ, giữ nguyên)
// ═══════════════════════════════════════════════════════════════
async function executeQuickSwitch(message, code) {
    const mappingEntry = getRoleMappings()[code];
    if (!mappingEntry) {
        return message.channel.send(`❌ Mã \`${code}\` không tồn tại!`);
    }

    const roleName = typeof mappingEntry === 'string' ? mappingEntry : mappingEntry.name;

    // Check user có role gốc không
    const sourceRole = message.guild.roles.cache.find(r => r.name === roleName);
    if (!sourceRole || !message.member.roles.cache.has(sourceRole.id)) {
        return message.channel.send(`❌ Ngươi chưa sở hữu danh hiệu **${roleName}**!`);
    }

    // Auto sync vào DB nếu chưa có
    const userData = db.getUserByDiscordId(message.author.id);
    if (userData) {
        const currentSubRole = db.getUserSubRole(message.author.id);
        if (!currentSubRole) {
            db.setUserSubRole(message.author.id, code);
        }
    }

    // Gán display role
    const displayAssigned = await assignDisplayRole(message.member, message.guild.id, code);

    if (displayAssigned) {
        try {
            const cardCache = require('../../utils/memberCardCache');
            cardCache.invalidateUser(message.author.id);
        } catch (e) { }

        const emojiStr = getEmojiString(code, mappingEntry);
        const finalEmbed = buildFinalEmbed(message.author, roleName, emojiStr);
        return message.channel.send({ embeds: [finalEmbed] });
    } else {
        return message.channel.send(`⚠️ Không tìm thấy display role cho \`${code}\`. Liên hệ Bang Chủ!`);
    }
}

module.exports = { execute };
