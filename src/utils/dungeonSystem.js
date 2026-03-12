/**
 * Dungeon System Module
 * Công thức tính thời gian, role checking, event messages
 */

// ============== CONSTANTS ==============

const DUNGEON_TYPES = {
    solo: {
        name: 'Solo',
        dungeonName: '🗡️ Hang Động U Minh',
        description: 'Bí cảnh đơn độc cho những chiến binh tự tin',
        icon: '🗡️',
        baseTime: 25, // phút (giảm từ 40)
        baseNhua: 20,
        maxMultiplier: 3,
        minPlayers: 1,
        maxPlayers: 1,
        tier: 1
    },
    coop5: {
        name: 'Coop 5 Người',
        dungeonName: '👥 Thành Cổ Ma Quái',
        description: 'Cần đội 5 người để chinh phạt',
        icon: '👥',
        baseTime: 75, // phút (giảm từ 120)
        baseNhua: 60,
        maxMultiplier: 3,
        minPlayers: 1,
        maxPlayers: 5,
        tier: 1
    },
    boss10: {
        name: 'Boss 10 Người',
        dungeonName: '👑 Lãnh Địa Ma Vương',
        description: 'Raid boss hàng tuần - 10 người',
        icon: '👑',
        baseTime: 300, // 300 phút = 5 giờ
        baseNhua: 0,
        maxMultiplier: 1,
        minPlayers: 1,
        maxPlayers: 10,
        weeklyLimit: 2,
        tier: 1
    }
};

// Phần thưởng cơ bản
const REWARDS = {
    solo: {
        boxes: 12,       // 12 Box / lần (x1-3)
        hat: 1000,       // 1000 Hạt / lần (x1-3)
        thachAmChance: 0.03, // 3%
        bonusBoxChances: { '+3': 0.05, '+2': 0.08, '+1': 0.10 },
        // Rare drops (per run)
        rareDrops: {
            nhuaCung: 0.05,      // 5% - Nhựa Cứng
            daDen: 0.02,         // 2% - Đá Đen
            lcp: 0.01,           // 1% - Lửa Cầu Phúc
            buaKhacYeu: 0.05     // 5% - Bùa Khắc Yêu
        }
    },
    coop5: {
        boxes: 35,       // 35 Box / lần (x1-3)
        hat: 4000,       // 4000 Hạt / lần (x1-3)
        thachAmChance: 0.10, // 10%
        bonusBoxChances: { '+3': 0.05, '+2': 0.08, '+1': 0.10 },
        // Rare drops (per run)
        rareDrops: {
            nhuaCung: 0.10,       // 10% - Nhựa Cứng
            daDen: 0.05,          // 5% - Đá Đen
            lcp: 0.03,            // 3% - Lửa Cầu Phúc
            tinhTheVang: 0.01,    // 1% - Tinh Thể Vàng
            thachAmVang: 0.01,    // 1% - Thạch Âm Vàng
            buaKhacYeu: 0.05      // 5% - Bùa Khắc Yêu
        }
    },
    boss10: {
        // Tổng: 100 Box + 10,000 Hạt + 4 Thạch Âm + 20% bonus 10-20 box
        // Chia đều 2 phase
        phases: {
            1: { // Phase 1 - 50% tiến độ
                boxes: 50,
                hat: 5000,
                thachAm: 2,
                bonusBoxChance: 0.20, // 20%
                bonusBoxRange: [10, 20],
                // Rare drops guaranteed/high chance
                rareDrops: {
                    nhuaCung: { chance: 0.50, amount: [2, 5] },   // 50% - 2-5 Nhựa Cứng
                    daDen: { chance: 0.30, amount: [1, 3] },      // 30% - 1-3 Đá Đen
                    lcp: { chance: 1.0, amount: 1 },              // 100% - 1 Lửa Cầu Phúc (GUARANTEED)
                    tinhTheVang: { chance: 0.05, amount: 1 },     // 5% - 1 Tinh Thể Vàng
                    thachAmVang: { chance: 0.05, amount: 1 },     // 5% - 1 Thạch Âm Vàng
                    lcpcl: { chance: 0.02, amount: 1 },           // 2% - 1 Lửa Cầu Phúc Cỡ Lớn
                    buaKhacYeu: { chance: 0.05, amount: 1 }       // 5% - 1 Bùa Khắc Yêu
                }
            },
            2: { // Phase 2 - 100% tiến độ  
                boxes: 50,
                hat: 5000,
                thachAm: 2,
                bonusBoxChance: 0.20, // 20%
                bonusBoxRange: [10, 20],
                // Rare drops guaranteed/high chance
                rareDrops: {
                    nhuaCung: { chance: 0.50, amount: [2, 5] },   // 50% - 2-5 Nhựa Cứng
                    daDen: { chance: 0.30, amount: [1, 3] },      // 30% - 1-3 Đá Đen
                    lcp: { chance: 1.0, amount: 1 },              // 100% - 1 Lửa Cầu Phúc (GUARANTEED)
                    tinhTheVang: { chance: 0.05, amount: 1 },     // 5% - 1 Tinh Thể Vàng
                    thachAmVang: { chance: 0.05, amount: 1 },     // 5% - 1 Thạch Âm Vàng
                    lcpcl: { chance: 0.02, amount: 1 },           // 2% - 1 Lửa Cầu Phúc Cỡ Lớn
                    buaKhacYeu: { chance: 0.05, amount: 1 }       // 5% - 1 Bùa Khắc Yêu
                }
            }
        }
    }
};

// AI penalty
const AI_BOX_PENALTY = 0.7; // 30% giảm hòm khi có AI

// ============== PARTY FACTOR ==============

/**
 * Tính Party Factor dựa trên số người
 * Công thức: 0.85 ^ (n-1)
 */
function getPartyFactor(memberCount) {
    return Math.pow(0.85, memberCount - 1);
}

// Bảng tra cứu nhanh
const PARTY_FACTORS = {
    1: 1.00,
    2: 0.85,
    3: 0.72,
    4: 0.61,
    5: 0.52,
    6: 0.44,
    7: 0.38,
    8: 0.32,
    9: 0.27,
    10: 0.20
};

// ============== MASTERY FACTOR ==============

const MAX_MASTERY_PER_PERSON = 8000;
const MASTERY_REDUCTION_RATE = 0.65; // Giảm tối đa 65% (Option A)

/**
 * Tính Mastery Factor
 * Công thức: 1 - (avgMastery / 8000) * 0.65
 * Cap: [0.35, 1.00]
 */
function getMasteryFactor(totalMastery, memberCount) {
    const avgMastery = totalMastery / memberCount;
    const factor = 1 - (avgMastery / MAX_MASTERY_PER_PERSON) * MASTERY_REDUCTION_RATE;
    return Math.max(0.35, Math.min(1.00, factor));
}

// ============== ROLE FACTOR ==============

/**
 * Tính Role Factor
 * Bao gồm: Synergy bonus, DPS bonus, penalties
 */
function getRoleFactor(members) {
    const roles = analyzeRoles(members);

    let synergy = 1.0;
    let dpsBonus = 1.0;
    let penalty = 1.0;

    // Synergy: Đủ 3 role = 0.90
    if (roles.hasTank && roles.hasHealer && roles.hasDPS) {
        synergy = 0.90;
    }

    // DPS Bonus: Mỗi DPS thêm từ thứ 2 = 0.95
    if (roles.dpsCount >= 2) {
        const extraDPS = Math.min(roles.dpsCount - 1, 4); // Cap tại 4 extra
        dpsBonus = Math.pow(0.95, extraDPS);
    }

    // Penalty: Thiếu DPS = x2.00
    if (roles.dpsCount === 0) {
        penalty = 2.0;
    }

    return {
        factor: synergy * dpsBonus * penalty,
        synergy,
        dpsBonus,
        penalty,
        roles
    };
}

/**
 * Phân tích role trong party
 */
function analyzeRoles(members) {
    let tankCount = 0;
    let dpsCount = 0;
    let healerCount = 0;

    for (const member of members) {
        const role = member.role?.toLowerCase();
        if (role === 'tanker' || role === 'tank') tankCount++;
        else if (role === 'dps') dpsCount++;
        else if (role === 'healer' || role === 'heal') healerCount++;
    }

    return {
        tankCount,
        dpsCount,
        healerCount,
        hasTank: tankCount > 0,
        hasDPS: dpsCount > 0,
        hasHealer: healerCount > 0,
        hasAllRoles: tankCount > 0 && dpsCount > 0 && healerCount > 0
    };
}

// ============== CALCULATE CLEAR TIME ==============

/**
 * Tính thời gian clear dungeon
 */
function calculateClearTime(dungeonType, members, aiCount = 0) {
    const dungeon = DUNGEON_TYPES[dungeonType];
    if (!dungeon) return null;

    const totalMembers = members.length + aiCount;

    // Tính tổng mastery (AI = 350 mastery mỗi con)
    let totalMastery = members.reduce((sum, m) => sum + (m.mastery || 0), 0);
    totalMastery += aiCount * 350;

    // Tính các factors
    const partyFactor = PARTY_FACTORS[totalMembers] || getPartyFactor(totalMembers);
    const masteryFactor = getMasteryFactor(totalMastery, totalMembers);
    const roleResult = getRoleFactor(members);

    // Final time
    const finalTime = Math.ceil(dungeon.baseTime * partyFactor * masteryFactor * roleResult.factor);

    return {
        baseTime: dungeon.baseTime,
        finalTime,
        partyFactor,
        masteryFactor,
        roleFactor: roleResult.factor,
        roleDetails: roleResult,
        totalMastery,
        avgMastery: totalMastery / totalMembers
    };
}

// ============== EVENT SYSTEM ==============

const EVENT_TRIGGER_CHANCE = 0.15; // 15%

const THIEU_HEAL_MESSAGES = [
    "💀 Ối! Không có ai heal, cả team ngủm hết rồi! Reset nào~ 🔄",
    "🩹 Team ơi, máu đâu máu đâu?! À quên, không có healer... WIPE! 💀",
    "⚰️ RIP team. Lần sau nhớ rủ healer đi nha! Reset thôi~ 🔄",
    "😵 'Tự heal đi' - câu nói cuối cùng trước khi team bay màu! 💨",
    "🪦 Không healer = Không máu = Không sống. Đơn giản vậy thôi! Reset~ 🔄"
];

const THIEU_TANK_MESSAGES = [
    "💥 Boss vả thẳng mặt DPS! Không tank thì chịu thôi~ Reset! 🔄",
    "🎯 Boss: 'DPS ngon quá, để tui one-shot cho!' WIPE! 💀",
    "🏃 Ai tank?! Không ai tank?! Chạy!! ...Không kịp rồi. Reset~ 🔄",
    "⚔️ DPS cứ tưởng mình là tank, kết quả: Team tạch! 🪦",
    "🤕 'Tank à? Mình tưởng heal tank được mà!' - Famous last words 💀"
];

/**
 * Check và tạo event ThieuHeal/ThieuTank
 * @returns {Object|null} Event info nếu có, null nếu không
 */
function checkForEvent(roles, clearTimeMinutes) {
    const events = [];

    // Check ThieuHeal
    if (!roles.hasHealer && Math.random() < EVENT_TRIGGER_CHANCE) {
        events.push({
            type: 'ThieuHeal',
            message: THIEU_HEAL_MESSAGES[Math.floor(Math.random() * THIEU_HEAL_MESSAGES.length)],
            triggerAt: getRandomTriggerTime(clearTimeMinutes)
        });
    }

    // Check ThieuTank
    if (!roles.hasTank && Math.random() < EVENT_TRIGGER_CHANCE) {
        events.push({
            type: 'ThieuTank',
            message: THIEU_TANK_MESSAGES[Math.floor(Math.random() * THIEU_TANK_MESSAGES.length)],
            triggerAt: getRandomTriggerTime(clearTimeMinutes)
        });
    }

    // Return event xảy ra sớm nhất
    if (events.length === 0) return null;
    return events.sort((a, b) => a.triggerAt - b.triggerAt)[0];
}

/**
 * Random thời điểm trigger event (10% - 90% thời gian clear)
 */
function getRandomTriggerTime(clearTimeMinutes) {
    const minPercent = 0.1;
    const maxPercent = 0.9;
    const percent = minPercent + Math.random() * (maxPercent - minPercent);
    return Math.floor(clearTimeMinutes * percent);
}

// ============== REWARD CALCULATION ==============

/**
 * Roll bonus box (exclusive - chỉ 1 loại)
 */
function rollBonusBoxes() {
    const rand = Math.random();

    // Roll order: +3 → +2 → +1
    if (rand < 0.05) return 3;
    if (rand < 0.05 + 0.08) return 2;
    if (rand < 0.05 + 0.08 + 0.10) return 1;
    return 0;
}

/**
 * Tính phần thưởng dungeon
 */
function calculateRewards(dungeonType, multiplier = 1, hasAI = false, rollsCount = 1) {
    const baseReward = REWARDS[dungeonType];
    if (!baseReward) return null;

    // Boss 10 dùng system riêng
    if (dungeonType === 'boss10') {
        return null; // Dùng calculateBossPhaseReward thay thế
    }

    let boxes = baseReward.boxes * multiplier;
    let hat = baseReward.hat * multiplier;
    let thachAm = 0;
    let bonusBoxes = 0;

    // AI penalty
    if (hasAI) {
        boxes = Math.floor(boxes * AI_BOX_PENALTY);
    }

    // Thạch Âm
    if (baseReward.thachAmGuaranteed) {
        thachAm = baseReward.thachAmGuaranteed * multiplier;
    } else if (baseReward.thachAmChance) {
        for (let i = 0; i < multiplier; i++) {
            if (Math.random() < baseReward.thachAmChance) thachAm++;
        }
    }

    // Bonus boxes (roll cho mỗi 20 nhựa với coop)
    for (let i = 0; i < rollsCount; i++) {
        bonusBoxes += rollBonusBoxes();
    }

    // Roll rare drops (per multiplier)
    const rareDropsResult = {};
    if (baseReward.rareDrops) {
        for (const [itemKey, chance] of Object.entries(baseReward.rareDrops)) {
            let count = 0;
            for (let i = 0; i < multiplier; i++) {
                if (Math.random() < chance) count++;
            }
            if (count > 0) rareDropsResult[itemKey] = count;
        }
    }

    return {
        boxes: boxes + bonusBoxes,
        baseBoxes: boxes,
        bonusBoxes,
        hat,
        thachAm,
        hasAI,
        rareDrops: rareDropsResult
    };
}

/**
 * Tính phần thưởng cho từng phase của Boss 10
 * @param {number} phase - 1 hoặc 2
 * @param {boolean} hasAI - Có AI trong team không
 */
function calculateBossPhaseReward(phase, hasAI = false) {
    const bossReward = REWARDS.boss10;
    if (!bossReward || !bossReward.phases[phase]) return null;

    const phaseReward = bossReward.phases[phase];

    let boxes = phaseReward.boxes;
    let hat = phaseReward.hat;
    let thachAm = phaseReward.thachAm;
    let bonusBoxes = 0;

    // AI penalty
    if (hasAI) {
        boxes = Math.floor(boxes * AI_BOX_PENALTY);
    }

    // Roll bonus boxes (20% chance for 10-20 boxes)
    if (Math.random() < phaseReward.bonusBoxChance) {
        const [min, max] = phaseReward.bonusBoxRange;
        bonusBoxes = min + Math.floor(Math.random() * (max - min + 1));
    }

    // Roll rare drops for boss
    const rareDropsResult = {};
    if (phaseReward.rareDrops) {
        for (const [itemKey, dropInfo] of Object.entries(phaseReward.rareDrops)) {
            if (Math.random() < dropInfo.chance) {
                let count = 1;
                if (Array.isArray(dropInfo.amount)) {
                    const [min, max] = dropInfo.amount;
                    count = min + Math.floor(Math.random() * (max - min + 1));
                } else {
                    count = dropInfo.amount;
                }
                rareDropsResult[itemKey] = count;
            }
        }
    }

    return {
        phase,
        boxes: boxes + bonusBoxes,
        baseBoxes: boxes,
        bonusBoxes,
        hat,
        thachAm,
        hasAI,
        rareDrops: rareDropsResult
    };
}

// ============== MASTERY CALCULATION ==============

/**
 * Tính mastery từ equipment đang mặc
 */
function calculateMasteryFromEquipment(equippedItems, playerClass) {
    let totalMastery = 0;

    for (const item of equippedItems) {
        // Base mastery từ tier
        let itemMastery = item.tier * 100;

        // Bonus từ rarity
        if (item.rarity === 'gold') itemMastery *= 1.5;
        else if (item.rarity === 'purple') itemMastery *= 1.0;

        // Bonus từ lines
        const lines = item.lines || [];
        itemMastery += lines.length * 50;

        // Bonus từ final line (dòng đặc biệt)
        if (item.final_line) {
            itemMastery += 100;
            // Bonus thêm nếu đúng phái
            if (item.final_line.exclusive === playerClass) {
                itemMastery *= 1.3;
            }
        }

        totalMastery += Math.floor(itemMastery);
    }

    return Math.min(MAX_MASTERY_PER_PERSON, totalMastery);
}

// ============== EXPORTS ==============

module.exports = {
    // Constants
    DUNGEON_TYPES,
    REWARDS,
    AI_BOX_PENALTY,
    MAX_MASTERY_PER_PERSON,
    EVENT_TRIGGER_CHANCE,
    PARTY_FACTORS,

    // Messages
    THIEU_HEAL_MESSAGES,
    THIEU_TANK_MESSAGES,

    // Functions
    getPartyFactor,
    getMasteryFactor,
    getRoleFactor,
    analyzeRoles,
    calculateClearTime,
    checkForEvent,
    rollBonusBoxes,
    calculateRewards,
    calculateBossPhaseReward,
    calculateMasteryFromEquipment
};


