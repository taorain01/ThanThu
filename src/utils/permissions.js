const fs = require('fs');
const path = require('path');

const PERMISSIONS_FILE = path.join(__dirname, '../../data/permissions.json');

// ID của owner bot (chỉ owner mới được set role)
const OWNER_ID = '395151484179841024';

/**
 * Load role yêu cầu từ file
 * @returns {Object} { guildId: roleId }
 */
function loadRequiredRoles() {
    try {
        if (fs.existsSync(PERMISSIONS_FILE)) {
            const data = fs.readFileSync(PERMISSIONS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Lỗi khi load permissions:', error);
    }
    return {};
}

/**
 * Lưu role yêu cầu vào file
 * @param {Object} roles - { guildId: roleId }
 */
function saveRequiredRoles(roles) {
    try {
        const dir = path.dirname(PERMISSIONS_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(roles, null, 2));
    } catch (error) {
        console.error('Lỗi khi lưu permissions:', error);
    }
}

/**
 * Set role yêu cầu cho guild
 * @param {string} guildId - ID của guild
 * @param {string} roleId - ID của role yêu cầu
 */
function setRequiredRole(guildId, roleId) {
    const roles = loadRequiredRoles();
    roles[guildId] = roleId;
    saveRequiredRoles(roles);
}

/**
 * Lấy role yêu cầu cho guild
 * @param {string} guildId - ID của guild
 * @returns {string|null} - Role ID hoặc null
 */
function getRequiredRole(guildId) {
    const roles = loadRequiredRoles();
    return roles[guildId] || null;
}

/**
 * Xóa role yêu cầu cho guild
 * @param {string} guildId - ID của guild
 */
function removeRequiredRole(guildId) {
    const roles = loadRequiredRoles();
    delete roles[guildId];
    saveRequiredRoles(roles);
}

/**
 * Kiểm tra user có quyền dùng lệnh thông báo không
 * @param {GuildMember} member - Member cần kiểm tra
 * @returns {boolean} - true nếu có quyền
 */
function hasNotificationPermission(member) {
    // Owner luôn có quyền
    if (member.user.id === OWNER_ID) {
        return true;
    }

    const requiredRoleId = getRequiredRole(member.guild.id);

    // Nếu chưa set role yêu cầu → Mọi người đều có quyền
    if (!requiredRoleId) {
        return true;
    }

    // Kiểm tra user có role yêu cầu không
    return member.roles.cache.has(requiredRoleId);
}

/**
 * Kiểm tra user có phải owner không
 * @param {string} userId - ID của user
 * @returns {boolean} - true nếu là owner
 */
function isOwner(userId) {
    return userId === OWNER_ID;
}

module.exports = {
    OWNER_ID,
    setRequiredRole,
    getRequiredRole,
    removeRequiredRole,
    hasNotificationPermission,
    isOwner
};


