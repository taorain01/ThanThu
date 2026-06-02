const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');
const supaSync = require('../../utils/supabaseSync');
const memberRosterSync = require('../../utils/memberRosterSync');
const { cleanupWeekendBcRegulars } = require('../../utils/bcRegularCleanup');

// Channel ID to send leave notifications
const LEAVE_NOTIFICATION_CHANNEL = '1465959064575152263';

module.exports = {
    name: 'guildMemberRemove',
    async execute(member, client) {
        try {
            // Check if user exists in database
            const userData = db.getUserByDiscordId(member.id);

            if (!userData) {
                // User not in database, ignore
                return;
            }

            // Check if already marked as left
            if (userData.left_at) {
                // Already marked as left, ignore
                return;
            }

            const activeSessions = db.getActiveBangchienByGuild(member.guild.id);

            if (member.user?.bot) {
                db.deleteUser(member.id);
                db.clearUserDisplay(member.id);
                await cleanupWeekendBcRegulars(member.guild, member.id, 'guild_bot_remove');
                for (const session of activeSessions) {
                    db.removeBangchienParticipant(session.party_key, member.id);
                }

                try {
                    if (supaSync.isReady()) {
                        await memberRosterSync.deleteUserFromSupabase(member.id);
                        for (const session of activeSessions) {
                            const updatedSession = db.getActiveBangchien(session.party_key);
                            const formatted = updatedSession
                                ? supaSync.formatActiveSession(updatedSession, db, member.guild)
                                : null;
                            if (formatted) await supaSync.syncBCSession(member.guild.id, updatedSession.day || session.day, formatted);
                        }
                    }
                } catch (syncError) {
                    console.error('[guildMemberRemove] Supabase bot delete failed:', syncError.message);
                }

                console.log(`[guildMemberRemove] Deleted bot account from roster data: ${userData.discord_name} (${member.id})`);
                return;
            }

            // Automatically mark as left when they leave Discord
            const result = db.markUserAsLeft(member.id);

            if (result.success) {
                console.log(`✅ Tự động đánh dấu rời guild: ${userData.discord_name} (${member.id})`);

                // Clear display role preference
                db.clearUserDisplay(member.id);

                // === XÓA KHỎI HỆ THỐNG BANG CHIẾN ===
                // 1. Xóa "Luôn tham gia" cho cả 2 ngày
                await cleanupWeekendBcRegulars(member.guild, member.id, 'guild_member_remove');

                // 2. Xóa khỏi tất cả session BC active
                for (const session of activeSessions) {
                    db.removeBangchienParticipant(session.party_key, member.id);
                }
                console.log(`[guildMemberRemove] Đã xóa ${member.id} khỏi BC + regular`);

                // Sync Supabase immediately so the web moves this user to the guest minigame.
                try {
                    if (supaSync.isReady()) {
                        const updatedUser = db.getUserByDiscordId(member.id) || {
                            ...userData,
                            position: 'Khong co'
                        };
                        await memberRosterSync.syncUserRecord(updatedUser, member.guild.id, member.guild);
                        for (const session of activeSessions) {
                            const updatedSession = db.getActiveBangchien(session.party_key);
                            const formatted = updatedSession
                                ? supaSync.formatActiveSession(updatedSession, db, member.guild)
                                : null;
                            if (formatted) await supaSync.syncBCSession(member.guild.id, updatedSession.day || session.day, formatted);
                        }
                    }
                } catch (syncError) {
                    console.error('[guildMemberRemove] Supabase sync failed:', syncError.message);
                }

                // Send notification to designated channel
                try {
                    const channel = await client.channels.fetch(LEAVE_NOTIFICATION_CHANNEL);
                    if (channel) {


                        const embed = new EmbedBuilder()
                            .setColor(0xFF4444)
                            .setTitle('⚠️ Thành viên đã rời Discord')
                            .setDescription(`**${userData.game_username || userData.discord_name}** đã rời khỏi server Discord.\n\n💡 **Có thể người này đã rời guild.** Vui lòng kiểm tra và kick trong game nếu cần.`)
                            .addFields(
                                { name: '👤 Discord', value: userData.discord_name || 'Không có', inline: true },
                                { name: '🎮 Tên Game', value: userData.game_username || 'Không có', inline: true },
                                { name: '🆔 UID', value: userData.game_uid || 'Không có', inline: true }
                            )
                            .setFooter({ text: '🔄 Đã tự động đánh dấu "Rời guild" và reset thông tin' })
                            .setTimestamp();

                        await channel.send({
                            embeds: [embed]
                        });
                    }
                } catch (channelError) {
                    console.error('Không thể gửi thông báo rời guild:', channelError);
                }
            }
        } catch (error) {
            console.error('Lỗi khi xử lý guildMemberRemove:', error);
        }
    }
};
