/**
 * Handler cho các nút bcql (Panel quản lý Bang Chiến)
 * Được import vào interactionCreate.js
 */

const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/db');
const { bangchienNotifications, bangchienRegistrations, bangchienChannels, DAY_CONFIG, listbcDetailMessages, refreshOverviewEmbed } = require('./bangchienState');
const { createBangchienEmbed, createBangchienButtons } = require('../commands/bangchien/bangchien');

// Helper: Lấy tên team dynamic từ DB
function getTeamEmojis() {
    const names = db.getTeamNames ? db.getTeamNames() : { attack1: 'Công 1', attack2: 'Công 2', defense: 'Thủ', forest: 'Rừng' };
    return {
        attack1: `⚔️ ${names.attack1}`, attack2: `🗡️ ${names.attack2}`,
        defense: `🛡️ ${names.defense}`, forest: `🌲 ${names.forest}`,
        waiting: '⏳ Chờ'
    };
}

// Helper: Sync session lên Supabase sau khi SQLite thay đổi
async function syncSessionToSupabase(guildId, partyKey, guild = null) {
    try {
        const supaSync = require('./supabaseSync');
        if (!supaSync.isReady()) return;
        const session = db.getActiveBangchien(partyKey);
        if (!session) return;
        const formatted = supaSync.formatActiveSession(session, db, guild);
        if (formatted) {
            await supaSync.syncBCSession(guildId, session.day || 'sat', formatted);
            console.log(`[bcqlHandlers] ✅ Đã sync session ${session.day} lên Supabase`);
        }
    } catch (e) {
        console.error('[bcqlHandlers] Lỗi sync Supabase:', e.message);
    }
}

/**
 * Parse day từ customId format: bcql_action_partyKey_day
 */
function parseDayFromCustomId(customId) {
    const parts = customId.split('_');
    const lastPart = parts[parts.length - 1];
    if (lastPart === 'sat' || lastPart === 'sun' || lastPart === 'custom') {
        return lastPart;
    }
    return null;
}

/**
 * Refresh listbc embed sau khi thực hiện action
 */
async function refreshListbcEmbed(interaction, session, day) {
    if (!day) return;

    const guildId = interaction.guild.id;
    const listbcKey = `${guildId}_${day}`;
    const storedData = listbcDetailMessages.get(listbcKey);

    if (!storedData || !storedData.message) {
        console.log(`[bcqlHandlers] No stored listbc message for ${listbcKey}`);
        return;
    }

    const listbcCommand = require('../commands/bangchien/listbangchien');

    // Lấy session mới nhất
    const freshSession = db.getActiveBangchienByDay(guildId, day);
    if (!freshSession) return;

    // Tạo embed mới và edit message
    let newEmbed = null;
    let newComponents = [];

    const fakeMessage = {
        guild: interaction.guild,
        channel: interaction.channel,
        reply: async (options) => {
            newEmbed = options.embeds?.[0];
            newComponents = options.components || [];
        }
    };

    await listbcCommand.showDetailedSession(fakeMessage, freshSession, true, day, true);

    // Edit stored message với embed mới
    if (newEmbed) {
        try {
            await storedData.message.edit({ embeds: [newEmbed], components: newComponents });
            console.log(`[bcqlHandlers] Refreshed listbc embed for ${listbcKey}`);
        } catch (e) {
            console.error(`[bcqlHandlers] Cannot edit listbc message:`, e.message);
            // Xóa reference nếu message không còn tồn tại
            listbcDetailMessages.delete(listbcKey);
        }
    }
}

/**
 * Handle bcql buttons
 * @param {Interaction} interaction 
 * @returns {boolean} true if handled
 */
async function handleBcqlButton(interaction) {
    const customId = interaction.customId;

    // Chỉ xử lý các nút bcql_
    if (!customId.startsWith('bcql_')) return false;

    const guildId = interaction.guild.id;

    // Parse day từ customId (format mới: bcql_action_partyKey_day)
    const day = parseDayFromCustomId(customId);

    // Lấy session từ DB - ưu tiên theo day nếu có
    let session;
    if (day) {
        session = db.getActiveBangchienByDay(guildId, day);
    } else {
        const activeSessions = db.getActiveBangchienByGuild(guildId);
        session = activeSessions.length > 0 ? activeSessions[0] : null;
    }

    if (!session) {
        await interaction.reply({ content: '❌ Không có BC đang chạy!', flags: MessageFlags.Ephemeral });
        return true;
    }

    const partyKey = session.party_key;

    // Kiểm tra quyền
    const quanLyRole = interaction.guild.roles.cache.find(r => r.name === 'Quản Lý');
    const leaderBcRole = interaction.guild.roles.cache.find(r => r.name === 'Leader BC');
    const kyCuuRole = interaction.guild.roles.cache.find(r => r.name === 'Kỳ Cựu');

    const isQuanLy = quanLyRole && interaction.member.roles.cache.has(quanLyRole.id);
    const isLeaderBc = leaderBcRole && interaction.member.roles.cache.has(leaderBcRole.id);
    const isKyCuu = kyCuuRole && interaction.member.roles.cache.has(kyCuuRole.id);
    const isSessionLeader = session.leader_id === interaction.user.id;

    if (!isSessionLeader && !isQuanLy && !isLeaderBc && !isKyCuu) {
        await interaction.reply({ content: '❌ Bạn không có quyền!', flags: MessageFlags.Ephemeral });
        return true;
    }

    // ========== NÚT LOẠI BỎ ==========
    if (customId.startsWith('bcql_kick_')) {
        const allMembers = [
            ...(() => { const n = getTeamEmojis(); return [
                ...session.team_attack1.map(p => ({ ...p, team: n.attack1 })),
                ...session.team_attack2.map(p => ({ ...p, team: n.attack2 })),
                ...session.team_defense.map(p => ({ ...p, team: n.defense })),
                ...session.team_forest.map(p => ({ ...p, team: n.forest })),
                ...session.waiting_list.map(p => ({ ...p, team: n.waiting }))
            ]; })()
        ].filter(p => p.id !== session.leader_id); // Không cho kick leader

        if (allMembers.length === 0) {
            await interaction.reply({ content: '⚠️ Không có ai để loại bỏ!', flags: MessageFlags.Ephemeral });
            return true;
        }

        const options = allMembers.slice(0, 25).map((p, i) => ({
            label: p.username || `User ${i + 1}`,
            description: `Team: ${p.team}`,
            value: p.id
        }));

        const dayParam = day || 'sat';
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`bcql_kick_select_${partyKey}_${dayParam}`)
            .setPlaceholder('Chọn người để loại bỏ...')
            .setMinValues(1)
            .setMaxValues(Math.min(options.length, 10))
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.reply({ content: '👢 **Chọn thành viên để loại:**', components: [row], flags: MessageFlags.Ephemeral });
        return true;
    }

    // ========== NÚT ƯU TIÊN ==========
    if (customId.startsWith('bcql_priority_')) {
        const waitingList = session.waiting_list || [];

        if (waitingList.length === 0) {
            await interaction.reply({ content: '⚠️ Danh sách chờ trống!', flags: MessageFlags.Ephemeral });
            return true;
        }

        const options = waitingList.slice(0, 25).map((p, i) => ({
            label: p.username || `User ${i + 1}`,
            description: `Vị trí chờ: ${i + 1}`,
            value: p.id
        }));

        const dayParam2 = day || 'sat';
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`bcql_priority_select_${partyKey}_${dayParam2}`)
            .setPlaceholder('Chọn người để ưu tiên lên team...')
            .setMinValues(1)
            .setMaxValues(Math.min(options.length, 5))
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.reply({ content: '⬆️ **Chọn người từ danh sách chờ:**', components: [row], flags: MessageFlags.Ephemeral });
        return true;
    }

    // ========== NÚT CHỐT DS ==========
    if (customId.startsWith('bcql_finalize_')) {
        // Defer reply NGAY ĐẦU vì quá trình chốt DS + cấp role mất nhiều thời gian
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const teamAttack1 = session.team_attack1 || [];
        const teamAttack2 = session.team_attack2 || [];
        const teamDefense = session.team_defense || [];
        const teamForest = session.team_forest || [];
        const waitingList = session.waiting_list || [];
        const total = teamAttack1.length + teamAttack2.length + teamDefense.length + teamForest.length;

        if (total === 0) {
            await interaction.editReply({ content: '⚠️ Chưa có ai đăng ký!' });
            return true;
        }

        try {
            const supaSync = require('./supabaseSync');
            await supaSync.setSessionLocked(guildId, day || session.day || 'sat', true);
        } catch (e) {}

        // Role emojis
        const roleEmojis = { 'DPS': '🟢', 'Healer': '🔵', 'Tanker': '🟠', 'Unknown': '❓' };

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

        function formatTeam(team, startNum) {
            if (team.length === 0) return '_Trống_';
            return team.map((p, i) => {
                const role = getMemberRole(p.id);
                const icon = roleEmojis[role] || '❓';
                const leader = p.isLeader || p.isTeamLeader ? ' 👑' : '';
                return `${startNum + i}. ${icon} <@${p.id}>${leader}`;
            }).join('\n');
        }

        function getStats(team) {
            let s = { h: 0, t: 0, d: 0 };
            team.forEach(p => {
                const role = getMemberRole(p.id);
                if (role === 'Healer') s.h++;
                else if (role === 'Tanker') s.t++;
                else s.d++;
            });
            return `🔵${s.h} 🟠${s.t} 🟢${s.d}`;
        }

        // Dynamic slot numbers - đồng bộ với bcsize
        const attack1Size = db.getTeamSize('attack1') || 10;
        const attack2Size = db.getTeamSize('attack2') || 10;
        const slotstartAtt2 = 1 + attack1Size;
        const slotStartDef = slotstartAtt2 + attack2Size;
        const slotStartFor = slotStartDef + (db.getTeamSize('defense') ?? 5);

        const defenseSize2 = db.getTeamSize('defense') ?? 5;
        const forestSize2 = db.getTeamSize('forest') ?? 5;

        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('📋 CHỐT DS BANG CHIẾN LANG GIA!')
            .setDescription(`Leader: ${session.leader_name} | Tổng: **${total}** người`)
            .addFields(
                ...(() => { const n = db.getTeamNames ? db.getTeamNames() : { attack1: 'CÔNG 1', attack2: 'CÔNG 2' }; return [
                    { name: `⚔️ ${n.attack1} (${teamAttack1.length}/${attack1Size}) [${getStats(teamAttack1)}]`, value: formatTeam(teamAttack1, 1), inline: false },
                    { name: `🗡️ ${n.attack2} (${teamAttack2.length}/${attack2Size}) [${getStats(teamAttack2)}]`, value: formatTeam(teamAttack2, slotstartAtt2), inline: false }
                ]; })()
            );

        // Chỉ hiện team Thủ nếu size > 0
        if (defenseSize2 > 0) {
            embed.addFields({ name: `🛡️ THỦ (${teamDefense.length}/${defenseSize2}) [${getStats(teamDefense)}]`, value: formatTeam(teamDefense, slotStartDef), inline: false });
        }
        // Chỉ hiện team Rừng nếu size > 0
        if (forestSize2 > 0) {
            embed.addFields({ name: `🌲 RỪNG (${teamForest.length}/${forestSize2}) [${getStats(teamForest)}]`, value: formatTeam(teamForest, slotStartFor), inline: false });
        }

        if (waitingList.length > 0) {
            embed.addFields({ name: `⏳ Chờ (${waitingList.length})`, value: waitingList.map((p, i) => `${i + 1}. <@${p.id}>`).join('\n'), inline: false });
        }

        embed.setTimestamp();
        await interaction.channel.send({ embeds: [embed] });

        // Role BC đã được cấp ngay khi bấm Tham gia, không cần cấp lại ở đây

        await interaction.editReply({ content: `📝 Đã chốt danh sách! (${total} người)\n🔔 Mọi người vẫn có thể đăng ký nhưng sẽ vào hàng chờ.\n🔓 Dùng Team Editor trên web để mở khóa.` });
        return true;
    }

    // ========== NÚT ĐỔI CHỖ ==========
    if (customId.startsWith('bcql_swap_')) {
        const dayParam3 = day || 'sat';
        const modal = new ModalBuilder()
            .setCustomId(`bcql_swap_modal_${partyKey}_${dayParam3}`)
            .setTitle('🔄 Đổi chỗ 2 người');

        const input1 = new TextInputBuilder()
            .setCustomId('position1')
            .setLabel('Vị trí thứ 1 (1-30)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ví dụ: 5')
            .setRequired(true)
            .setMaxLength(2);

        const input2 = new TextInputBuilder()
            .setCustomId('position2')
            .setLabel('Vị trí thứ 2 (1-30)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ví dụ: 15')
            .setRequired(true)
            .setMaxLength(2);

        modal.addComponents(
            new ActionRowBuilder().addComponents(input1),
            new ActionRowBuilder().addComponents(input2)
        );

        await interaction.showModal(modal);
        return true;
    }

    // ========== NÚT THÊM NGƯỜI ==========
    if (customId.startsWith('bcql_add_')) {
        const dayParam4 = day || 'sat';
        const modal = new ModalBuilder()
            .setCustomId(`bcql_add_modal_${partyKey}_${dayParam4}`)
            .setTitle('➕ Thêm người vào BC');

        const userInput = new TextInputBuilder()
            .setCustomId('user_id')
            .setLabel('User ID, @mention, hoặc tên username')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('VD: 395151484179841024, @TaoRain, TaoRain')
            .setRequired(true)
            .setMaxLength(40);

        const teamInput = new TextInputBuilder()
            .setCustomId('team')
            .setLabel('Team (1/2/thu/rung) - để trống = tự động')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('1, 2, thu, hoặc rung')
            .setRequired(false)
            .setMaxLength(4);

        modal.addComponents(
            new ActionRowBuilder().addComponents(userInput),
            new ActionRowBuilder().addComponents(teamInput)
        );

        await interaction.showModal(modal);
        return true;
    }

    // ========== NÚT SỐ LƯỢNG (unused, kept for reference) ==========
    if (customId.startsWith('bcql_size_')) {
        const attack1Size = db.getTeamSize('attack1') || 10;
        const attack2Size = db.getTeamSize('attack2') || 10;
        const defenseSize = db.getTeamSize('defense') ?? 5;
        const forestSize = db.getTeamSize('forest') ?? 5;
        const total = attack1Size + attack2Size + defenseSize + forestSize;

        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('📏 Số lượng Team hiện tại')
            .addFields(
                ...(() => { const n = getTeamEmojis(); return [
                    { name: n.attack1, value: `**${attack1Size}**`, inline: true },
                    { name: n.attack2, value: `**${attack2Size}**`, inline: true },
                    { name: '📊 Tổng', value: `${total}`, inline: true },
                    { name: n.defense, value: `**${defenseSize}**`, inline: true },
                    { name: n.forest, value: `**${forestSize}**`, inline: true },
                    { name: '\u200B', value: '\u200B', inline: true }
                ]; })()
            )
            .setFooter({ text: '💡 VD: ?bcsize cong1 11 cong2 10 thu 5 rung 4' });

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return true;
    }

    // ========== NÚT RESIZE ==========
    if (customId.startsWith('bcql_resize_')) {
        const dayParam5 = day || 'sat';
        const modal = new ModalBuilder()
            .setCustomId(`bcql_resize_modal_${partyKey}_${dayParam5}`)
            .setTitle('📏 Resize & Đổi Tên Team');

        // Lấy sizes hiện tại
        const curAtk1 = db.getTeamSize('attack1') || 10;
        const curAtk2 = db.getTeamSize('attack2') || 10;
        const curDef  = db.getTeamSize('defense') ?? 5;
        const curFor  = db.getTeamSize('forest')  ?? 5;

        // Lấy tên hiện tại
        const curNames = db.getTeamNames ? db.getTeamNames() : { attack1: 'TEAM CÔNG 1', attack2: 'TEAM CÔNG 2', defense: 'TEAM THỦ', forest: 'TEAM RỪNG' };

        // 1 field gộp 4 số — tránh lãng phí 4 field Discord
        const sizesInput = new TextInputBuilder()
            .setCustomId('all_sizes')
            .setLabel('Số slot (Công1 Công2 Thủ Rừng) — cách bằng dấu cách')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('10 10 5 5')
            .setValue(`${curAtk1} ${curAtk2} ${curDef} ${curFor}`)
            .setRequired(true);

        const name1Input = new TextInputBuilder()
            .setCustomId('name_attack1')
            .setLabel('⚔️ Tên Team Công 1 (tối đa 20 ký tự)')
            .setStyle(TextInputStyle.Short)
            .setValue(curNames.attack1)
            .setRequired(false);

        const name2Input = new TextInputBuilder()
            .setCustomId('name_attack2')
            .setLabel('🗡️ Tên Team Công 2 (tối đa 20 ký tự)')
            .setStyle(TextInputStyle.Short)
            .setValue(curNames.attack2)
            .setRequired(false);

        const nameDefInput = new TextInputBuilder()
            .setCustomId('name_defense')
            .setLabel('🛡️ Tên Team Thủ (tối đa 20 ký tự)')
            .setStyle(TextInputStyle.Short)
            .setValue(curNames.defense)
            .setRequired(false);

        const nameForInput = new TextInputBuilder()
            .setCustomId('name_forest')
            .setLabel('🌲 Tên Team Rừng (tối đa 20 ký tự)')
            .setStyle(TextInputStyle.Short)
            .setValue(curNames.forest)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(sizesInput),
            new ActionRowBuilder().addComponents(name1Input),
            new ActionRowBuilder().addComponents(name2Input),
            new ActionRowBuilder().addComponents(nameDefInput),
            new ActionRowBuilder().addComponents(nameForInput)
        );

        await interaction.showModal(modal);
        return true;
    }

    // ========== NÚT SET LEADER ==========
    if (customId.startsWith('bcql_setleader_')) {
        const dayParam6 = day || 'sat';
        const modal = new ModalBuilder()
            .setCustomId(`bcql_setleader_modal_${partyKey}_${dayParam6}`)
            .setTitle('👑 Set Leader cho 4 team');

        const attack1Size = db.getTeamSize('attack1') || 10;
        const attack2Size = db.getTeamSize('attack2') || 10;
        const defenseSize = db.getTeamSize('defense') ?? 5;

        const slotStartAtt2 = 1 + attack1Size;
        const slotStartDef = slotStartAtt2 + attack2Size;
        const slotStartFor = slotStartDef + defenseSize;

        const leadersInput = new TextInputBuilder()
            .setCustomId('leaders_input')
            .setLabel(`Nhập 4 số slot (Công1, Công2, Thủ, Rừng)`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(`VD: 1 ${slotStartAtt2} ${slotStartDef} ${slotStartFor}`)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(leadersInput));

        await interaction.showModal(modal);
        return true;
    }

    return false;
}

/**
 * Handle bcql select menus
 */
async function handleBcqlSelect(interaction) {
    const customId = interaction.customId;

    if (!customId.startsWith('bcql_')) return false;

    const guildId = interaction.guild.id;

    // Parse day từ customId (format: bcql_kick_select_partyKey_day)
    const day = parseDayFromCustomId(customId);

    // Lấy session từ DB - ưu tiên theo day nếu có
    let session;
    if (day) {
        session = db.getActiveBangchienByDay(guildId, day);
    } else {
        const activeSessions = db.getActiveBangchienByGuild(guildId);
        session = activeSessions.length > 0 ? activeSessions[0] : null;
    }

    if (!session) {
        await interaction.reply({ content: '❌ BC không tồn tại!', flags: MessageFlags.Ephemeral });
        return true;
    }

    const partyKey = session.party_key;

    // ========== KICK SELECT ==========
    if (customId.startsWith('bcql_kick_select_')) {
        const selectedIds = interaction.values;
        let kicked = 0;

        const freshSession = db.getActiveBangchien(partyKey);
        if (!freshSession) {
            await interaction.update({ content: '❌ BC không tồn tại!', components: [] });
            return true;
        }

        const teams = {
            attack1: [...(freshSession.team_attack1 || [])],
            attack2: [...(freshSession.team_attack2 || [])],
            defense: [...(freshSession.team_defense || [])],
            forest: [...(freshSession.team_forest || [])],
            waiting: [...(freshSession.waiting_list || [])]
        };

        for (const userId of selectedIds) {
            let moved = false;
            for (const teamKey of ['attack1', 'attack2', 'defense', 'forest']) {
                const idx = teams[teamKey].findIndex(p => p.id === userId);
                if (idx !== -1) {
                    const person = teams[teamKey].splice(idx, 1)[0];
                    teams.waiting.push(person);
                    kicked++;
                    moved = true;
                    break;
                }
            }
            if (!moved && teams.waiting.some(p => p.id === userId)) kicked++;

            const sessionDay = day || freshSession.day || 'sat';
            db.removeBcRegular(guildId, userId, sessionDay);
            try {
                const supaSync = require('./supabaseSync');
                await supaSync.removeBcRegular(guildId, userId, sessionDay);
            } catch (e) {}
        }

        db.updateActiveBangchien(partyKey, {
            team_attack1: teams.attack1,
            team_attack2: teams.attack2,
            team_defense: teams.defense,
            team_forest: teams.forest,
            waiting_list: teams.waiting
        });

        await refreshOverviewEmbed(interaction.client, guildId);
        await syncSessionToSupabase(guildId, partyKey, interaction.guild);
        await interaction.update({ content: `✅ Đã chuyển ${kicked} người xuống hàng chờ!`, components: [] });
        if (day) {
            await refreshListbcEmbed(interaction, session, day);
        }
        return true;
    }

    // ========== PRIORITY SELECT ==========
    if (customId.startsWith('bcql_priority_select_')) {
        const selectedIds = interaction.values;
        let moved = 0;

        // Lấy session mới nhất
        const freshSession = db.getActiveBangchien(partyKey);
        if (!freshSession) {
            await interaction.update({ content: '❌ BC không tồn tại!', components: [] });
            return true;
        }

        const attack1Size = db.getTeamSize('attack1') || 10;
        const attack2Size = db.getTeamSize('attack2') || 10;
        const defenseSize = db.getTeamSize('defense') ?? 5;
        const forestSize = db.getTeamSize('forest') ?? 5;

        for (const userId of selectedIds) {
            // Tìm người trong waiting list
            const waitIndex = freshSession.waiting_list.findIndex(p => p.id === userId);
            if (waitIndex === -1) continue;

            const person = freshSession.waiting_list[waitIndex];

            // Thử đưa vào team theo thứ tự
            if (freshSession.team_attack1.length < attack1Size) {
                freshSession.team_attack1.push(person);
                freshSession.waiting_list.splice(waitIndex, 1);
                moved++;
            } else if (freshSession.team_attack2.length < attack2Size) {
                freshSession.team_attack2.push(person);
                freshSession.waiting_list.splice(waitIndex, 1);
                moved++;
            } else if (freshSession.team_defense.length < defenseSize) {
                freshSession.team_defense.push(person);
                freshSession.waiting_list.splice(waitIndex, 1);
                moved++;
            } else if (freshSession.team_forest.length < forestSize) {
                freshSession.team_forest.push(person);
                freshSession.waiting_list.splice(waitIndex, 1);
                moved++;
            }
        }

        // Update DB
        db.updateActiveBangchien(partyKey, {
            team_attack1: freshSession.team_attack1,
            team_attack2: freshSession.team_attack2,
            team_defense: freshSession.team_defense,
            team_forest: freshSession.team_forest,
            waiting_list: freshSession.waiting_list
        });

        // Refresh ?bc overview embed
        await refreshOverviewEmbed(interaction.client, guildId);
        await syncSessionToSupabase(guildId, partyKey, interaction.guild);

        await interaction.update({ content: `✅ Đã đưa ${moved} người lên team!`, components: [] });

        // Refresh ?listbc embed nếu có day
        if (day) {
            await refreshListbcEmbed(interaction, session, day);
        }
        return true;
    }

    return false;
}


/**
 * Handle bcql modals
 */
async function handleBcqlModal(interaction) {
    const customId = interaction.customId;

    if (!customId.startsWith('bcql_')) return false;

    const guildId = interaction.guild.id;

    // Parse day từ customId (format: bcql_swap_modal_partyKey_day hoặc bcql_add_modal_partyKey_day)
    const day = parseDayFromCustomId(customId);

    // Lấy session từ DB - ưu tiên theo day nếu có
    let session;
    if (day) {
        session = db.getActiveBangchienByDay(guildId, day);
    } else {
        const activeSessions = db.getActiveBangchienByGuild(guildId);
        session = activeSessions.length > 0 ? activeSessions[0] : null;
    }

    if (!session) {
        await interaction.reply({ content: '❌ BC không tồn tại!', flags: MessageFlags.Ephemeral });
        return true;
    }

    const partyKey = session.party_key;

    // ========== SWAP MODAL ==========
    if (customId.startsWith('bcql_swap_modal_')) {
        const pos1 = parseInt(interaction.fields.getTextInputValue('position1'));
        const pos2 = parseInt(interaction.fields.getTextInputValue('position2'));

        if (isNaN(pos1) || isNaN(pos2) || pos1 < 1 || pos2 < 1) {
            await interaction.reply({ content: '❌ Vị trí không hợp lệ!', flags: MessageFlags.Ephemeral });
            return true;
        }

        // Dynamic slot numbers - đồng bộ với bcsize
        const attack1Size = db.getTeamSize('attack1') || 10;
        const attack2Size = db.getTeamSize('attack2') || 10;
        const defenseSize = db.getTeamSize('defense') ?? 5;
        const forestSize = db.getTeamSize('forest') ?? 5;

        const slotStartAtt2 = 1 + attack1Size;
        const slotStartDef = slotStartAtt2 + attack2Size;
        const slotStartFor = slotStartDef + defenseSize;
        const slotStartWait = slotStartFor + forestSize;

        // Build all members array with positions
        const allMembers = [];
        session.team_attack1.forEach((p, i) => allMembers.push({ ...p, pos: 1 + i, team: 'attack1', idx: i }));
        session.team_attack2.forEach((p, i) => allMembers.push({ ...p, pos: slotStartAtt2 + i, team: 'attack2', idx: i }));
        session.team_defense.forEach((p, i) => allMembers.push({ ...p, pos: slotStartDef + i, team: 'defense', idx: i }));
        session.team_forest.forEach((p, i) => allMembers.push({ ...p, pos: slotStartFor + i, team: 'forest', idx: i }));
        session.waiting_list.forEach((p, i) => allMembers.push({ ...p, pos: slotStartWait + i, team: 'waiting', idx: i }));

        const member1 = allMembers.find(m => m.pos === pos1);
        const member2 = allMembers.find(m => m.pos === pos2);

        // Helper: xác định team từ slot number
        function getTeamFromSlot(slotNum) {
            if (slotNum >= 1 && slotNum < slotStartAtt2) return { team: 'attack1', maxSize: attack1Size, currentLen: session.team_attack1.length, startSlot: 1 };
            if (slotNum >= slotStartAtt2 && slotNum < slotStartDef) return { team: 'attack2', maxSize: attack2Size, currentLen: session.team_attack2.length, startSlot: slotStartAtt2 };
            if (slotNum >= slotStartDef && slotNum < slotStartFor) return { team: 'defense', maxSize: defenseSize, currentLen: session.team_defense.length, startSlot: slotStartDef };
            if (slotNum >= slotStartFor && slotNum < slotStartWait) return { team: 'forest', maxSize: forestSize, currentLen: session.team_forest.length, startSlot: slotStartFor };
            if (slotNum >= slotStartWait) return { team: 'waiting', maxSize: 999, currentLen: session.waiting_list.length, startSlot: slotStartWait };
            return null;
        }

        const TEAM_EMOJI = getTeamEmojis();

        // Swap in session
        const teams = {
            attack1: [...session.team_attack1],
            attack2: [...session.team_attack2],
            defense: [...session.team_defense],
            forest: [...session.team_forest],
            waiting: [...session.waiting_list]
        };

        const sessionDay = session.day || 'sat';
        const isAttackTeam = (team) => team === 'attack1' || team === 'attack2';
        const isPresetTeam = (team) => team === 'defense' || team === 'forest';

        // Case 1: Cả 2 slot có người → SWAP
        if (member1 && member2) {
            const person1Data = { id: member1.id, username: member1.username, role: member1.role, isLeader: member1.isLeader };
            const person2Data = { id: member2.id, username: member2.username, role: member2.role, isLeader: member2.isLeader };

            teams[member1.team][member1.idx] = person2Data;
            teams[member2.team][member2.idx] = person1Data;

            // Preset logic for person1
            if (isPresetTeam(member2.team)) {
                const presetType = member2.team === 'defense' ? 'thu' : 'rung';
                const currentPreset = db.getBcPreset(interaction.guild.id, presetType, sessionDay);
                if (!currentPreset.some(p => p.id === member1.id)) {
                    currentPreset.push({ id: member1.id, username: member1.username });
                    db.setBcPreset(interaction.guild.id, presetType, currentPreset, sessionDay);
                }
            }
            if (isPresetTeam(member1.team) && isAttackTeam(member2.team)) {
                const presetType = member1.team === 'defense' ? 'thu' : 'rung';
                const currentPreset = db.getBcPreset(interaction.guild.id, presetType, sessionDay);
                const newPreset = currentPreset.filter(p => p.id !== member1.id);
                if (newPreset.length !== currentPreset.length) {
                    db.setBcPreset(interaction.guild.id, presetType, newPreset, sessionDay);
                }
            }

            // Preset logic for person2
            if (isPresetTeam(member1.team)) {
                const presetType = member1.team === 'defense' ? 'thu' : 'rung';
                const currentPreset = db.getBcPreset(interaction.guild.id, presetType, sessionDay);
                if (!currentPreset.some(p => p.id === member2.id)) {
                    currentPreset.push({ id: member2.id, username: member2.username });
                    db.setBcPreset(interaction.guild.id, presetType, currentPreset, sessionDay);
                }
            }
            if (isPresetTeam(member2.team) && isAttackTeam(member1.team)) {
                const presetType = member2.team === 'defense' ? 'thu' : 'rung';
                const currentPreset = db.getBcPreset(interaction.guild.id, presetType, sessionDay);
                const newPreset = currentPreset.filter(p => p.id !== member2.id);
                if (newPreset.length !== currentPreset.length) {
                    db.setBcPreset(interaction.guild.id, presetType, newPreset, sessionDay);
                }
            }

            // Update DB
            db.updateActiveBangchien(partyKey, {
                team_attack1: teams.attack1,
                team_attack2: teams.attack2,
                team_defense: teams.defense,
                team_forest: teams.forest,
                waiting_list: teams.waiting
            });

            // Refresh overview
            await refreshOverviewEmbed(interaction.client, guildId);
            await syncSessionToSupabase(guildId, partyKey, interaction.guild);

            await interaction.reply({ content: `✅ Đã đổi vị trí ${pos1} ↔ ${pos2}!`, flags: MessageFlags.Ephemeral });
            if (day) await refreshListbcEmbed(interaction, session, day);
            return true;
        }

        // Case 2: Slot1 có người, Slot2 trống → MOVE
        if (member1 && !member2) {
            const targetTeamInfo = getTeamFromSlot(pos2);
            if (!targetTeamInfo) {
                await interaction.reply({ content: '❌ Vị trí đích không hợp lệ!', flags: MessageFlags.Ephemeral });
                return true;
            }

            // Kiểm tra phải di chuyển vào slot đầu tiên
            const firstEmptySlot = targetTeamInfo.startSlot + targetTeamInfo.currentLen;
            if (pos2 !== firstEmptySlot) {
                await interaction.reply({ content: `❌ Phải di chuyển vào slot **${firstEmptySlot}** (slot trống đầu tiên của ${TEAM_EMOJI[targetTeamInfo.team]})`, flags: MessageFlags.Ephemeral });
                return true;
            }

            // Kiểm tra team đích có đầy không
            if (targetTeamInfo.currentLen >= targetTeamInfo.maxSize) {
                await interaction.reply({ content: `❌ ${TEAM_EMOJI[targetTeamInfo.team]} đã đầy!`, flags: MessageFlags.Ephemeral });
                return true;
            }

            // Move
            const movedPerson = { id: member1.id, username: member1.username, role: member1.role, isLeader: member1.isLeader };
            teams[member1.team].splice(member1.idx, 1);
            teams[targetTeamInfo.team].push(movedPerson);

            // Preset logic
            if (isPresetTeam(targetTeamInfo.team)) {
                const presetType = targetTeamInfo.team === 'defense' ? 'thu' : 'rung';
                const currentPreset = db.getBcPreset(interaction.guild.id, presetType, sessionDay);
                if (!currentPreset.some(p => p.id === movedPerson.id)) {
                    currentPreset.push({ id: movedPerson.id, username: movedPerson.username });
                    db.setBcPreset(interaction.guild.id, presetType, currentPreset, sessionDay);
                }
            }
            if (isPresetTeam(member1.team) && isAttackTeam(targetTeamInfo.team)) {
                const presetType = member1.team === 'defense' ? 'thu' : 'rung';
                const currentPreset = db.getBcPreset(interaction.guild.id, presetType, sessionDay);
                const newPreset = currentPreset.filter(p => p.id !== movedPerson.id);
                if (newPreset.length !== currentPreset.length) {
                    db.setBcPreset(interaction.guild.id, presetType, newPreset, sessionDay);
                }
            }

            // Update DB
            db.updateActiveBangchien(partyKey, {
                team_attack1: teams.attack1,
                team_attack2: teams.attack2,
                team_defense: teams.defense,
                team_forest: teams.forest,
                waiting_list: teams.waiting
            });

            // Refresh overview
            await refreshOverviewEmbed(interaction.client, guildId);
            await syncSessionToSupabase(guildId, partyKey, interaction.guild);

            await interaction.reply({ content: `✅ Đã di chuyển **${movedPerson.username}** → ${TEAM_EMOJI[targetTeamInfo.team]}!`, flags: MessageFlags.Ephemeral });
            if (day) await refreshListbcEmbed(interaction, session, day);
            return true;
        }

        // Case 3: Slot1 trống
        await interaction.reply({ content: '❌ Vị trí nguồn không có người!', flags: MessageFlags.Ephemeral });
        return true;
    }

    // ========== ADD MODAL ==========
    if (customId.startsWith('bcql_add_modal_')) {
        let userInput = interaction.fields.getTextInputValue('user_id').trim();
        const teamInput = interaction.fields.getTextInputValue('team').trim().toLowerCase();

        // Resolve user từ nhiều định dạng: ID, @mention, username, display name
        let user;
        let userId;

        // 1. Thử parse @mention format: <@123456> hoặc <@!123456>
        const mentionMatch = userInput.match(/^<@!?(\d+)>$/);
        if (mentionMatch) {
            userInput = mentionMatch[1];
        }

        // 2. Nếu là số thuần (User ID) → fetch trực tiếp
        if (/^\d{17,20}$/.test(userInput)) {
            try {
                user = await interaction.client.users.fetch(userInput);
                userId = userInput;
            } catch (e) {
                await interaction.reply({ content: '❌ User ID không tồn tại!', flags: MessageFlags.Ephemeral });
                return true;
            }
        } else {
            // 3. Tìm theo username hoặc display name trong guild
            const searchTerm = userInput.toLowerCase().replace(/^@/, ''); // Bỏ @ đầu nếu có
            await interaction.guild.members.fetch().catch(() => null);
            const foundMember = interaction.guild.members.cache.find(m =>
                m.user.username.toLowerCase() === searchTerm ||
                m.displayName.toLowerCase() === searchTerm ||
                m.user.tag?.toLowerCase() === searchTerm
            );

            if (!foundMember) {
                await interaction.reply({ content: `❌ Không tìm thấy user "${userInput}" trong server!\n💡 Thử nhập User ID hoặc username chính xác.`, flags: MessageFlags.Ephemeral });
                return true;
            }
            user = foundMember.user;
            userId = user.id;
        }

        // Check if already registered
        const allMembers = [...session.team_attack1, ...session.team_attack2, ...session.team_defense, ...session.team_forest, ...session.waiting_list];
        if (allMembers.some(p => p.id === userId)) {
            await interaction.reply({ content: '❌ Người này đã đăng ký rồi!', flags: MessageFlags.Ephemeral });
            return true;
        }

        // Lookup tên ingame từ DB
        const addUserInfo = db.getUserByDiscordId(userId);
        const addGameName = addUserInfo?.game_username || '';

        // Add to specified team or auto
        const result = db.addBangchienParticipant(partyKey, { id: userId, username: user.username, gn: addGameName, name: addGameName || user.username, role: 'DPS' }, guildId);

        if (!result.success) {
            await interaction.reply({ content: `❌ ${result.error}`, flags: MessageFlags.Ephemeral });
            return true;
        }

        // Refresh ?bc overview embed
        await refreshOverviewEmbed(interaction.client, guildId);
        await syncSessionToSupabase(guildId, partyKey, interaction.guild);

        const teamEmojis = getTeamEmojis();
        await interaction.reply({ content: `✅ Đã thêm ${user.username} vào ${teamEmojis[result.team] || result.team}!`, flags: MessageFlags.Ephemeral });

        // Refresh ?listbc embed nếu có day
        if (day) {
            await refreshListbcEmbed(interaction, session, day);
        }
        return true;
    }

    // ========== MODAL RESIZE ==========
    if (customId.startsWith('bcql_resize_modal_')) {
        // Parse 4 con số từ 1 field dạng "10 10 5 5"
        const sizesRaw = interaction.fields.getTextInputValue('all_sizes').trim();
        const sizeParts = sizesRaw.split(/[\s,]+/).map(s => parseInt(s)).filter(n => !isNaN(n));

        if (sizeParts.length < 4) {
            await interaction.reply({
                content: '❌ Nhập đúng 4 số (Công1 Công2 Thủ Rừng)!\nVD: `10 10 5 5`',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        const [attack1Size, attack2Size, defSizeRaw, forSizeRaw] = sizeParts;
        const defenseSize = defSizeRaw;
        const forestSize = forSizeRaw;

        // Validate
        if (attack1Size < 1 || attack1Size > 20 || attack2Size < 1 || attack2Size > 20 ||
            defenseSize < 0 || defenseSize > 10 || forestSize < 0 || forestSize > 10) {
            await interaction.reply({ content: '❌ Số lượng không hợp lệ! Công: 1-20, Thủ/Rừng: 0-10', flags: MessageFlags.Ephemeral });
            return true;
        }

        const total = attack1Size + attack2Size + defenseSize + forestSize;
        if (total < 1) {
            await interaction.reply({ content: `❌ Tổng số thành viên không hợp lệ (${total}). Phải lớn hơn 0.`, flags: MessageFlags.Ephemeral });
            return true;
        }

        // Parse tên team (bỏ trống nếu không nhập)
        const nameAttack1 = interaction.fields.getTextInputValue('name_attack1').trim();
        const nameAttack2 = interaction.fields.getTextInputValue('name_attack2').trim();
        const nameDefense = interaction.fields.getTextInputValue('name_defense').trim();
        const nameForest  = interaction.fields.getTextInputValue('name_forest').trim();

        // Lưu sizes
        db.setTeamSize('attack1', attack1Size);
        db.setTeamSize('attack2', attack2Size);
        db.setTeamSize('defense', defenseSize);
        db.setTeamSize('forest', forestSize);

        // Lưu names (chỉ cập nhật nếu có nhập)
        const savedNames = db.setTeamNames({
            attack1: nameAttack1 || undefined,
            attack2: nameAttack2 || undefined,
            defense: nameDefense || undefined,
            forest:  nameForest  || undefined
        });

        // Lấy các sizes cũ để so sánh
        const oldAtk1 = sizeParts[0]; // Giả nguyên, đây là nếu cần diff
        const emoji = { attack1: '⚔️', attack2: '🗡️', defense: '🛡️', forest: '🌲' };

        const resultLines = [
            `${emoji.attack1} **${savedNames.attack1}**: ${attack1Size} slot`,
            `${emoji.attack2} **${savedNames.attack2}**: ${attack2Size} slot`,
            ...(defenseSize > 0 ? [`${emoji.defense} **${savedNames.defense}**: ${defenseSize} slot`] : [`${emoji.defense} **${savedNames.defense}**: ẩn`]),
            ...(forestSize  > 0 ? [`${emoji.forest}  **${savedNames.forest}**: ${forestSize} slot`] : [`${emoji.forest}  **${savedNames.forest}**: ẩn`]),
            `📊 Tổng: **${total}** slot`
        ];

        await interaction.reply({
            content: `✅ Đã cập nhật đội hình!\n${resultLines.join('\n')}`,
            flags: MessageFlags.Ephemeral
        });

        // Sync lên Supabase (team_sizes + team_names)
        await syncSessionToSupabase(guildId, partyKey, interaction.guild);

        // Refresh listbc nếu có
        if (day && session) {
            await refreshListbcEmbed(interaction, session, day);
        }
        return true;
    }

    // ========== MODAL SET LEADER ==========
    if (customId.startsWith('bcql_setleader_modal_')) {
        const leadersStr = interaction.fields.getTextInputValue('leaders_input').trim();
        const slotNumbers = leadersStr.split(/\s+/).map(s => parseInt(s)).filter(n => !isNaN(n));

        if (slotNumbers.length === 0 || slotNumbers.length > 4) {
            await interaction.reply({ content: '❌ Nhập 1-4 số slot (cách nhau bằng dấu cách)!', flags: MessageFlags.Ephemeral });
            return true;
        }

        // Lấy team sizes
        const attack1Size = db.getTeamSize('attack1') || 10;
        const attack2Size = db.getTeamSize('attack2') || 10;
        const defenseSize = db.getTeamSize('defense') ?? 5;

        const slotStartAtt2 = 1 + attack1Size;
        const slotStartDef = slotStartAtt2 + attack2Size;
        const slotStartFor = slotStartDef + defenseSize;
        const slotStartWait = slotStartFor + (db.getTeamSize('forest') ?? 5);

        // Clone teams
        const teams = {
            attack1: [...(session.team_attack1 || [])],
            attack2: [...(session.team_attack2 || [])],
            defense: [...(session.team_defense || [])],
            forest: [...(session.team_forest || [])],
            waiting: [...(session.waiting_list || [])]
        };

        // Reset all leaders first
        for (const team of Object.values(teams)) {
            team.forEach(p => { p.isLeader = false; p.isTeamLeader = false; });
        }

        // Helper: get person by slot
        function getPersonBySlot(slotNum) {
            if (slotNum >= 1 && slotNum < slotStartAtt2) {
                const idx = slotNum - 1;
                return idx < teams.attack1.length ? { team: 'attack1', person: teams.attack1[idx], idx } : null;
            } else if (slotNum >= slotStartAtt2 && slotNum < slotStartDef) {
                const idx = slotNum - slotStartAtt2;
                return idx < teams.attack2.length ? { team: 'attack2', person: teams.attack2[idx], idx } : null;
            } else if (slotNum >= slotStartDef && slotNum < slotStartFor) {
                const idx = slotNum - slotStartDef;
                return idx < teams.defense.length ? { team: 'defense', person: teams.defense[idx], idx } : null;
            } else if (slotNum >= slotStartFor && slotNum < slotStartWait) {
                const idx = slotNum - slotStartFor;
                return idx < teams.forest.length ? { team: 'forest', person: teams.forest[idx], idx } : null;
            }
            return null;
        }

        const TEAM_EMOJI = getTeamEmojis();
        const results = [];

        for (const slotNum of slotNumbers) {
            const info = getPersonBySlot(slotNum);
            if (info) {
                info.person.isTeamLeader = true;
                results.push(`👑 ${info.person.username} → ${TEAM_EMOJI[info.team]}`);
            } else {
                results.push(`❌ Slot ${slotNum} không có người`);
            }
        }

        // Update DB
        db.updateActiveBangchien(partyKey, {
            team_attack1: teams.attack1,
            team_attack2: teams.attack2,
            team_defense: teams.defense,
            team_forest: teams.forest,
            waiting_list: teams.waiting
        });

        // Refresh ?bc overview embed
        await refreshOverviewEmbed(interaction.client, guildId);
        await syncSessionToSupabase(guildId, partyKey, interaction.guild);

        await interaction.reply({ content: `✅ Đã set Leader:\n${results.join('\n')}`, flags: MessageFlags.Ephemeral });

        if (day) await refreshListbcEmbed(interaction, session, day);
        return true;
    }

    return false;
}

module.exports = { handleBcqlButton, handleBcqlSelect, handleBcqlModal };

