/**
 * ?bcmove - Di chuyển 1 người vào team/slot khác (4-TEAM + MULTI-DAY)
 * Cách dùng: ?bcmove @user <team>, ?bcmove t7/cn @user <team>
 *   ?bcmove @user 1 → Di chuyển vào Team Công 1
 *   ?bcmove @user 2 → Di chuyển vào Team Công 2
 *   ?bcmove @user thu → Di chuyển vào Team Thủ (auto-save preset)
 *   ?bcmove @user rung → Di chuyển vào Team Rừng (auto-save preset)
 */

const { EmbedBuilder } = require('discord.js');
const { DAY_CONFIG, DAY_ALIASES, parseDayArg, LEAGUE_TIME, normalizeBcTime } = require('../../utils/bangchienState');
const bangchienRoster = require('../../utils/bangchienRoster');
const supaSync = require('../../utils/supabaseSync');

// Team config - maxSize sẽ được lấy dynamic từ DB
function getTeamConfig(db) {
    return {
        '1': { name: 'TEAM CÔNG 1', emoji: '⚔️', field: 'attack1', maxSize: db.getTeamSize('attack1') || 10 },
        '2': { name: 'TEAM CÔNG 2', emoji: '🗡️', field: 'attack2', maxSize: db.getTeamSize('attack2') || 10 },
        'thu': { name: 'TEAM THỦ', emoji: '🛡️', field: 'defense', maxSize: db.getTeamSize('defense') ?? 5, preset: true },
        'rung': { name: 'TEAM RỪNG', emoji: '🌲', field: 'forest', maxSize: db.getTeamSize('forest') ?? 5, preset: true }
    };
}

module.exports = {
    name: 'bcmove',
    aliases: ['dichuyen', 'doivitri'],
    description: 'Di chuyển người vào team khác. Dùng: ?bcmove t7/cn @user <team>',

    async execute(message, args, client) {
        const db = require('../../database/db');
        const guildId = message.guild.id;

        // Kiểm tra quyền
        const quanLyRole = message.guild.roles.cache.find(r => r.name === 'Quản Lý');
        const kyCuuRole = message.guild.roles.cache.find(r => r.name === 'Kỳ Cựu');
        const isQuanLy = quanLyRole && message.member.roles.cache.has(quanLyRole.id);
        const isKyCuu = kyCuuRole && message.member.roles.cache.has(kyCuuRole.id);

        // Parse day từ args (MULTI-DAY)
        const parsedDayArg = parseDayArg(args);
        const day = parsedDayArg?.day;
        const requestedTime = normalizeBcTime(parsedDayArg?.time || LEAGUE_TIME);
        const isDayOrTimeArg = (value) => DAY_ALIASES[value?.toLowerCase()] || /^\d{1,2}[h:]\d{0,2}$/i.test(value || '');

        // Lấy session
        let session, isActiveSession = false;
        if (day) {
            session = db.getActiveBangchienByDayTime
                ? db.getActiveBangchienByDayTime(guildId, day, requestedTime)
                : db.getActiveBangchienByDay(guildId, day);
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
            return message.reply('❌ Chỉ Leader BC, Quản Lý hoặc Kỳ Cựu mới được di chuyển!');
        }

        // Hướng dẫn
        if (args.length < 2 || !message.mentions.users.first()) {
            return message.reply(
                '❌ Cách dùng:\n' +
                '`?bcmove @user 1` → Team Công 1\n' +
                '`?bcmove @user 2` → Team Công 2\n' +
                '`?bcmove @user thu` → Team Thủ (cố định)\n' +
                '`?bcmove @user rung` → Team Rừng (cố định)'
            );
        }

        const mention = message.mentions.users.first();
        const targetTeamArg = args.find(a => !a.startsWith('<@') && !isDayOrTimeArg(a));

        // Lấy TEAM_CONFIG dynamic
        const TEAM_CONFIG = getTeamConfig(db);

        if (!targetTeamArg || (!isActiveSession && !TEAM_CONFIG[targetTeamArg.toLowerCase()])) {
            return message.reply('❌ Team không hợp lệ! Dùng: 1, 2, thu, hoặc rung');
        }

        const targetTeamKey = targetTeamArg.toLowerCase();
        const targetConfig = TEAM_CONFIG[targetTeamKey];

        // Lấy data
        if (isActiveSession) {
            const normalizeArg = (value) => String(value || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .replace(/[^a-z0-9_-]+/g, ' ')
                .trim();
            const resolveTeam = (roster, rawArg) => {
                const arg = normalizeArg(rawArg);
                if (!arg) return null;
                if (/^\d+$/.test(arg)) return roster.layout[Number(arg) - 1] || null;
                const alias = {
                    thu: 'team_defense',
                    defense: 'team_defense',
                    thur: 'team_defense',
                    rung: 'team_forest',
                    forest: 'team_forest'
                }[arg];
                if (alias) return roster.layout.find((team) => team.id === alias) || null;
                return roster.layout.find((team) =>
                    normalizeArg(team.id) === arg ||
                    normalizeArg(team.name) === arg ||
                    normalizeArg(team.name).includes(arg)
                ) || null;
            };

            const roster = bangchienRoster.normalizeRoster(session);
            const targetTeam = resolveTeam(roster, targetTeamArg);
            if (!targetTeam) {
                return message.reply('ERROR: Team khong hop le. Dung so thu tu team, ten team, `thu`, hoac `rung`.');
            }

            const found = bangchienRoster.findMember(roster, mention.id);
            if (!found) {
                return message.reply(`ERROR: **${mention.username}** khong co trong danh sach BC!`);
            }
            if (found.teamId === targetTeam.id) {
                return message.reply(`WARN: **${mention.username}** da o ${targetTeam.name} roi!`);
            }
            if (found.member?.isLeader && !found.waiting) {
                return message.reply(`WARN: **${mention.username}** la Leader BC, khong the di chuyen sang team khac.`);
            }

            const targetList = roster.teams[targetTeam.id] || [];
            if (targetList.length >= targetTeam.capacity) {
                return message.reply(`ERROR: ${targetTeam.name} da day (${targetList.length}/${targetTeam.capacity})!`);
            }

            const person = found.member;
            const fromTeamName = found.waiting
                ? 'Cho'
                : (roster.layout.find((team) => team.id === found.teamId)?.name || found.teamId);
            if (found.waiting) roster.waitingList.splice(found.index, 1);
            else roster.teams[found.teamId].splice(found.index, 1);
            roster.teams[targetTeam.id] = targetList;
            targetList.push({ ...person, team: targetTeam.id });

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
                const { refreshOverviewEmbed } = require('../../utils/bangchienState');
                await refreshOverviewEmbed(client, guildId).catch(() => {});
            }

            const counts = bangchienRoster.getRosterCounts(roster);
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('DI CHUYEN THANH CONG')
                .setDescription(`**${person.username || mention.username}** da duoc di chuyen tu **${fromTeamName}** sang **${targetTeam.name}**`)
                .addFields(
                    ...roster.layout.map((team) => ({
                        name: `${team.icon || '*'} ${team.name}`,
                        value: `${counts.byTeam[team.id] || 0}/${team.capacity}`,
                        inline: true
                    })),
                    { name: 'Cho', value: `${counts.waiting}`, inline: true }
                )
                .setFooter({ text: 'Dung ?bc de xem' });

            console.log(`[bcmove] ${message.author.username} di chuyen ${mention.username} tu ${found.teamId} -> ${targetTeam.id}`);
            return message.reply({ embeds: [embed] });
        }

        let teams = {
            attack1: isActiveSession ? [...session.team_attack1] : JSON.parse(session.team_attack1 || '[]'),
            attack2: isActiveSession ? [...session.team_attack2] : JSON.parse(session.team_attack2 || '[]'),
            defense: isActiveSession ? [...session.team_defense] : JSON.parse(session.team_defense || '[]'),
            forest: isActiveSession ? [...session.team_forest] : JSON.parse(session.team_forest || '[]'),
            waiting: isActiveSession ? [...session.waiting_list] : JSON.parse(session.waiting_list || '[]')
        };

        // Tìm người trong các team
        let foundIn = null;
        let foundIndex = -1;
        let person = null;

        for (const [teamName, team] of Object.entries(teams)) {
            const idx = team.findIndex(p => p.id === mention.id);
            if (idx !== -1) {
                foundIn = teamName;
                foundIndex = idx;
                person = team[idx];
                break;
            }
        }

        if (!person) {
            return message.reply(`❌ **${mention.username}** không có trong danh sách BC!`);
        }

        // Kiểm tra nếu là Leader và đang cố di chuyển sang team khác
        if (person.isLeader && foundIn !== targetConfig.field) {
            return message.reply(`⚠️ **${mention.username}** là Leader BC! Không thể di chuyển Leader sang team khác. Dùng \`?bcchihuy\` để đổi người chỉ huy trước.`);
        }

        // Kiểm tra team đích đã đầy chưa
        if (teams[targetConfig.field].length >= targetConfig.maxSize) {
            return message.reply(`❌ ${targetConfig.emoji} ${targetConfig.name} đã đầy (${targetConfig.maxSize}/${targetConfig.maxSize})!`);
        }

        // Nếu đã ở team đích rồi
        if (foundIn === targetConfig.field) {
            return message.reply(`⚠️ **${mention.username}** đã ở ${targetConfig.emoji} ${targetConfig.name} rồi!`);
        }

        // Di chuyển
        teams[foundIn].splice(foundIndex, 1); // Xóa khỏi team cũ
        teams[targetConfig.field].push(person); // Thêm vào team mới

        // ====== SMART PRESET LOGIC ======
        let presetSaved = false;
        let presetRemoved = false;

        // 1. Nếu move VÀO Thủ/Rừng → thêm vào preset
        if (targetConfig.preset) {
            const presetType = targetTeamKey;
            const currentPreset = db.getBcPreset(guildId, presetType, sessionDay || 'sat');
            if (!currentPreset.some(p => p.id === person.id)) {
                currentPreset.push({ id: person.id, username: person.username });
                db.setBcPreset(guildId, presetType, currentPreset, sessionDay || 'sat');
                presetSaved = true;
            }
        }

        // 2. Nếu move RA KHỎI Thủ/Rừng (sang Công 1/2) → xóa khỏi preset
        const isMovingToAttack = targetConfig.field === 'attack1' || targetConfig.field === 'attack2';
        if (isMovingToAttack) {
            // Xóa khỏi preset Thủ nếu đang có
            if (foundIn === 'defense') {
                const presetThu = db.getBcPreset(guildId, 'thu', sessionDay || 'sat');
                const newPresetThu = presetThu.filter(p => p.id !== person.id);
                if (newPresetThu.length !== presetThu.length) {
                    db.setBcPreset(guildId, 'thu', newPresetThu, sessionDay || 'sat');
                    presetRemoved = true;
                    console.log(`[bcmove] Đã xóa ${person.username} khỏi preset Thủ`);
                }
            }
            // Xóa khỏi preset Rừng nếu đang có
            if (foundIn === 'forest') {
                const presetRung = db.getBcPreset(guildId, 'rung', sessionDay || 'sat');
                const newPresetRung = presetRung.filter(p => p.id !== person.id);
                if (newPresetRung.length !== presetRung.length) {
                    db.setBcPreset(guildId, 'rung', newPresetRung, sessionDay || 'sat');
                    presetRemoved = true;
                    console.log(`[bcmove] Đã xóa ${person.username} khỏi preset Rừng`);
                }
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
            const newAll = [...teams.attack1, ...teams.attack2, ...teams.defense, ...teams.forest, ...teams.waiting];
            stmt.run(
                JSON.stringify(teams.attack1),
                JSON.stringify(teams.attack2),
                JSON.stringify(teams.defense),
                JSON.stringify(teams.forest),
                JSON.stringify(newAll),
                newAll.length,
                session.id
            );
        }

        const fromTeamName = Object.values(TEAM_CONFIG).find(t => t.field === foundIn)?.name || foundIn;
        let description = `**${person.username}** đã được di chuyển từ **${fromTeamName}** sang **${targetConfig.emoji} ${targetConfig.name}**`;

        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ DI CHUYỂN THÀNH CÔNG!')
            .setDescription(description)
            .addFields(
                { name: '⚔️ Công 1', value: `${teams.attack1.length}/${TEAM_CONFIG['1'].maxSize}`, inline: true },
                { name: '🗡️ Công 2', value: `${teams.attack2.length}/${TEAM_CONFIG['2'].maxSize}`, inline: true },
                { name: '🛡️ Thủ', value: `${teams.defense.length}/${TEAM_CONFIG['thu'].maxSize}`, inline: true },
                { name: '🌲 Rừng', value: `${teams.forest.length}/${TEAM_CONFIG['rung'].maxSize}`, inline: true }
            )
            .setFooter({ text: isActiveSession ? 'Dùng ?bc để xem' : 'Dùng ?listbc để xem' });

        console.log(`[bcmove] ${message.author.username} di chuyển ${person.username} từ ${foundIn} → ${targetConfig.field}${presetSaved ? ' (preset saved)' : ''}`);
        return message.reply({ embeds: [embed] });
    }
};
