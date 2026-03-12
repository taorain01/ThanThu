/**
 * ?mem command - View member information (Quản Lý)
 * Usage: ?mem @user | ?mem <UID> | ?mem <Tên nhân vật>
 * 
 * Displays beautiful embed with member info from database
 * Shows 5 random members + hint when no args provided
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');

// Position display config - Wuxia warm gold tones
const POSITION_CONFIG = {
    bc: { name: 'Bang Chủ', emoji: '👑', color: 0xFFD700 },      // Vàng kim
    pbc: { name: 'Phó Bang Chủ', emoji: '⚔️', color: 0xDAA520 }, // Vàng đồng
    kc: { name: 'Kỳ Cựu', emoji: '🏆', color: 0xC0A060 },        // Vàng cổ
    mem: { name: 'Thành Viên', emoji: '👤', color: 0xB8860B }    // Vàng nhạt
};

/**
 * Get position display info
 * @param {string} position - Position code
 * @returns {Object} { name, emoji, color }
 */
function getPositionDisplay(position) {
    const pos = position?.toLowerCase();
    if (POSITION_CONFIG[pos]) {
        return POSITION_CONFIG[pos];
    }
    // Custom kc variant - use kc style with custom name
    return { name: pos?.toUpperCase() || 'Không rõ', emoji: '🏆', color: 0x9B59B6 };
}

/**
 * Display pending ID information (from ?addid)
 * @param {Message} message - Discord message
 * @param {Object} pendingData - Pending ID data from database
 */
async function displayPendingEmbed(message, pendingData) {
    // Calculate days since added
    const addedDate = new Date(pendingData.added_at);
    const today = new Date();
    const daysSinceAdded = Math.floor((today - addedDate) / (1000 * 60 * 60 * 24));

    // Calculate days since joined (if available)
    let joinInfo = 'Không có thông tin';
    if (pendingData.joined_at) {
        const joinedDate = new Date(pendingData.joined_at);
        const daysInGuild = Math.floor((today - joinedDate) / (1000 * 60 * 60 * 24));
        joinInfo = `<t:${Math.floor(joinedDate.getTime() / 1000)}:D> (${daysInGuild} ngày)`;
    }

    const embed = new EmbedBuilder()
        .setColor(0xF59E0B) // Orange for pending
        .setTitle('⏳ Thông tin UID trong danh sách chờ')
        .addFields(
            { name: '🎮 Tên nhân vật', value: pendingData.game_username, inline: true },
            { name: '🆔 UID Game', value: pendingData.game_uid, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '📅 Ngày vào guild', value: joinInfo, inline: true },
            { name: '⏱️ Đã thêm cách đây', value: `${daysSinceAdded} ngày`, inline: true }
        )
        .setDescription(`💡 **Chưa vào Discord**\nDùng \`?addmem @user pbc ${pendingData.game_uid} ${pendingData.game_username}\` để thêm vào database chính.`)
        .setFooter({ text: 'Danh sách chờ • Dùng ?listid để xem tất cả' })
        .setTimestamp();

    await message.channel.send({ embeds: [embed] });
}

/**
 * Execute xem command
 * @param {Message} message - Discord message
 * @param {Array} args - Command arguments
 */
async function execute(message, args) {
    let userData = null;
    let searchMethod = '';
    let discordUser = null;

    // Check for mentioned user first
    const mentionedUser = message.mentions.users.first();

    if (mentionedUser) {
        // Search by Discord mention
        userData = db.getUserByDiscordId(mentionedUser.id);
        discordUser = mentionedUser;
        searchMethod = 'mention';
    } else if (args.length > 0) {
        // Get search term from args
        const searchTerm = args.join(' ');

        // Guess the expected search method for the error message
        if (/^\d{17,20}$/.test(searchTerm)) {
            searchMethod = 'discord_id';
        } else if (/^\d+$/.test(searchTerm)) {
            searchMethod = 'uid';
        } else {
            searchMethod = 'username';
        }

        // Check if it's a Discord ID (17-20 digits)
        if (/^\d{17,20}$/.test(searchTerm)) {
            userData = db.getUserByDiscordId(searchTerm);

            // Try to fetch Discord user for avatar
            if (userData) {
                try {
                    discordUser = await message.client.users.fetch(searchTerm);
                } catch (e) {
                    // User might have left Discord, continue without avatar
                }
            }
        }

        // Try to search by game UID (if it's a number and not already found)
        if (!userData && /^\d+$/.test(searchTerm)) {
            userData = db.getUserByGameUid(searchTerm);

            // If not found, check pending_ids
            if (!userData) {
                try {
                    const pendingData = db.db.prepare('SELECT * FROM pending_ids WHERE game_uid = ?').get(searchTerm);
                    if (pendingData) {
                        return displayPendingEmbed(message, pendingData);
                    }
                } catch (e) {
                    // Table might not exist yet, continue
                }
            }
        }

        // If not found by UID, try searching by game username
        if (!userData) {
            userData = db.getUserByGameUsername(searchTerm);

            // If still not found, check pending_ids by username
            if (!userData) {
                try {
                    const pendingData = db.db.prepare('SELECT * FROM pending_ids WHERE game_username LIKE ?').get(`%${searchTerm}%`);
                    if (pendingData) {
                        return displayPendingEmbed(message, pendingData);
                    }
                } catch (e) {
                    // Table might not exist yet, continue
                }
            }
        }

        // If still not found, try searching by Discord username
        if (!userData) {
            try {
                // Search guild members by username or display name
                let foundMember = message.guild.members.cache.find(m =>
                    m.user.username.toLowerCase() === searchTerm.toLowerCase() ||
                    m.displayName?.toLowerCase() === searchTerm.toLowerCase()
                );

                // If not in cache, try API search
                if (!foundMember) {
                    const searchResults = await message.guild.members.search({ query: searchTerm, limit: 1 });
                    foundMember = searchResults.first();
                }

                if (foundMember) {
                    userData = db.getUserByDiscordId(foundMember.id);
                    if (userData) {
                        discordUser = foundMember.user;
                    }
                }
            } catch (e) {
                // Search failed, continue
            }
        }

        // If found, try to get Discord user (if not already set)
        if (userData && !discordUser) {
            try {
                discordUser = await message.client.users.fetch(userData.discord_id);
            } catch (error) {
                // User might have left Discord, continue without avatar
                console.log(`Could not fetch Discord user ${userData.discord_id}`);
            }
        }
    } else {
        // No arguments provided - Xem thông tin bản thân
        userData = db.getUserByDiscordId(message.author.id);
        discordUser = message.author;
        searchMethod = 'self';

        // Nếu không tìm thấy trong DB
        if (!userData) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Không tìm thấy thông tin')
                .setDescription(`Bạn chưa được thêm vào database.\nNhờ Quản Lý dùng \`?addmem @${message.author.username} <chức vụ> <UID> <Tên nhân vật>\` để thêm.`)
                .addFields({
                    name: '💡 Cách dùng lệnh ?mem',
                    value: '• `?mem` - Xem thông tin bản thân\n• `?mem @user` - Xem theo tag Discord\n• `?mem 12345` - Xem theo UID game\n• `?mem TenNhanVat` - Xem theo tên nhân vật',
                    inline: false
                })
                .setTimestamp();
            return message.channel.send({ embeds: [embed] });
        }
    }

    // If no user data found
    if (!userData) {
        const searchInfo = searchMethod === 'uid' ? `UID **${args.join(' ')}**` :
            searchMethod === 'username' ? `tên nhân vật **${args.join(' ')}**` :
                'thông tin này';

        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Không tìm thấy thông tin')
            .setDescription(`Không tìm thấy thành viên với ${searchInfo}.`)
            .setTimestamp();

        return message.channel.send({ embeds: [embed] });
    }

    // === SYNC POSITION WITH DISCORD ROLES ===
    // If user has high DB position but no longer has Discord role, downgrade to mem
    try {
        // Phương án 4: Dùng cache trước, chỉ fetch nếu cần
        const member = message.guild.members.cache.get(userData.discord_id)
            || await message.guild.members.fetch(userData.discord_id);
        if (member) {
            const hasKcRole = member.roles.cache.some(r => r.name === 'Kỳ Cựu');
            const hasQuanLyRole = member.roles.cache.some(r => r.name === 'Quản Lý');
            const hasBangChuRole = member.roles.cache.some(r => r.name === 'Bang Chủ');
            const hasPhoBangChuRole = member.roles.cache.some(r => r.name === '✦ Phó Guild');

            const dbPosition = userData.position?.toLowerCase();
            let shouldDowngrade = false;

            // Check if DB position doesn't match Discord roles
            if (dbPosition === 'bc' && !hasBangChuRole && !hasQuanLyRole) {
                shouldDowngrade = true;
            } else if (dbPosition === 'pbc' && !hasPhoBangChuRole && !hasQuanLyRole) {
                shouldDowngrade = true;
            } else if (dbPosition === 'kc' && !hasKcRole && !hasQuanLyRole) {
                shouldDowngrade = true;
            }

            if (shouldDowngrade) {
                db.updateUserPosition(userData.discord_id, 'mem');
                userData.position = 'mem';
            }
        }
    } catch (e) {
        // Member might not be fetchable, skip sync
    }

    // Get position display
    const posDisplay = getPositionDisplay(userData.position);

    // Calculate days in guild
    const joinedDate = new Date(userData.joined_at);
    const today = new Date();
    const daysInGuild = Math.floor((today - joinedDate) / (1000 * 60 * 60 * 24));

    // Format footer với thông tin ngày - Ẩn ngày vào nếu đã rời guild
    const gameName = userData.game_username || 'Chưa có';
    const uid = userData.game_uid || '???';
    const isLeftMember = !!userData.left_at;
    const footerText = isLeftMember
        ? `${gameName} • ${uid} • Hôm nay lúc ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
        : `${gameName} • ${uid} • Ngày vào: ${joinedDate.toLocaleDateString('vi-VN')} • Hôm nay lúc ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;

    // === CHECK CUSTOM AVATAR - FULL EMBED + CARD ===
    let customAvatar = db.getUserAvatar(userData.discord_id);
    const kcSubtype = userData.sub_role || userData.kc_subtype || null; // Get sub_role for display

    // === RANDOM AVATAR LOGIC ===
    if (userData.avatar_random_mode > 0) {
        const albumImages = db.getAlbumImages(userData.discord_id, 1, 100);
        let pickedImage = null;

        if (userData.avatar_random_mode === 1 && albumImages.length > 0) {
            // Pick random from all
            pickedImage = albumImages[Math.floor(Math.random() * albumImages.length)];
        } else if (userData.avatar_random_mode === 2 && userData.avatar_random_list) {
            // Pick from list
            try {
                const allowedNumbers = JSON.parse(userData.avatar_random_list);
                const filtered = albumImages.filter(img => allowedNumbers.includes(img.image_number));
                if (filtered.length > 0) {
                    pickedImage = filtered[Math.floor(Math.random() * filtered.length)];
                }
            } catch (e) {
                console.error('[mem] Error parsing random list:', e.message);
            }
        }

        if (pickedImage) {
            customAvatar = { primary: pickedImage.image_url, backup: null };
        }
    }

    // Debug log
    console.log(`[mem] User ${userData.discord_id} - Avatar:`, customAvatar ? customAvatar.primary : 'null');

    if (customAvatar) {
        try {
            const { createMemberCard } = require('../../utils/memberCard');
            const attachment = await createMemberCard(userData, customAvatar, kcSubtype);

            // Embed đầy đủ thông tin + card
            const cardEmbed = new EmbedBuilder()
                .setColor(posDisplay.color)
                .setTitle(`${posDisplay.emoji} Hồ Sơ Giang Hồ`);

            if (discordUser) {
                cardEmbed.setThumbnail(discordUser.displayAvatarURL({ dynamic: true, size: 256 }));
            }

            cardEmbed.addFields(
                { name: '🎭 Hiệp Khách', value: discordUser ? `<@${userData.discord_id}>` : userData.discord_name, inline: true }
            )
                .setImage('attachment://member_card.png')
                .setFooter({ text: footerText });

            return message.channel.send({ embeds: [cardEmbed], files: [attachment] });
        } catch (e) {
            console.error('[mem] Error rendering member card:', e.message);
            // Fallback to full embed below
        }
    }

    // === EMBED VỚI CARD MẶC ĐỊNH (khi không có custom avatar) ===
    try {
        const { createDefaultCard } = require('../../utils/memberCard');
        const attachment = await createDefaultCard(userData, kcSubtype);

        const defaultEmbed = new EmbedBuilder()
            .setColor(posDisplay.color)
            .setTitle(`${posDisplay.emoji} Hồ Sơ Giang Hồ`);

        if (discordUser) {
            defaultEmbed.setThumbnail(discordUser.displayAvatarURL({ dynamic: true, size: 256 }));
        }

        defaultEmbed.addFields(
            { name: '🎭 Hiệp Khách', value: discordUser ? `<@${userData.discord_id}>` : userData.discord_name, inline: true }
        )
            .setImage('attachment://member_card.png')
            .setFooter({ text: footerText });

        if (userData.notes) {
            defaultEmbed.addFields({ name: '📝 Ghi chú', value: userData.notes });
        }

        await message.channel.send({ embeds: [defaultEmbed], files: [attachment] });
    } catch (e) {
        console.error('[mem] Error rendering default card:', e.message);
        // Simple fallback without image
        const fallbackEmbed = new EmbedBuilder()
            .setColor(posDisplay.color)
            .setTitle(`${posDisplay.emoji} Hồ Sơ Giang Hồ`)
            .addFields(
                { name: '🎭 Hiệp Khách', value: discordUser ? `<@${userData.discord_id}>` : userData.discord_name, inline: true }
            )
            .setFooter({ text: footerText });
        await message.channel.send({ embeds: [fallbackEmbed] });
    }
}

/**
 * Hiển thị 5 thành viên ngẫu nhiên + hint lệnh khi không có args
 * @param {Message} message - Discord message
 */
async function showRandomMembersHint(message) {
    // Lấy tất cả thành viên đang hoạt động
    const allMembers = db.getActiveGuildMembers();

    if (allMembers.length === 0) {
        return message.reply('📭 Chưa có thành viên nào trong database!');
    }

    // Shuffle và lấy 5 người ngẫu nhiên
    const shuffled = allMembers.sort(() => 0.5 - Math.random());
    const randomMembers = shuffled.slice(0, Math.min(5, allMembers.length));

    // Format danh sách
    const memberList = randomMembers.map((m, i) => {
        const posDisplay = getPositionDisplay(m.position);
        const gameName = m.game_username || 'Chưa có';
        return `${i + 1}. ${posDisplay.emoji} **${gameName}** - <@${m.discord_id}>`;
    }).join('\n');

    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('👥 Danh sách thành viên (ngẫu nhiên)')
        .setDescription(`**Tổng thành viên:** ${allMembers.length} người\n\n${memberList}`)
        .addFields({
            name: '💡 Cách dùng lệnh ?mem',
            value: '• `?mem @user` - Xem theo tag Discord\n• `?mem 12345` - Xem theo UID game\n• `?mem TenNhanVat` - Xem theo tên nhân vật',
            inline: false
        })
        .setFooter({ text: 'Dùng ?listmem để xem danh sách đầy đủ' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

module.exports = {
    execute,
    aliases: ['me']
};


