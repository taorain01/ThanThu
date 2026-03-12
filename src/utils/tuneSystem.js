/**
 * Tune System Module
 * Quản lý roll dòng và tính điểm Mastery
 */

const { STAT_TYPES, SPECIAL_LINES, SLOT_STATS, isDeCu, getRandomStatForSlot, getRandomEquipmentName } = require('./classSystem');

// ============== CONSTANTS ==============

// Chi phí tune theo dòng (Đá T1)
const TUNE_COSTS = {
    2: 3,
    3: 5,
    4: 7,
    5: 9
};

// Tỉ lệ drop dòng
const LINE_DROP_RATES = {
    normal: 0.725,      // 72.5% stat thường
    special: 0.175,     // 17.5% dòng đặc biệt phái
    universal: 0.10     // 10% Tăng % Vũ Khí
};

// ============== ROLL FUNCTIONS ==============

/**
 * Roll % ngẫu nhiên (60-100)
 * @param {boolean} forceGold - Force rarity = gold (từ buff)
 * @returns {{ percent: number, rarity: string }}
 */
function rollPercent(forceGold = false) {
    // Roll từ 60 đến 100
    const percent = Math.floor(Math.random() * 41) + 60;

    // Nếu forceGold -> luôn là gold với percent 90-100
    if (forceGold) {
        const goldPercent = Math.floor(Math.random() * 11) + 90; // 90-100
        return { percent: goldPercent, rarity: 'gold' };
    }

    // 60-89 = Tím (75%), 90-100 = Vàng (25%)
    const rarity = percent >= 90 ? 'gold' : 'purple';

    return { percent, rarity };
}

/**
 * Roll loại dòng (normal/special/universal)
 */
function rollLineType() {
    const roll = Math.random();

    if (roll < LINE_DROP_RATES.normal) {
        return 'normal';
    } else if (roll < LINE_DROP_RATES.normal + LINE_DROP_RATES.special) {
        return 'special';
    } else {
        return 'universal';
    }
}

/**
 * Roll dòng đặc biệt ngẫu nhiên (1 trong 3 phái)
 */
function rollSpecialLine() {
    const specialTypes = ['tank_endurance', 'dps_assault', 'healer_restore'];
    return specialTypes[Math.floor(Math.random() * specialTypes.length)];
}

/**
 * Roll một dòng mới cho equipment
 * @param {string} slot - Slot equipment
 * @param {boolean} forceGold - Force rarity = gold (từ buff)
 * @returns {Object} Line object
 */
function rollLine(slot, forceGold = false) {
    const lineType = rollLineType();
    const { percent, rarity } = rollPercent(forceGold);

    let line = {
        percent,
        rarity,
        type: lineType
    };

    if (lineType === 'normal') {
        // Dòng stat thường
        const statType = getRandomStatForSlot(slot);
        const stat = STAT_TYPES[statType];
        const [min, max] = stat.range;
        const value = min + (max - min) * (percent / 100);

        line = {
            ...line,
            stat: statType,
            name: stat.name,
            value: Math.round(value * 10) / 10,
            unit: stat.unit || '',
            icon: stat.icon
        };
    } else if (lineType === 'special') {
        // Dòng đặc biệt phái - tính value cụ thể
        const specialType = rollSpecialLine();
        const special = SPECIAL_LINES[specialType];

        // Tính giá trị cụ thể dựa trên percent
        let value = 0;
        if (specialType === 'tank_endurance') {
            // HP +5%, Defense +3% → tính từ base range
            const hpBonus = (50 + 150 * (percent / 100)) * 0.05; // 5% of HP range
            const defBonus = (3 + 9 * (percent / 100)) * 0.03; // 3% of Defense range
            value = Math.round(hpBonus + defBonus * 10); // Combine values
        } else if (specialType === 'dps_assault') {
            // Attack +5%, Critical +2%
            const atkBonus = (8 + 12 * (percent / 100)) * 0.05;
            const critBonus = (1 + 4 * (percent / 100)) * 0.02;
            value = Math.round((atkBonus + critBonus * 10) * 10) / 10;
        } else if (specialType === 'healer_restore') {
            // Heal +10%, Affinity +2%
            const healBonus = (8 + 12 * (percent / 100)) * 0.1;
            const affinityBonus = (1 + 3 * (percent / 100)) * 0.02;
            value = Math.round((healBonus + affinityBonus * 10) * 10) / 10;
        }

        line = {
            ...line,
            stat: specialType,
            name: special.name,
            value: value,
            icon: special.icon,
            effect: special.effect,
            isSpecial: true
        };
    } else {
        // Dòng universal (Tăng % Vũ Khí) - tính value cụ thể
        const special = SPECIAL_LINES.universal_weapon;

        // 3% weapon attack → tính từ attack range
        const weaponBonus = (8 + 12 * (percent / 100)) * 0.03;
        const value = Math.round(weaponBonus * 10) / 10;

        line = {
            ...line,
            stat: 'universal_weapon',
            name: special.name,
            value: value,
            unit: '',
            icon: special.icon,
            effect: special.effect,
            isUniversal: true
        };
    }

    return line;
}

/**
 * Tạo equipment mới từ box
 * @param {string} slot - Slot equipment (random nếu null)
 * @param {boolean} forceGold - Force rarity = gold (cho pity system)
 * @param {string} userId - Discord user ID to check blessing fire status
 * @returns {Object} Equipment data
 */
function createEquipmentFromBox(slot = null, forceGold = false, userId = null) {
    // Random slot nếu không chỉ định
    if (!slot) {
        const slots = Object.keys(SLOT_STATS);
        slot = slots[Math.floor(Math.random() * slots.length)];
    }

    // Roll dòng đầu tiên
    const firstLine = rollLine(slot);

    // Xác định rarity equipment
    // Base: 97% Tím, 3% Vàng
    // Blessing Fire: +100% (LCP) hoặc +200% (LCPCL) vào tỉ lệ vàng
    let goldChance = 0.03; // Base 3%

    if (userId) {
        try {
            const economy = require('../database/economy');
            const blessingStatus = economy.getBlessingFireStatus(userId);
            if (blessingStatus.active) {
                // LCP: +100% => goldChance = 0.03 * 2 = 0.06 (6%)
                // LCPCL: +200% => goldChance = 0.03 * 3 = 0.09 (9%)
                const multiplier = 1 + (blessingStatus.bonusPercent / 100);
                goldChance = goldChance * multiplier;
            }
        } catch (e) {
            // Ignore if economy module not available
        }
    }

    // Nếu forceGold (pity hit) -> luôn là gold
    const equipRarity = forceGold ? 'gold' : (Math.random() < (1 - goldChance) ? 'purple' : 'gold');

    return {
        slot,
        name: getRandomEquipmentName(slot),
        tier: 1,
        rarity: equipRarity,
        lines: [firstLine],
        final_line: null
    };
}

// ============== MASTERY CALCULATION ==============

/**
 * Tính điểm mastery cho 1 dòng
 * @param {Object} line - Line object
 * @param {string} playerClass - Phái người chơi
 * @returns {number} Điểm mastery
 */
function calculateLineMastery(line, playerClass) {
    // Base từ percent (60-100) -> scale thành 40-120
    const basePoints = 40 + (line.percent - 60) * 2;

    // Kiểm tra Đề Cử
    const laDeCu = isDeCu(line.stat, playerClass);

    // Kiểm tra Priority Stats (import từ classSystem)
    const { isPriorityStat } = require('./classSystem');
    const laPriority = isPriorityStat(line.stat, playerClass);

    // Hệ số Đề Cử: +50% nếu Đề Cử
    const heSoDeCu = laDeCu ? 1.5 : 1.0;

    // Hệ số màu: Vàng +25%, Tím x1.0
    const heSoMau = line.rarity === 'gold' ? 1.25 : 1.0;

    // Hệ số Priority: +30% nếu là Priority Stats cho phái
    const heSoPriority = laPriority ? 1.3 : 1.0;

    let points = basePoints * heSoMau * heSoDeCu * heSoPriority;

    // Bonus dòng đặc biệt
    if (line.isSpecial) {
        const special = SPECIAL_LINES[line.stat];
        if (special && special.exclusive === playerClass) {
            // Đúng phái: +30%
            points *= 1.3;
        }
    }

    // Dòng Universal: +15% cho tất cả
    if (line.isUniversal) {
        points *= 1.15;
    }

    return Math.floor(points);
}

/**
 * Tính tổng mastery của equipment
 * @param {Object} equipment - Equipment object
 * @param {string} playerClass - Phái người chơi
 * @returns {number} Tổng điểm mastery
 */
function calculateEquipmentMastery(equipment, playerClass) {
    let total = 0;

    // Tính điểm các dòng
    for (const line of equipment.lines) {
        total += calculateLineMastery(line, playerClass);
    }

    // Tính điểm dòng cuối
    if (equipment.final_line) {
        total += calculateLineMastery(equipment.final_line, playerClass);
    }

    return total;
}

/**
 * Tính tổng mastery của tất cả equipment đang mặc
 * @param {Array} equippedItems - Danh sách equipment đang mặc
 * @param {string} playerClass - Phái người chơi
 * @returns {number} Tổng điểm mastery
 */
function calculateTotalMastery(equippedItems, playerClass) {
    let total = 0;

    for (const item of equippedItems) {
        total += calculateEquipmentMastery(item, playerClass);
    }

    return total;
}

// ============== DISPLAY HELPERS ==============

/**
 * Format dòng để hiển thị (dùng custom Discord emotes)
 * @param {Object} line - Line object
 * @param {string} playerClass - Phái người chơi
 * @param {boolean} isNewLine - Dòng mới tune (sẽ dùng emote bốc lửa)
 * @returns {string} Formatted string
 */
function formatLine(line, playerClass, isNewLine = false) {
    // Import ICONS config
    const ICONS = require('../config/icons');

    // Custom emotes from config
    const EMOTES = ICONS.rarity;

    let rarityIcon;
    if (isNewLine) {
        rarityIcon = line.rarity === 'gold' ? EMOTES.goldNew : EMOTES.purpleNew;
    } else {
        rarityIcon = line.rarity === 'gold' ? EMOTES.gold : EMOTES.purple;
    }

    const laDeCu = isDeCu(line.stat, playerClass);
    const deCuTag = laDeCu ? ' `Đề Cử`' : '';

    // Tất cả dòng đều hiển thị value
    const unit = line.unit || '';
    const valueText = line.value ? `+${line.value}${unit}` : '';
    return `${rarityIcon} ${line.icon} ${line.name} ${valueText} (${line.percent}%)${deCuTag}`;
}

/**
 * Lấy chi phí tune dòng
 * @param {number} lineNumber - Số dòng (2-5)
 * @returns {number} Chi phí Đá T1
 */
function getTuneCost(lineNumber) {
    return TUNE_COSTS[lineNumber] || 0;
}

/**
 * Tính tổng chi phí tune batch (nhiều dòng cùng lúc)
 * @param {number} currentLines - Số dòng hiện có
 * @param {number} times - Số lần tune (1, 2, 3, 4)
 * @returns {number} Tổng chi phí Đá T1
 */
function getBatchTuneCost(currentLines, times) {
    let total = 0;
    for (let i = 0; i < times; i++) {
        const lineNum = currentLines + 1 + i; // Dòng tiếp theo
        if (lineNum <= 5) {
            total += getTuneCost(lineNum);
        }
    }
    return total;
}

module.exports = {
    // Constants
    TUNE_COSTS,
    LINE_DROP_RATES,
    // Roll functions
    rollPercent,
    rollLine,
    createEquipmentFromBox,
    // Mastery
    calculateLineMastery,
    calculateEquipmentMastery,
    calculateTotalMastery,
    // Helpers
    formatLine,
    getTuneCost,
    getBatchTuneCost
};


