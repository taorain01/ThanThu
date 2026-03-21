/**
 * ?bcmove - Di chuyển 1 người vào team/slot khác (4-TEAM + MULTI-DAY)
 * Cách dùng: ?bcmove @user <team>, ?bcmove t7/cn @user <team>
 *   ?bcmove @user 1 → Di chuyển vào Team Công 1
 *   ?bcmove @user 2 → Di chuyển vào Team Công 2
 *   ?bcmove @user thu → Di chuyển vào Team Thủ (auto-save preset)
 *   ?bcmove @user rung → Di chuyển vào Team Rừng (auto-save preset)
 */

const { EmbedBuilder } = require('discord.js');
const { DAY_CONFIG, parseDayArg } = require('../../utils/bangchienState');

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
        const targetTeamArg = args.find(a => !a.startsWith('<@'));

        // Lấy TEAM_CONFIG dynamic
        const TEAM_CONFIG = getTeamConfig(db);

        if (!targetTeamArg || !TEAM_CONFIG[targetTeamArg.toLowerCase()]) {
            return message.reply('❌ Team không hợp lệ! Dùng: 1, 2, thu, hoặc rung');
        }

        const targetTeamKey = targetTeamArg.toLowerCase();
        const targetConfig = TEAM_CONFIG[targetTeamKey];

        // Lấy data
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
