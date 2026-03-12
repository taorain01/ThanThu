const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const REACTION_ROLES_FILE = path.join(DATA_DIR, 'reaction_roles.json');

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

/**
 * structure of ReactionRoles cache:
 * {
 *   "messageId": {
 *     "channelId": "12345",
 *     "guildId": "123456",
 *     "reactions": {
 *       "emojiIdOrName": "roleId"
 *     }
 *   }
 * }
 */
let reactionRolesCache = null;

function loadReactionRoles() {
    if (reactionRolesCache) return reactionRolesCache;
    try {
        if (!fs.existsSync(REACTION_ROLES_FILE)) {
            reactionRolesCache = {};
            return reactionRolesCache;
        }
        const data = fs.readFileSync(REACTION_ROLES_FILE, 'utf8');
        reactionRolesCache = JSON.parse(data);
        return reactionRolesCache;
    } catch (error) {
        console.error('Lỗi khi load reaction_roles.json:', error);
        return {};
    }
}

function saveReactionRoles(data) {
    try {
        ensureDataDir();
        fs.writeFileSync(REACTION_ROLES_FILE, JSON.stringify(data, null, 2), 'utf8');
        reactionRolesCache = data;
        return true;
    } catch (error) {
        console.error('Lỗi khi lưu reaction_roles.json:', error);
        return false;
    }
}

function addReactionRole(messageId, channelId, guildId, emojiIdOrName, roleId) {
    const data = loadReactionRoles();
    if (!data[messageId]) {
        data[messageId] = {
            channelId,
            guildId,
            reactions: {}
        };
    }
    data[messageId].reactions[emojiIdOrName] = roleId;
    saveReactionRoles(data);
}

function removeReactionRoleByRole(messageId, roleId) {
    const data = loadReactionRoles();
    if (data[messageId]) {
        let reactionToRemove = null;
        for (const [emoji, role] of Object.entries(data[messageId].reactions)) {
            if (role === roleId) {
                reactionToRemove = emoji;
                delete data[messageId].reactions[emoji];
            }
        }

        // Cleanup if empty
        if (Object.keys(data[messageId].reactions).length === 0) {
            delete data[messageId];
        }

        saveReactionRoles(data);
        return reactionToRemove;
    }
    return null;
}

function getRoleForReaction(messageId, emojiIdOrName) {
    const data = loadReactionRoles();
    if (data[messageId] && data[messageId].reactions) {
        return data[messageId].reactions[emojiIdOrName] || null;
    }
    return null;
}

/**
 * Kiểm tra xem messageId có nằm trong hệ thống reaction role không
 */
function isReactionRoleMessage(messageId) {
    const data = loadReactionRoles();
    return !!data[messageId];
}

module.exports = {
    loadReactionRoles,
    addReactionRole,
    removeReactionRoleByRole,
    getRoleForReaction,
    isReactionRoleMessage
};
