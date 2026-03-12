/**
 * Class System Module
 * Quản lý phái và hệ thống Đề Cử
 */

const ICONS = require('../config/icons');

// ============== PHÁI ==============

const CLASSES = {
    dps: { name: 'DPS', icon: ICONS.classes.dps, role: 'DPS' },
    tanker: { name: 'Tanker', icon: ICONS.classes.tanker, role: 'Tanker' },
    healer: { name: 'Healer', icon: ICONS.classes.healer, role: 'Healer' }
};

// Priority Stats cho mỗi phái - nhận bonus ×1.3
const PRIORITY_STATS = {
    dps: ['critical_rate', 'critical_damage'],      // Crit Rate + Crit DMG
    tanker: ['max_hp', 'defense'],                   // HP + Defense
    healer: ['cooldown', 'critical_rate']            // Cooldown + Crit Rate
};

/**
 * Kiểm tra stat có phải Priority cho phái không
 */
function isPriorityStat(statType, playerClass) {
    if (!playerClass || !PRIORITY_STATS[playerClass]) return false;
    return PRIORITY_STATS[playerClass].includes(statType);
}

/**
 * Detect player class từ Discord Role
 */
function getPlayerClass(member) {
    if (!member || !member.roles) return null;

    const roles = member.roles.cache;
    if (roles.some(r => r.name === 'DPS')) return 'dps';
    if (roles.some(r => r.name === 'Tanker')) return 'tanker';
    if (roles.some(r => r.name === 'Healer')) return 'healer';

    return null;
}

/**
 * Lấy thông tin phái
 */
function getClassInfo(className) {
    return CLASSES[className] || null;
}

// ============== STATS ==============

const STAT_TYPES = {
    // === DPS Stats ===
    min_attack: {
        name: 'Tấn Công Tối Thiểu',
        range: [5, 15],
        icon: ICONS.stats.min_attack,
        deCu: ['dps']  // DPS only
    },
    max_attack: {
        name: 'Tấn Công Tối Đa',
        range: [8, 20],
        icon: ICONS.stats.max_attack,
        deCu: ['dps']  // DPS only
    },
    critical_rate: {
        name: 'Tỉ Lệ Bạo Kích',
        range: [1, 5],
        unit: '%',
        icon: ICONS.stats.critical_rate,
        deCu: ['dps', 'healer']  // DPS + Healer
    },
    critical_damage: {
        name: 'Sát Thương Bạo Kích',
        range: [3, 10],
        unit: '%',
        icon: ICONS.stats.critical_damage,
        deCu: ['dps']  // DPS only
    },
    penetration: {
        name: 'Xuyên Giáp',
        range: [2, 8],
        icon: ICONS.stats.penetration,
        deCu: ['dps']  // DPS only
    },

    // === Tanker Stats ===
    max_hp: {
        name: 'Máu Tối Đa',
        range: [50, 200],
        icon: ICONS.stats.max_hp,
        deCu: ['tanker', 'healer']  // Tanker + Healer
    },
    defense: {
        name: 'Phòng Thủ',
        range: [3, 12],
        icon: ICONS.stats.defense,
        deCu: ['tanker']  // Tanker only
    },
    evasion: {
        name: 'Né Tránh',
        range: [1, 4],
        icon: ICONS.stats.evasion,
        deCu: ['tanker'],  // Tanker only
        effect: 'Né Tránh (giảm dần theo điểm)'
    },
    damage_reduction: {
        name: 'Giảm Sát Thương',
        range: [1, 5],
        icon: ICONS.stats.damage_reduction,
        deCu: ['tanker', 'healer'],  // Tanker + Healer
        effect: 'Giảm ST nhận (giảm dần theo điểm)'
    },
    agility: {
        name: 'Nhanh Nhẹn',
        range: [2, 8],
        icon: ICONS.stats.agility,
        deCu: ['tanker', 'healer']  // Tanker + Healer
    },

    // === Healer Stats ===
    momentum: {
        name: 'Động Lực',
        range: [2, 8],
        icon: ICONS.stats.momentum,
        deCu: ['healer']  // Healer only
    },
    affinity_rate: {
        name: 'Tỉ Lệ Ái Lực',
        range: [1, 4],
        unit: '%',
        icon: ICONS.stats.affinity_rate,
        deCu: ['healer']  // Healer only
    },

    // === NEW STATS (6 mới) ===
    the: {
        name: 'Thế',
        range: [2, 6],
        icon: ICONS.stats.the,
        deCu: ['dps', 'healer'],  // DPS + Healer
        effect: 'Crit Rate + Crit DMG (giảm dần theo điểm)'
    },
    the_luc: {
        name: 'Thể',
        range: [3, 10],
        icon: ICONS.stats.the_luc,
        deCu: ['tanker'],  // Tanker only
        effect: 'HP + Phòng Thủ (giảm dần theo điểm)'
    },
    ngu: {
        name: 'Ngự',
        range: [2, 6],
        icon: ICONS.stats.ngu,
        deCu: ['tanker'],  // Tanker only
        effect: 'Giảm ST + Né Tránh (giảm dần theo điểm)'
    },
    man: {
        name: 'Mẫn',
        range: [2, 5],
        icon: ICONS.stats.man,
        deCu: ['dps'],  // DPS only
        effect: 'Tốc Độ + Xuyên Giáp (giảm dần theo điểm)'
    },
    luc: {
        name: 'Lực',
        range: [3, 10],
        icon: ICONS.stats.luc,
        deCu: [],  // Universal - không đề cử riêng
        effect: 'Tấn Công + HP (giảm dần theo điểm)'
    },
    cooldown: {
        name: 'Giảm Hồi Chiêu',
        range: [1, 4],
        unit: '%',
        icon: ICONS.stats.cooldown,
        deCu: ['healer']  // Healer only
    }
};

// ============== DÒNG ĐẶC BIỆT ==============

const SPECIAL_LINES = {
    tank_endurance: {
        name: 'Chịu Đựng',
        icon: ICONS.special.tank_endurance,
        exclusive: 'tanker',
        effect: 'HP +5%, Phòng Thủ +3%',
        bonusPercent: 30 // +30% mastery nếu đúng phái
    },
    dps_assault: {
        name: 'Tấn Công',
        icon: ICONS.special.dps_assault,
        exclusive: 'dps',
        effect: 'Attack +5%, Bạo Kích +2%',
        bonusPercent: 30
    },
    healer_restore: {
        name: 'Hồi Phục',
        icon: ICONS.special.healer_restore,
        exclusive: 'healer',
        effect: 'Heal +10%, Ái Lực +2%',
        bonusPercent: 30
    },
    universal_weapon: {
        name: 'Tăng % Vũ Khí',
        icon: ICONS.special.universal_weapon,
        exclusive: null, // Đề Cử cho tất cả
        effect: 'Tấn Công Vũ Khí +3%',
        bonusPercent: 15 // +15% mastery (yếu hơn dòng phái)
    }
};

// ============== SLOT EQUIPMENT ==============

const SLOTS = {
    mu: { name: 'Mũ', shortName: 'Mũ', icon: ICONS.slots.mu },
    giap: { name: 'Giáp', shortName: 'Giáp', icon: ICONS.slots.giap },
    gang: { name: 'Găng', shortName: 'Găng', icon: ICONS.slots.gang },
    giay: { name: 'Giày', shortName: 'Giày', icon: ICONS.slots.giay },
    vukhi: { name: 'Vũ Khí', shortName: 'Vũ Khí', icon: ICONS.slots.vukhi },
    vukhiphu: { name: 'Vũ Khí Phụ', shortName: 'VK Phụ', icon: ICONS.slots.vukhiphu },
    ngocboi: { name: 'Ngọc Bội', shortName: 'Ngọc', icon: ICONS.slots.ngocboi },
    khuyentai: { name: 'Khuyên Tai', shortName: 'Khuyên', icon: ICONS.slots.khuyentai }
};

// Backward compatibility: alias 'ao' → 'mu' cho equipment cũ trong database
SLOTS.ao = SLOTS.mu;

// Tên equipment theo slot
const EQUIPMENT_NAMES = {
    mu: ['Mũ Chiến Thần', 'Mũ Long Hổ', 'Mũ Thiên Sơn', 'Mũ Huyền Thiên'],
    giap: ['Hộ Tâm Giáp', 'Giáp Bình Minh', 'Kim Chung Giáp', 'Huyền Thiết Giáp'],
    gang: ['Thiết Thủ Quyền', 'Hỏa Diệm Quyền', 'Băng Giá Quyền', 'Phong Vân Thủ'],
    giay: ['Thảo Nguyên Hài', 'Phong Thần Hài', 'Vân Du Hài', 'Thiên Lý Hài'],
    vukhi: ['Trảm Long Kiếm', 'Phong Vân Đao', 'Thiên Mệnh Kiếm', 'Vô Danh Kiếm'],
    vukhiphu: ['Song Thiết Kiếm', 'Hắc Diện Phiến', 'Ngọc Tiêu', 'Phi Tiêu Ám Khí'],
    ngocboi: ['Ngọc Bích Cổ', 'Ngọc Tỷ Bà', 'Hồ Ly Ngọc', 'Thiên Long Ngọc'],
    khuyentai: ['Nhĩ Hoàn Minh Nguyệt', 'Kim Long Nhĩ', 'Thủy Tinh Hoàn', 'Bạch Ngọc Nhĩ']
};

// Stats có thể ra theo slot
const SLOT_STATS = {
    mu: ['max_hp', 'defense', 'evasion', 'damage_reduction', 'agility'],
    giap: ['defense', 'max_hp', 'damage_reduction', 'evasion', 'momentum'],
    gang: ['min_attack', 'max_attack', 'critical_rate', 'agility', 'penetration'],
    giay: ['agility', 'evasion', 'momentum', 'max_hp', 'damage_reduction'],
    vukhi: ['max_attack', 'min_attack', 'critical_damage', 'penetration', 'critical_rate'],
    vukhiphu: ['min_attack', 'penetration', 'critical_rate', 'affinity_rate', 'agility'],
    ngocboi: ['max_hp', 'defense', 'max_attack', 'affinity_rate', 'momentum', 'agility'],
    khuyentai: ['affinity_rate', 'momentum', 'critical_rate', 'agility', 'max_hp']
};

// Backward compatibility: alias 'ao' → 'mu' cho equipment cũ
SLOT_STATS.ao = SLOT_STATS.mu;

// ============== ĐỀ CỬ CHECK ==============

/**
 * Kiểm tra stat có phải Đề Cử cho phái không
 */
function isDeCu(statType, playerClass) {
    if (!playerClass) return false;

    // Dòng stat thường
    const stat = STAT_TYPES[statType];
    if (stat && stat.deCu) {
        return stat.deCu.includes(playerClass);
    }

    // Dòng đặc biệt
    const special = SPECIAL_LINES[statType];
    if (special) {
        // Universal = Đề Cử cho tất cả
        if (special.exclusive === null) return true;
        // Dòng phái = chỉ Đề Cử cho phái đó
        return special.exclusive === playerClass;
    }

    return false;
}

/**
 * Lấy random tên equipment theo slot
 */
function getRandomEquipmentName(slot) {
    const names = EQUIPMENT_NAMES[slot];
    if (!names || names.length === 0) return 'Trang Bị';
    return names[Math.floor(Math.random() * names.length)];
}

/**
 * Lấy random stat cho slot
 */
function getRandomStatForSlot(slot) {
    const stats = SLOT_STATS[slot];
    if (!stats || stats.length === 0) return 'max_hp';
    return stats[Math.floor(Math.random() * stats.length)];
}

module.exports = {
    // Classes
    CLASSES,
    getPlayerClass,
    getClassInfo,
    // Stats
    STAT_TYPES,
    SPECIAL_LINES,
    PRIORITY_STATS,
    // Slots
    SLOTS,
    EQUIPMENT_NAMES,
    SLOT_STATS,
    // Helpers
    isDeCu,
    isPriorityStat,
    getRandomEquipmentName,
    getRandomStatForSlot
};


