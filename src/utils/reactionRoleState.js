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
        const buf = fs.readFileSync(REACTION_ROLES_FILE);
        let text = '';

        // Phát hiện BOM UTF-16LE (FF FE) → decode đúng encoding
        if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
            text = buf.toString('utf16le');
        } else {
            text = buf.toString('utf8');
        }

        // Loại bỏ BOM UTF-8 (EF BB BF) nếu có
        text = text.replace(/^\uFEFF/, '').trim();

        if (!text || text === '') {
            console.warn('[ReactionRole] File reaction_roles.json rỗng, khởi tạo mới.');
            reactionRolesCache = {};
            return reactionRolesCache;
        }

        reactionRolesCache = JSON.parse(text);
        return reactionRolesCache;
    } catch (error) {
        console.error('Lỗi khi load reaction_roles.json:', error);
        reactionRolesCache = {};
        return reactionRolesCache;
    }
}

function saveReactionRoles(data) {
    try {
        ensureDataDir();
        // Xóa file cũ trước để tránh BOM UTF-16LE ký sinh
        if (fs.existsSync(REACTION_ROLES_FILE)) {
            fs.unlinkSync(REACTION_ROLES_FILE);
        }
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
