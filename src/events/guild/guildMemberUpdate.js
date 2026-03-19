/**
 * guildMemberUpdate Event
 * Triggered when a member's roles, nickname, or other properties change
 * 
 * Display Role System:
 *   - Auto remove display role khi user mất role gốc
 * 
 * Booster System:
 *   - DM cảm ơn khi ai boost server (addedRoles)
 *   - Xoá Boost Room khi mất role booster (removedRoles)
 */

const db = require('../../database/db');
const { EmbedBuilder } = require('discord.js');
const { getRoleMappings, DISPLAY_ROLE_NAME } = require('../../commands/quanly/subrole/addrole');

// ID role Server Booster (Discord cấp tự động)
const BOOSTER_ROLE_ID = '740457614470545408';

// Custom emoji IDs cho embed cảm ơn
const EMOJI = {
    tenlua: '<a:oz_rocket:1251414424422580314>',
    booster: '<a:oz_boost:1251399419467792495>',
    kimcuong: '<a:oz_diamond:1251414256990031965>',
    tiendo: '<a:oz_money:1251399400803008542>'
};

module.exports = {
    name: 'guildMemberUpdate',
    async execute(oldMember, newMember) {
        try {
            // Kiểm tra role changes
            const oldRoles = oldMember.roles.cache;
            const newRoles = newMember.roles.cache;

            // Tìm roles được thêm + roles bị xóa
            const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
            const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));

            // Không có thay đổi role → bỏ qua
            if (addedRoles.size === 0 && removedRoles.size === 0) return;

            const guildId = newMember.guild.id;

            // ═══════════════════════════════════════════════════════════════
            // BOOSTER ROLE GAINED — DM cảm ơn khi ai boost server
            // ═══════════════════════════════════════════════════════════════
            if (addedRoles.has(BOOSTER_ROLE_ID)) {
                console.log(`[guildMemberUpdate] ${newMember.user.tag} vừa Boost server!`);

                try {
                    const thankEmbed = new EmbedBuilder()
                        .setColor('#FF73FA')
                        .setAuthor({ name: 'Game Group Family', iconURL: newMember.guild.iconURL({ size: 64 }) })
                        .setTitle(`${EMOJI.booster} Cảm Ơn Bạn Đã Boost!`)
                        .setThumbnail(newMember.user.displayAvatarURL({ size: 128 }))
                        .setDescription(
                            `${EMOJI.kimcuong} **Cảm ơn ${newMember.displayName} đã Boost server!**\n\n` +
                            `Từ **Rain** và toàn bộ anh chị em **Game Group** — sự ủng hộ của bạn là động lực lớn giúp cộng đồng ngày càng phát triển! 🎉\n\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                            `${EMOJI.tiendo} **Đặc quyền Booster — VIP Voice Room:**\n\n` +
                            `> 🎙️ Tạo voice channel riêng, tuỳ chỉnh tên & chế độ\n` +
                            `> 👻 3 chế độ: **Ẩn** / **Công khai** / **Khoá**\n` +
                            `> 🎛️ Bảng điều khiển VIP khi vào room\n` +
                            `> 🌏 Tự chọn server khu vực (SG, HK, JP...)\n\n` +
                            `${EMOJI.tenlua} **Bắt đầu nhanh:**\n` +
                            `Tới kênh **#booster-panel** → Nhấn \`Tạo VIP Room\` → Vào room để mở bảng điều khiển!\n\n` +
                            `💖 *Chúc bạn có trải nghiệm tuyệt vời tại Game Group!*`
                        )
                        .setFooter({ text: '⭐ Server Booster • Game Group Community' })
                        .setTimestamp();

                    await newMember.send({ embeds: [thankEmbed] });
                    console.log(`[guildMemberUpdate] Đã gửi DM cảm ơn đến ${newMember.user.tag}`);
                } catch (e) {
                    // User tắt DM → bỏ qua
                    console.log(`[guildMemberUpdate] Không gửi được DM cho ${newMember.user.tag} (DM tắt)`);
                }
            }

            // ═══════════════════════════════════════════════════════════════
            // DISPLAY ROLE SYSTEM — Auto remove display role khi mất role gốc
            // ═══════════════════════════════════════════════════════════════
            if (removedRoles.size > 0) {
                const mappings = getRoleMappings();

                for (const [, removedRole] of removedRoles) {
                    // Tìm code tương ứng với role bị xóa
                    const matchedCode = Object.entries(mappings).find(([code, entry]) => {
                        const roleName = typeof entry === 'string' ? entry : entry.name;
                        return roleName === removedRole.name;
                    });

                    if (matchedCode) {
                        const [code] = matchedCode;

                        // Check user đang show code này không
                        const currentDisplay = db.getUserDisplay(newMember.id);

                        if (currentDisplay === code) {
                            console.log(`[guildMemberUpdate] User ${newMember.user.tag} lost role ${removedRole.name}, removing display role`);

                            // Xóa display role
                            const displayRoleData = db.getDisplayRole(guildId, code);
                            if (displayRoleData && displayRoleData.display_role_id) {
                                const displayRole = newMember.guild.roles.cache.get(displayRoleData.display_role_id);
                                if (displayRole && newMember.roles.cache.has(displayRole.id)) {
                                    try {
                                        await newMember.roles.remove(displayRole);
                                        console.log(`[guildMemberUpdate] Removed display role for ${newMember.user.tag}`);
                                    } catch (e) {
                                        console.error('[guildMemberUpdate] Error removing display role:', e.message);
                                    }
                                }
                            }

                            // Clear trong DB
                            db.clearUserDisplay(newMember.id);
                        }
                    }
                }

                // ═══════════════════════════════════════════════════════════════
                // BOOSTER ROLE LOSS — Xoá Boost Room khi mất boost
                // ═══════════════════════════════════════════════════════════════
                for (const [, removedRole] of removedRoles) {
                    if (removedRole.id === BOOSTER_ROLE_ID) {
                        // User mất Server Booster role
                        const room = db.getBoosterRoom(newMember.id);
                        if (room) {
                            console.log(`[guildMemberUpdate] User ${newMember.user.tag} lost Booster role, deleting room`);

                            // Xoá voice channel
                            const channel = newMember.guild.channels.cache.get(room.channel_id);
                            if (channel) {
                                try {
                                    await channel.delete('Mất role Booster');
                                } catch (e) {
                                    console.error('[guildMemberUpdate] Error deleting boost room channel:', e.message);
                                }
                            }

                            // Xoá DB
                            db.deleteBoosterRoom(newMember.id);

                            // DM thông báo
                            try {
                                await newMember.send('🎙️ Boost Room của bạn đã bị xoá vì bạn không còn là Server Booster.');
                            } catch (e) { /* DM bị tắt */ }
                        }
                        break;
                    }
                }
            }
        } catch (error) {
            console.error('[guildMemberUpdate] Error:', error);
        }
    },
};
