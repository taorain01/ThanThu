/**
 * Handler cho cÃ¡c nÃºt bcql (Panel quáº£n lÃ½ Bang Chiáº¿n)
 * ÄÆ°á»£c import vÃ o interactionCreate.js
 */

const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/db');
const { bangchienNotifications, bangchienRegistrations, bangchienChannels, DAY_CONFIG, listbcDetailMessages, refreshOverviewEmbed } = require('./bangchienState');
const { createBangchienEmbed, createBangchienButtons } = require('../commands/bangchien/bangchien');

// Helper: Sync session lÃªn Supabase sau khi SQLite thay Ä‘á»•i
async function syncSessionToSupabase(guildId, partyKey, guild = null) {
    try {
        const supaSync = require('./supabaseSync');
        if (!supaSync.isReady()) return;
        const session = db.getActiveBangchien(partyKey);
        if (!session) return;
        const formatted = supaSync.formatActiveSession(session, db, guild);
        if (formatted) {
            await supaSync.syncBCSession(guildId, session.day || 'sat', formatted);
            console.log(`[bcqlHandlers] âœ… ÄÃ£ sync session ${session.day} lÃªn Supabase`);
        }
    } catch (e) {
        console.error('[bcqlHandlers] Lá»—i sync Supabase:', e.message);
    }
}

/**
 * Parse day tá»« customId format: bcql_action_partyKey_day
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
 * Refresh listbc embed sau khi thá»±c hiá»‡n action
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

    // Láº¥y session má»›i nháº¥t
    const freshSession = db.getActiveBangchienByDay(guildId, day);
    if (!freshSession) return;

    // Táº¡o embed má»›i vÃ  edit message
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

    // Edit stored message vá»›i embed má»›i
    if (newEmbed) {
        try {
            await storedData.message.edit({ embeds: [newEmbed], components: newComponents });
            console.log(`[bcqlHandlers] Refreshed listbc embed for ${listbcKey}`);
        } catch (e) {
            console.error(`[bcqlHandlers] Cannot edit listbc message:`, e.message);
            // XÃ³a reference náº¿u message khÃ´ng cÃ²n tá»“n táº¡i
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

    // Chá»‰ xá»­ lÃ½ cÃ¡c nÃºt bcql_
    if (!customId.startsWith('bcql_')) return false;

    const guildId = interaction.guild.id;

    // Parse day tá»« customId (format má»›i: bcql_action_partyKey_day)
    const day = parseDayFromCustomId(customId);

    // Láº¥y session tá»« DB - Æ°u tiÃªn theo day náº¿u cÃ³
    let session;
    if (day) {
        session = db.getActiveBangchienByDay(guildId, day);
    } else {
        const activeSessions = db.getActiveBangchienByGuild(guildId);
        session = activeSessions.length > 0 ? activeSessions[0] : null;
    }

    if (!session) {
        await interaction.reply({ content: 'âŒ KhÃ´ng cÃ³ BC Ä‘ang cháº¡y!', flags: MessageFlags.Ephemeral });
        return true;
    }

    const partyKey = session.party_key;

    // Kiá»ƒm tra quyá»n
    const quanLyRole = interaction.guild.roles.cache.find(r => r.name === 'Quáº£n LÃ½');
    const leaderBcRole = interaction.guild.roles.cache.find(r => r.name === 'Leader BC');
    const kyCuuRole = interaction.guild.roles.cache.find(r => r.name === 'Ká»³ Cá»±u');

    const isQuanLy = quanLyRole && interaction.member.roles.cache.has(quanLyRole.id);
    const isLeaderBc = leaderBcRole && interaction.member.roles.cache.has(leaderBcRole.id);
    const isKyCuu = kyCuuRole && interaction.member.roles.cache.has(kyCuuRole.id);
    const isSessionLeader = session.leader_id === interaction.user.id;

    if (!isSessionLeader && !isQuanLy && !isLeaderBc && !isKyCuu) {
        await interaction.reply({ content: 'âŒ Báº¡n khÃ´ng cÃ³ quyá»n!', flags: MessageFlags.Ephemeral });
        return true;
    }

    // ========== NÃšT LOáº I Bá»Ž ==========
    if (customId.startsWith('bcql_kick_')) {
        const allMembers = [
            ...session.team_attack1.map(p => ({ ...p, team: 'CÃ´ng 1' })),
            ...session.team_attack2.map(p => ({ ...p, team: 'CÃ´ng 2' })),
            ...session.team_defense.map(p => ({ ...p, team: 'Thá»§' })),
            ...session.team_forest.map(p => ({ ...p, team: 'Rá»«ng' })),
            ...session.waiting_list.map(p => ({ ...p, team: 'Chá»' }))
        ].filter(p => p.id !== session.leader_id); // KhÃ´ng cho kick leader

        if (allMembers.length === 0) {
            await interaction.reply({ content: 'âš ï¸ KhÃ´ng cÃ³ ai Ä‘á»ƒ loáº¡i bá»!', flags: MessageFlags.Ephemeral });
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
            .setPlaceholder('Chá»n ngÆ°á»i Ä‘á»ƒ loáº¡i bá»...')
            .setMinValues(1)
            .setMaxValues(Math.min(options.length, 10))
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.reply({ content: 'ðŸ‘¢ **Chá»n thÃ nh viÃªn Ä‘á»ƒ loáº¡i:**', components: [row], flags: MessageFlags.Ephemeral });
        return true;
    }

    // ========== NÃšT Æ¯U TIÃŠN ==========
    if (customId.startsWith('bcql_priority_')) {
        const waitingList = session.waiting_list || [];

        if (waitingList.length === 0) {
            await interaction.reply({ content: 'âš ï¸ Danh sÃ¡ch chá» trá»‘ng!', flags: MessageFlags.Ephemeral });
            return true;
        }

        const options = waitingList.slice(0, 25).map((p, i) => ({
            label: p.username || `User ${i + 1}`,
            description: `Vá»‹ trÃ­ chá»: ${i + 1}`,
            value: p.id
        }));

        const dayParam2 = day || 'sat';
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`bcql_priority_select_${partyKey}_${dayParam2}`)
            .setPlaceholder('Chá»n ngÆ°á»i Ä‘á»ƒ Æ°u tiÃªn lÃªn team...')
            .setMinValues(1)
            .setMaxValues(Math.min(options.length, 5))
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.reply({ content: 'â¬†ï¸ **Chá»n ngÆ°á»i tá»« danh sÃ¡ch chá»:**', components: [row], flags: MessageFlags.Ephemeral });
        return true;
    }

    // ========== NÃšT CHá»T DS ==========
    if (customId.startsWith('bcql_finalize_')) {
        // Defer reply NGAY Äáº¦U vÃ¬ quÃ¡ trÃ¬nh chá»‘t DS + cáº¥p role máº¥t nhiá»u thá»i gian
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const teamAttack1 = session.team_attack1 || [];
        const teamAttack2 = session.team_attack2 || [];
        const teamDefense = session.team_defense || [];
        const teamForest = session.team_forest || [];
        const waitingList = session.waiting_list || [];
        const total = teamAttack1.length + teamAttack2.length + teamDefense.length + teamForest.length;

        if (total === 0) {
            await interaction.editReply({ content: 'âš ï¸ ChÆ°a cÃ³ ai Ä‘Äƒng kÃ½!' });
            return true;
        }

        try {
            const supaSync = require('./supabaseSync');
            await supaSync.setSessionLocked(guildId, day || session.day || 'sat', true);
        } catch (e) {}

        // Role emojis
        const roleEmojis = { 'DPS': 'ðŸ”µ', 'Healer': 'ðŸŸ¢', 'Tanker': 'ðŸŸ ', 'Unknown': 'â“' };

        // Helper: detect role tá»« Discord - Æ¯U TIÃŠN Healer/Tanker
        function getMemberRole(memberId) {
            try {
                const member = interaction.guild.members.cache.get(memberId);
                if (!member) return 'Unknown';

                const healerRole = interaction.guild.roles.cache.find(r => r.name === 'Healer');
                if (healerRole && member.roles.cache.has(healerRole.id)) return 'Healer';

                const tankerRole = interaction.guild.roles.cache.find(r => r.name === 'Tanker');
                if (tankerRole && member.roles.cache.has(tankerRole.id)) return 'Tanker';

                const dpsSubTypes = ['Quáº¡t DÃ¹', 'VÃ´ Danh', 'Song Äao', 'Cá»­u Kiáº¿m'];
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
            if (team.length === 0) return '_Trá»‘ng_';
            return team.map((p, i) => {
                const role = getMemberRole(p.id);
                const icon = roleEmojis[role] || 'â“';
                const leader = p.isLeader || p.isTeamLeader ? ' ðŸ‘‘' : '';
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
            return `ðŸŸ¢${s.h} ðŸŸ ${s.t} ðŸ”µ${s.d}`;
        }

        // Dynamic slot numbers - Ä‘á»“ng bá»™ vá»›i bcsize
        const attack1Size = db.getTeamSize('attack1') || 10;
        const attack2Size = db.getTeamSize('attack2') || 10;
        const slotstartAtt2 = 1 + attack1Size;
        const slotStartDef = slotstartAtt2 + attack2Size;
        const slotStartFor = slotStartDef + (db.getTeamSize('defense') ?? 5);

        const defenseSize2 = db.getTeamSize('defense') ?? 5;
        const forestSize2 = db.getTeamSize('forest') ?? 5;

        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('ðŸ“‹ CHá»T DS BANG CHIáº¾N LANG GIA!')
            .setDescription(`Leader: ${session.leader_name} | Tá»•ng: **${total}** ngÆ°á»i`)
            .addFields(
                { name: `âš”ï¸ CÃ”NG 1 (${teamAttack1.length}/${attack1Size}) [${getStats(teamAttack1)}]`, value: formatTeam(teamAttack1, 1), inline: false },
                { name: `ðŸ—¡ï¸ CÃ”NG 2 (${teamAttack2.length}/${attack2Size}) [${getStats(teamAttack2)}]`, value: formatTeam(teamAttack2, slotstartAtt2), inline: false }
            );

        // Chá»‰ hiá»‡n team Thá»§ náº¿u size > 0
        if (defenseSize2 > 0) {
            embed.addFields({ name: `ðŸ›¡ï¸ THá»¦ (${teamDefense.length}/${defenseSize2}) [${getStats(teamDefense)}]`, value: formatTeam(teamDefense, slotStartDef), inline: false });
        }
        // Chá»‰ hiá»‡n team Rá»«ng náº¿u size > 0
        if (forestSize2 > 0) {
            embed.addFields({ name: `ðŸŒ² Rá»ªNG (${teamForest.length}/${forestSize2}) [${getStats(teamForest)}]`, value: formatTeam(teamForest, slotStartFor), inline: false });
        }

        if (waitingList.length > 0) {
            embed.addFields({ name: `â³ Chá» (${waitingList.length})`, value: waitingList.map((p, i) => `${i + 1}. <@${p.id}>`).join('\n'), inline: false });
        }

        embed.setTimestamp();
        await interaction.channel.send({ embeds: [embed] });

        // Role BC Ä‘Ã£ Ä‘Æ°á»£c cáº¥p ngay khi báº¥m Tham gia, khÃ´ng cáº§n cáº¥p láº¡i á»Ÿ Ä‘Ã¢y

        await interaction.editReply({ content: `ðŸ”’ ÄÃ£ chá»‘t danh sÃ¡ch! (${total} ngÆ°á»i)\nðŸ’¡ Má»i ngÆ°á»i váº«n cÃ³ thá»ƒ Ä‘Äƒng kÃ½ nhÆ°ng sáº½ vÃ o hÃ ng chá».\nðŸ“ DÃ¹ng Team Editor trÃªn web Ä‘á»ƒ má»Ÿ khÃ³a.` });
        return true;
    }

    // ========== NÃšT Äá»”I CHá»– ==========
    if (customId.startsWith('bcql_swap_')) {
        const dayParam3 = day || 'sat';
        const modal = new ModalBuilder()
            .setCustomId(`bcql_swap_modal_${partyKey}_${dayParam3}`)
            .setTitle('ðŸ”„ Äá»•i chá»— 2 ngÆ°á»i');

        const input1 = new TextInputBuilder()
            .setCustomId('position1')
            .setLabel('Vá»‹ trÃ­ thá»© 1 (1-30)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('VÃ­ dá»¥: 5')
            .setRequired(true)
            .setMaxLength(2);

        const input2 = new TextInputBuilder()
            .setCustomId('position2')
            .setLabel('Vá»‹ trÃ­ thá»© 2 (1-30)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('VÃ­ dá»¥: 15')
            .setRequired(true)
            .setMaxLength(2);

        modal.addComponents(
            new ActionRowBuilder().addComponents(input1),
            new ActionRowBuilder().addComponents(input2)
        );

        await interaction.showModal(modal);
        return true;
    }

    // ========== NÃšT THÃŠM NGÆ¯á»œI ==========
    if (customId.startsWith('bcql_add_')) {
        const dayParam4 = day || 'sat';
        const modal = new ModalBuilder()
            .setCustomId(`bcql_add_modal_${partyKey}_${dayParam4}`)
            .setTitle('âž• ThÃªm ngÆ°á»i vÃ o BC');

        const userInput = new TextInputBuilder()
            .setCustomId('user_id')
            .setLabel('User ID, @mention, hoáº·c tÃªn username')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('VD: 395151484179841024, @TaoRain, TaoRain')
            .setRequired(true)
            .setMaxLength(40);

        const teamInput = new TextInputBuilder()
            .setCustomId('team')
            .setLabel('Team (1/2/thu/rung) - Ä‘á»ƒ trá»‘ng = tá»± Ä‘á»™ng')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('1, 2, thu, hoáº·c rung')
            .setRequired(false)
            .setMaxLength(4);

        modal.addComponents(
            new ActionRowBuilder().addComponents(userInput),
            new ActionRowBuilder().addComponents(teamInput)
        );

        await interaction.showModal(modal);
        return true;
    }

    // ========== NÃšT Sá» LÆ¯á»¢NG (unused, kept for reference) ==========
    if (customId.startsWith('bcql_size_')) {
        const attack1Size = db.getTeamSize('attack1') || 10;
        const attack2Size = db.getTeamSize('attack2') || 10;
        const defenseSize = db.getTeamSize('defense') ?? 5;
        const forestSize = db.getTeamSize('forest') ?? 5;
        const total = attack1Size + attack2Size + defenseSize + forestSize;

        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('ðŸ“Š Sá»‘ lÆ°á»£ng Team hiá»‡n táº¡i')
            .addFields(
                { name: 'âš”ï¸ CÃ´ng 1', value: `**${attack1Size}**`, inline: true },
                { name: 'ðŸ—¡ï¸ CÃ´ng 2', value: `**${attack2Size}**`, inline: true },
                { name: 'ðŸ“ Tá»•ng', value: `${total}`, inline: true },
                { name: 'ðŸ›¡ï¸ Thá»§', value: `**${defenseSize}**`, inline: true },
                { name: 'ðŸŒ² Rá»«ng', value: `**${forestSize}**`, inline: true },
                { name: '\u200B', value: '\u200B', inline: true }
            )
            .setFooter({ text: 'ðŸ’¡ VD: ?bcsize cong1 11 cong2 10 thu 5 rung 4' });

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return true;
    }

    // ========== NÃšT RESIZE ==========
    if (customId.startsWith('bcql_resize_')) {
        const dayParam5 = day || 'sat';
        const modal = new ModalBuilder()
            .setCustomId(`bcql_resize_modal_${partyKey}_${dayParam5}`)
            .setTitle('ðŸ“ Thay Ä‘á»•i sá»‘ lÆ°á»£ng Team');

        const attack1Input = new TextInputBuilder()
            .setCustomId('attack1_size')
            .setLabel('CÃ´ng 1 (1-20)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('10')
            .setValue(String(db.getTeamSize('attack1') || 10))
            .setRequired(true);

        const attack2Input = new TextInputBuilder()
            .setCustomId('attack2_size')
            .setLabel('CÃ´ng 2 (1-20)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('10')
            .setValue(String(db.getTeamSize('attack2') || 10))
            .setRequired(true);

        const defenseInput = new TextInputBuilder()
            .setCustomId('defense_size')
            .setLabel('Thá»§ (0-10, nháº­p 0 Ä‘á»ƒ áº©n team Thá»§)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('5')
            .setValue(String(db.getTeamSize('defense') ?? 5))
            .setRequired(true);

        const forestInput = new TextInputBuilder()
            .setCustomId('forest_size')
            .setLabel('Rá»«ng (0-10, nháº­p 0 Ä‘á»ƒ áº©n team Rá»«ng)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('5')
            .setValue(String(db.getTeamSize('forest') ?? 5))
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(attack1Input),
            new ActionRowBuilder().addComponents(attack2Input),
            new ActionRowBuilder().addComponents(defenseInput),
            new ActionRowBuilder().addComponents(forestInput)
        );

        await interaction.showModal(modal);
        return true;
    }

    // ========== NÃšT SET LEADER ==========
    if (customId.startsWith('bcql_setleader_')) {
        const dayParam6 = day || 'sat';
        const modal = new ModalBuilder()
            .setCustomId(`bcql_setleader_modal_${partyKey}_${dayParam6}`)
            .setTitle('ðŸ‘‘ Set Leader cho 4 team');

        const attack1Size = db.getTeamSize('attack1') || 10;
        const attack2Size = db.getTeamSize('attack2') || 10;
        const defenseSize = db.getTeamSize('defense') ?? 5;

        const slotStartAtt2 = 1 + attack1Size;
        const slotStartDef = slotStartAtt2 + attack2Size;
        const slotStartFor = slotStartDef + defenseSize;

        const leadersInput = new TextInputBuilder()
            .setCustomId('leaders_input')
            .setLabel(`Nháº­p 4 sá»‘ slot (CÃ´ng1, CÃ´ng2, Thá»§, Rá»«ng)`)
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

    // Parse day tá»« customId (format: bcql_kick_select_partyKey_day)
    const day = parseDayFromCustomId(customId);

    // Láº¥y session tá»« DB - Æ°u tiÃªn theo day náº¿u cÃ³
    let session;
    if (day) {
        session = db.getActiveBangchienByDay(guildId, day);
    } else {
        const activeSessions = db.getActiveBangchienByGuild(guildId);
        session = activeSessions.length > 0 ? activeSessions[0] : null;
    }

    if (!session) {
        await interaction.reply({ content: 'âŒ BC khÃ´ng tá»“n táº¡i!', flags: MessageFlags.Ephemeral });
        return true;
    }

    const partyKey = session.party_key;

    // ========== KICK SELECT ==========
    if (customId.startsWith('bcql_kick_select_')) {
        const selectedIds = interaction.values;
        let kicked = 0;

        const freshSession = db.getActiveBangchien(partyKey);
        if (!freshSession) {
            await interaction.update({ content: 'Ã¢ÂÅ’ BC khÃƒÂ´ng tÃ¡Â»â€œn tÃ¡ÂºÂ¡i!', components: [] });
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
        await syncSessionToSupabase(guildId, partyKey);
        await interaction.update({ content: `Ã¢Å“â€¦ Ã„ÂÃƒÂ£ Ã„â€˜Ã†Â°a ${kicked} ngÃ†Â°Ã¡Â»Âi xuÃ¡Â»â€˜ng hÃƒÂ ng chÃ¡Â»Â!`, components: [] });
        if (day) {
            await refreshListbcEmbed(interaction, session, day);
        }
        return true;

        for (const userId of selectedIds) {
            const result = db.removeBangchienParticipant(partyKey, userId);
            if (result.success) {
                kicked++;
                // XÃ³a "LuÃ´n tham gia" cho user bá»‹ kick
                const sessionDay = day || 'sat';
                db.removeBcRegular(guildId, userId, sessionDay);
            }
        }

        // XÃ³a role BC cho cÃ¡c user bá»‹ kick
        const bcRole = interaction.guild.roles.cache.find(r => r.name === 'bc');
        if (bcRole) {
            for (const userId of selectedIds) {
                try {
                    const member = await interaction.guild.members.fetch(userId).catch(() => null);
                    if (member && member.roles.cache.has(bcRole.id)) await member.roles.remove(bcRole);
                } catch (e) { }
            }
        }

        // Refresh ?bc overview embed
        await refreshOverviewEmbed(interaction.client, guildId);
        await syncSessionToSupabase(guildId, partyKey);

        await interaction.update({ content: `âœ… ÄÃ£ loáº¡i ${kicked} ngÆ°á»i!`, components: [] });

        // Refresh ?listbc embed náº¿u cÃ³ day
        if (day) {
            await refreshListbcEmbed(interaction, session, day);
        }
        return true;
    }

    // ========== PRIORITY SELECT ==========
    if (customId.startsWith('bcql_priority_select_')) {
        const selectedIds = interaction.values;
        let moved = 0;

        // Láº¥y session má»›i nháº¥t
        const freshSession = db.getActiveBangchien(partyKey);
        if (!freshSession) {
            await interaction.update({ content: 'âŒ BC khÃ´ng tá»“n táº¡i!', components: [] });
            return true;
        }

        const attack1Size = db.getTeamSize('attack1') || 10;
        const attack2Size = db.getTeamSize('attack2') || 10;
        const defenseSize = db.getTeamSize('defense') ?? 5;
        const forestSize = db.getTeamSize('forest') ?? 5;

        for (const userId of selectedIds) {
            // TÃ¬m ngÆ°á»i trong waiting list
            const waitIndex = freshSession.waiting_list.findIndex(p => p.id === userId);
            if (waitIndex === -1) continue;

            const person = freshSession.waiting_list[waitIndex];

            // Thá»­ Ä‘Æ°a vÃ o team theo thá»© tá»±
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
        await syncSessionToSupabase(guildId, partyKey);

        await interaction.update({ content: `âœ… ÄÃ£ Ä‘Æ°a ${moved} ngÆ°á»i lÃªn team!`, components: [] });

        // Refresh ?listbc embed náº¿u cÃ³ day
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

    // Parse day tá»« customId (format: bcql_swap_modal_partyKey_day hoáº·c bcql_add_modal_partyKey_day)
    const day = parseDayFromCustomId(customId);

    // Láº¥y session tá»« DB - Æ°u tiÃªn theo day náº¿u cÃ³
    let session;
    if (day) {
        session = db.getActiveBangchienByDay(guildId, day);
    } else {
        const activeSessions = db.getActiveBangchienByGuild(guildId);
        session = activeSessions.length > 0 ? activeSessions[0] : null;
    }

    if (!session) {
        await interaction.reply({ content: 'âŒ BC khÃ´ng tá»“n táº¡i!', flags: MessageFlags.Ephemeral });
        return true;
    }

    const partyKey = session.party_key;

    // ========== SWAP MODAL ==========
    if (customId.startsWith('bcql_swap_modal_')) {
        const pos1 = parseInt(interaction.fields.getTextInputValue('position1'));
        const pos2 = parseInt(interaction.fields.getTextInputValue('position2'));

        if (isNaN(pos1) || isNaN(pos2) || pos1 < 1 || pos2 < 1) {
            await interaction.reply({ content: 'âŒ Vá»‹ trÃ­ khÃ´ng há»£p lá»‡!', flags: MessageFlags.Ephemeral });
            return true;
        }

        // Dynamic slot numbers - Ä‘á»“ng bá»™ vá»›i bcsize
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

        // Helper: xÃ¡c Ä‘á»‹nh team tá»« slot number
        function getTeamFromSlot(slotNum) {
            if (slotNum >= 1 && slotNum < slotStartAtt2) return { team: 'attack1', maxSize: attack1Size, currentLen: session.team_attack1.length, startSlot: 1 };
            if (slotNum >= slotStartAtt2 && slotNum < slotStartDef) return { team: 'attack2', maxSize: attack2Size, currentLen: session.team_attack2.length, startSlot: slotStartAtt2 };
            if (slotNum >= slotStartDef && slotNum < slotStartFor) return { team: 'defense', maxSize: defenseSize, currentLen: session.team_defense.length, startSlot: slotStartDef };
            if (slotNum >= slotStartFor && slotNum < slotStartWait) return { team: 'forest', maxSize: forestSize, currentLen: session.team_forest.length, startSlot: slotStartFor };
            if (slotNum >= slotStartWait) return { team: 'waiting', maxSize: 999, currentLen: session.waiting_list.length, startSlot: slotStartWait };
            return null;
        }

        const TEAM_EMOJI = { attack1: 'âš”ï¸ CÃ´ng 1', attack2: 'ðŸ—¡ï¸ CÃ´ng 2', defense: 'ðŸ›¡ï¸ Thá»§', forest: 'ðŸŒ² Rá»«ng', waiting: 'â³ Chá»' };

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

        // Case 1: Cáº£ 2 slot cÃ³ ngÆ°á»i â†’ SWAP
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
            await syncSessionToSupabase(guildId, partyKey);

            await interaction.reply({ content: `âœ… ÄÃ£ Ä‘á»•i vá»‹ trÃ­ ${pos1} â†” ${pos2}!`, flags: MessageFlags.Ephemeral });
            if (day) await refreshListbcEmbed(interaction, session, day);
            return true;
        }

        // Case 2: Slot1 cÃ³ ngÆ°á»i, Slot2 trá»‘ng â†’ MOVE
        if (member1 && !member2) {
            const targetTeamInfo = getTeamFromSlot(pos2);
            if (!targetTeamInfo) {
                await interaction.reply({ content: 'âŒ Vá»‹ trÃ­ Ä‘Ã­ch khÃ´ng há»£p lá»‡!', flags: MessageFlags.Ephemeral });
                return true;
            }

            // Kiá»ƒm tra pháº£i di chuyá»ƒn vÃ o slot Ä‘áº§u tiÃªn
            const firstEmptySlot = targetTeamInfo.startSlot + targetTeamInfo.currentLen;
            if (pos2 !== firstEmptySlot) {
                await interaction.reply({ content: `âŒ Pháº£i di chuyá»ƒn vÃ o slot **${firstEmptySlot}** (slot trá»‘ng Ä‘áº§u tiÃªn cá»§a ${TEAM_EMOJI[targetTeamInfo.team]})`, flags: MessageFlags.Ephemeral });
                return true;
            }

            // Kiá»ƒm tra team Ä‘Ã­ch cÃ³ Ä‘áº§y khÃ´ng
            if (targetTeamInfo.currentLen >= targetTeamInfo.maxSize) {
                await interaction.reply({ content: `âŒ ${TEAM_EMOJI[targetTeamInfo.team]} Ä‘Ã£ Ä‘áº§y!`, flags: MessageFlags.Ephemeral });
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
            await syncSessionToSupabase(guildId, partyKey);

            await interaction.reply({ content: `âœ… ÄÃ£ di chuyá»ƒn **${movedPerson.username}** â†’ ${TEAM_EMOJI[targetTeamInfo.team]}!`, flags: MessageFlags.Ephemeral });
            if (day) await refreshListbcEmbed(interaction, session, day);
            return true;
        }

        // Case 3: Slot1 trá»‘ng
        await interaction.reply({ content: 'âŒ Vá»‹ trÃ­ nguá»“n khÃ´ng cÃ³ ngÆ°á»i!', flags: MessageFlags.Ephemeral });
        return true;
    }

    // ========== ADD MODAL ==========
    if (customId.startsWith('bcql_add_modal_')) {
        let userInput = interaction.fields.getTextInputValue('user_id').trim();
        const teamInput = interaction.fields.getTextInputValue('team').trim().toLowerCase();

        // Resolve user tá»« nhiá»u Ä‘á»‹nh dáº¡ng: ID, @mention, username, display name
        let user;
        let userId;

        // 1. Thá»­ parse @mention format: <@123456> hoáº·c <@!123456>
        const mentionMatch = userInput.match(/^<@!?(\d+)>$/);
        if (mentionMatch) {
            userInput = mentionMatch[1];
        }

        // 2. Náº¿u lÃ  sá»‘ thuáº§n (User ID) â†’ fetch trá»±c tiáº¿p
        if (/^\d{17,20}$/.test(userInput)) {
            try {
                user = await interaction.client.users.fetch(userInput);
                userId = userInput;
            } catch (e) {
                await interaction.reply({ content: 'âŒ User ID khÃ´ng tá»“n táº¡i!', flags: MessageFlags.Ephemeral });
                return true;
            }
        } else {
            // 3. TÃ¬m theo username hoáº·c display name trong guild
            const searchTerm = userInput.toLowerCase().replace(/^@/, ''); // Bá» @ Ä‘áº§u náº¿u cÃ³
            await interaction.guild.members.fetch().catch(() => null);
            const foundMember = interaction.guild.members.cache.find(m =>
                m.user.username.toLowerCase() === searchTerm ||
                m.displayName.toLowerCase() === searchTerm ||
                m.user.tag?.toLowerCase() === searchTerm
            );

            if (!foundMember) {
                await interaction.reply({ content: `âŒ KhÃ´ng tÃ¬m tháº¥y user "${userInput}" trong server!\nðŸ’¡ Thá»­ nháº­p User ID hoáº·c username chÃ­nh xÃ¡c.`, flags: MessageFlags.Ephemeral });
                return true;
            }
            user = foundMember.user;
            userId = user.id;
        }

        // Check if already registered
        const allMembers = [...session.team_attack1, ...session.team_attack2, ...session.team_defense, ...session.team_forest, ...session.waiting_list];
        if (allMembers.some(p => p.id === userId)) {
            await interaction.reply({ content: 'âŒ NgÆ°á»i nÃ y Ä‘Ã£ Ä‘Äƒng kÃ½ rá»“i!', flags: MessageFlags.Ephemeral });
            return true;
        }

        // Lookup tÃªn ingame tá»« DB
        const addUserInfo = db.getUserByDiscordId(userId);
        const addGameName = addUserInfo?.game_username || '';

        // Add to specified team or auto
        const result = db.addBangchienParticipant(partyKey, { id: userId, username: user.username, gn: addGameName, name: addGameName || user.username, role: 'DPS' }, guildId);

        if (!result.success) {
            await interaction.reply({ content: `âŒ ${result.error}`, flags: MessageFlags.Ephemeral });
            return true;
        }

        // Refresh ?bc overview embed
        await refreshOverviewEmbed(interaction.client, guildId);
        await syncSessionToSupabase(guildId, partyKey);

        const teamEmojis = { attack1: 'âš”ï¸ CÃ´ng 1', attack2: 'ðŸ—¡ï¸ CÃ´ng 2', defense: 'ðŸ›¡ï¸ Thá»§', forest: 'ðŸŒ² Rá»«ng', waiting: 'â³ Chá»' };
        await interaction.reply({ content: `âœ… ÄÃ£ thÃªm ${user.username} vÃ o ${teamEmojis[result.team] || result.team}!`, flags: MessageFlags.Ephemeral });

        // Refresh ?listbc embed náº¿u cÃ³ day
        if (day) {
            await refreshListbcEmbed(interaction, session, day);
        }
        return true;
    }

    // ========== MODAL RESIZE ==========
    if (customId.startsWith('bcql_resize_modal_')) {
        const attack1Size = parseInt(interaction.fields.getTextInputValue('attack1_size')) || 10;
        const attack2Size = parseInt(interaction.fields.getTextInputValue('attack2_size')) || 10;
        const defenseRaw = parseInt(interaction.fields.getTextInputValue('defense_size'));
        const forestRaw = parseInt(interaction.fields.getTextInputValue('forest_size'));
        const defenseSize = isNaN(defenseRaw) ? 5 : defenseRaw;
        const forestSize = isNaN(forestRaw) ? 5 : forestRaw;

        // Validate
        if (attack1Size < 1 || attack1Size > 20 || attack2Size < 1 || attack2Size > 20 ||
            defenseSize < 0 || defenseSize > 10 || forestSize < 0 || forestSize > 10) {
            await interaction.reply({ content: 'âŒ Sá»‘ lÆ°á»£ng khÃ´ng há»£p lá»‡! CÃ´ng: 1-20, Thá»§/Rá»«ng: 0-10', flags: MessageFlags.Ephemeral });
            return true;
        }

        const total = attack1Size + attack2Size + defenseSize + forestSize;
        if (total !== 30) {
            await interaction.reply({ content: `Tong so thanh vien phai dung bang 30! Hien tai la ${total}.`, flags: MessageFlags.Ephemeral });
            return true;
        }

        // Save
        db.setTeamSize('attack1', attack1Size);
        db.setTeamSize('attack2', attack2Size);
        db.setTeamSize('defense', defenseSize);
        db.setTeamSize('forest', forestSize);

        await interaction.reply({
            content: `âœ… ÄÃ£ cáº­p nháº­t!\nâš”ï¸ CÃ´ng 1: **${attack1Size}**\nðŸ—¡ï¸ CÃ´ng 2: **${attack2Size}**\nðŸ›¡ï¸ Thá»§: **${defenseSize}**\nðŸŒ² Rá»«ng: **${forestSize}**\nðŸ“Š Tá»•ng: **${total}**`,
            flags: MessageFlags.Ephemeral
        });

        // Refresh listbc náº¿u cÃ³
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
            await interaction.reply({ content: 'âŒ Nháº­p 1-4 sá»‘ slot (cÃ¡ch nhau báº±ng dáº¥u cÃ¡ch)!', flags: MessageFlags.Ephemeral });
            return true;
        }

        // Láº¥y team sizes
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

        const TEAM_EMOJI = { attack1: 'âš”ï¸ CÃ´ng 1', attack2: 'ðŸ—¡ï¸ CÃ´ng 2', defense: 'ðŸ›¡ï¸ Thá»§', forest: 'ðŸŒ² Rá»«ng' };
        const results = [];

        for (const slotNum of slotNumbers) {
            const info = getPersonBySlot(slotNum);
            if (info) {
                info.person.isTeamLeader = true;
                results.push(`ðŸ‘‘ ${info.person.username} â†’ ${TEAM_EMOJI[info.team]}`);
            } else {
                results.push(`âŒ Slot ${slotNum} khÃ´ng cÃ³ ngÆ°á»i`);
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
        await syncSessionToSupabase(guildId, partyKey);

        await interaction.reply({ content: `âœ… ÄÃ£ set Leader:\n${results.join('\n')}`, flags: MessageFlags.Ephemeral });

        if (day) await refreshListbcEmbed(interaction, session, day);
        return true;
    }

    return false;
}

module.exports = { handleBcqlButton, handleBcqlSelect, handleBcqlModal };

