/**
 * ?bcleader - Đặt leader cho 4 team bang chiến (4-TEAM + MULTI-DAY)
 * Cách dùng: ?bcleader t7/cn 1/2/3/4 @user hoặc ?bcleader 1/2/3/4 <số>
 */

const { EmbedBuilder } = require('discord.js');
const { DAY_CONFIG, DAY_ALIASES, parseDayArg, LEAGUE_TIME, normalizeBcTime, formatSessionDateTimeLabel } = require('../../utils/bangchienState');
const bangchienRoster = require('../../utils/bangchienRoster');
const supaSync = require('../../utils/supabaseSync');

// Team config - dynamic names khởi tạo lại mỗi lần execute
function getTeamConfig(db) {
    const names = db.getTeamNames ? db.getTeamNames() : { attack1: 'CÔNG 1', attack2: 'CÔNG 2', defense: 'THỦ', forest: 'RỪNG' };
    return {
        1: { name: names.attack1, emoji: '⚔️', field: 'team_attack1', leaderField: 'team1_leader_id', color: 0xE74C3C },
        2: { name: names.attack2, emoji: '🗡️', field: 'team_attack2', leaderField: 'team2_leader_id', color: 0xC0392B },
        3: { name: names.defense, emoji: '🛡️', field: 'team_defense', leaderField: 'team3_leader_id', color: 0x3498DB },
        4: { name: names.forest, emoji: '🌲', field: 'team_forest', leaderField: 'team4_leader_id', color: 0x27AE60 }
    };
}

// Team sizes - Hàm lấy dynamic từ DB
function getTeamSizes(db) {
    return {
        attack1: db.getTeamSize('attack1') || 10,
        attack2: db.getTeamSize('attack2') || 10,
        defense: db.getTeamSize('defense') ?? 5,
        forest: db.getTeamSize('forest') ?? 5
    };
}

module.exports = {
    name: 'bcleader',
    aliases: ['bcld', 'setleader'],
    description: 'Đặt leader team BC. Dùng: ?bcleader t7/cn <1-4> @user',

    async execute(message, args, client) {
        const db = require('../../database/db');
        const guildId = message.guild.id;

        // Kiểm tra quyền (Leader hoặc Quản Lý)
        const quanLyRole = message.guild.roles.cache.find(r => r.name === 'Quản Lý');
        const isQuanLy = quanLyRole && message.member.roles.cache.has(quanLyRole.id);

        // Parse day từ args (MULTI-DAY)
        const parsedDayArg = parseDayArg(args);
        const day = parsedDayArg?.day;
        const requestedTime = normalizeBcTime(parsedDayArg?.time || LEAGUE_TIME);
        const isDayOrTimeArg = (value) => DAY_ALIASES[value?.toLowerCase()] || /^\d{1,2}[h:]\d{0,2}$/i.test(value || '');

        // Bỏ qua arg t7/cn nếu có để lấy đúng team number
        let filteredArgs = args.filter(a => !isDayOrTimeArg(a));

        // Lấy session
        let session, isActiveSession = false;
        if (day) {
            session = db.getActiveBangchienByDayTime
                ? db.getActiveBangchienByDayTime(guildId, day, requestedTime)
                : db.getActiveBangchienByDay(guildId, day);
            if (!session) {
                return message.reply(`❌ Không có phiên BC ${formatSessionDateTimeLabel({ day, time: requestedTime }) || `${DAY_CONFIG[day].name} ${requestedTime}`} đang chạy!`);
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

        // Kiểm tra quyền
        if (message.author.id !== session.leader_id && !isQuanLy) {
            return message.reply('❌ Chỉ Leader BC hoặc Quản Lý mới được đặt leader team!');
        }

        // Lấy tất cả mentions
        const mentions = [...message.mentions.users.values()];
        const activeRosterForLeader = isActiveSession ? bangchienRoster.normalizeRoster(session) : null;
        const sessionLabel = formatSessionDateTimeLabel(session);
        const expectedLeaderCount = activeRosterForLeader?.layout?.length || 4;

        // ========== TÍNH NĂNG MỚI: SET TẤT CẢ 4 LEADER CÙNG LÚC ==========
        // Bằng 4 mentions
        if (mentions.length === expectedLeaderCount) {
            return await this.setAllLeaders(message, session, isActiveSession, mentions, day, db);
        }

        // Bằng 4 số slot
        const slotNumbers = filteredArgs.map(a => parseInt(a)).filter(n => !isNaN(n) && n >= 1);
        if (slotNumbers.length === expectedLeaderCount && mentions.length === 0) {
            return await this.setLeadersBySlots(message, session, isActiveSession, slotNumbers, day, db);
        }

        // Hướng dẫn
        if (filteredArgs.length < 1 || (mentions.length === 0 && slotNumbers.length !== expectedLeaderCount && !(isActiveSession && slotNumbers.length >= 2))) {
            if (isActiveSession && activeRosterForLeader) {
                let cursor = 1;
                const starts = [];
                const ranges = activeRosterForLeader.layout.map((team) => {
                    const start = cursor;
                    const capacity = Number(team.capacity) || 0;
                    cursor += capacity;
                    starts.push(start);
                    return `${team.icon || ''} ${team.name || team.id}: ${start}-${cursor - 1}`.trim();
                });
                return message.reply(
                    'ERROR: Cach dung ?bcleader\n\n' +
                    `Set ${expectedLeaderCount} leader bang slot:\n` +
                    `\`?bcleader ${day || 't7'} ${starts.join(' ')}\`\n` +
                    `${ranges.join('\n')}\n\n` +
                    `Set 1 leader:\n` +
                    `\`?bcleader ${day || 't7'} 1 @user\``
                );
            }
            const dayHint = day ? `${DAY_CONFIG[day].name} ` : '';
            const sizes = getTeamSizes(db);
            const slotStartAtt2 = 1 + sizes.attack1;
            const slotStartDef = slotStartAtt2 + sizes.attack2;
            const slotStartFor = slotStartDef + sizes.defense;

            return message.reply(
                '❌ **Cách dùng ?bcleader:**\n\n' +
                `**Set 4 leader bằng số slot:**\n` +
                `\`?bcleader ${day || 't7'} 1 ${slotStartAtt2} ${slotStartDef} ${slotStartFor}\`\n` +
                `_(Công1: 1-${sizes.attack1}, Công2: ${slotStartAtt2}-${slotStartDef - 1}, Thủ: ${slotStartDef}-${slotStartFor - 1}, Rừng: ${slotStartFor}+)_\n\n` +
                `**Set 4 leader bằng mention:**\n` +
                `\`?bcleader ${day || 't7'} @công1 @công2 @thủ @rừng\`\n\n` +
                `**Set 1 leader:**\n` +
                `\`?bcleader ${day || 't7'} 1 @user\` - Leader ⚔️ Team Công 1`
            );
        }

        const teamNum = parseInt(filteredArgs[0]);
        if (isActiveSession) {
            const roster = bangchienRoster.normalizeRoster(session);
            const targetTeam = roster.layout[teamNum - 1] || null;
            if (!targetTeam) {
                return message.reply(`ERROR: Team phai la 1-${roster.layout.length}!`);
            }

            const targetList = roster.teams[targetTeam.id] || [];
            let leaderId = null;
            let leaderName = null;
            let personIndex = -1;
            const mention = message.mentions.users.first();

            if (mention) {
                personIndex = targetList.findIndex((player) => String(player.id) === String(mention.id));
                if (personIndex === -1) {
                    return message.reply(`ERROR: Nguoi nay khong co trong ${targetTeam.name}!`);
                }
                leaderId = mention.id;
                leaderName = mention.username;
            } else {
                const slotNum = parseInt(filteredArgs[1]);
                if (isNaN(slotNum) || slotNum < 1) {
                    return message.reply('ERROR: So khong hop le!');
                }
                const activeMembers = bangchienRoster.getActiveRosterMembers(roster);
                const picked = activeMembers[slotNum - 1] || null;
                if (!picked || picked.teamId !== targetTeam.id) {
                    return message.reply(`ERROR: Slot ${slotNum} khong thuoc ${targetTeam.name}!`);
                }
                personIndex = targetList.findIndex((player) => String(player.id) === String(picked.id));
                leaderId = picked.id;
                leaderName = picked.username || picked.name || picked.gn || picked.id;
            }

            let person = { ...targetList[personIndex], isTeamLeader: true, ld: true };
            targetList.splice(personIndex, 1);
            roster.teams[targetTeam.id] = [
                person,
                ...targetList.map((player) => ({ ...player, isTeamLeader: false, ld: false }))
            ];

            db.updateActiveBangchien(session.party_key, {
                team_layout: roster.layout,
                teams: roster.teams,
                waiting_list: roster.waitingList
            });
            const fresh = db.getActiveBangchien(session.party_key);
            if (fresh) {
                const formatted = supaSync.formatActiveSession
                    ? supaSync.formatActiveSession(fresh, db, message.guild)
                    : fresh;
                await supaSync.syncBCSession(guildId, fresh.day || session.day || 'sat', formatted || fresh).catch(() => {});
            }

            const BC_VOICE_CHANNEL_ID = '1461450602033844368';
            let voicePermResult = '';
            try {
                const voiceChannel = message.guild.channels.cache.get(BC_VOICE_CHANNEL_ID);
                if (voiceChannel) {
                    await voiceChannel.permissionOverwrites.edit(leaderId, {
                        Speak: true,
                        Connect: true
                    });
                    voicePermResult = '\nDa cap quyen noi trong voice BC!';
                }
            } catch (e) {
                console.error('[bcleader] Loi cap quyen voice:', e.message);
            }

            const embed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle(`DA DAT LEADER ${targetTeam.icon || ''} ${targetTeam.name}!`)
                .setDescription(`${sessionLabel ? `Phien: ${sessionLabel}\n` : ''}**${leaderName}** (<@${leaderId}>) la Leader cua ${targetTeam.name}.\nDa di chuyen len vi tri dau team.${voicePermResult}`)
                .setFooter({ text: 'Dung ?bc de xem' });

            console.log(`[bcleader] ${message.author.username} set leader team ${teamNum}: ${leaderName}`);
            return message.reply({ embeds: [embed] });
        }
        if (![1, 2, 3, 4].includes(teamNum)) {
            return message.reply('❌ Team phải là 1, 2, 3 hoặc 4!');
        }

        const TEAM_CONFIG = getTeamConfig(db);
        const teamConfig = TEAM_CONFIG[teamNum];

        // Lấy tất cả team data
        let teams = {
            team_attack1: isActiveSession ? session.team_attack1 : JSON.parse(session.team_attack1 || '[]'),
            team_attack2: isActiveSession ? session.team_attack2 : JSON.parse(session.team_attack2 || '[]'),
            team_defense: isActiveSession ? session.team_defense : JSON.parse(session.team_defense || '[]'),
            team_forest: isActiveSession ? session.team_forest : JSON.parse(session.team_forest || '[]')
        };

        // Tìm người
        let leaderId = null;
        let leaderName = null;
        let personIndex = -1;
        let fromTeamField = null;

        const mention = message.mentions.users.first();
        if (mention) {
            // Tìm trong tất cả team
            for (const [field, team] of Object.entries(teams)) {
                const idx = team.findIndex(p => p.id === mention.id);
                if (idx !== -1) {
                    leaderId = mention.id;
                    leaderName = mention.username;
                    personIndex = idx;
                    fromTeamField = field;
                    break;
                }
            }
            if (!leaderId) {
                return message.reply('❌ Người này không có trong danh sách!');
            }
        } else {
            const num = parseInt(filteredArgs[1]);
            if (isNaN(num) || num < 1) {
                return message.reply('❌ Số không hợp lệ!');
            }

            // Tính vị trí: 1-10 attack1, 11-20 attack2, 21-25 defense, 26-30 forest
            const att1Len = teams.team_attack1.length;
            const att2Len = teams.team_attack2.length;
            const defLen = teams.team_defense.length;
            const forLen = teams.team_forest.length;

            if (num <= att1Len) {
                const person = teams.team_attack1[num - 1];
                leaderId = person.id;
                leaderName = person.username;
                personIndex = num - 1;
                fromTeamField = 'team_attack1';
            } else if (num <= att1Len + att2Len) {
                const person = teams.team_attack2[num - att1Len - 1];
                leaderId = person.id;
                leaderName = person.username;
                personIndex = num - att1Len - 1;
                fromTeamField = 'team_attack2';
            } else if (num <= att1Len + att2Len + defLen) {
                const person = teams.team_defense[num - att1Len - att2Len - 1];
                leaderId = person.id;
                leaderName = person.username;
                personIndex = num - att1Len - att2Len - 1;
                fromTeamField = 'team_defense';
            } else if (num <= att1Len + att2Len + defLen + forLen) {
                const person = teams.team_forest[num - att1Len - att2Len - defLen - 1];
                leaderId = person.id;
                leaderName = person.username;
                personIndex = num - att1Len - att2Len - defLen - 1;
                fromTeamField = 'team_forest';
            } else {
                return message.reply(`❌ Số ${num} không nằm trong danh sách!`);
            }
        }

        // Kiểm tra người có thuộc đúng team không
        if (fromTeamField !== teamConfig.field) {
            const fromTeamName = Object.values(getTeamConfig(db)).find(t => t.field === fromTeamField)?.name || fromTeamField;
            return message.reply(`❌ Người này đang ở ${fromTeamName}, không thể set làm Leader ${teamConfig.name}!\nDùng \`?bcdoi\` để đổi chỗ trước.`);
        }

        // Đưa person lên đầu team và đánh dấu isTeamLeader
        let targetTeam = [...teams[teamConfig.field]];
        let person = { ...targetTeam[personIndex] };
        targetTeam.splice(personIndex, 1);
        person.isTeamLeader = true;
        targetTeam = targetTeam.map(p => ({ ...p, isTeamLeader: false }));
        targetTeam.unshift(person);
        teams[teamConfig.field] = targetTeam;

        // Cập nhật database
        if (isActiveSession) {
            const updates = {
                [teamConfig.field]: targetTeam,
                [teamConfig.leaderField]: leaderId
            };
            db.updateActiveBangchien(session.party_key, updates);
        } else {
            const stmt = db.db.prepare(`
                UPDATE bangchien_history 
                SET ${teamConfig.field} = ?, ${teamConfig.leaderField} = ?
                WHERE id = ?
            `);
            stmt.run(JSON.stringify(targetTeam), leaderId, session.id);
        }

        // Cấp quyền nói trong voice channel BC
        const BC_VOICE_CHANNEL_ID = '1461450602033844368';
        let voicePermResult = '';
        try {
            const voiceChannel = message.guild.channels.cache.get(BC_VOICE_CHANNEL_ID);
            if (voiceChannel) {
                await voiceChannel.permissionOverwrites.edit(leaderId, {
                    Speak: true,
                    Connect: true
                });
                voicePermResult = '\n🎤 Đã cấp quyền nói trong voice BC!';
            }
        } catch (e) {
            console.error('[bcleader] Lỗi cấp quyền voice:', e.message);
        }

        const embed = new EmbedBuilder()
            .setColor(teamConfig.color)
            .setTitle(`🎯 ĐÃ ĐẶT LEADER ${teamConfig.emoji} ${teamConfig.name}!`)
            .setDescription(`${sessionLabel ? `Phiên: ${sessionLabel}\n` : ''}**${leaderName}** (<@${leaderId}>) là Leader của ${teamConfig.emoji} ${teamConfig.name}.\nĐã di chuyển lên vị trí đầu team.${voicePermResult}`)
            .setFooter({ text: isActiveSession ? 'Dùng ?bc để xem' : 'Dùng ?bcql để quản lý' });

        console.log(`[bcleader] ${message.author.username} set leader team ${teamNum}: ${leaderName}`);
        return message.reply({ embeds: [embed] });
    },

    // ========== HÀM SET TẤT CẢ 4 LEADER CÙNG LÚC ==========
    async setAllLeaders(message, session, isActiveSession, mentions, day, db) {
        const BC_VOICE_CHANNEL_ID = '1461450602033844368';
        const results = [];
        const errors = [];

        if (isActiveSession) {
            const roster = bangchienRoster.normalizeRoster(session);
            if (mentions.length !== roster.layout.length) {
                return message.reply(`ERROR: Can nhap dung ${roster.layout.length} leader cho ${roster.layout.length} team.`);
            }

            for (let i = 0; i < roster.layout.length; i++) {
                const team = roster.layout[i];
                const user = mentions[i];
                const list = roster.teams[team.id] || [];
                const idx = list.findIndex((player) => String(player.id) === String(user.id));
                const label = `${team.icon || ''} ${team.name || team.id}`.trim();
                if (idx === -1) {
                    errors.push(`${user.username}: khong co trong ${label}`);
                    continue;
                }

                const person = { ...list[idx], isTeamLeader: true, ld: true };
                list.splice(idx, 1);
                roster.teams[team.id] = [
                    person,
                    ...list.map((player) => ({ ...player, isTeamLeader: false, ld: false }))
                ];
                results.push(`${user.username} -> ${label}`);

                try {
                    const voiceChannel = message.guild.channels.cache.get(BC_VOICE_CHANNEL_ID);
                    if (voiceChannel) {
                        await voiceChannel.permissionOverwrites.edit(user.id, {
                            Speak: true,
                            Connect: true
                        });
                    }
                } catch (e) {
                    console.error(`[bcleader] Loi cap quyen voice cho ${user.username}:`, e.message);
                }
            }

            const updates = {
                team_layout: roster.layout,
                teams: roster.teams,
                waiting_list: roster.waitingList
            };
            roster.layout.slice(0, 4).forEach((team, index) => {
                const leader = (roster.teams[team.id] || []).find((player) => player.isTeamLeader || player.ld);
                updates[`team${index + 1}_leader_id`] = leader?.id || null;
            });
            db.updateActiveBangchien(session.party_key, updates);
            const fresh = db.getActiveBangchien(session.party_key);
            if (fresh) {
                const formatted = supaSync.formatActiveSession
                    ? supaSync.formatActiveSession(fresh, db, message.guild)
                    : fresh;
                await supaSync.syncBCSession(message.guild.id, fresh.day || session.day || 'sat', formatted || fresh).catch(() => {});
            }

            const dayName = sessionLabel || (day ? DAY_CONFIG[day].name : '');
            const embed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle(`DA DAT LEADER ${dayName}`)
                .setDescription(
                    (results.length > 0 ? `Thanh cong:\n${results.join('\n')}` : '') +
                    (errors.length > 0 ? `\n\nLoi:\n${errors.join('\n')}` : '')
                )
                .setFooter({ text: 'Da cap quyen noi trong voice BC neu co kenh.' });

            console.log(`[bcleader] ${message.author.username} set all dynamic leaders: ${mentions.map(u => u.username).join(', ')}`);
            return message.reply({ embeds: [embed] });
        }

        // Lấy tất cả team data
        let teams = {
            team_attack1: isActiveSession ? session.team_attack1 : JSON.parse(session.team_attack1 || '[]'),
            team_attack2: isActiveSession ? session.team_attack2 : JSON.parse(session.team_attack2 || '[]'),
            team_defense: isActiveSession ? session.team_defense : JSON.parse(session.team_defense || '[]'),
            team_forest: isActiveSession ? session.team_forest : JSON.parse(session.team_forest || '[]')
        };

        const TC = getTeamConfig(db);
        const teamOrder = [
            { num: 1, config: TC[1], field: 'team_attack1' },
            { num: 2, config: TC[2], field: 'team_attack2' },
            { num: 3, config: TC[3], field: 'team_defense' },
            { num: 4, config: TC[4], field: 'team_forest' }
        ];

        for (let i = 0; i < 4; i++) {
            const user = mentions[i];
            const { num, config, field } = teamOrder[i];
            const team = teams[field];

            // Tìm user trong team
            const idx = team.findIndex(p => p.id === user.id);
            if (idx === -1) {
                errors.push(`${config.emoji} ${user.username}: Không có trong ${config.name}`);
                continue;
            }

            // Đưa lên đầu team
            let person = { ...team[idx] };
            team.splice(idx, 1);
            person.isTeamLeader = true;
            const updatedTeam = team.map(p => ({ ...p, isTeamLeader: false }));
            updatedTeam.unshift(person);
            teams[field] = updatedTeam;

            results.push(`${config.emoji} **${user.username}** → ${config.name}`);

            // Cấp quyền voice
            try {
                const voiceChannel = message.guild.channels.cache.get(BC_VOICE_CHANNEL_ID);
                if (voiceChannel) {
                    await voiceChannel.permissionOverwrites.edit(user.id, {
                        Speak: true,
                        Connect: true
                    });
                }
            } catch (e) {
                console.error(`[bcleader] Lỗi cấp quyền voice cho ${user.username}:`, e.message);
            }
        }

        // Cập nhật database
        if (isActiveSession) {
            const updates = {
                team_attack1: teams.team_attack1,
                team_attack2: teams.team_attack2,
                team_defense: teams.team_defense,
                team_forest: teams.team_forest,
                team1_leader_id: mentions[0]?.id || null,
                team2_leader_id: mentions[1]?.id || null,
                team3_leader_id: mentions[2]?.id || null,
                team4_leader_id: mentions[3]?.id || null
            };
            db.updateActiveBangchien(session.party_key, updates);
        } else {
            const stmt = db.db.prepare(`
                UPDATE bangchien_history 
                SET team_attack1 = ?, team_attack2 = ?, team_defense = ?, team_forest = ?,
                    team1_leader_id = ?, team2_leader_id = ?, team3_leader_id = ?, team4_leader_id = ?
                WHERE id = ?
            `);
            stmt.run(
                JSON.stringify(teams.team_attack1),
                JSON.stringify(teams.team_attack2),
                JSON.stringify(teams.team_defense),
                JSON.stringify(teams.team_forest),
                mentions[0]?.id || null,
                mentions[1]?.id || null,
                mentions[2]?.id || null,
                mentions[3]?.id || null,
                session.id
            );
        }

        const dayName = sessionLabel || (day ? DAY_CONFIG[day].name : '');
        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle(`🎯 ĐÃ ĐẶT TẤT CẢ LEADER ${dayName}!`)
            .setDescription(
                (results.length > 0 ? `✅ **Thành công:**\n${results.join('\n')}` : '') +
                (errors.length > 0 ? `\n\n❌ **Lỗi:**\n${errors.join('\n')}` : '')
            )
            .setFooter({ text: '🎤 Đã cấp quyền nói trong voice BC' });

        console.log(`[bcleader] ${message.author.username} set all 4 leaders: ${mentions.map(u => u.username).join(', ')}`);
        return message.reply({ embeds: [embed] });
    },

    // ========== HÀM SET 4 LEADER BẰNG SỐ SLOT ==========
    async setLeadersBySlots(message, session, isActiveSession, slotNumbers, day, db) {
        const BC_VOICE_CHANNEL_ID = '1461450602033844368';
        const results = [];
        const errors = [];

        if (isActiveSession) {
            const roster = bangchienRoster.normalizeRoster(session);
            if (slotNumbers.length !== roster.layout.length) {
                return message.reply(`ERROR: Can nhap dung ${roster.layout.length} slot leader.`);
            }

            const seenTeams = new Set();
            const selected = [];
            const getSlotInfo = (slotNum) => {
                let cursor = 1;
                for (const team of roster.layout) {
                    const capacity = Number(team.capacity) || 0;
                    if (slotNum >= cursor && slotNum < cursor + capacity) {
                        const index = slotNum - cursor;
                        const list = roster.teams[team.id] || [];
                        return { team, teamId: team.id, index, member: list[index] || null };
                    }
                    cursor += capacity;
                }
                return null;
            };

            for (const slotNum of slotNumbers) {
                const info = getSlotInfo(slotNum);
                if (!info || !info.member) {
                    errors.push(`Slot ${slotNum}: khong co nguoi active`);
                    continue;
                }
                if (seenTeams.has(info.teamId)) {
                    errors.push(`Slot ${slotNum}: trung team`);
                    continue;
                }
                seenTeams.add(info.teamId);
                selected.push({ slotNum, info });
            }

            if (errors.length) {
                return message.reply(`ERROR:\n${errors.join('\n')}`);
            }

            for (const team of roster.layout) {
                (roster.teams[team.id] || []).forEach((player) => {
                    player.isTeamLeader = false;
                    player.ld = false;
                });
            }

            for (const item of selected) {
                const team = item.info.team;
                const list = roster.teams[team.id] || [];
                const person = { ...list[item.info.index], isTeamLeader: true, ld: true };
                list.splice(item.info.index, 1);
                list.unshift(person);
                roster.teams[team.id] = list;
                const label = `${team.icon || ''} ${team.name || team.id}`.trim();
                results.push(`${person.username || person.name || person.gn || person.id} -> ${label} (slot ${item.slotNum})`);

                try {
                    const voiceChannel = message.guild.channels.cache.get(BC_VOICE_CHANNEL_ID);
                    if (voiceChannel) {
                        await voiceChannel.permissionOverwrites.edit(person.id, {
                            Speak: true,
                            Connect: true
                        });
                    }
                } catch (e) {
                    console.error(`[bcleader] Loi cap quyen voice cho ${person.username || person.id}:`, e.message);
                }
            }

            const updates = {
                team_layout: roster.layout,
                teams: roster.teams,
                waiting_list: roster.waitingList
            };
            roster.layout.slice(0, 4).forEach((team, index) => {
                const leader = (roster.teams[team.id] || []).find((player) => player.isTeamLeader || player.ld);
                updates[`team${index + 1}_leader_id`] = leader?.id || null;
            });
            db.updateActiveBangchien(session.party_key, updates);
            const fresh = db.getActiveBangchien(session.party_key);
            if (fresh) {
                const formatted = supaSync.formatActiveSession
                    ? supaSync.formatActiveSession(fresh, db, message.guild)
                    : fresh;
                await supaSync.syncBCSession(message.guild.id, fresh.day || session.day || 'sat', formatted || fresh).catch(() => {});
            }

            const dayName = sessionLabel || (day ? DAY_CONFIG[day].name : '');
            const embed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle(`DA DAT LEADER THEO SLOT ${dayName}`)
                .setDescription(`Thanh cong:\n${results.join('\n')}`)
                .setFooter({ text: 'Da cap quyen noi trong voice BC neu co kenh.' });

            console.log(`[bcleader] ${message.author.username} set dynamic leaders by slots: ${slotNumbers.join(', ')}`);
            return message.reply({ embeds: [embed] });
        }

        // Lấy team sizes
        const sizes = getTeamSizes(db);
        const slotStartAtt2 = 1 + sizes.attack1;
        const slotStartDef = slotStartAtt2 + sizes.attack2;
        const slotStartFor = slotStartDef + sizes.defense;
        const slotStartWait = slotStartFor + sizes.forest;

        // Lấy tất cả team data
        let teams = {
            team_attack1: isActiveSession ? [...session.team_attack1] : JSON.parse(session.team_attack1 || '[]'),
            team_attack2: isActiveSession ? [...session.team_attack2] : JSON.parse(session.team_attack2 || '[]'),
            team_defense: isActiveSession ? [...session.team_defense] : JSON.parse(session.team_defense || '[]'),
            team_forest: isActiveSession ? [...session.team_forest] : JSON.parse(session.team_forest || '[]')
        };

        // Reset tất cả leader
        for (const team of Object.values(teams)) {
            team.forEach(p => { p.isTeamLeader = false; });
        }

        // Helper: lấy người theo slot number
        function getPersonBySlot(slotNum) {
            if (slotNum >= 1 && slotNum < slotStartAtt2) {
                const idx = slotNum - 1;
                return idx < teams.team_attack1.length ? { team: 'team_attack1', idx, person: teams.team_attack1[idx] } : null;
            } else if (slotNum >= slotStartAtt2 && slotNum < slotStartDef) {
                const idx = slotNum - slotStartAtt2;
                return idx < teams.team_attack2.length ? { team: 'team_attack2', idx, person: teams.team_attack2[idx] } : null;
            } else if (slotNum >= slotStartDef && slotNum < slotStartFor) {
                const idx = slotNum - slotStartDef;
                return idx < teams.team_defense.length ? { team: 'team_defense', idx, person: teams.team_defense[idx] } : null;
            } else if (slotNum >= slotStartFor && slotNum < slotStartWait) {
                const idx = slotNum - slotStartFor;
                return idx < teams.team_forest.length ? { team: 'team_forest', idx, person: teams.team_forest[idx] } : null;
            }
            return null;
        }

        const _tn = db.getTeamNames ? db.getTeamNames() : { attack1: 'Công 1', attack2: 'Công 2', defense: 'Thủ', forest: 'Rừng' };
        const TEAM_EMOJI = { team_attack1: `⚔️ ${_tn.attack1}`, team_attack2: `🗡️ ${_tn.attack2}`, team_defense: `🛡️ ${_tn.defense}`, team_forest: `🌲 ${_tn.forest}` };
        const expectedTeams = ['team_attack1', 'team_attack2', 'team_defense', 'team_forest'];
        const leaderIds = [null, null, null, null];

        for (let i = 0; i < 4; i++) {
            const slotNum = slotNumbers[i];
            const info = getPersonBySlot(slotNum);

            if (!info) {
                errors.push(`❌ Slot ${slotNum}: Không có người`);
                continue;
            }

            if (info.team !== expectedTeams[i]) {
                errors.push(`❌ Slot ${slotNum} (${info.person.username}): Không thuộc ${TEAM_EMOJI[expectedTeams[i]]}`);
                continue;
            }

            // Đánh dấu leader và đưa lên đầu team
            const team = teams[info.team];
            let person = { ...team[info.idx] };
            team.splice(info.idx, 1);
            person.isTeamLeader = true;
            team.unshift(person);
            teams[info.team] = team;
            leaderIds[i] = person.id;

            results.push(`👑 ${person.username} → ${TEAM_EMOJI[info.team]}`);

            // Cấp quyền voice
            try {
                const voiceChannel = message.guild.channels.cache.get(BC_VOICE_CHANNEL_ID);
                if (voiceChannel) {
                    await voiceChannel.permissionOverwrites.edit(person.id, {
                        Speak: true,
                        Connect: true
                    });
                }
            } catch (e) {
                console.error(`[bcleader] Lỗi cấp quyền voice cho ${person.username}:`, e.message);
            }
        }

        // Cập nhật database
        if (isActiveSession) {
            const updates = {
                team_attack1: teams.team_attack1,
                team_attack2: teams.team_attack2,
                team_defense: teams.team_defense,
                team_forest: teams.team_forest,
                team1_leader_id: leaderIds[0],
                team2_leader_id: leaderIds[1],
                team3_leader_id: leaderIds[2],
                team4_leader_id: leaderIds[3]
            };
            db.updateActiveBangchien(session.party_key, updates);
        } else {
            const stmt = db.db.prepare(`
                UPDATE bangchien_history 
                SET team_attack1 = ?, team_attack2 = ?, team_defense = ?, team_forest = ?,
                    team1_leader_id = ?, team2_leader_id = ?, team3_leader_id = ?, team4_leader_id = ?
                WHERE id = ?
            `);
            stmt.run(
                JSON.stringify(teams.team_attack1),
                JSON.stringify(teams.team_attack2),
                JSON.stringify(teams.team_defense),
                JSON.stringify(teams.team_forest),
                leaderIds[0], leaderIds[1], leaderIds[2], leaderIds[3],
                session.id
            );
        }

        const dayName = sessionLabel || (day ? DAY_CONFIG[day].name : '');
        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle(`🎯 ĐÃ ĐẶT TẤT CẢ LEADER ${dayName}!`)
            .setDescription(
                (results.length > 0 ? `✅ **Thành công:**\n${results.join('\n')}` : '') +
                (errors.length > 0 ? `\n\n❌ **Lỗi:**\n${errors.join('\n')}` : '')
            )
            .setFooter({ text: '🎤 Đã cấp quyền nói trong voice BC' });

        console.log(`[bcleader] ${message.author.username} set 4 leaders by slots: ${slotNumbers.join(', ')}`);
        return message.reply({ embeds: [embed] });
    }
};
