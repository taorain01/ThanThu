/**
 * Quest System - Hệ thống nhiệm vụ ngày/tuần
 */

const economy = require('../database/economy');
const { db } = economy;

// ============== DAILY QUEST POOL (Chỉ những quest có tracking) ==============
const DAILY_POOL = [
    // boxes_opened - ✅ Tracked in boxOpening.js
    { id: 1, name: 'Mở 1 Box', type: 'boxes_opened', target: 1 },
    { id: 2, name: 'Mở 3 Box', type: 'boxes_opened', target: 3 },
    { id: 3, name: 'Mở 5 Box', type: 'boxes_opened', target: 5 },
    { id: 4, name: 'Mở 10 Box', type: 'boxes_opened', target: 10 },

    // tune_count - ✅ Tracked in tune.js
    { id: 5, name: 'Tune 1 lần', type: 'tune_count', target: 1 },
    { id: 6, name: 'Tune 3 lần', type: 'tune_count', target: 3 },
    { id: 7, name: 'Tune 5 lần', type: 'tune_count', target: 5 },
    { id: 8, name: 'Tune 10 lần', type: 'tune_count', target: 10 },

    // items_dismantled - ✅ Tracked in dismantle.js
    { id: 9, name: 'Phân tách 1 đồ', type: 'items_dismantled', target: 1 },
    { id: 10, name: 'Phân tách 3 đồ', type: 'items_dismantled', target: 3 },
    { id: 11, name: 'Phân tách 5 đồ', type: 'items_dismantled', target: 5 },

    // shop_bought - ✅ Tracked in buy.js  
    { id: 12, name: 'Mua hàng Shop', type: 'shop_bought', target: 1 },
    { id: 13, name: 'Mua 3 lần Shop', type: 'shop_bought', target: 3 },

    // items_equipped - ✅ Tracked in equip.js
    { id: 14, name: 'Gắn 1 trang bị', type: 'items_equipped', target: 1 },
    { id: 15, name: 'Gắn 3 trang bị', type: 'items_equipped', target: 3 },

    // solo_completed - ✅ Tracked in dungeon.js
    { id: 16, name: 'Đi 1 Bí Cảnh', type: 'solo_completed', target: 1 },
    { id: 17, name: 'Đi 3 Bí Cảnh', type: 'solo_completed', target: 3 }
];

// ============== WEEKLY QUEST POOL ==============
const WEEKLY_POOL = [
    { id: 1, name: 'Mở 500 Box', type: 'boxes_opened', target: 500 },
    { id: 2, name: 'Mở 700 Box', type: 'boxes_opened', target: 700 },
    { id: 3, name: 'Tune 30 lần', type: 'tune_count', target: 30 },
    { id: 4, name: 'Tune 50 lần', type: 'tune_count', target: 50 },
    { id: 5, name: 'Phân tách 10 đồ', type: 'items_dismantled', target: 10 },
    { id: 6, name: 'Phân tách 20 đồ', type: 'items_dismantled', target: 20 },
    { id: 7, name: 'Gắn 5 trang bị', type: 'items_equipped', target: 5 },
    // solo_completed - ✅ Tracked in dungeon.js
    { id: 8, name: 'Đi 5 Bí Cảnh', type: 'solo_completed', target: 5 },
    { id: 9, name: 'Đi 7 Bí Cảnh', type: 'solo_completed', target: 7 },
    // TODO: Implement weekly boss dungeon system before enabling this quest
    // { id: 10, name: 'Nhận thưởng Bí Cảnh Tuần', type: 'weekly_boss_claimed', target: 1 }
];

// ============== SLOT REWARDS ==============
// Weighted reward pool for daily quests
// Normal rewards (can appear multiple times per day)
const DAILY_REWARD_POOL = [
    { weight: 20, reward: { hat: 1000 } },                             // 20%: 1000 Hạt
    { weight: 2, reward: { hat: [500, 1500], thachAm: 1 } },           // 2%: 500-1500 Hạt + Thạch Âm
    { weight: 20, reward: { hat: 200, daT1: [10, 20] } },              // 20%: 200 Hạt + 10-20 Đá
    { weight: 20, reward: { hat: [2000, 5000] } },                     // 20%: 2000-5000 Hạt
    { weight: 18, reward: { boxes: [5, 15] } },                        // 18%: 5-15 Box
    { weight: 12, reward: { nhuaCung: [1, 5] }, exclusive: true },     // 12%: 1-5 Nhựa Cứng (EXCLUSIVE)
    // Jackpot reward (only ONE can appear per day)
    { weight: 3, reward: { boxes: 100, hat: 25000, daT1: 100, buaKhacYeu: 1 }, exclusive: true }, // 3%: 100 Box + 25k Hạt + 100 Đá T1 + 1 Bùa (JACKPOT)
    // Ultra-rare rewards (0.25% each)
    { weight: 0.25, reward: { daT1KhacAn: 1 } },                       // 0.25%: 1 Đá T1 Khắc Ấn
    { weight: 0.25, reward: { thachAmKhacAn: 1 } },                    // 0.25%: 1 Thạch Âm Khắc Ấn
    // Lửa Cầu Phúc
    { weight: 1, reward: { lcp: 1 } },                                 // 1%: 1 Lửa Cầu Phúc
    { weight: 0.5, reward: { lcpcl: 1 } }                              // 0.5%: 1 Lửa Cầu Phúc Cỡ Lớn
];

const WEEKLY_SLOT_REWARDS = [
    { slot: 1, hat: 15000, thachAm: 3, buaKhacYeu: 1 },
    { slot: 2, hat: 15000, daT1: 30, boxes: 15, buaKhacYeu: 1 }
];

// ============== HELPER FUNCTIONS ==============

function getTodayString() {
    const now = new Date();
    // Vietnam timezone (UTC+7)
    now.setHours(now.getHours() + 7);
    return now.toISOString().split('T')[0];
}

function getWeekStartString() {
    const now = new Date();
    now.setHours(now.getHours() + 7);
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
    now.setDate(diff);
    return now.toISOString().split('T')[0];
}

function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function randomFromPool(pool, count) {
    const shuffled = shuffleArray(pool);
    return shuffled.slice(0, count);
}

/**
 * Pick a reward from weighted pool
 */
function pickWeightedReward(pool) {
    const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
    let random = Math.random() * totalWeight;

    for (const item of pool) {
        random -= item.weight;
        if (random <= 0) {
            return item.reward;
        }
    }

    return pool[0].reward; // Fallback
}

/**
 * Calculate exact reward from template
 */
function calculateRewardAmount(rewardTemplate) {
    const result = {};

    if (Array.isArray(rewardTemplate.hat)) {
        const min = rewardTemplate.hat[0];
        const max = rewardTemplate.hat[1];
        const step = 100;
        const steps = Math.floor((max - min) / step) + 1;
        result.hat = min + Math.floor(Math.random() * steps) * step;
    } else if (rewardTemplate.hat) {
        result.hat = rewardTemplate.hat;
    }

    if (rewardTemplate.thachAm) result.thachAm = rewardTemplate.thachAm;

    if (Array.isArray(rewardTemplate.daT1)) {
        result.daT1 = rewardTemplate.daT1[0] + Math.floor(Math.random() * (rewardTemplate.daT1[1] - rewardTemplate.daT1[0] + 1));
    } else if (rewardTemplate.daT1) {
        result.daT1 = rewardTemplate.daT1;
    }

    if (Array.isArray(rewardTemplate.boxes)) {
        result.boxes = rewardTemplate.boxes[0] + Math.floor(Math.random() * (rewardTemplate.boxes[1] - rewardTemplate.boxes[0] + 1));
    } else if (rewardTemplate.boxes) {
        result.boxes = rewardTemplate.boxes;
    }

    // New item types
    if (Array.isArray(rewardTemplate.nhuaCung)) {
        result.nhuaCung = rewardTemplate.nhuaCung[0] + Math.floor(Math.random() * (rewardTemplate.nhuaCung[1] - rewardTemplate.nhuaCung[0] + 1));
    } else if (rewardTemplate.nhuaCung) {
        result.nhuaCung = rewardTemplate.nhuaCung;
    }

    if (rewardTemplate.daT1KhacAn) result.daT1KhacAn = rewardTemplate.daT1KhacAn;
    if (rewardTemplate.thachAmKhacAn) result.thachAmKhacAn = rewardTemplate.thachAmKhacAn;

    // Lửa Cầu Phúc
    if (rewardTemplate.lcp) result.lcp = rewardTemplate.lcp;
    if (rewardTemplate.lcpcl) result.lcpcl = rewardTemplate.lcpcl;

    return result;
}

function assignSlots(quests, isDaily = true) {
    if (isDaily) {
        let exclusiveUsed = false; // Track if an exclusive reward already appeared today

        // Each quest picks independently from weighted pool
        return quests.map((q) => {
            let poolItem;
            let attempts = 0;

            do {
                poolItem = pickWeightedRewardItem(DAILY_REWARD_POOL);
                attempts++;
                // If exclusive already used, re-roll (up to 20 attempts to avoid infinite loop)
            } while (poolItem.exclusive && exclusiveUsed && attempts < 20);

            // If we picked an exclusive, mark it as used
            if (poolItem.exclusive) {
                exclusiveUsed = true;
            }

            const exactReward = calculateRewardAmount(poolItem.reward);

            return {
                ...q,
                slotReward: null, // No longer using slot system
                exactReward: exactReward,
                isExclusive: poolItem.exclusive || false,
                progress: 0,
                completed: false,
                claimed: false
            };
        });
    } else {
        // Weekly: fixed slots 1, 2
        return quests.map((q, i) => {
            const slotReward = i + 1;
            const slot = WEEKLY_SLOT_REWARDS.find(r => r.slot === slotReward);
            const exactReward = { ...slot };
            delete exactReward.slot;

            return {
                ...q,
                slotReward: slotReward,
                exactReward: exactReward,
                progress: 0,
                completed: false,
                claimed: false
            };
        });
    }
}

/**
 * Pick a reward from weighted pool (returns the pool item, not just reward)
 */
function pickWeightedRewardItem(pool) {
    const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
    let random = Math.random() * totalWeight;

    for (const item of pool) {
        random -= item.weight;
        if (random <= 0) {
            return item;
        }
    }

    return pool[0]; // Fallback
}

/**
 * Sync items_equipped quest progress based on currently equipped items
 * @returns {Array} Array of completed quests for notification
 */
function syncEquippedItemsProgress(discordId, questSlots) {
    const economy = require('../database/economy');
    const equippedItems = economy.getEquippedItems(discordId);
    const equippedCount = equippedItems.length;
    const completedQuests = [];

    for (const quest of questSlots) {
        if (quest.type === 'items_equipped' && !quest.claimed) {
            quest.progress = Math.min(equippedCount, quest.target);
            if (quest.progress >= quest.target) {
                quest.completed = true;

                // Auto-claim reward
                if (!quest.claimed && quest.exactReward) {
                    const rewards = quest.exactReward;
                    quest.claimed = true;

                    // Give rewards
                    if (rewards.hat) economy.addHat(discordId, rewards.hat);
                    if (rewards.thachAm) economy.addThachAm(discordId, rewards.thachAm);
                    if (rewards.daT1) economy.addStoneT1(discordId, rewards.daT1);
                    if (rewards.boxes) economy.addBoxesT1(discordId, rewards.boxes);
                    if (rewards.nhuaCung) economy.addNhuaCung(discordId, rewards.nhuaCung);
                    if (rewards.daT1KhacAn) economy.addDaT1KhacAn(discordId, rewards.daT1KhacAn);
                    if (rewards.thachAmKhacAn) economy.addThachAmKhacAn(discordId, rewards.thachAmKhacAn);
                    if (rewards.lcp) economy.addLcp(discordId, rewards.lcp);
                    if (rewards.lcpcl) economy.addLcpcl(discordId, rewards.lcpcl);
                    if (rewards.buaKhacYeu) economy.addBuaKhacYeu(discordId, rewards.buaKhacYeu);

                    // Add to completed list for notification
                    completedQuests.push({
                        type: 'daily', // Will be overwritten by caller if weekly
                        quest: quest,
                        rewards: rewards
                    });
                }
            }
        }
    }

    return completedQuests;
}

// ============== MAIN FUNCTIONS ==============

function getOrGenerateDailyQuests(discordId) {
    const today = getTodayString();
    let syncedQuests = [];

    let record = db.prepare('SELECT * FROM daily_quests WHERE discord_id = ?').get(discordId);

    if (!record || record.quest_date !== today) {
        // Generate new quests
        const selectedQuests = randomFromPool(DAILY_POOL, 5);
        const questSlots = assignSlots(selectedQuests, true);

        // Auto-sync items_equipped quest progress
        const completed = syncEquippedItemsProgress(discordId, questSlots);
        syncedQuests.push(...completed.map(c => ({ ...c, type: 'daily' })));

        db.prepare(`
            INSERT OR REPLACE INTO daily_quests (discord_id, quest_date, quest_slots)
            VALUES (?, ?, ?)
        `).run(discordId, today, JSON.stringify(questSlots));

        return { quests: questSlots, syncedQuests };
    }

    // Sync progress for existing quests
    const questSlots = JSON.parse(record.quest_slots);
    const completed = syncEquippedItemsProgress(discordId, questSlots);
    syncedQuests.push(...completed.map(c => ({ ...c, type: 'daily' })));

    db.prepare('UPDATE daily_quests SET quest_slots = ? WHERE discord_id = ?')
        .run(JSON.stringify(questSlots), discordId);

    return { quests: questSlots, syncedQuests };
}

function getOrGenerateWeeklyQuests(discordId) {
    const weekStart = getWeekStartString();
    let syncedQuests = [];

    let record = db.prepare('SELECT * FROM weekly_quests WHERE discord_id = ?').get(discordId);

    if (!record || record.week_start !== weekStart) {
        // Generate new quests
        const selectedQuests = randomFromPool(WEEKLY_POOL, 2);
        const questSlots = assignSlots(selectedQuests, false);

        // Auto-sync items_equipped quest progress
        const completed = syncEquippedItemsProgress(discordId, questSlots);
        syncedQuests.push(...completed.map(c => ({ ...c, type: 'weekly' })));

        db.prepare(`
            INSERT OR REPLACE INTO weekly_quests (discord_id, week_start, quest_slots)
            VALUES (?, ?, ?)
        `).run(discordId, weekStart, JSON.stringify(questSlots));

        return { quests: questSlots, syncedQuests };
    }

    // Sync progress for existing quests
    const questSlots = JSON.parse(record.quest_slots);
    const completed = syncEquippedItemsProgress(discordId, questSlots);
    syncedQuests.push(...completed.map(c => ({ ...c, type: 'weekly' })));

    db.prepare('UPDATE weekly_quests SET quest_slots = ? WHERE discord_id = ?')
        .run(JSON.stringify(questSlots), discordId);

    return { quests: questSlots, syncedQuests };
}

function updateQuestProgress(discordId, actionType, amount = 1) {
    const today = getTodayString();
    const weekStart = getWeekStartString();
    const completedQuests = []; // Track newly completed quests for notifications

    // Import economy for giving rewards
    const economy = require('../database/economy');

    // Tự động tạo quest record nếu chưa có (không cần chạy ?q trước)
    const dailyResult = getOrGenerateDailyQuests(discordId);
    const weeklyResult = getOrGenerateWeeklyQuests(discordId);

    // Update daily quests
    const dailyRecord = db.prepare('SELECT * FROM daily_quests WHERE discord_id = ? AND quest_date = ?').get(discordId, today);
    if (dailyRecord) {
        const quests = JSON.parse(dailyRecord.quest_slots);
        let updated = false;

        for (const quest of quests) {
            if (quest.type === actionType && !quest.completed) {
                quest.progress = Math.min(quest.progress + amount, quest.target);
                if (quest.progress >= quest.target) {
                    quest.completed = true;

                    // Auto-claim reward
                    if (!quest.claimed) {
                        const rewards = quest.exactReward || calculateSlotReward(quest.slotReward, true);
                        quest.claimed = true;

                        // Give rewards
                        if (rewards.hat) economy.addHat(discordId, rewards.hat);
                        if (rewards.thachAm) economy.addThachAm(discordId, rewards.thachAm);
                        if (rewards.daT1) economy.addStoneT1(discordId, rewards.daT1);
                        if (rewards.boxes) economy.addBoxesT1(discordId, rewards.boxes);
                        if (rewards.nhuaCung) economy.addNhuaCung(discordId, rewards.nhuaCung);
                        if (rewards.daT1KhacAn) economy.addDaT1KhacAn(discordId, rewards.daT1KhacAn);
                        if (rewards.thachAmKhacAn) economy.addThachAmKhacAn(discordId, rewards.thachAmKhacAn);
                        if (rewards.lcp) economy.addLcp(discordId, rewards.lcp);
                        if (rewards.lcpcl) economy.addLcpcl(discordId, rewards.lcpcl);
                        if (rewards.buaKhacYeu) economy.addBuaKhacYeu(discordId, rewards.buaKhacYeu);

                        completedQuests.push({
                            type: 'daily',
                            quest: quest,
                            rewards: rewards
                        });
                    }
                }
                updated = true;
            }
        }

        if (updated) {
            db.prepare('UPDATE daily_quests SET quest_slots = ? WHERE discord_id = ?')
                .run(JSON.stringify(quests), discordId);
        }
    }

    // Update weekly quests
    const weeklyRecord = db.prepare('SELECT * FROM weekly_quests WHERE discord_id = ? AND week_start = ?').get(discordId, weekStart);
    if (weeklyRecord) {
        const quests = JSON.parse(weeklyRecord.quest_slots);
        let updated = false;

        for (const quest of quests) {
            if (quest.type === actionType && !quest.completed) {
                quest.progress = Math.min(quest.progress + amount, quest.target);
                if (quest.progress >= quest.target) {
                    quest.completed = true;

                    // Auto-claim reward
                    if (!quest.claimed) {
                        const rewards = quest.exactReward || calculateSlotReward(quest.slotReward, false);
                        quest.claimed = true;

                        // Give rewards
                        if (rewards.hat) economy.addHat(discordId, rewards.hat);
                        if (rewards.thachAm) economy.addThachAm(discordId, rewards.thachAm);
                        if (rewards.daT1) economy.addStoneT1(discordId, rewards.daT1);
                        if (rewards.boxes) economy.addBoxesT1(discordId, rewards.boxes);
                        if (rewards.nhuaCung) economy.addNhuaCung(discordId, rewards.nhuaCung);
                        if (rewards.daT1KhacAn) economy.addDaT1KhacAn(discordId, rewards.daT1KhacAn);
                        if (rewards.thachAmKhacAn) economy.addThachAmKhacAn(discordId, rewards.thachAmKhacAn);
                        if (rewards.lcp) economy.addLcp(discordId, rewards.lcp);
                        if (rewards.lcpcl) economy.addLcpcl(discordId, rewards.lcpcl);
                        if (rewards.buaKhacYeu) economy.addBuaKhacYeu(discordId, rewards.buaKhacYeu);

                        completedQuests.push({
                            type: 'weekly',
                            quest: quest,
                            rewards: rewards
                        });
                    }
                }
                updated = true;
            }
        }

        if (updated) {
            db.prepare('UPDATE weekly_quests SET quest_slots = ? WHERE discord_id = ?')
                .run(JSON.stringify(quests), discordId);
        }
    }

    // Check achievements after quest progress update
    try {
        const achievementSystem = require('./achievementSystem');
        const eco = economy.getOrCreateEconomy(discordId);
        const goldItems = economy.getUserGoldEquipment(discordId);
        const equippedItems = economy.getUserEquippedItems(discordId);

        const context = {
            items_equipped: equippedItems.length,
            gold_owned: goldItems.length,
            hat_owned: eco.hat || 0,
            slots_filled: equippedItems.length,
            inv_slots: economy.getInvSlots(discordId),
            slot_purchased: economy.getSlotPurchaseCount(discordId),
            equipment_count: economy.countUserEquipment(discordId)
        };

        const unlockedAchievements = achievementSystem.checkAndUnlockAchievements(discordId, context);

        // Add unlocked achievements to completed quests for notification
        for (const ach of unlockedAchievements) {
            completedQuests.push({
                type: 'achievement',
                quest: { name: ach.name, desc: ach.desc },
                rewards: ach.reward || {}
            });
        }
    } catch (e) {
        // Achievement system error, ignore silently
        console.error('[Quest] Achievement check error:', e.message);
    }

    return completedQuests; // Return completed quests for notification
}

function calculateSlotReward(slotReward, isDaily = true) {
    const rewards = isDaily ? DAILY_SLOT_REWARDS : WEEKLY_SLOT_REWARDS;
    const slot = rewards.find(r => r.slot === slotReward);
    if (!slot) return { hat: 100 };

    const result = {};

    // Handle random ranges
    if (Array.isArray(slot.hat)) {
        const min = slot.hat[0];
        const max = slot.hat[1];
        const step = 100;
        const steps = Math.floor((max - min) / step) + 1;
        result.hat = min + Math.floor(Math.random() * steps) * step;
    } else if (slot.hat) {
        result.hat = slot.hat;
    }

    if (slot.thachAm) result.thachAm = slot.thachAm;

    if (Array.isArray(slot.daT1)) {
        result.daT1 = slot.daT1[0] + Math.floor(Math.random() * (slot.daT1[1] - slot.daT1[0] + 1));
    } else if (slot.daT1) {
        result.daT1 = slot.daT1;
    }

    if (Array.isArray(slot.boxes)) {
        result.boxes = slot.boxes[0] + Math.floor(Math.random() * (slot.boxes[1] - slot.boxes[0] + 1));
    } else if (slot.boxes) {
        result.boxes = slot.boxes;
    }

    return result;
}

function claimQuestReward(discordId, questIndex, isDaily = true) {
    const result = isDaily ? getOrGenerateDailyQuests(discordId) : getOrGenerateWeeklyQuests(discordId);
    const quests = result.quests || result;

    if (questIndex < 0 || questIndex >= quests.length) {
        return { success: false, message: 'Nhiệm vụ không tồn tại' };
    }

    const quest = quests[questIndex];

    if (!quest.completed) {
        return { success: false, message: 'Nhiệm vụ chưa hoàn thành' };
    }

    if (quest.claimed) {
        return { success: false, message: 'Đã nhận thưởng rồi' };
    }

    // Calculate and give rewards
    const rewards = calculateSlotReward(quest.slotReward, isDaily);
    quest.claimed = true;

    // Update database
    const table = isDaily ? 'daily_quests' : 'weekly_quests';
    db.prepare(`UPDATE ${table} SET quest_slots = ? WHERE discord_id = ? `)
        .run(JSON.stringify(quests), discordId);

    return { success: true, rewards, quest };
}

/**
 * Helper function to send quest completion notifications
 * @param {Object} channel - Discord channel to send to
 * @param {string} userId - Discord user ID
 * @param {Array} completedQuests - Array of completed quests from updateQuestProgress
 */
async function sendQuestNotifications(channel, userId, completedQuests) {
    if (!completedQuests || completedQuests.length === 0) return;

    const { EmbedBuilder } = require('discord.js');

    for (const cq of completedQuests) {
        // Format detailed rewards
        const rewardParts = [];
        if (cq.rewards.hat) rewardParts.push(`🌾 ${cq.rewards.hat.toLocaleString()} Hạt`);
        if (cq.rewards.thachAm) rewardParts.push(`🔮 ${cq.rewards.thachAm} Thạch Âm`);
        if (cq.rewards.daT1) rewardParts.push(`💎 ${cq.rewards.daT1} Đá T1`);
        if (cq.rewards.boxes) rewardParts.push(`📦 ${cq.rewards.boxes} Box T1`);
        if (cq.rewards.nhuaCung) rewardParts.push(`💊 ${cq.rewards.nhuaCung} Nhựa Cứng`);
        if (cq.rewards.daT1KhacAn) rewardParts.push(`💠 ${cq.rewards.daT1KhacAn} Tinh Thể Vàng`);
        if (cq.rewards.thachAmKhacAn) rewardParts.push(`🔷 ${cq.rewards.thachAmKhacAn} Thạch Âm Vàng`);
        if (cq.rewards.lcp) rewardParts.push(`🔥 ${cq.rewards.lcp} Lửa Cầu Phúc`);
        if (cq.rewards.lcpcl) rewardParts.push(`🔥 ${cq.rewards.lcpcl} Lửa Cầu Phúc Cỡ Lớn`);
        if (cq.rewards.daDen) rewardParts.push(`🌑 ${cq.rewards.daDen} Đá Đen`);
        if (cq.rewards.buaKhacYeu) rewardParts.push(`📜 ${cq.rewards.buaKhacYeu} Bùa Khắc Yêu`);
        if (cq.rewards.title) rewardParts.push(`🏷️ Danh hiệu: ** ${cq.rewards.title}** `);

        // Achievement notification - Different style (gold/trophy)
        if (cq.type === 'achievement') {
            const achievementEmbed = new EmbedBuilder()
                .setColor(0xFFD700) // Gold color
                .setTitle('🏆 THÀNH TỰU MỚI!')
                .setDescription(
                    `** ${cq.quest.name}**\n` +
                    `* ${cq.quest.desc}*\n\n` +
                    `🎁 ** Phần thưởng:**\n${rewardParts.length > 0 ? rewardParts.join('\n') : '*(Không có)*'} `
                )
                .setFooter({ text: '?thanhtuu để xem tất cả thành tựu' })
                .setTimestamp();

            await channel.send({ embeds: [achievementEmbed] }).catch(() => { });
            continue;
        }

        // Quest notification - Regular style (green)
        // Get remaining quests
        const allQuests = cq.type === 'daily'
            ? getOrGenerateDailyQuests(userId)
            : getOrGenerateWeeklyQuests(userId);
        const questArray = allQuests.quests || allQuests;

        const remaining = questArray.filter(q => !q.claimed);
        let remainingText = '';
        if (remaining.length > 0) {
            remainingText = '\n\n**Nhiệm vụ còn lại:**\n';
            remaining.forEach((q) => {
                const status = q.completed ? '✅' : '⬜';
                remainingText += `${status} ${q.name} (${q.progress}/${q.target})\n`;
            });
        }

        const questEmbed = new EmbedBuilder()
            .setColor(0x22C55E) // Green color
            .setTitle('✅ Nhiệm vụ hoàn thành!')
            .setDescription(
                `** ${cq.quest.name} (${cq.quest.progress || cq.quest.target}/${cq.quest.target})** (${cq.type === 'daily' ? 'Ngày' : 'Tuần'}) \n\n` +
                `🎁 ** Phần thưởng:**\n${rewardParts.length > 0 ? rewardParts.join('\n') : '_(Đã nhận phần thưởng)_'} ` +
                remainingText
            )
            .setFooter({ text: '?q để xem chi tiết' })
            .setTimestamp();

        await channel.send({ embeds: [questEmbed] }).catch(() => { });
    }
}

module.exports = {
    DAILY_POOL,
    WEEKLY_POOL,
    DAILY_REWARD_POOL,
    WEEKLY_SLOT_REWARDS,
    getOrGenerateDailyQuests,
    getOrGenerateWeeklyQuests,
    updateQuestProgress,
    sendQuestNotifications,
    calculateSlotReward,
    claimQuestReward,
    getTodayString,
    getWeekStartString
};


