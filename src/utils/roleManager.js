/**
 * Quản lý cấp/xóa roles cho event nhắc nhở
 */

// Mapping giữa event type và role name
// BangChien removed - BC registration handled by separate ?bc command
const ROLE_NAMES = {
    'BossSolo': 'bs',
    'PvpSolo': 'ps',
    'YenTiec': 'yt',
    'BangChien': 'bc',
    'AllEvents': ['bs', 'ps', 'yt']
};

/**
 * Cấp role event cho user
 * @param {GuildMember} member - Member cần cấp role
 * @param {string} roleType - Loại role: 'BossSolo', 'PvpSolo', 'YenTiec', 'AllEvents'
 * @returns {Object} { success: boolean, message: string, roles: Array }
 */
async function assignEventRole(member, roleType) {
    try {
        const guild = member.guild;
        const roleNames = roleType === 'AllEvents' ? ROLE_NAMES[roleType] : [ROLE_NAMES[roleType]];

        const rolesToAdd = [];
        const alreadyHas = [];
        const notFound = [];

        // Tìm và kiểm tra từng role
        for (const roleName of roleNames) {
            const role = guild.roles.cache.find(r => r.name === roleName);

            if (!role) {
                notFound.push(roleName);
                continue;
            }

            // Kiểm tra user đã có role chưa
            if (member.roles.cache.has(role.id)) {
                alreadyHas.push(roleName);
            } else {
                rolesToAdd.push(role);
            }
        }

        // Báo lỗi nếu role không tồn tại
        if (notFound.length > 0) {
            return {
                success: false,
                message: `❌ Admin chưa tạo role: ${notFound.map(r => `@${r}`).join(', ')}. Vui lòng liên hệ admin!`,
                roles: []
            };
        }

        // Nếu user đã có tất cả roles
        if (rolesToAdd.length === 0) {
            return {
                success: false,
                message: `ℹ️ Bạn đã đăng ký nhắc nhở ${roleType === 'AllEvents' ? 'toàn bộ event' : roleNames[0]} rồi!`,
                roles: alreadyHas
            };
        }

        // Cấp roles
        await member.roles.add(rolesToAdd);

        // Tạo message
        const addedRoleNames = rolesToAdd.map(r => `@${r.name}`).join(', ');
        let message;

        if (roleType === 'AllEvents') {
            message = `✅ Đã cấp toàn bộ roles: ${addedRoleNames}! Bạn sẽ được tag cho mọi event Guild!`;
        } else {
            message = `✅ Đã cấp role ${addedRoleNames}! Bạn sẽ được tag khi có ${roleNames[0]}!`;
        }

        // Thông báo nếu đã có một số roles
        if (alreadyHas.length > 0) {
            message += `\n(Bạn đã có sẵn: ${alreadyHas.map(r => `@${r}`).join(', ')})`;
        }

        return {
            success: true,
            message: message,
            roles: rolesToAdd.map(r => r.name)
        };

    } catch (error) {
        console.error('Lỗi khi cấp role:', error);

        // Kiểm tra lỗi phổ biến
        if (error.code === 50013) {
            return {
                success: false,
                message: '❌ Bot không có quyền cấp role! Liên hệ admin để cấp quyền "Manage Roles" cho bot.',
                roles: []
            };
        }

        return {
            success: false,
            message: '❌ Có lỗi xảy ra khi cấp role. Vui lòng thử lại sau!',
            roles: []
        };
    }
}

/**
 * Xóa role event khỏi user (cho tính năng hủy đăng ký sau này)
 * @param {GuildMember} member - Member cần xóa role
 * @param {string} roleType - Loại role
 * @returns {Object} { success: boolean, message: string }
 */
async function removeEventRole(member, roleType) {
    try {
        const guild = member.guild;
        const roleNames = roleType === 'AllEvents' ? ROLE_NAMES[roleType] : [ROLE_NAMES[roleType]];

        const rolesToRemove = [];

        for (const roleName of roleNames) {
            const role = guild.roles.cache.find(r => r.name === roleName);
            if (role && member.roles.cache.has(role.id)) {
                rolesToRemove.push(role);
            }
        }

        if (rolesToRemove.length === 0) {
            return {
                success: false,
                message: 'ℹ️ Bạn chưa đăng ký nhắc nhở này!'
            };
        }

        await member.roles.remove(rolesToRemove);

        return {
            success: true,
            message: `✅ Đã hủy đăng ký nhắc nhở ${rolesToRemove.map(r => `@${r.name}`).join(', ')}!`
        };

    } catch (error) {
        console.error('Lỗi khi xóa role:', error);
        return {
            success: false,
            message: '❌ Có lỗi xảy ra khi hủy đăng ký!'
        };
    }
}

/**
 * Lấy role mention string để tag trong thông báo
 * @param {Guild} guild - Guild object
 * @param {string} missionType - 'BossSolo', 'PvpSolo', 'YenTiec'
 * @returns {string} - Role mention string hoặc empty string
 */
function getRoleMention(guild, missionType) {
    const roleName = ROLE_NAMES[missionType];
    if (!roleName) return '';

    const role = guild.roles.cache.find(r => r.name === roleName);
    return role ? `<@&${role.id}>` : '';
}

module.exports = {
    assignEventRole,
    removeEventRole,
    getRoleMention,
    ROLE_NAMES
};


