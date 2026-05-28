/**
 * PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
 * bangchienManageHandlers.js - Handlers cho Quản lý Bang Chiến
 * PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
 *
 * Handlers (hệ thống CŨ - legacy, vẫn giữ để tương thích ngược):
 *   - bangchien_regular_*         : Đăng ký tham gia định kỳ
 *   - bangchien_regular_confirm_* : Xác nhận đăng ký định kỳ
 *   - bangchien_regular_cancel_*  : Hủy đăng ký định kỳ
 *   - bangchien_kick_*            : Kick member khỏi BC party (leader only)
 *   - bangchien_priority_*        : Ưu tiên member từ danh sách chờ (leader only)
 *   - bangchien_finalize_*        : Chốt danh sách BC (leader only)
 *
 * Được import vào: src/events/client/interactionCreate.js
 * PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
 */

const { EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const {
    bangchienNotifications,
    bangchienRegistrations,
    bangchienFinalizedParties,
    BANGCHIEN_MAX_MEMBERS,
    getDayFromPartyKey
} = require('./bangchienState');
const {
    addBcRegularIfEligible,
    cleanupWeekendBcRegulars,
    getBcRegularEligibility,
    removeBcRegularDay
} = require('./bcRegularCleanup');

const WEEKEND_DAYS = new Set(['sat', 'sun']);

/**
 * Xử lý button interactions cho quản lý Bang Chiến
 * @param {ButtonInteraction} interaction
 * @param {Client} client
 * @returns {boolean} true nếu đã xử lý, false nếu không phải handler này
 */
async function handleButton(interaction, client) {
    const customId = interaction.customId;

    try {
        // PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
        // Xử lý nút Đăng ký (Regular Participant) - BƯỚC 1: Hiển thị xác nhận
        // PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
        if (customId.startsWith('bangchien_regular_') && !customId.includes('_confirm_') && !customId.includes('_cancel_')) {
            const partyKey = customId.replace('bangchien_regular_', '');
            const db = require('../database/db');
            const guildId = interaction.guild.id;
            const userId = interaction.user.id;
            const day = getDayFromPartyKey(partyKey);

            if (!WEEKEND_DAYS.has(day)) {
                if (day) await removeBcRegularDay(guildId, userId, day, 'legacy_invalid_day');
                return interaction.reply({
                    content: '"Luon tham gia" chi ap dung cho Thu 7 va Chu Nhat.',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Kiểm tra trạng thái hiện tại
            const isRegular = db.isBcRegular(guildId, userId, day);
            const eligibility = await getBcRegularEligibility(interaction.guild, userId, interaction.member);
            if (!eligibility.eligible) {
                await cleanupWeekendBcRegulars(interaction.guild, userId, `legacy_blocked:${eligibility.reason}`);
                return interaction.reply({
                    content: 'Ban can co role LangGia de bat "Luon tham gia". Da xoa dang ky dinh ky cu neu co.',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Tạo embed xác nhận với hint
            const confirmEmbed = new EmbedBuilder()
                .setColor(isRegular ? 0xE74C3C : 0x3498DB)
                .setTitle(isRegular ? '❌ HỦY ĐĂNG KÝ THAM GIA ĐỊNH KỲ?' : '✅ XÁC NHẬN THAM GIA ĐỊNH KỲ?')
                .setDescription(
                    isRegular
                        ? '**Bạn có chắc muốn hủy đăng ký tham gia định kỳ?**\n\n' +
                        '⚠️ Sau khi hủy, bạn sẽ **không** tự động được thêm vào danh sách khi có trận Bang Chiến mới.'
                        : '**Bạn có chắc muốn đăng ký tham gia định kỳ?**\n\n' +
                        '📌 **Lưu ý:** Nếu nhấn xác nhận, bạn sẽ **tự động được thêm vào** danh sách đăng ký mỗi khi có trận Bang Chiến mới được mở.\n\n' +
                        '✨ Phù hợp với những người **luôn tham gia** các trận Bang Chiến của bang.'
                )
                .setFooter({ text: 'Bạn có 30 giây để xác nhận' });

            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`bangchien_regular_confirm_${partyKey}_${userId}`)
                        .setLabel('✅ Xác nhận')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`bangchien_regular_cancel_${partyKey}_${userId}`)
                        .setLabel('❌ Hủy bỏ')
                        .setStyle(ButtonStyle.Secondary)
                );

            await interaction.reply({
                embeds: [confirmEmbed],
                components: [confirmRow],
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        // PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
        // Xử lý nút Đăng ký - BƯỚC 2: Xử lý xác nhận
        // PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
        if (customId.startsWith('bangchien_regular_confirm_')) {
            const parts = customId.replace('bangchien_regular_confirm_', '').split('_');
            const partyKey = parts.slice(0, -1).join('_'); // Lấy partyKey (có thể chứa _)
            const targetUserId = parts[parts.length - 1]; // userId là phần cuối

            // Chỉ cho phép user gốc xác nhận
            if (interaction.user.id !== targetUserId) {
                return interaction.reply({
                    content: '❌ Bạn không có quyền thực hiện hành động này!',
                    flags: MessageFlags.Ephemeral
                });
            }

            const db = require('../database/db');
            const guildId = interaction.guild.id;
            const userId = interaction.user.id;
            const username = interaction.user.username;
            const day = getDayFromPartyKey(partyKey);

            if (!WEEKEND_DAYS.has(day)) {
                if (day) await removeBcRegularDay(guildId, userId, day, 'legacy_confirm_invalid_day');
                await interaction.update({
                    content: '"Luon tham gia" chi ap dung cho Thu 7 va Chu Nhat.',
                    embeds: [],
                    components: []
                });
                return true;
            }

            // Toggle: nếu đã đăng ký thì hủy, ngược lại thì thêm
            const isRegular = db.isBcRegular(guildId, userId, day);

            if (isRegular) {
                await removeBcRegularDay(guildId, userId, day, 'legacy_off');
                await interaction.update({
                    content: '✅ Đã **hủy** đăng ký tham gia định kỳ!\nBạn sẽ không tự động được thêm vào BC lần sau.',
                    embeds: [],
                    components: []
                });
            } else {
                const addRegular = await addBcRegularIfEligible(interaction.guild, userId, username, day, interaction.member);
                if (!addRegular.success) {
                    await interaction.update({
                        content: 'Ban can co role LangGia de bat "Luon tham gia". Da xoa dang ky dinh ky cu neu co.',
                        embeds: [],
                        components: []
                    });
                    return true;
                }
                await interaction.update({
                    content: '📌 Đã đăng ký **tham gia định kỳ**!\nBạn sẽ tự động được thêm vào mỗi lần mở ?bc mới.',
                    embeds: [],
                    components: []
                });
            }
            return true;
        }

        // PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
        // Xử lý nút Đăng ký - BƯỚC 3: Xử lý hủy bỏ
        // PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
        if (customId.startsWith('bangchien_regular_cancel_')) {
            const parts = customId.replace('bangchien_regular_cancel_', '').split('_');
            const targetUserId = parts[parts.length - 1];

            // Chỉ cho phép user gốc hủy
            if (interaction.user.id !== targetUserId) {
                return interaction.reply({
                    content: '❌ Bạn không có quyền thực hiện hành động này!',
                    flags: MessageFlags.Ephemeral
                });
            }

            await interaction.update({
                content: '❌ Đã hủy bỏ thao tác.',
                embeds: [],
                components: []
            });
            return true;
        }

        // PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
        // Xử lý nút Loại bỏ (Kick) - Chỉ Leader dùng được
        // PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
        if (customId.startsWith('bangchien_kick_')) {
            const partyKey = customId.replace('bangchien_kick_', '');

            const notifData = bangchienNotifications.get(partyKey);
            if (!notifData) {
                return interaction.reply({
                    content: '❌ Party này không còn hoạt động!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Chỉ leader mới kick được
            if (interaction.user.id !== notifData.leaderId) {
                return interaction.reply({
                    content: '❌ Chỉ Leader mới có thể loại bỏ thành viên!',
                    flags: MessageFlags.Ephemeral
                });
            }

            const registrations = bangchienRegistrations.get(partyKey) || [];

            // Tạo danh sách để chọn kick (không bao gồm leader)
            const kickableMembers = registrations.filter(r => !r.isLeader);

            if (kickableMembers.length === 0) {
                return interaction.reply({
                    content: '⚠️ Không có thành viên nào để loại bỏ!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Tạo select menu để chọn người kick
            const selectOptions = kickableMembers.slice(0, 25).map((r, i) => ({
                label: r.username,
                description: `Thứ tự đăng ký: ${registrations.findIndex(reg => reg.id === r.id) + 1}`,
                value: r.id
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`bangchien_kick_select_${partyKey}`)
                .setPlaceholder('Chọn thành viên để loại bỏ...')
                .setMinValues(1)
                .setMaxValues(Math.min(selectOptions.length, 10))
                .addOptions(selectOptions);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await interaction.reply({
                content: '👢 **Chọn thành viên để loại khỏi danh sách:**',
                components: [row],
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        // PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
        // Xử lý nút Ưu tiên - Đưa người từ danh sách chờ lên danh sách chính
        // PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
        if (customId.startsWith('bangchien_priority_') && !customId.startsWith('bangchien_priority_select_')) {
            const partyKey = customId.replace('bangchien_priority_', '');

            const notifData = bangchienNotifications.get(partyKey);
            if (!notifData) {
                return interaction.reply({
                    content: '❌ Party này không còn hoạt động!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Chỉ leader mới ưu tiên được
            if (interaction.user.id !== notifData.leaderId) {
                return interaction.reply({
                    content: '❌ Chỉ Leader mới có thể ưu tiên thành viên!',
                    flags: MessageFlags.Ephemeral
                });
            }

            const registrations = bangchienRegistrations.get(partyKey) || [];

            // Lấy những người trong danh sách chờ (ngoài danh sách chính)
            const waitingMembers = registrations.slice(BANGCHIEN_MAX_MEMBERS);

            if (waitingMembers.length === 0) {
                return interaction.reply({
                    content: '⚠️ Không có ai trong danh sách chờ để ưu tiên!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Tạo select menu để chọn người ưu tiên
            const selectOptions = waitingMembers.slice(0, 25).map((r, i) => ({
                label: r.username,
                description: `Vị trí chờ: ${i + 1}`,
                value: r.id
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`bangchien_priority_select_${partyKey}`)
                .setPlaceholder('Chọn thành viên để ưu tiên lên danh sách chính...')
                .setMinValues(1)
                .setMaxValues(Math.min(selectOptions.length, 5))
                .addOptions(selectOptions);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await interaction.reply({
                content: '⬆️ **Chọn thành viên từ danh sách chờ để đưa vào danh sách chính:**\n*(Họ sẽ được đưa lên đầu danh sách)*',
                components: [row],
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        // PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
        // Xử lý nút Chốt danh sách Bang Chiến
        // PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
        if (customId.startsWith('bangchien_finalize_')) {
            const partyKey = customId.replace('bangchien_finalize_', '');

            const notifData = bangchienNotifications.get(partyKey);
            if (!notifData) {
                return interaction.reply({
                    content: '❌ Party này không còn hoạt động!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Chỉ leader mới chốt được
            if (interaction.user.id !== notifData.leaderId) {
                return interaction.reply({
                    content: '❌ Chỉ Leader mới có thể chốt danh sách!',
                    flags: MessageFlags.Ephemeral
                });
            }

            const registrations = bangchienRegistrations.get(partyKey) || [];

            if (registrations.length === 0) {
                return interaction.reply({
                    content: '⚠️ Chưa có ai đăng ký!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Dừng interval
            clearInterval(notifData.intervalId);

            // Lookup tên in-game - Áp dụng logic ưu tiên (isPrioritized bypass MAX_MEMBERS)
            const db = require('../database/db');

            // Tách danh sách chính và chờ với logic ưu tiên
            const baseSelected = registrations.slice(0, BANGCHIEN_MAX_MEMBERS);
            const afterMax = registrations.slice(BANGCHIEN_MAX_MEMBERS);
            const prioritizedAfterMax = afterMax.filter(r => r.isPrioritized);
            const nonPrioritizedAfterMax = afterMax.filter(r => !r.isPrioritized);

            const selectedParticipants = [...baseSelected, ...prioritizedAfterMax];
            const waitingList = nonPrioritizedAfterMax;

            const participantList = selectedParticipants.map((r, i) => {
                const userData = db.getUserByDiscordId(r.id);
                const gameName = userData?.game_username || null;
                const nameDisplay = gameName ? `<@${r.id}> (${gameName})` : `<@${r.id}>`;
                return `${i + 1}. ${nameDisplay}${r.isLeader ? ' 👑' : ''}`;
            }).join('\n');

            // Helper: chia danh sách thành các phần không vượt quá 1024 ký tự
            function splitListIntoChunks(list, maxLength = 1000) {
                const chunks = [];
                let currentChunk = '';
                const lines = list.split('\n');

                for (const line of lines) {
                    if ((currentChunk + '\n' + line).length > maxLength && currentChunk.length > 0) {
                        chunks.push(currentChunk);
                        currentChunk = line;
                    } else {
                        currentChunk = currentChunk ? currentChunk + '\n' + line : line;
                    }
                }
                if (currentChunk) chunks.push(currentChunk);
                return chunks;
            }

            // Role emojis - tất cả DPS dùng 🟢
            const roleEmojis = { 'DPS': '🟢', 'Quạt Dù': '🟢', 'Vô Danh': '🟢', 'Song Đao': '🟢', 'Cửu Kiếm': '🟢', 'Healer': '🔵', 'Tanker': '🟠', 'Unknown': '❓' };

            // Helper: detect role từ Discord - ƯU TIÊN Healer/Tanker
            function getMemberRole(memberId) {
                try {
                    const member = interaction.guild.members.cache.get(memberId);
                    if (!member) return 'Unknown';

                    const healerRole = interaction.guild.roles.cache.find(r => r.name === 'Healer');
                    if (healerRole && member.roles.cache.has(healerRole.id)) return 'Healer';

                    const tankerRole = interaction.guild.roles.cache.find(r => r.name === 'Tanker');
                    if (tankerRole && member.roles.cache.has(tankerRole.id)) return 'Tanker';

                    const dpsSubTypes = ['Quạt Dù', 'Vô Danh', 'Song Đao', 'Cửu Kiếm'];
                    for (const subTypeName of dpsSubTypes) {
                        const role = interaction.guild.roles.cache.find(r => r.name === subTypeName);
                        if (role && member.roles.cache.has(role.id)) return 'DPS';
                    }

                    const dpsRole = interaction.guild.roles.cache.find(r => r.name === 'DPS');
                    if (dpsRole && member.roles.cache.has(dpsRole.id)) return 'DPS';
                } catch (e) { }
                return 'Unknown';
            }

            // Chia team tự động
            const { splitTeams } = require('../utils/teamSplit');
            const teamResult = splitTeams(selectedParticipants, interaction.guild);

            // Format danh sách team với role - detect từ Discord
            function formatTeamList(team) {
                return team.map((p, i) => {
                    const userData = db.getUserByDiscordId(p.id);
                    const gameName = userData?.game_username || null;
                    const role = getMemberRole(p.id);
                    const roleIcon = roleEmojis[role] || '❓';
                    const nameDisplay = gameName ? `<@${p.id}> (${gameName})` : `<@${p.id}>`;
                    return `${i + 1}. ${roleIcon} ${nameDisplay}${p.isLeader ? ' 👑' : ''}`;
                }).join('\n');
            }

            const defenseList = formatTeamList(teamResult.defense);
            const offenseList = formatTeamList(teamResult.offense);

            // Thống kê team
            const defStats = teamResult.stats.defense;
            const offStats = teamResult.stats.offense;
            const defenseStats = `🔵${defStats.healer} 🟠${defStats.tanker} 🟢${defStats.dps}` + (defStats.unknown > 0 ? ` ❓${defStats.unknown}` : '');
            const offenseStats = `🔵${offStats.healer} 🟠${offStats.tanker} 🟢${offStats.dps}` + (offStats.unknown > 0 ? ` ❓${offStats.unknown}` : '');

            // Tạo embed chốt danh sách với 2 team
            const finalEmbed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle('📋 CHỐT DANH SÁCH BANG CHIẾN LANG GIA!');

            // Thêm Team Phòng Thủ
            const defenseChunks = splitListIntoChunks(defenseList);
            defenseChunks.forEach((chunk, index) => {
                finalEmbed.addFields({
                    name: index === 0 ? `🛡️ TEAM PHÒNG THỦ (${teamResult.defense.length}) [${defenseStats}]` : '\u200b',
                    value: chunk,
                    inline: false
                });
            });

            // Thêm Team Tấn Công
            const offenseChunks = splitListIntoChunks(offenseList);
            offenseChunks.forEach((chunk, index) => {
                finalEmbed.addFields({
                    name: index === 0 ? `⚔️ TEAM TẤN CÔNG (${teamResult.offense.length}) [${offenseStats}]` : '\u200b',
                    value: chunk,
                    inline: false
                });
            });

            // Thêm danh sách chờ nếu có
            if (waitingList.length > 0) {
                const waitingListText = waitingList.map((r, i) => `${i + 1}. <@${r.id}>`).join('\n');
                const waitingChunks = splitListIntoChunks(waitingListText);
                waitingChunks.forEach((chunk, index) => {
                    finalEmbed.addFields({
                        name: index === 0 ? `⏳ Danh sách chờ (${waitingList.length} người)` : '\u200b',
                        value: chunk,
                        inline: false
                    });
                });
            }

            // Thêm cảnh báo nếu có
            if (teamResult.warnings.length > 0) {
                finalEmbed.addFields({
                    name: '⚠️ Lưu ý',
                    value: teamResult.warnings.join('\n'),
                    inline: false
                });
            }

            finalEmbed.setFooter({ text: `👑 Leader reply tin này để tag tất cả | Tổng đăng ký: ${registrations.length}` })
                .setTimestamp();

            // Gửi thông báo chốt danh sách (KHÔNG tag ngay)
            const finalMessage = await interaction.channel.send({
                embeds: [finalEmbed]
            });

            // Lưu danh sách để reply tag sau (có memory và database)
            const participantData = selectedParticipants.map(r => ({ id: r.id, username: r.username }));

            // Lưu vào memory cho reply-to-tag ngay lập tức
            bangchienFinalizedParties.set(finalMessage.id, {
                leaderId: notifData.leaderId,
                participants: participantData,
                guildId: interaction.guild.id,
                channelId: interaction.channel.id,
                createdAt: Date.now()
            });

            // Lưu vào database để xem lại lịch sử (bao gồm TẤT CẢ người đăng ký + team data)
            const { saveBangchienHistory } = require('../database/db');
            const allParticipantData = registrations.map(r => ({ id: r.id, username: r.username, isLeader: r.isLeader }));
            saveBangchienHistory({
                guildId: interaction.guild.id,
                leaderId: notifData.leaderId,
                leaderName: notifData.leaderName,
                participants: participantData,
                messageId: finalMessage.id,
                totalRegistrations: registrations.length,
                allParticipants: allParticipantData,
                teamDefense: teamResult.defense,
                teamOffense: teamResult.offense
            });

            // Xóa tin nhắn cũ (embed đăng ký)
            try {
                if (notifData.message) await notifData.message.delete();
            } catch (e) { }

            // ===== ROLE BC ĐÃ ĐƯỢC CẤP NGAY KHI THAM GIA =====
            // Không cần cấp role ở đây nữa

            // Xóa dữ liệu party
            bangchienNotifications.delete(partyKey);
            bangchienRegistrations.delete(partyKey);

            await interaction.reply({
                content: `✅ Đã chốt và chia team cho ${selectedParticipants.length} người!\n🛡️ Phòng Thủ: ${teamResult.defense.length} | ⚔️ Tấn Công: ${teamResult.offense.length}\n**Reply tin chốt danh sách để tag tất cả.**`,
                flags: MessageFlags.Ephemeral
            });

            // Logic tag role 19:30 đã được di chuyển sang bangchien.js (khi mở session)

            return true;
        }

        // Không phải handler của file này
        return false;

    } catch (error) {
        console.error('[bangchienManageHandlers] Error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '❌ Có lỗi xảy ra khi xử lý quản lý Bang Chiến!',
                flags: MessageFlags.Ephemeral
            });
        }
        return true; // Đã xử lý lỗi
    }
}

module.exports = {
    handleButton
};
