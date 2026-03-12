/**
 * guildMemberUpdate Event
 * Triggered when a member's roles, nickname, or other properties change
 * 
 * Display Role System:
 *   - Auto remove display role khi user mất role gốc
 */

const db = require('../../database/db');
const { getRoleMappings, DISPLAY_ROLE_NAME } = require('../../commands/quanly/subrole/addrole');

module.exports = {
    name: 'guildMemberUpdate',
    async execute(oldMember, newMember) {
        try {
            // Kiểm tra role changes
            const oldRoles = oldMember.roles.cache;
            const newRoles = newMember.roles.cache;

            // Tìm roles bị xóa
            const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));

            if (removedRoles.size === 0) return;

            // Lấy mappings để check role gốc
            const mappings = getRoleMappings();
            const guildId = newMember.guild.id;

            // Kiểm tra xem có role gốc nào bị xóa không
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
                if (removedRole.id === '740457614470545408') {
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
        } catch (error) {
            console.error('[guildMemberUpdate] Error:', error);
        }
    },
};
