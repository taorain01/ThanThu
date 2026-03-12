/**
 * Achievement System - Hệ thống thành tựu T1
 */

const economy = require('../database/economy');

// ============== ACHIEVEMENTS (40 thành tựu) ==============
const ACHIEVEMENTS = [
    // Mới Bắt Đầu (1-5)
    { id: 1, name: 'Tân Binh T1', desc: 'Mở box T1 đầu tiên', type: 'boxes_opened', target: 1, reward: { hat: 500 } },
    { id: 2, name: 'Khởi Đầu T1', desc: 'Trang bị item T1 đầu tiên', type: 'items_equipped', target: 1, reward: { hat: 500 } },
    { id: 3, name: 'Thợ Rèn T1', desc: 'Tune lần đầu', type: 'tune_count', target: 1, reward: { hat: 500 } },
    { id: 4, name: 'Chiến Binh T1', desc: 'Dungeon solo đầu tiên', type: 'solo_completed', target: 1, reward: { hat: 1000 } },
    { id: 5, name: 'Đồng Đội', desc: 'Tham gia coop đầu tiên', type: 'coop_completed', target: 1, reward: { hat: 1000 } },

    // Farming T1 (6-10)
    { id: 6, name: 'Thợ Mỏ T1 I', desc: 'Mở 10 box T1', type: 'boxes_opened', target: 10, reward: { hat: 1000, daT1: 10 } },
    { id: 7, name: 'Thợ Mỏ T1 II', desc: 'Mở 50 box T1', type: 'boxes_opened', target: 50, reward: { hat: 3000, daT1: 20 } },
    { id: 8, name: 'Thợ Mỏ T1 III', desc: 'Mở 100 box T1', type: 'boxes_opened', target: 100, reward: { hat: 8000, thachAm: 5 } },
    { id: 9, name: 'Nghiện Farm T1', desc: 'Mở 500 box T1', type: 'boxes_opened', target: 500, reward: { hat: 25000, thachAm: 10, title: 'Nghiện Farm' } },
    { id: 10, name: 'Đại Gia T1', desc: 'Có 50,000 Hạt', type: 'hat_owned', target: 50000, reward: { hat: 15000, title: 'Đại Gia' } },

    // Dungeon (11-15)
    { id: 11, name: 'Dungeon I', desc: '10 solo dungeon', type: 'solo_completed', target: 10, reward: { hat: 2000 } },
    { id: 12, name: 'Dungeon II', desc: '50 solo dungeon', type: 'solo_completed', target: 50, reward: { hat: 8000, daT1: 15 } },
    { id: 13, name: 'Dungeon III', desc: '100 solo dungeon', type: 'solo_completed', target: 100, reward: { hat: 20000, thachAm: 8 } },
    { id: 14, name: 'Coop Master', desc: '20 coop dungeon', type: 'coop_completed', target: 20, reward: { hat: 10000, thachAm: 5 } },
    { id: 15, name: 'Boss Slayer T1', desc: 'Đánh 10 boss tuần', type: 'boss_completed', target: 10, reward: { hat: 30000, thachAm: 10, title: 'Boss Slayer' } },

    // Tune T1 (16-20)
    { id: 16, name: 'Tune T1 I', desc: 'Tune 20 lần', type: 'tune_count', target: 20, reward: { hat: 1000 } },
    { id: 17, name: 'Tune T1 II', desc: 'Tune 100 lần', type: 'tune_count', target: 100, reward: { hat: 5000, daT1: 20 } },
    { id: 18, name: 'Tune T1 III', desc: 'Tune 500 lần', type: 'tune_count', target: 500, reward: { hat: 15000, thachAm: 10 } },
    { id: 19, name: '⭐ Đề Cử I', desc: 'Đồ đang mặc có 10 dòng Đề Cử', type: 'decu_equipped', target: 10, reward: { hat: 3000 } },
    { id: 20, name: '⭐ Đề Cử II', desc: 'Đồ đang mặc có 48 dòng Đề Cử (max)', type: 'decu_equipped', target: 48, reward: { hat: 20000, title: '⭐ Đề Cử' } },

    // Equipment T1 (21-25)
    { id: 21, name: 'Trang Bị T1 I', desc: 'Có 5 đồ Vàng T1', type: 'gold_owned', target: 5, reward: { hat: 3000 } },
    { id: 22, name: 'Trang Bị T1 II', desc: 'Có 20 đồ Vàng T1', type: 'gold_owned', target: 20, reward: { hat: 15000, thachAm: 10 } },
    { id: 23, name: 'Full Set T1', desc: 'Đủ 8 slot equipped T1', type: 'slots_filled', target: 8, reward: { hat: 10000, title: 'Full Set' } },
    { id: 24, name: 'Perfect T1 I', desc: '1 đồ T1 có 5 dòng Đề Cử', type: 'perfect_item', target: 5, reward: { hat: 15000 } },
    { id: 25, name: 'Perfect T1 II', desc: '1 đồ T1 có 6 dòng Đề Cử', type: 'perfect_item', target: 6, reward: { hat: 30000, title: 'Perfect' } },

    // Mastery T1 (26-30)
    { id: 26, name: 'Mastery T1 I', desc: 'Đạt 5,000 Mastery', type: 'mastery', target: 5000, reward: { hat: 3000 } },
    { id: 27, name: 'Mastery T1 II', desc: 'Đạt 15,000 Mastery', type: 'mastery', target: 15000, reward: { hat: 15000, thachAm: 10 } },
    { id: 28, name: 'Mastery T1 III', desc: 'Đạt 30,000 Mastery', type: 'mastery', target: 30000, reward: { hat: 30000, title: 'Master' } },
    { id: 29, name: 'Top 3 T1', desc: 'Vào Top 3 Leaderboard', type: 'top_rank', target: 3, reward: { hat: 25000, title: 'Top 3' } },
    { id: 30, name: 'Huyền Thoại T1', desc: 'Top 1 Leaderboard (giữ 24h)', type: 'top_1_24h', target: 1, reward: { hat: 50000, title: '🏆 Huyền Thoại' } },

    // ============== NEW: Đá Đen & Truyền Dòng (31-35) ==============
    { id: 31, name: '🌑 Thợ Đen I', desc: 'Truyền dòng thành công 1 lần', type: 'transfer_success', target: 1, reward: { hat: 2000, daDen: 2 } },
    { id: 32, name: '🌑 Thợ Đen II', desc: 'Truyền dòng thành công 5 lần', type: 'transfer_success', target: 5, reward: { hat: 8000, daDen: 5 } },
    { id: 33, name: '🌑 Thợ Đen III', desc: 'Truyền dòng thành công 20 lần', type: 'transfer_success', target: 20, reward: { hat: 20000, thachAm: 8 } },
    { id: 34, name: '🌑 Đá Đen Master', desc: 'Dùng 50 Đá Đen', type: 'daden_used', target: 50, reward: { hat: 30000, title: '🌑 Đá Đen Master' } },
    { id: 35, name: '🌑 May Mắn', desc: 'Truyền dòng 3 lần liên tiếp thành công', type: 'transfer_streak', target: 3, reward: { hat: 10000, daDen: 5 } },

    // ============== NEW: Kho Đồ (36-40) ==============
    { id: 36, name: '📦 Mở Rộng I', desc: 'Mở rộng kho 1 lần', type: 'slot_purchased', target: 1, reward: { hat: 2000 } },
    { id: 37, name: '📦 Mở Rộng II', desc: 'Mở rộng kho 5 lần', type: 'slot_purchased', target: 5, reward: { hat: 8000, daT1: 50 } },
    { id: 38, name: '📦 Kho Lớn', desc: 'Có 1000 slot kho', type: 'inv_slots', target: 1000, reward: { hat: 10000 } },
    { id: 39, name: '📦 Kho Khổng Lồ', desc: 'Có 2000 slot kho', type: 'inv_slots', target: 2000, reward: { hat: 30000, title: '📦 Kho Khổng Lồ' } },
    { id: 40, name: '🎒 Tích Trữ', desc: 'Có 500 trang bị', type: 'equipment_count', target: 500, reward: { hat: 20000, thachAm: 10 } }
];



// ============== FUNCTIONS ==============

function getPlayerAchievements(discordId) {
    const records = economy.db.prepare('SELECT achievement_id FROM achievements WHERE discord_id = ?').all(discordId);
    return records.map(r => r.achievement_id);
}

function hasAchievement(discordId, achievementId) {
    const record = economy.db.prepare('SELECT * FROM achievements WHERE discord_id = ? AND achievement_id = ?').get(discordId, achievementId);
    return !!record;
}

function unlockAchievement(discordId, achievementId) {
    if (hasAchievement(discordId, achievementId)) {
        return { success: false, message: 'Đã unlock rồi' };
    }

    economy.db.prepare('INSERT INTO achievements (discord_id, achievement_id) VALUES (?, ?)').run(discordId, achievementId);

    const achievement = ACHIEVEMENTS.find(a => a.id === achievementId);

    // Give rewards
    if (achievement && achievement.reward) {
        const r = achievement.reward;
        if (r.hat) economy.addHat(discordId, r.hat);
        if (r.daT1) economy.addStoneT1(discordId, r.daT1);
        if (r.thachAm) economy.addThachAm(discordId, r.thachAm);
        if (r.daDen) economy.addBlackStone(discordId, r.daDen);
    }

    return { success: true, achievement };
}

function getPlayerProgress(discordId) {
    let record = economy.db.prepare('SELECT * FROM player_progress WHERE discord_id = ?').get(discordId);

    if (!record) {
        economy.db.prepare('INSERT INTO player_progress (discord_id) VALUES (?)').run(discordId);
        record = economy.db.prepare('SELECT * FROM player_progress WHERE discord_id = ?').get(discordId);
    }

    return record;
}

function updateProgress(discordId, field, amount = 1) {
    getPlayerProgress(discordId); // Ensure record exists
    try {
        economy.db.prepare(`UPDATE player_progress SET ${field} = COALESCE(${field}, 0) + ? WHERE discord_id = ?`).run(amount, discordId);
    } catch (e) {
        // Column might not exist, try adding it
        try {
            economy.db.prepare(`ALTER TABLE player_progress ADD COLUMN ${field} INTEGER DEFAULT 0`).run();
            economy.db.prepare(`UPDATE player_progress SET ${field} = ? WHERE discord_id = ?`).run(amount, discordId);
        } catch (e2) { /* ignore */ }
    }
}

function checkAndUnlockAchievements(discordId, context = {}) {
    const unlocked = [];
    const unlockedIds = getPlayerAchievements(discordId);
    const progress = getPlayerProgress(discordId);

    for (const achievement of ACHIEVEMENTS) {
        if (unlockedIds.includes(achievement.id)) continue;

        let value = 0;

        switch (achievement.type) {
            case 'boxes_opened':
                value = progress.boxes_opened || 0;
                break;
            case 'solo_completed':
                value = progress.solo_completed || 0;
                break;
            case 'coop_completed':
                value = progress.coop_completed || 0;
                break;
            case 'boss_completed':
                value = progress.boss_completed || 0;
                break;
            case 'tune_count':
                value = progress.tune_count || 0;
                break;
            case 'items_equipped':
                value = context.items_equipped || 0;
                break;
            case 'gold_owned':
                value = context.gold_owned || 0;
                break;
            case 'hat_owned':
                value = context.hat_owned || 0;
                break;
            case 'mastery':
                value = context.mastery || 0;
                break;
            case 'slots_filled':
                value = context.slots_filled || 0;
                break;
            case 'decu_equipped':
                value = context.decu_equipped || 0;
                break;
            case 'perfect_item':
                value = context.perfect_item || 0;
                break;
            case 'top_rank':
                value = context.top_rank || 0;
                break;
            case 'top_1_24h':
                value = context.top_1_24h || 0;
                break;
            // ============== NEW TYPES ==============
            case 'transfer_success':
                value = progress.transfer_success || 0;
                break;
            case 'daden_used':
                value = progress.daden_used || 0;
                break;
            case 'transfer_streak':
                value = context.transfer_streak || 0;
                break;
            case 'slot_purchased':
                value = context.slot_purchased || economy.getSlotPurchaseCount(discordId) || 0;
                break;
            case 'inv_slots':
                value = context.inv_slots || economy.getInvSlots(discordId) || 500;
                break;
            case 'equipment_count':
                value = context.equipment_count || economy.countUserEquipment(discordId) || 0;
                break;
            default:
                value = progress[achievement.type] || 0;
        }

        if (value >= achievement.target) {
            const result = unlockAchievement(discordId, achievement.id);
            if (result.success) {
                unlocked.push(achievement);
            }
        }
    }

    return unlocked;
}

function getAchievementStats(discordId) {
    const unlockedIds = getPlayerAchievements(discordId);
    return {
        unlocked: unlockedIds.length,
        total: ACHIEVEMENTS.length,
        percentage: Math.round((unlockedIds.length / ACHIEVEMENTS.length) * 100)
    };
}

module.exports = {
    ACHIEVEMENTS,
    getPlayerAchievements,
    hasAchievement,
    unlockAchievement,
    getPlayerProgress,
    updateProgress,
    checkAndUnlockAchievements,
    getAchievementStats
};
