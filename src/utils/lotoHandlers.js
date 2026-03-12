/**
 * ═══════════════════════════════════════════════════════════════════════════
 * lotoHandlers.js - Handlers cho nút Lô Tô
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Handlers:
 *   - loto_draw_*  : Bốc 1 số (cooldown 0.5s)
 *   - loto_auto_*  : Bật auto bốc mỗi 3s
 *   - loto_stop_*  : Dừng auto
 *   - loto_kinh_*  : Nhiều người có thể KINH cùng lúc (3 phút timeout)
 * 
 * Được import vào: src/events/client/interactionCreate.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const lotoState = require('../commands/loto/lotoState');
const lotoCommand = require('../commands/loto/loto');

// Cooldown tracker: Map<guildId, lastDrawTime>
const drawCooldowns = new Map();
const DRAW_COOLDOWN = 500; // 0.5 giây

// Lock tracker: ngăn bốc chồng chéo
const drawLocks = new Map();

// KINH check tracker: Map<guildId, Map<userId, { userName, collector, wasAutoRunning }>>
const kinhChecks = new Map();

// Pending winners tracker: Map<guildId, Set<userId>>
// Map: guildId -> Map(userId -> [numbers])
const pendingWinners = new Map();

/**
 * Xử lý tất cả button interactions liên quan đến Lô Tô
 */
async function handleButton(interaction, client) {
    const customId = interaction.customId;
    const guildId = interaction.guild?.id;

    if (!guildId) return false;

    try {
        // ═══════════════════════════════════════════════════════════════
        // NÚT BỐC SỐ
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('loto_draw_')) {
            // Kiểm tra loto enabled
            if (!lotoState.isLotoEnabled()) {
                return interaction.reply({
                    content: '⛔ Hệ thống Lô Tô đang **TẮT**!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Kiểm tra nhà cái
            if (!lotoState.isDealer(guildId, interaction.user.id)) {
                return interaction.reply({
                    content: '❌ Chỉ nhà cái mới được bốc số!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Kiểm tra đang KINH check
            if (kinhChecks.has(guildId) && kinhChecks.get(guildId).size > 0) {
                return interaction.reply({
                    content: '⏸️ Đang có người kiểm tra KINH! Chờ xong mới bốc tiếp.',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Kiểm tra cooldown
            const lastDraw = drawCooldowns.get(guildId) || 0;
            const now = Date.now();
            if (now - lastDraw < DRAW_COOLDOWN) {
                return interaction.reply({
                    content: '⏳ Chờ chút...',
                    flags: MessageFlags.Ephemeral
                });
            }
            drawCooldowns.set(guildId, now);

            // Kiểm tra hết số
            const session = lotoState.getSession(guildId);
            if (session.availableNumbers.size === 0) {
                return interaction.reply({
                    content: '❌ Đã hết số!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Defer reply
            await interaction.deferUpdate();

            // Kiểm tra lock
            if (drawLocks.get(guildId)) return true;
            drawLocks.set(guildId, true);

            try {
                const num = await lotoCommand.runDrawAnimation(interaction.channel, guildId);
                if (num !== null) {
                    await lotoCommand.updateBoardEmbed(interaction.channel, guildId);
                }
            } finally {
                drawLocks.delete(guildId);
            }

            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // NÚT AUTO
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('loto_auto_')) {
            if (!lotoState.isLotoEnabled()) {
                return interaction.reply({
                    content: '⛔ Hệ thống Lô Tô đang **TẮT**!',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (!lotoState.isDealer(guildId, interaction.user.id)) {
                return interaction.reply({
                    content: '❌ Chỉ nhà cái mới được bật auto!',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (lotoState.isAutoRunning(guildId)) {
                return interaction.reply({
                    content: '⚠️ Auto đang chạy rồi!',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (kinhChecks.has(guildId) && kinhChecks.get(guildId).size > 0) {
                return interaction.reply({
                    content: '⏸️ Đang có người kiểm tra KINH!',
                    flags: MessageFlags.Ephemeral
                });
            }

            const session = lotoState.getSession(guildId);
            if (session.availableNumbers.size === 0) {
                return interaction.reply({
                    content: '❌ Đã hết số!',
                    flags: MessageFlags.Ephemeral
                });
            }

            await interaction.deferUpdate();

            // Đăng ký auto
            lotoState.startAuto(guildId, { timeout: null });

            // Cập nhật board với nút dừng
            const updatedSession = lotoState.getSession(guildId);
            const boardEmbed = lotoCommand.createBoardEmbed(updatedSession, guildId);
            const row = lotoCommand.createBoardButtons(guildId, true);
            try {
                const boardMsg = await interaction.channel.messages.fetch(updatedSession.boardMessageId);
                if (boardMsg) await boardMsg.edit({ embeds: [boardEmbed], components: [row] });
            } catch (e) { }

            // Hàm bốc tuần tự
            async function autoDrawNext() {
                if (!lotoState.isAutoRunning(guildId)) return;
                if (kinhChecks.has(guildId) && kinhChecks.get(guildId).size > 0) return; // Dừng nếu đang check KINH

                const checkSession = lotoState.getSession(guildId);
                if (checkSession.availableNumbers.size === 0) {
                    lotoState.stopAuto(guildId);
                    await interaction.channel.send('🏁 Đã bốc hết tất cả số!').then(m => {
                        setTimeout(() => m.delete().catch(() => { }), 5000);
                    });
                    await lotoCommand.updateBoardEmbed(interaction.channel, guildId);
                    return;
                }

                await lotoCommand.runDrawAnimation(interaction.channel, guildId);
                await lotoCommand.updateBoardEmbed(interaction.channel, guildId);

                if (!lotoState.isAutoRunning(guildId)) return;

                const timeoutId = setTimeout(() => autoDrawNext(), 1500);
                lotoState.startAuto(guildId, { timeout: timeoutId });
            }

            await autoDrawNext();
            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // NÚT DỪNG AUTO
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('loto_stop_')) {
            if (!lotoState.isDealer(guildId, interaction.user.id)) {
                return interaction.reply({
                    content: '❌ Chỉ nhà cái mới được dừng auto!',
                    flags: MessageFlags.Ephemeral
                });
            }

            lotoState.stopAuto(guildId);
            await interaction.deferUpdate();
            await lotoCommand.updateBoardEmbed(interaction.channel, guildId);

            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // NÚT KINH - Nhiều người bấm được, 3 phút timeout
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('loto_kinh_')) {
            // ========= Kiểm tra user có trong voice channel với bot không =========
            if (!ttsService.isConnected(guildId)) {
                return interaction.reply({
                    content: '❌ Bot chưa vào voice! Không thể KINH.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const botConnection = ttsService.getConnection(guildId);
            const userVoiceChannel = interaction.member?.voice?.channel;

            if (!userVoiceChannel || !botConnection || botConnection.joinConfig.channelId !== userVoiceChannel.id) {
                return interaction.reply({
                    content: '❌ Bạn phải ở cùng voice channel với bot mới được KINH!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Kiểm tra người này đã KINH chưa
            if (!kinhChecks.has(guildId)) {
                kinhChecks.set(guildId, new Map());
            }
            if (!pendingWinners.has(guildId)) {
                pendingWinners.set(guildId, new Map());
            }

            const guildKinhChecks = kinhChecks.get(guildId);

            if (guildKinhChecks.has(interaction.user.id)) {
                return interaction.reply({
                    content: '⏸️ Bạn đã hô KINH rồi! Đang chờ bạn nhập số.',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Kiểm tra đã bốc đủ 5 số chưa
            const sessionCheck = lotoState.getSession(guildId);
            if (sessionCheck.drawnNumbers.length < 5) {
                return interaction.reply({
                    content: `❌ Chưa đủ số để KINH! Cần ít nhất **5 số** trên sàn (hiện tại: **${sessionCheck.drawnNumbers.length}**).`,
                    flags: MessageFlags.Ephemeral
                });
            }

            // Defer reply immediately since we have multiple async operations
            await interaction.deferReply();

            // Hủy animation nếu đang chạy (chỉ lần đầu tiên có người KINH)
            if (guildKinhChecks.size === 0) {
                const isAnimating = drawLocks.get(guildId);
                await cancelAnimation(interaction.channel, guildId);

                // Nếu đang animation (đang bốc) mà bấm KINH -> Huỷ số đó luôn
                if (isAnimating) {
                    lotoState.undoLastDraw(guildId);
                }
            }

            // Tạm dừng auto nếu đang chạy (chỉ lần đầu)
            const wasAutoRunning = lotoState.isAutoRunning(guildId);
            if (wasAutoRunning && guildKinhChecks.size === 0) {
                lotoState.stopAuto(guildId);
            }

            // Cập nhật board: disabled label + NÚT KINH vẫn bật
            const session = lotoState.getSession(guildId);
            if (session.boardMessageId) {
                try {
                    const boardMsg = await interaction.channel.messages.fetch(session.boardMessageId);
                    if (boardMsg) {
                        const kinhRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`loto_disabled_${guildId}`)
                                .setLabel('⏸️ Đang kiểm tra...')
                                .setStyle(ButtonStyle.Secondary)
                                .setDisabled(true),
                            new ButtonBuilder()
                                .setCustomId(`loto_kinh_${guildId}`)
                                .setLabel('📢 KINH trùng')
                                .setStyle(ButtonStyle.Success)
                        );
                        await boardMsg.edit({ components: [kinhRow] });
                    }
                } catch (e) { }
            }

            // Đọc "Kinh" ngay lập tức
            if (ttsService.isConnected(guildId)) {
                ttsService.speak(guildId, 'Kinh');
            }

            // Gửi thông báo KINH + nút BỎ QUA cho nhà cái + nút HUỶ cho người KINH
            const dealer = lotoState.getDealer(guildId);
            const buttonsRow = new ActionRowBuilder();

            // Nút HUỶ cho chính người KINH
            buttonsRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`loto_kinhcancel_${guildId}_${interaction.user.id}`)
                    .setLabel('❌ Huỷ KINH')
                    .setStyle(ButtonStyle.Secondary)
            );

            // Nút BỎ QUA cho nhà cái
            if (dealer) {
                buttonsRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`loto_kinhcancel_${guildId}_${interaction.user.id}`) // Dùng chung handler cancel nhưng check logic dealer skip sau, hoặc dùng skip riêng
                        // Wait, logic cũ dùng loto_skip -> giữ nguyên
                        .setCustomId(`loto_skip_${guildId}_${interaction.user.id}`)
                        .setLabel('⏭️ BỎ QUA')
                        .setStyle(ButtonStyle.Danger)
                );
            }

            // Lưu collector và messageId
            const replyMsg = await interaction.editReply({
                content: `📢 **${interaction.user.username}** hô **KINH**! ⏸️\n\n👉 <@${interaction.user.id}>, hãy gõ **5 số** của bạn (cách nhau bởi dấu cách). VD: \`5 12 23 45 67\`\n\n⏰ Bạn có **3 phút** để nhập.`,
                components: [buttonsRow]
            });

            // Message collector để đợi 5 số
            const filter = m => m.author.id === interaction.user.id;
            const collector = interaction.channel.createMessageCollector({
                filter,
                time: 180000 // 3 phút
            });

            // Lưu collector
            guildKinhChecks.set(interaction.user.id, {
                userName: interaction.user.username,
                collector,
                wasAutoRunning,
                messageId: replyMsg.id
            });

            collector.on('collect', async (msg) => {
                const numbers = msg.content.trim().split(/[\s,]+/).map(s => parseInt(s)).filter(n => !isNaN(n));

                if (numbers.length !== 5) {
                    await msg.delete().catch(() => { });
                    return;
                }

                const getRow = (n) => n >= 80 ? 8 : Math.floor(n / 10);
                const rows = numbers.map(n => getRow(n));
                const uniqueRows = new Set(rows);
                if (uniqueRows.size !== 5) {
                    await msg.delete().catch(() => { });
                    return;
                }

                const drawnSet = session.drawnSet;
                const results = numbers.map(n => ({
                    num: n,
                    matched: drawnSet.has(n)
                }));

                const allMatch = results.every(r => r.matched);
                const resultText = results.map(r =>
                    r.matched ? `✅ **${String(r.num).padStart(2, '0')}**` : `❌ **${String(r.num).padStart(2, '0')}**`
                ).join('  ');

                if (allMatch) {
                    // 🎉 WIN!
                    // Lưu vào pending winners (userId -> numbers)
                    pendingWinners.get(guildId).set(interaction.user.id, numbers);

                    // Xoá tin nhắn check của bot (nếu có - tuỳ chọn)
                    // ...

                    // Thông báo người này đúng, chờ người khác
                    await interaction.channel.send(`✅ **${interaction.user.username}** đã nhập đúng! Đang chờ những người khác...`);

                    // Stop collector này (nhưng chưa end game)
                    collector.stop('win_pending');
                } else {
                    await msg.delete().catch(() => { });
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'skipped') return; // Đã xử lý ở skip

                // Nếu timeout hoặc win_pending
                if (reason === 'time') {
                    interaction.channel.send(`⏰ <@${interaction.user.id}> hết thời gian! KINH không hợp lệ.`).then(m => {
                        setTimeout(() => m.delete().catch(() => { }), 5000);
                    });

                    // Xóa prompt message cũ nếu timeout
                    const currentCheck = guildKinhChecks.get(interaction.user.id); // Lưu ý: có thể đã bị delete nếu race condition, nhưng ở đây là 'end' event
                    if (currentCheck && currentCheck.messageId) {
                        try {
                            const promptMsg = await interaction.channel.messages.fetch(currentCheck.messageId);
                            if (promptMsg) await promptMsg.delete();
                        } catch (e) { }
                    }

                    // Xóa khỏi pending winners nếu có (đề phòng)
                    pendingWinners.get(guildId)?.delete(interaction.user.id);
                }

                // Xoá user khỏi list đang check (để biết đã xong)
                guildKinhChecks.delete(interaction.user.id);

                // === KIỂM TRA XEM CÒN AI ĐANG CHECK KHÔNG ===
                if (guildKinhChecks.size > 0) {
                    // Vẫn còn người đang check -> chờ họ
                    return;
                }

                // === KHÔNG CÒN AI CHECK -> XỬ LÝ KẾT QUẢ ===
                const winners = pendingWinners.get(guildId);

                if (winners && winners.size > 0) {
                    // CÓ NGƯỜI THẮNG -> END GAME

                    // Tạo danh sách số đã bốc (cho embed)
                    const sortedDrawn = [...session.drawnNumbers].sort((a, b) => a - b);
                    const drawnGroups = {};
                    for (let i = 0; i <= 9; i++) drawnGroups[i] = [];
                    sortedDrawn.forEach(num => {
                        const idx = num === 90 ? 9 : Math.floor(num / 10);
                        if (drawnGroups[idx]) drawnGroups[idx].push(num);
                    });
                    const drawnLines = [];
                    for (let i = 0; i <= 9; i++) {
                        const nums = drawnGroups[i];
                        if (nums.length > 0) {
                            let label = i === 9 ? '90' : `${i}x`;
                            const numStr = nums.map(n => String(n).padStart(2, '0')).join('  ');
                            drawnLines.push(`\`${label.padEnd(2)}\` | \`${numStr}\``);
                        }
                    }

                    // Danh sách người thắng với số đã nhập
                    const winnerLines = [];
                    for (const [winnerId, winnerNumbers] of winners) {
                        const user = await client.users.fetch(winnerId).catch(() => null);
                        if (user) {
                            const numbersStr = winnerNumbers.map(n => String(n).padStart(2, '0')).join('  ');
                            winnerLines.push(`• **${user.username}**: \`${numbersStr}\``);
                        }
                    }
                    const winnerText = Array.from(winners.keys()).map(id => {
                        const user = client.users.cache.get(id);
                        return user ? user.username : id;
                    }).join(', ');

                    const winEmbed = new EmbedBuilder()
                        .setColor('#22C55E')
                        .setTitle('🏆🏆🏆 WIN! 🏆🏆🏆')
                        .setDescription([
                            `## 🏆 Lụm LÚA`,
                            '',
                            `**Người thắng:**`,
                            ...winnerLines,
                            '',
                            `> Tất cả số đều trùng khớp!`,
                            '',
                            `**Đã bốc (${session.drawnNumbers.length}):**`,
                            ...drawnLines
                        ].join('\n'))
                        .setTimestamp();

                    await interaction.channel.send({ embeds: [winEmbed] });

                    // TTS đọc
                    if (ttsService.isConnected(guildId)) {
                        await ttsService.speak(guildId, `${winnerText} đã win!`);
                    }

                    // Reset và end game
                    const boardMsgId = session.boardMessageId;
                    lotoState.endSession(guildId);
                    kinhChecks.delete(guildId);
                    pendingWinners.delete(guildId);

                    // Xóa embed sàn cũ
                    if (boardMsgId) {
                        try {
                            const boardMsg = await interaction.channel.messages.fetch(boardMsgId);
                            if (boardMsg) await boardMsg.delete();
                        } catch (e) { }
                    }

                    await interaction.channel.send('🔄 Ván đã kết thúc! Dùng `?lt` để bắt đầu ván mới.').then(m => {
                        setTimeout(() => m.delete().catch(() => { }), 8000);
                    });

                } else {
                    // KHÔNG CÓ AI THẮNG -> RESUME GAME
                    pendingWinners.delete(guildId); // Clear empty set
                    checkAndResume(guildId, interaction.channel, wasAutoRunning);
                }
            });

            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // NÚT HUỶ KINH - Người KINH tự huỷ
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('loto_kinhcancel_')) {
            const parts = customId.split('_');
            const kinhUserId = parts[parts.length - 1];

            // Chỉ người KINH mới được huỷ
            if (interaction.user.id !== kinhUserId) {
                return interaction.reply({
                    content: '❌ Chỉ người hô KINH mới được huỷ!',
                    flags: MessageFlags.Ephemeral
                });
            }

            const guildKinhChecks = kinhChecks.get(guildId);
            if (!guildKinhChecks || !guildKinhChecks.has(kinhUserId)) {
                return interaction.reply({
                    content: '❌ Không tìm thấy KINH của bạn!',
                    flags: MessageFlags.Ephemeral
                });
            }

            const kinhData = guildKinhChecks.get(kinhUserId);

            // Dừng collector
            if (kinhData?.collector) {
                kinhData.collector.stop('skipped'); // Dùng reason skipped để không trigger logic end collector của nó
            }

            // Xoá user khỏi guildKinhChecks thủ công vì collector stop với reason skipped
            guildKinhChecks.delete(kinhUserId);
            pendingWinners.get(guildId)?.delete(kinhUserId);

            await interaction.deferUpdate();

            // Thông báo huỷ
            await interaction.channel.send(`🔙 <@${kinhUserId}> đã **HUỶ KINH**.`).then(m => {
                setTimeout(() => m.delete().catch(() => { }), 5000);
            });

            // Xoá tin nhắn reply button
            // Ưu tiên dùng messageId đã lưu nếu có
            if (kinhData.messageId) {
                try {
                    const replyMsg = await interaction.channel.messages.fetch(kinhData.messageId);
                    if (replyMsg) await replyMsg.delete();
                } catch (e) { }
            } else {
                try {
                    const replyMsg = await interaction.message;
                    if (replyMsg) await replyMsg.delete();
                } catch (e) { }
            }

            // CHECK RESUME HOẶC END GAME (nếu người khác đã win)
            if (guildKinhChecks.size === 0) {
                const winners = pendingWinners.get(guildId);
                if (winners && winners.size > 0) {
                    // Trigger logic end game nếu có người win đang chờ
                    // CHÚ Ý: Logic end game nằm trong sự kiện 'end' của collector.
                    // Vì mình stop với 'skipped', sự kiện 'end' của collector này sẽ ignore.
                    // Nên ta phải gọi tay logic check ở đây.
                    // NHƯNG để tái sử dụng code, ta có thể trigger một fake event hoặc tách hàm check.
                    // Đơn giản nhất: gọi 1 hàm chung `finalizeKinhChecks(guildId, interaction.channel, wasAutoRunning)`
                    // Ở đây pending logic hơi phức tạp để tách nhanh, nên ta copy logic check:

                    // Code copy từ collector end:
                    const session = lotoState.getSession(guildId);
                    const sortedDrawn = [...session.drawnNumbers].sort((a, b) => a - b);
                    const drawnGroups = {};
                    for (let i = 0; i <= 9; i++) drawnGroups[i] = [];
                    sortedDrawn.forEach(num => {
                        const idx = num === 90 ? 9 : Math.floor(num / 10);
                        if (drawnGroups[idx]) drawnGroups[idx].push(num);
                    });
                    const drawnLines = [];
                    for (let i = 0; i <= 9; i++) {
                        const nums = drawnGroups[i];
                        if (nums.length > 0) {
                            let label = i === 9 ? '90' : `${i}x`;
                            const numStr = nums.map(n => String(n).padStart(2, '0')).join('  ');
                            drawnLines.push(`\`${label.padEnd(2)}\` | \`${numStr}\``);
                        }
                    }

                    const winnerLines = [];
                    for (const [winnerId, winnerNumbers] of winners) {
                        const user = await client.users.fetch(winnerId).catch(() => null);
                        if (user) {
                            const numbersStr = winnerNumbers.map(n => String(n).padStart(2, '0')).join('  ');
                            winnerLines.push(`• **${user.username}**: \`${numbersStr}\``);
                        }
                    }
                    const winnerText = Array.from(winners.keys()).map(id => {
                        const user = client.users.cache.get(id);
                        return user ? user.username : id;
                    }).join(', ');

                    const winEmbed = new EmbedBuilder()
                        .setColor('#22C55E')
                        .setTitle('🏆🏆🏆 WIN! 🏆🏆🏆')
                        .setDescription([
                            `## 🏆 Lụm LÚA`,
                            '',
                            `**Người thắng:**`,
                            ...winnerLines,
                            '',
                            `> Tất cả số đều trùng khớp!`,
                            '',
                            `**Đã bốc (${session.drawnNumbers.length}):**`,
                            ...drawnLines
                        ].join('\n'))
                        .setTimestamp();

                    await interaction.channel.send({ embeds: [winEmbed] });

                    if (ttsService.isConnected(guildId)) {
                        await ttsService.speak(guildId, `${winnerText} đã win!`);
                    }

                    const boardMsgId = session.boardMessageId;
                    lotoState.endSession(guildId);
                    kinhChecks.delete(guildId);
                    pendingWinners.delete(guildId);

                    if (boardMsgId) {
                        try {
                            const boardMsg = await interaction.channel.messages.fetch(boardMsgId);
                            if (boardMsg) await boardMsg.delete();
                        } catch (e) { }
                    }

                    await interaction.channel.send('🔄 Ván đã kết thúc! Dùng `?lt` để bắt đầu ván mới.').then(m => {
                        setTimeout(() => m.delete().catch(() => { }), 8000);
                    });
                } else {
                    checkAndResume(guildId, interaction.channel, kinhData.wasAutoRunning);
                }
            }

            return true;
        }

        // ═══════════════════════════════════════════════════════════════
        // NÚT BỎ QUA (lần 1) - Nhà cái bấm để bỏ qua KINH
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('loto_skip_')) {
            // Chỉ nhà cái mới được bỏ qua
            if (!lotoState.isDealer(guildId, interaction.user.id)) {
                return interaction.reply({
                    content: '❌ Chỉ nhà cái mới được bỏ qua KINH!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Gửi xác nhận lần 2
            const confirmRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`loto_skipconfirm_${guildId}_${customId.split('_').pop()}`)
                    .setLabel('✅ Xác nhận BỎ QUA')
                    .setStyle(ButtonStyle.Danger)
            );

            return interaction.reply({
                content: '⚠️ Bạn có chắc muốn **BỎ QUA** KINH này không?',
                components: [confirmRow]
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // NÚT XÁC NHẬN BỎ QUA (lần 2)
        // ═══════════════════════════════════════════════════════════════
        if (customId.startsWith('loto_skipconfirm_')) {
            // Chỉ nhà cái
            if (!lotoState.isDealer(guildId, interaction.user.id)) {
                return interaction.reply({
                    content: '❌ Chỉ nhà cái mới được bỏ qua!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Lấy userId của người đang KINH
            const parts = customId.split('_');
            const kinhUserId = parts[parts.length - 1];

            const guildKinhChecks = kinhChecks.get(guildId);
            if (!guildKinhChecks) {
                return interaction.reply({
                    content: '❌ Không có ai đang KINH!',
                    flags: MessageFlags.Ephemeral
                });
            }

            const kinhData = guildKinhChecks.get(kinhUserId);

            // Dừng collector
            if (kinhData?.collector) {
                kinhData.collector.stop('skipped');
            }

            // Xoá khỏi kinhChecks
            guildKinhChecks.delete(kinhUserId);
            pendingWinners.get(guildId)?.delete(kinhUserId); // Xóa nếu có trong pending

            await interaction.deferUpdate();

            // Thông báo bỏ qua
            await interaction.channel.send(`⏭️ Nhà cái đã **BỎ QUA** KINH của <@${kinhUserId}>.`).then(m => {
                setTimeout(() => m.delete().catch(() => { }), 5000);
            });

            // Xoá tin nhắn xác nhận bỏ qua (tin nhắn chứa nút "Xác nhận BỎ QUA")
            try {
                const confirmMsg = await interaction.message;
                if (confirmMsg) await confirmMsg.delete();
            } catch (e) { }

            // Xoá tin nhắn KINH gốc
            if (kinhData && kinhData.messageId) {
                try {
                    const kinhMsg = await interaction.channel.messages.fetch(kinhData.messageId);
                    if (kinhMsg) await kinhMsg.delete();
                } catch (e) { }
            }

            // CHECK LOGIC: Nếu còn người khác check -> chờ. Nếu hết -> check winner -> nếu không -> resume.
            if (guildKinhChecks.size === 0) {
                const winners = pendingWinners.get(guildId);
                if (winners && winners.size > 0) {
                    // CÓ WINNER -> END GAME (copy logic từ button hủy)
                    const session = lotoState.getSession(guildId);
                    const sortedDrawn = [...session.drawnNumbers].sort((a, b) => a - b);
                    const drawnGroups = {};
                    for (let i = 0; i <= 9; i++) drawnGroups[i] = [];
                    sortedDrawn.forEach(num => {
                        const idx = num === 90 ? 9 : Math.floor(num / 10);
                        if (drawnGroups[idx]) drawnGroups[idx].push(num);
                    });
                    const drawnLines = [];
                    for (let i = 0; i <= 9; i++) {
                        const nums = drawnGroups[i];
                        if (nums.length > 0) {
                            let label = i === 9 ? '90' : `${i}x`;
                            const numStr = nums.map(n => String(n).padStart(2, '0')).join('  ');
                            drawnLines.push(`\`${label.padEnd(2)}\` | \`${numStr}\``);
                        }
                    }

                    const winnerLines = [];
                    for (const [winnerId, winnerNumbers] of winners) {
                        const user = await client.users.fetch(winnerId).catch(() => null);
                        if (user) {
                            const numbersStr = winnerNumbers.map(n => String(n).padStart(2, '0')).join('  ');
                            winnerLines.push(`• **${user.username}**: \`${numbersStr}\``);
                        }
                    }
                    const winnerText = Array.from(winners.keys()).map(id => {
                        const user = client.users.cache.get(id);
                        return user ? user.username : id;
                    }).join(', ');

                    const winEmbed = new EmbedBuilder()
                        .setColor('#22C55E')
                        .setTitle('🏆🏆🏆 WIN! 🏆🏆🏆')
                        .setDescription([
                            `## 🏆 Lụm LÚA`,
                            '',
                            `**Người thắng:**`,
                            ...winnerLines,
                            '',
                            `> Tất cả số đều trùng khớp!`,
                            '',
                            `**Đã bốc (${session.drawnNumbers.length}):**`,
                            ...drawnLines
                        ].join('\n'))
                        .setTimestamp();

                    await interaction.channel.send({ embeds: [winEmbed] });

                    if (ttsService.isConnected(guildId)) {
                        await ttsService.speak(guildId, `${winnerText} đã win!`);
                    }

                    const boardMsgId = session.boardMessageId;
                    lotoState.endSession(guildId);
                    kinhChecks.delete(guildId);
                    pendingWinners.delete(guildId);

                    if (boardMsgId) {
                        try {
                            const boardMsg = await interaction.channel.messages.fetch(boardMsgId);
                            if (boardMsg) await boardMsg.delete();
                        } catch (e) { }
                    }

                    await interaction.channel.send('🔄 Ván đã kết thúc! Dùng `?lt` để bắt đầu ván mới.').then(m => {
                        setTimeout(() => m.delete().catch(() => { }), 8000);
                    });
                } else {
                    checkAndResume(guildId, interaction.channel, kinhData.wasAutoRunning);
                }
            }

            return true;
        }

        return false;

    } catch (error) {
        console.error('[lotoHandlers] Error:', error);
        try {
            if (!interaction.replied) {
                if (interaction.deferred) {
                    await interaction.editReply({
                        content: '❌ Có lỗi xảy ra! Vui lòng thử lại.'
                    }).catch(() => { });
                } else {
                    await interaction.reply({
                        content: '❌ Có lỗi xảy ra!',
                        flags: MessageFlags.Ephemeral
                    }).catch(() => { });
                }
            }
        } catch (e) { }
        return true;
    }
}


/**
 * Kiểm tra và resume sau khi KINH check xong (nếu không còn ai đang check)
 */
async function checkAndResume(guildId, channel, wasAutoRunning) {
    const guildKinhChecks = kinhChecks.get(guildId);
    if (!guildKinhChecks || guildKinhChecks.size === 0) {
        // 1. Kiểm tra có người thắng không
        const winners = pendingWinners.get(guildId);
        if (winners && winners.size > 0) {
            // Có người thắng -> Kết thúc game
            const winnerList = Array.from(winners).map(id => `<@${id}>`).join(', ');

            // Highlight winner
            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('🎉 KINH!!!! CÓ NGƯỜI TRÚNG RỒI!')
                .setDescription(`🏆 **Chúc mừng:** ${winnerList}\n\nĐã chiến thắng ván lô tô này!`)
                .setTimestamp();

            await channel.send({ embeds: [embed] });

            // End session
            const oldSession = lotoState.endSession(guildId);

            // Xoá board message cũ
            if (oldSession && oldSession.boardMessageId) {
                try {
                    const boardMsg = await channel.messages.fetch(oldSession.boardMessageId);
                    if (boardMsg) await boardMsg.delete();
                } catch (e) { }
            }

            // Cleanup local state
            kinhChecks.delete(guildId);
            pendingWinners.delete(guildId);
            return;
        }

        // 2. Không có người thắng -> Resume game
        kinhChecks.delete(guildId);
        pendingWinners.delete(guildId); // Clear leftovers

        // Restore buttons
        await lotoCommand.updateBoardEmbed(channel, guildId);

        // Resume auto nếu trước đó đang chạy
        if (wasAutoRunning) {
            const session = lotoState.getSession(guildId);
            if (session && session.availableNumbers.size > 0) {
                lotoState.startAuto(guildId, { timeout: null });

                // Cập nhật board với nút dừng
                const boardEmbed = lotoCommand.createBoardEmbed(session, guildId);
                const row = lotoCommand.createBoardButtons(guildId, true);
                try {
                    const boardMsg = await channel.messages.fetch(session.boardMessageId);
                    if (boardMsg) await boardMsg.edit({ embeds: [boardEmbed], components: [row] });
                } catch (e) { }

                // Restart auto draw
                async function autoDrawNext() {
                    if (!lotoState.isAutoRunning(guildId)) return;
                    const guildChecks = kinhChecks.get(guildId);
                    if (guildChecks && guildChecks.size > 0) return;

                    const checkSession = lotoState.getSession(guildId);
                    if (checkSession.availableNumbers.size === 0) {
                        lotoState.stopAuto(guildId);
                        await channel.send('🏁 Đã bốc hết tất cả số!').then(m => {
                            setTimeout(() => m.delete().catch(() => { }), 5000);
                        });
                        await lotoCommand.updateBoardEmbed(channel, guildId);
                        return;
                    }

                    await lotoCommand.runDrawAnimation(channel, guildId);
                    await lotoCommand.updateBoardEmbed(channel, guildId);

                    if (!lotoState.isAutoRunning(guildId)) return;

                    const timeoutId = setTimeout(() => autoDrawNext(), 1500);
                    lotoState.startAuto(guildId, { timeout: timeoutId });
                }

                await autoDrawNext();
            }
        } else {
            // Thông báo tiếp tục
            await channel.send('▶️ Tiếp tục bốc số...').then(m => {
                setTimeout(() => m.delete().catch(() => { }), 3000);
            });
        }
    }
}

// Import TTS cho KINH
const ttsService = require('./ttsService');

/**
 * Kiểm tra có đang KINH check trong guild không
 */
function isKinhChecking(guildId) {
    const guildKinhChecks = kinhChecks.get(guildId);
    return guildKinhChecks && guildKinhChecks.size > 0;
}

/**
 * Xoá tất cả tin nhắn từ sau board embed tới mới nhất
 */
async function cleanupMessagesAfterBoard(channel, boardMessageId) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const boardMsg = messages.get(boardMessageId);
        if (!boardMsg) return;

        const boardTimestamp = boardMsg.createdTimestamp;
        const toDelete = messages.filter(m =>
            m.id !== boardMessageId && m.createdTimestamp > boardTimestamp
        );

        if (toDelete.size > 0) {
            // Bulk delete (chỉ xoá tin nhắn < 14 ngày)
            await channel.bulkDelete(toDelete, true).catch(() => {
                // Fallback: xoá từng tin
                toDelete.forEach(m => m.delete().catch(() => { }));
            });
        }
    } catch (e) {
        console.error('[lotoHandlers] Error cleaning up messages:', e.message);
    }
}

// Animation message tracker: Map<guildId, messageId>
const animationMessages = new Map();

/**
 * Lưu message ID của animation đang chạy
 */
function setAnimationMessage(guildId, messageId) {
    animationMessages.set(guildId, messageId);
}

/**
 * Xoá message ID của animation
 */
function clearAnimationMessage(guildId) {
    animationMessages.delete(guildId);
}

/**
 * Kiểm tra message ID có phải là animation đang chạy không
 */
function isAnimationTracked(guildId, messageId) {
    return animationMessages.get(guildId) === messageId;
}

/**
 * Huỷ animation đang chạy (xoá message)
 */
async function cancelAnimation(channel, guildId) {
    const msgId = animationMessages.get(guildId);
    if (msgId) {
        try {
            const msg = await channel.messages.fetch(msgId);
            if (msg) await msg.delete();
        } catch (e) {
            // Message might be already deleted
        }
        animationMessages.delete(guildId);
    }
}

module.exports = {
    handleButton,
    setAnimationMessage,
    clearAnimationMessage,
    cancelAnimation,
    isKinhChecking,
    isAnimationTracked
};
