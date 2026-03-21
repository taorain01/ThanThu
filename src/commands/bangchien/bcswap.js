/**
 * ?bcswap - Đổi người giữa các team trong bang chiến (4-TEAM + MULTI-DAY)
 * Cách dùng: ?bcdoi <số1> <số2>, ?bcdoi t7 <số1> <số2>, ?bcdoi cn <số1> <số2>
 * Số thứ tự: 1-10 Công1, 11-20 Công2, 21-25 Thủ, 26-30 Rừng, 31+ Chờ
 */

const { EmbedBuilder } = require('discord.js');
const { DAY_CONFIG, parseDayArg } = require('../../utils/bangchienState');

// Team config
const TEAM_EMOJI = {
    attack1: '⚔️ Công 1',
    attack2: '🗡️ Công 2',
    defense: '🛡️ Thủ',
    forest: '🌲 Rừng',
    waiting: '⏳ Chờ'
};

module.exports = {
    name: 'bcswap',
    aliases: ['bcdoi', 'doiteam'],
    description: 'Đổi team BC. Dùng: ?bcdoi t7/cn <số1> <số2>',

    async execute(message, args, client) {
        const db = require('../../database/db');
        const guildId = message.guild.id;

        // Kiểm tra quyền (Leader hoặc Quản Lý hoặc Kỳ Cựu)
        const quanLyRole = message.guild.roles.cache.find(r => r.name === 'Quản Lý');
        const kyCuuRole = message.guild.roles.cache.find(r => r.name === 'Kỳ Cựu');
        const isQuanLy = quanLyRole && message.member.roles.cache.has(quanLyRole.id);
        const isKyCuu = kyCuuRole && message.member.roles.cache.has(kyCuuRole.id);

        // Parse day từ args (MULTI-DAY)
        const day = parseDayArg(args);

        // Lấy session
        let session, isActiveSession = false;
        if (day) {
            session = db.getActiveBangchienByDay(guildId, day);
            if (!session) {
                return message.reply(`❌ Không có phiên BC ${DAY_CONFIG[day].name} đang chạy!`);
            }
            isActiveSession = true;
        } else {
            const activeSessions = db.getActiveBangchienByGuild(guildId);
            if (activeSessions.length > 0) {
                session = activeSessions[0];
                isActiveSession = true;
            } else {
                const history = db.getBangchienHistory(guildId, 1);
                if (history.length === 0) {
                    return message.reply('📭 Chưa có bang chiến nào!');
                }
                session = history[0];
            }
        }

        const sessionDay = session.day || null;

        // Kiểm tra quyền
        if (message.author.id !== session.leader_id && !isQuanLy && !isKyCuu) {
            return message.reply('❌ Chỉ Leader BC, Quản Lý hoặc Kỳ Cựu mới được đổi team!');
        }

        // Lấy 4 team data
        let teams = {
            attack1: isActiveSession ? session.team_attack1 : JSON.parse(session.team_attack1 || '[]'),
            attack2: isActiveSession ? session.team_attack2 : JSON.parse(session.team_attack2 || '[]'),
            defense: isActiveSession ? session.team_defense : JSON.parse(session.team_defense || '[]'),
            forest: isActiveSession ? session.team_forest : JSON.parse(session.team_forest || '[]'),
            waiting: isActiveSession ? session.waiting_list : JSON.parse(session.waiting_list || '[]')
        };

        const att1Len = teams.attack1.length;
        const att2Len = teams.attack2.length;
        const defLen = teams.defense.length;
        const forLen = teams.forest.length;
        const waitLen = teams.waiting.length;
        const totalPeople = att1Len + att2Len + defLen + forLen + waitLen;

        // DYNAMIC SLOT NUMBERING - Đồng bộ với ?bcsize settings
        const SIZE_ATTACK1 = db.getTeamSize('attack1') || 10;
        const SIZE_ATTACK2 = db.getTeamSize('attack2') || 10;
        const SIZE_DEFENSE = db.getTeamSize('defense') ?? 5;
        const SIZE_FOREST = db.getTeamSize('forest') ?? 5;

        // Tính slot bắt đầu của từng team
        const SLOT_ATTACK1_START = 1;
        const SLOT_ATTACK2_START = SLOT_ATTACK1_START + SIZE_ATTACK1;
        const SLOT_DEFENSE_START = SLOT_ATTACK2_START + SIZE_ATTACK2;
        const SLOT_FOREST_START = SLOT_DEFENSE_START + SIZE_DEFENSE;
        const SLOT_WAITING_START = SLOT_FOREST_START + SIZE_FOREST;

        // Xử lý ?bcdoi <số1> <số2>
        if (args.length >= 2) {
            const num1 = parseInt(args[0]);
            const num2 = parseInt(args[1]);

            if (isNaN(num1) || isNaN(num2) || num1 < 1 || num2 < 1) {
                return message.reply('❌ Số không hợp lệ! Dùng: `?bcdoi <số1> <số2>`');
            }

            if (num1 === num2) {
                return message.reply('❌ Hai số phải khác nhau!');
            }

            // Helper: lấy người từ số thứ tự SLOT CỐ ĐỊNH (đồng bộ với listbc)
            // Trả về person=null nếu slot trống nhưng vẫn trả về team info
            function getSlotInfo(num) {
                // Công 1: slot 1-10
                if (num >= SLOT_ATTACK1_START && num < SLOT_ATTACK2_START) {
                    const index = num - SLOT_ATTACK1_START;
                    const person = index < att1Len ? teams.attack1[index] : null;
                    return { team: 'attack1', index: index, person: person, slotNum: num, maxSize: SIZE_ATTACK1, currentLen: att1Len };
                }
                // Công 2: slot 11-20
                else if (num >= SLOT_ATTACK2_START && num < SLOT_DEFENSE_START) {
                    const index = num - SLOT_ATTACK2_START;
                    const person = index < att2Len ? teams.attack2[index] : null;
                    return { team: 'attack2', index: index, person: person, slotNum: num, maxSize: SIZE_ATTACK2, currentLen: att2Len };
                }
                // Thủ: slot 21-25
                else if (num >= SLOT_DEFENSE_START && num < SLOT_FOREST_START) {
                    const index = num - SLOT_DEFENSE_START;
                    const person = index < defLen ? teams.defense[index] : null;
                    return { team: 'defense', index: index, person: person, slotNum: num, maxSize: SIZE_DEFENSE, currentLen: defLen };
                }
                // Rừng: slot 26-30
                else if (num >= SLOT_FOREST_START && num < SLOT_WAITING_START) {
                    const index = num - SLOT_FOREST_START;
                    const person = index < forLen ? teams.forest[index] : null;
                    return { team: 'forest', index: index, person: person, slotNum: num, maxSize: SIZE_FOREST, currentLen: forLen };
                }
                // Chờ: slot 31+
                else if (num >= SLOT_WAITING_START) {
                    const index = num - SLOT_WAITING_START;
                    const person = index < waitLen ? teams.waiting[index] : null;
                    return { team: 'waiting', index: index, person: person, slotNum: num, maxSize: 999, currentLen: waitLen };
                }
                return null; // Số không hợp lệ
            }

            const slot1 = getSlotInfo(num1);
            const slot2 = getSlotInfo(num2);

            if (!slot1 || !slot2) {
                return message.reply(`❌ Số slot không hợp lệ!`);
            }

            // Case 1: Cả 2 slot đều có người → SWAP
            if (slot1.person && slot2.person) {
                // Swap bình thường
                teams[slot1.team][slot1.index] = slot2.person;
                teams[slot2.team][slot2.index] = slot1.person;

                // ====== SMART PRESET LOGIC ======
                let presetUpdates = [];

                // Helper: kiểm tra team có phải Công không
                const isAttackTeam = (team) => team === 'attack1' || team === 'attack2';
                const isPresetTeam = (team) => team === 'defense' || team === 'forest';

                // Person1 đổi sang vị trí của slot2
                if (isPresetTeam(slot2.team)) {
                    const presetType = slot2.team === 'defense' ? 'thu' : 'rung';
                    const currentPreset = db.getBcPreset(guildId, presetType, sessionDay || 'sat');
                    if (!currentPreset.some(p => p.id === slot1.person.id)) {
                        currentPreset.push({ id: slot1.person.id, username: slot1.person.username });
                        db.setBcPreset(guildId, presetType, currentPreset, sessionDay || 'sat');
                        presetUpdates.push(`📌 ${slot1.person.username} → ${presetType === 'thu' ? '🛡️ Thủ' : '🌲 Rừng'} (cố định)`);
                    }
                }
                if (isPresetTeam(slot1.team) && isAttackTeam(slot2.team)) {
                    const presetType = slot1.team === 'defense' ? 'thu' : 'rung';
                    const currentPreset = db.getBcPreset(guildId, presetType, sessionDay || 'sat');
                    const newPreset = currentPreset.filter(p => p.id !== slot1.person.id);
                    if (newPreset.length !== currentPreset.length) {
                        db.setBcPreset(guildId, presetType, newPreset, sessionDay || 'sat');
                    }
                }

                // Person2 đổi sang vị trí của slot1
                if (isPresetTeam(slot1.team)) {
                    const presetType = slot1.team === 'defense' ? 'thu' : 'rung';
                    const currentPreset = db.getBcPreset(guildId, presetType, sessionDay || 'sat');
                    if (!currentPreset.some(p => p.id === slot2.person.id)) {
                        currentPreset.push({ id: slot2.person.id, username: slot2.person.username });
                        db.setBcPreset(guildId, presetType, currentPreset, sessionDay || 'sat');
                        presetUpdates.push(`📌 ${slot2.person.username} → ${presetType === 'thu' ? '🛡️ Thủ' : '🌲 Rừng'} (cố định)`);
                    }
                }
                if (isPresetTeam(slot2.team) && isAttackTeam(slot1.team)) {
                    const presetType = slot2.team === 'defense' ? 'thu' : 'rung';
                    const currentPreset = db.getBcPreset(guildId, presetType, sessionDay || 'sat');
                    const newPreset = currentPreset.filter(p => p.id !== slot2.person.id);
                    if (newPreset.length !== currentPreset.length) {
                        db.setBcPreset(guildId, presetType, newPreset, sessionDay || 'sat');
                    }
                }

                // Cập nhật database
                if (isActiveSession) {
                    db.updateActiveBangchien(session.party_key, {
                        team_attack1: teams.attack1,
                        team_attack2: teams.attack2,
                        team_defense: teams.defense,
                        team_forest: teams.forest,
                        waiting_list: teams.waiting
                    });
                } else {
                    const stmt = db.db.prepare(`
                    UPDATE bangchien_history 
                    SET team_attack1 = ?, team_attack2 = ?, team_defense = ?, team_forest = ?, all_participants = ?, total_registrations = ?
                    WHERE id = ?
                `);
                    const newAllParticipants = [...teams.attack1, ...teams.attack2, ...teams.defense, ...teams.forest, ...teams.waiting];
                    stmt.run(
                        JSON.stringify(teams.attack1),
                        JSON.stringify(teams.attack2),
                        JSON.stringify(teams.defense),
                        JSON.stringify(teams.forest),
                        JSON.stringify(newAllParticipants),
                        newAllParticipants.length,
                        session.id
                    );
                }

                // Tạo message kết quả
                const name1 = slot1.person.username || `User ${num1}`;
                const name2 = slot2.person.username || `User ${num2}`;
                const team1Display = TEAM_EMOJI[slot1.team] || slot1.team;
                const team2Display = TEAM_EMOJI[slot2.team] || slot2.team;

                let description = `**${num1}. ${team1Display} ${name1}** ⇄ **${num2}. ${team2Display} ${name2}**`;
                if (presetUpdates.length > 0) description += '\n\n' + presetUpdates.join('\n');

                const resultEmbed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('✅ ĐÃ ĐỔI CHỖ THÀNH CÔNG!')
                    .setDescription(description)
                    .addFields(
                        { name: '⚔️ Công 1', value: `${teams.attack1.length}/${SIZE_ATTACK1}`, inline: true },
                        { name: '🗡️ Công 2', value: `${teams.attack2.length}/${SIZE_ATTACK2}`, inline: true },
                        { name: '🛡️ Thủ', value: `${teams.defense.length}/${SIZE_DEFENSE}`, inline: true },
                        { name: '🌲 Rừng', value: `${teams.forest.length}/${SIZE_FOREST}`, inline: true },
                        { name: '⏳ Chờ', value: `${teams.waiting.length}`, inline: true }
                    )
                    .setFooter({ text: isActiveSession ? 'Dùng ?bc để xem' : 'Dùng ?listbc để xem' });

                console.log(`[bcswap] ${message.author.username} đổi ${num1} ↔ ${num2}${presetUpdates.length > 0 ? ' (auto-preset)' : ''}`);
                return message.reply({ embeds: [resultEmbed] });
            }

            // Case 2: Slot1 có người, Slot2 trống → MOVE vào team đích
            if (slot1.person && !slot2.person) {
                // Kiểm tra slot trống có phải slot đầu tiên trong team không
                const firstEmptySlot = slot2.currentLen;
                if (slot2.index !== firstEmptySlot) {
                    const expectedSlot = slot2.team === 'attack1' ? SLOT_ATTACK1_START + firstEmptySlot :
                        slot2.team === 'attack2' ? SLOT_ATTACK2_START + firstEmptySlot :
                            slot2.team === 'defense' ? SLOT_DEFENSE_START + firstEmptySlot :
                                slot2.team === 'forest' ? SLOT_FOREST_START + firstEmptySlot :
                                    SLOT_WAITING_START + firstEmptySlot;
                    return message.reply(`❌ Phải di chuyển vào slot **${expectedSlot}** (slot trống đầu tiên của ${TEAM_EMOJI[slot2.team]})`);
                }

                // Kiểm tra team đích có đầy không
                if (slot2.currentLen >= slot2.maxSize) {
                    return message.reply(`❌ ${TEAM_EMOJI[slot2.team]} đã đầy (${slot2.currentLen}/${slot2.maxSize})!`);
                }

                // Di chuyển: xóa khỏi team cũ, thêm vào team mới
                const movedPerson = slot1.person;
                teams[slot1.team].splice(slot1.index, 1);
                teams[slot2.team].push(movedPerson);

                // Preset logic
                let presetUpdates = [];
                const isAttackTeam = (team) => team === 'attack1' || team === 'attack2';
                const isPresetTeam = (team) => team === 'defense' || team === 'forest';

                if (isPresetTeam(slot2.team)) {
                    const presetType = slot2.team === 'defense' ? 'thu' : 'rung';
                    const currentPreset = db.getBcPreset(guildId, presetType, sessionDay || 'sat');
                    if (!currentPreset.some(p => p.id === movedPerson.id)) {
                        currentPreset.push({ id: movedPerson.id, username: movedPerson.username });
                        db.setBcPreset(guildId, presetType, currentPreset, sessionDay || 'sat');
                        presetUpdates.push(`📌 ${movedPerson.username} → ${presetType === 'thu' ? '🛡️ Thủ' : '🌲 Rừng'} (cố định)`);
                    }
                }
                if (isPresetTeam(slot1.team) && isAttackTeam(slot2.team)) {
                    const presetType = slot1.team === 'defense' ? 'thu' : 'rung';
                    const currentPreset = db.getBcPreset(guildId, presetType, sessionDay || 'sat');
                    const newPreset = currentPreset.filter(p => p.id !== movedPerson.id);
                    if (newPreset.length !== currentPreset.length) {
                        db.setBcPreset(guildId, presetType, newPreset, sessionDay || 'sat');
                    }
                }

                // Cập nhật database
                if (isActiveSession) {
                    db.updateActiveBangchien(session.party_key, {
                        team_attack1: teams.attack1,
                        team_attack2: teams.attack2,
                        team_defense: teams.defense,
                        team_forest: teams.forest,
                        waiting_list: teams.waiting
                    });
                } else {
                    const stmt = db.db.prepare(`
                    UPDATE bangchien_history 
                    SET team_attack1 = ?, team_attack2 = ?, team_defense = ?, team_forest = ?, all_participants = ?, total_registrations = ?
                    WHERE id = ?
                `);
                    const newAllParticipants = [...teams.attack1, ...teams.attack2, ...teams.defense, ...teams.forest, ...teams.waiting];
                    stmt.run(
                        JSON.stringify(teams.attack1),
                        JSON.stringify(teams.attack2),
                        JSON.stringify(teams.defense),
                        JSON.stringify(teams.forest),
                        JSON.stringify(newAllParticipants),
                        newAllParticipants.length,
                        session.id
                    );
                }

                let description = `**${movedPerson.username}** → ${TEAM_EMOJI[slot2.team]}`;
                if (presetUpdates.length > 0) description += '\n\n' + presetUpdates.join('\n');

                const resultEmbed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('✅ ĐÃ DI CHUYỂN THÀNH CÔNG!')
                    .setDescription(description)
                    .addFields(
                        { name: '⚔️ Công 1', value: `${teams.attack1.length}/${SIZE_ATTACK1}`, inline: true },
                        { name: '🗡️ Công 2', value: `${teams.attack2.length}/${SIZE_ATTACK2}`, inline: true },
                        { name: '🛡️ Thủ', value: `${teams.defense.length}/${SIZE_DEFENSE}`, inline: true },
                        { name: '🌲 Rừng', value: `${teams.forest.length}/${SIZE_FOREST}`, inline: true },
                        { name: '⏳ Chờ', value: `${teams.waiting.length}`, inline: true }
                    )
                    .setFooter({ text: isActiveSession ? 'Dùng ?bc để xem' : 'Dùng ?listbc để xem' });

                console.log(`[bcswap] ${message.author.username} move ${movedPerson.username} → ${slot2.team}${presetUpdates.length > 0 ? ' (auto-preset)' : ''}`);
                return message.reply({ embeds: [resultEmbed] });
            }

            // Case 3: Cả 2 slot đều trống
            return message.reply('❌ Cả hai slot đều trống! Dùng `?listbc` để xem số thứ tự.');
        }

        // Hiển thị hướng dẫn nếu không có args
        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('🔄 ĐỔI TEAM BANG CHIẾN (4-TEAM)')
            .setDescription(
                `**${isActiveSession ? 'Session đang chạy' : 'BC gần nhất'}**\n\n` +
                `⚔️ Công 1: 1-${att1Len} (slot 1-${SIZE_ATTACK1})\n` +
                `🗡️ Công 2: ${SLOT_ATTACK2_START}-${SLOT_ATTACK2_START - 1 + att2Len} (slot ${SLOT_ATTACK2_START}-${SLOT_DEFENSE_START - 1})\n` +
                `🛡️ Thủ: ${SLOT_DEFENSE_START}-${SLOT_DEFENSE_START - 1 + defLen} (slot ${SLOT_DEFENSE_START}-${SLOT_FOREST_START - 1})\n` +
                `🌲 Rừng: ${SLOT_FOREST_START}-${SLOT_FOREST_START - 1 + forLen} (slot ${SLOT_FOREST_START}-${SLOT_WAITING_START - 1})\n` +
                (waitLen > 0 ? `⏳ Chờ: ${SLOT_WAITING_START}-${SLOT_WAITING_START - 1 + waitLen}\n\n` : '\n') +
                `**Cách dùng:**\n\`?bcdoi 1 ${SLOT_DEFENSE_START}\` - Đổi người #1 (Công1) với #${SLOT_DEFENSE_START} (Thủ)`
            )
            .setFooter({ text: `Số slot đồng bộ với ?bcsize • Dùng ?listbc để xem` });

        await message.reply({ embeds: [embed] });
    }
};
