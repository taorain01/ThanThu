const { EmbedBuilder } = require('discord.js');
const { DAY_CONFIG, parseDayArg } = require('../../utils/bangchienState');

module.exports = {
    name: 'bcchihuy',
    aliases: ['bcch', 'setchihuy'],
    description: 'Đặt chỉ huy cho BC. Dùng: ?bcchihuy t7/cn @user',

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

        // Kiểm tra quyền
        const sessionLeaderId = isActiveSession ? session.leader_id : session.leader_id;
        if (message.author.id !== sessionLeaderId && !isQuanLy) {
            return message.reply('❌ Chỉ Leader BC hoặc Quản Lý mới được đặt chỉ huy!');
        }

        if (args.length === 0) {
            return message.reply('❌ Vui lòng nhập số thứ tự hoặc mention!\n`?bcchihuy 5` hoặc `?bcchihuy @user`');
        }

        // Lấy team data
        const teamDefense = isActiveSession ? session.team_defense :
            (typeof session.team_defense === 'string' ? JSON.parse(session.team_defense) : session.team_defense || []);
        const teamOffense = isActiveSession ? session.team_offense :
            (typeof session.team_offense === 'string' ? JSON.parse(session.team_offense) : session.team_offense || []);

        let commanderId = null;
        let commanderName = null;

        const mention = message.mentions.users.first();
        if (mention) {
            commanderId = mention.id;
            commanderName = mention.username;
        } else {
            const num = parseInt(args[0]);
            if (isNaN(num) || num < 1) {
                return message.reply('❌ Số không hợp lệ!');
            }

            const defenseLen = teamDefense?.length || 0;
            const offenseLen = teamOffense?.length || 0;

            if (num <= defenseLen) {
                const person = teamDefense[num - 1];
                commanderId = person.id;
                commanderName = person.username;
            } else if (num <= defenseLen + offenseLen) {
                const person = teamOffense[num - defenseLen - 1];
                commanderId = person.id;
                commanderName = person.username;
            } else {
                return message.reply(`❌ Số ${num} không nằm trong danh sách (1-${defenseLen + offenseLen})!`);
            }
        }

        // Cập nhật database
        if (isActiveSession) {
            db.updateActiveBangchien(session.party_key, { commander_id: commanderId });
        } else {
            const stmt = db.db.prepare(`UPDATE bangchien_history SET commander_id = ? WHERE id = ?`);
            stmt.run(commanderId, session.id);
        }

        // Cấp quyền nói trong voice channel BC
        const BC_VOICE_CHANNEL_ID = '1461450602033844368';
        let voicePermResult = '';
        try {
            const voiceChannel = message.guild.channels.cache.get(BC_VOICE_CHANNEL_ID);
            if (voiceChannel) {
                await voiceChannel.permissionOverwrites.edit(commanderId, {
                    Speak: true,
                    Connect: true
                });
                voicePermResult = '\n🎤 Đã cấp quyền nói trong voice BC!';
            }
        } catch (e) {
            console.error('[bcchihuy] Lỗi cấp quyền voice:', e.message);
        }

        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🎖️ ĐÃ ĐẶT CHỈ HUY!')
            .setDescription(`**${commanderName}** (<@${commanderId}>) là Chỉ Huy BC.${voicePermResult}`)
            .setFooter({ text: isActiveSession ? 'Dùng ?bc để xem' : 'Dùng ?listbc để xem' });

        return message.reply({ embeds: [embed] });
    }
};
