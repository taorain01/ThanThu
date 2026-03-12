/**
 * ?donedung command - Skip dungeon timer
 * Usage: ?donedung @user (hoặc không tag thì tự bản thân)
 * Only OWNER_ID can use this command
 */

const economy = require('../../../database/economy');

// Owner ID - Only this user can use this command
const OWNER_ID = '395151484179841024';

/**
 * Execute donedung command
 */
async function execute(message, args) {
    // Check permission - Owner only
    if (message.author.id !== OWNER_ID) {
        return message.reply('❌ Bạn không có quyền thực hiện lệnh này!');
    }

    // Parse mentioned user - nếu không tag ai thì dùng bản thân
    const mentionedUser = message.mentions.users.first();
    const targetUserId = mentionedUser ? mentionedUser.id : message.author.id;

    // Check if user has active dungeon
    const session = economy.db.prepare(`
        SELECT * FROM dungeon_sessions 
        WHERE leader_id = ? AND status = 'in_progress'
        ORDER BY created_at DESC LIMIT 1
    `).get(targetUserId);

    if (!session) {
        return message.reply(`❌ <@${targetUserId}> không có dungeon nào đang chạy!`);
    }

    // Set ends_at to now (skip timer)
    economy.db.prepare(`
        UPDATE dungeon_sessions SET ends_at = ?
        WHERE id = ?
    `).run(new Date().toISOString(), session.id);

    return message.reply(`⏭️ Đã skip thời gian dungeon **${session.dungeon_type}** của <@${targetUserId}>!\n👉 Dùng \`?dung\` để nhận thưởng.`);
}

module.exports = { execute };


