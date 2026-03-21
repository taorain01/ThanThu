/**
 * ?bcadd - Thêm người vào danh sách bang chiến (4-TEAM SYSTEM + MULTI-DAY)
 * Cách dùng: 
 *   ?bcadd @user - Thêm vào team (auto theo preset)
 *   ?bcadd t7 @user - Thêm vào phiên T7
 *   ?bcadd cn @user - Thêm vào phiên CN
 *   ?bcadd @user thu - Thêm vào Team Thủ
 *   ?bcadd @user rung - Thêm vào Team Rừng
 */

const { EmbedBuilder } = require('discord.js');
const { DAY_CONFIG, parseDayArg } = require('../../utils/bangchienState');

// Team emoji config
const TEAM_EMOJI = {
    attack1: '⚔️ Công 1',
    attack2: '🗡️ Công 2',
    defense: '🛡️ Thủ',
    forest: '🌲 Rừng',
    waiting: '⏳ Chờ'
};

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
    name: 'bcadd',
    aliases: ['bcaddmem', 'thembc'],
    description: 'Thêm người vào BC. Dùng: ?bcadd t7/cn @user [thu/rung/1/2]',

    async execute(message, args, client) {
        const db = require('../../database/db');
        const guildId = message.guild.id;

        // Kiểm tra quyền (Leader hoặc Quản Lý)
        const quanLyRole = message.guild.roles.cache.find(r => r.name === 'Quản Lý');
        const isQuanLy = quanLyRole && message.member.roles.cache.has(quanLyRole.id);

        // Parse day từ args (MULTI-DAY)
        const day = parseDayArg(args);

        // Lấy session
        let session, isActiveSession = false;
        if (day) {
            // Có chỉ định ngày → lấy session của ngày đó
            session = db.getActiveBangchienByDay(guildId, day);
            if (!session) {
                return message.reply(`❌ Không có phiên BC ${DAY_CONFIG[day].name} đang chạy!`);
            }
            isActiveSession = true;
        } else {
            // Không chỉ định ngày → lấy session đầu tiên hoặc history
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
        if (message.author.id !== session.leader_id && !isQuanLy) {
            return message.reply('❌ Chỉ Leader BC hoặc Quản Lý mới được thêm người!');
        }

        // Lấy mention
        const mention = message.mentions.users.first();
        if (!mention) {
            return message.reply(
                '❌ Cách dùng:\n' +
                '`?bcadd @user` - Thêm vào team (auto theo preset)\n' +
                '`?bcadd @user thu` - Thêm vào Team Thủ\n' +
                '`?bcadd @user rung` - Thêm vào Team Rừng\n' +
                '`?bcadd @user 1` - Thêm vào Team Công 1\n' +
                '`?bcadd @user 2` - Thêm vào Team Công 2'
            );
        }

        // Lấy 4 team data
        let teams = {
            attack1: isActiveSession ? [...session.team_attack1] : JSON.parse(session.team_attack1 || '[]'),
            attack2: isActiveSession ? [...session.team_attack2] : JSON.parse(session.team_attack2 || '[]'),
            defense: isActiveSession ? [...session.team_defense] : JSON.parse(session.team_defense || '[]'),
            forest: isActiveSession ? [...session.team_forest] : JSON.parse(session.team_forest || '[]'),
            waiting: isActiveSession ? [...session.waiting_list] : JSON.parse(session.waiting_list || '[]')
        };

        const att1Len = teams.attack1.length;
        const att2Len = teams.attack2.length;
        const defLen = teams.defense.length;
        const forLen = teams.forest.length;
        const waitLen = teams.waiting.length;
        const totalLen = att1Len + att2Len + defLen + forLen + waitLen;

        // Lấy team sizes từ DB
        const TEAM_SIZES = getTeamSizes(db);

        // Tạo object người mới
        const newPerson = {
            id: mention.id,
            username: mention.username,
            joinedAt: Date.now(),
            isLeader: false
        };

        // Kiểm tra đã có trong danh sách chưa
        for (const [teamName, team] of Object.entries(teams)) {
            const idx = team.findIndex(p => p.id === mention.id);
            if (idx !== -1) {
                return message.reply(`❌ **${mention.username}** đã có trong ${TEAM_EMOJI[teamName]}!`);
            }
        }

        let resultText;
        let addedToTeam;

        // Kiểm tra có chỉ định team không
        const teamArg = args.find(a => !a.startsWith('<@'))?.toLowerCase();

        if (teamArg === 'thu') {
            // Thêm vào Team Thủ
            if (defLen >= TEAM_SIZES.defense) {
                return message.reply(`❌ 🛡️ Team Thủ đã đầy (${defLen}/${TEAM_SIZES.defense})!`);
            }
            teams.defense.push(newPerson);
            resultText = `Đã thêm **${mention.username}** vào 🛡️ Team Thủ`;
            addedToTeam = 'defense';
            // Auto-save preset (không thông báo)
            const currentPreset = db.getBcPreset(guildId, 'thu', sessionDay || 'sat');
            if (!currentPreset.some(p => p.id === mention.id)) {
                currentPreset.push({ id: mention.id, username: mention.username });
                db.setBcPreset(guildId, 'thu', currentPreset, sessionDay || 'sat');
            }
        } else if (teamArg === 'rung') {
            // Thêm vào Team Rừng
            if (forLen >= TEAM_SIZES.forest) {
                return message.reply(`❌ 🌲 Team Rừng đã đầy (${forLen}/${TEAM_SIZES.forest})!`);
            }
            teams.forest.push(newPerson);
            resultText = `Đã thêm **${mention.username}** vào 🌲 Team Rừng`;
            addedToTeam = 'forest';
            // Auto-save preset (không thông báo)
            const currentPreset = db.getBcPreset(guildId, 'rung', sessionDay || 'sat');
            if (!currentPreset.some(p => p.id === mention.id)) {
                currentPreset.push({ id: mention.id, username: mention.username });
                db.setBcPreset(guildId, 'rung', currentPreset, sessionDay || 'sat');
            }
        } else if (teamArg === '1') {
            // Thêm vào Team Công 1
            if (att1Len >= TEAM_SIZES.attack1) {
                return message.reply(`❌ ⚔️ Team Công 1 đã đầy (${att1Len}/${TEAM_SIZES.attack1})!`);
            }
            teams.attack1.push(newPerson);
            resultText = `Đã thêm **${mention.username}** vào ⚔️ Team Công 1`;
            addedToTeam = 'attack1';
        } else if (teamArg === '2') {
            // Thêm vào Team Công 2
            if (att2Len >= TEAM_SIZES.attack2) {
                return message.reply(`❌ 🗡️ Team Công 2 đã đầy (${att2Len}/${TEAM_SIZES.attack2})!`);
            }
            teams.attack2.push(newPerson);
            resultText = `Đã thêm **${mention.username}** vào 🗡️ Team Công 2`;
            addedToTeam = 'attack2';
        } else {
            // Auto-add: kiểm tra preset trước, sau đó vào team công
            const presetThu = db.getBcPreset(guildId, 'thu', sessionDay || 'sat');
            const presetRung = db.getBcPreset(guildId, 'rung', sessionDay || 'sat');

            // Check preset Thủ
            if (presetThu.some(p => p.id === mention.id) && defLen < TEAM_SIZES.defense) {
                teams.defense.push(newPerson);
                resultText = `Đã thêm **${mention.username}** vào 🛡️ Team Thủ (Preset)`;
                addedToTeam = 'defense';
            }
            // Check preset Rừng
            else if (presetRung.some(p => p.id === mention.id) && forLen < TEAM_SIZES.forest) {
                teams.forest.push(newPerson);
                resultText = `Đã thêm **${mention.username}** vào 🌲 Team Rừng (Preset)`;
                addedToTeam = 'forest';
            }
            // Thêm vào team công (cân bằng)
            else {
                const totalInTeams = att1Len + att2Len + defLen + forLen;
                if (totalInTeams >= (TEAM_SIZES.attack1 + TEAM_SIZES.attack2 + TEAM_SIZES.defense + TEAM_SIZES.forest)) {
                    teams.waiting.push(newPerson);
                    resultText = `Đã thêm **${mention.username}** vào ⏳ Chờ (Team đầy)`;
                    addedToTeam = 'waiting';
                } else if (att1Len <= att2Len && att1Len < TEAM_SIZES.attack1) {
                    teams.attack1.push(newPerson);
                    resultText = `Đã thêm **${mention.username}** vào ⚔️ Team Công 1`;
                    addedToTeam = 'attack1';
                } else if (att2Len < TEAM_SIZES.attack2) {
                    teams.attack2.push(newPerson);
                    resultText = `Đã thêm **${mention.username}** vào 🗡️ Team Công 2`;
                    addedToTeam = 'attack2';
                } else if (defLen < TEAM_SIZES.defense) {
                    teams.defense.push(newPerson);
                    resultText = `Đã thêm **${mention.username}** vào 🛡️ Team Thủ`;
                    addedToTeam = 'defense';
                } else if (forLen < TEAM_SIZES.forest) {
                    teams.forest.push(newPerson);
                    resultText = `Đã thêm **${mention.username}** vào 🌲 Team Rừng`;
                    addedToTeam = 'forest';
                } else {
                    teams.waiting.push(newPerson);
                    resultText = `Đã thêm **${mention.username}** vào ⏳ Chờ`;
                    addedToTeam = 'waiting';
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
            const newAllParticipants = [...teams.attack1, ...teams.attack2, ...teams.defense, ...teams.forest, ...teams.waiting];
            const stmt = db.db.prepare(`
                UPDATE bangchien_history 
                SET team_attack1 = ?, team_attack2 = ?, team_defense = ?, team_forest = ?, all_participants = ?, total_registrations = ?
                WHERE id = ?
            `);
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

        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ THÊM NGƯỜI THÀNH CÔNG!')
            .setDescription(resultText)
            .addFields(
                { name: '⚔️ Công 1', value: `${teams.attack1.length}/${TEAM_SIZES.attack1}`, inline: true },
                { name: '🗡️ Công 2', value: `${teams.attack2.length}/${TEAM_SIZES.attack2}`, inline: true },
                { name: '🛡️ Thủ', value: `${teams.defense.length}/${TEAM_SIZES.defense}`, inline: true },
                { name: '🌲 Rừng', value: `${teams.forest.length}/${TEAM_SIZES.forest}`, inline: true },
                { name: '⏳ Chờ', value: `${teams.waiting.length}`, inline: true }
            )
            .setFooter({ text: isActiveSession ? 'Dùng ?bc để xem' : 'Dùng ?listbc để xem' });

        console.log(`[bcadd] ${message.author.username} thêm ${mention.username} vào ${addedToTeam}`);
        return message.reply({ embeds: [embed] });
    }
};
