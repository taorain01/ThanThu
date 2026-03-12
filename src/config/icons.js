/**
 * Icons Configuration
 * File config tập trung cho tất cả icons/emojis sử dụng trong bot
 * 
 * HOW TO USE:
 * 1. Import module: const ICONS = require('./config/icons');
 * 2. Sử dụng: ICONS.currency.hat, ICONS.classes.dps, etc.
 * 
 * HOW TO CHANGE ICONS:
 * Chỉ cần sửa emoji trong file này, tất cả nơi sử dụng sẽ tự động thay đổi!
 */

module.exports = {
    // ============== CURRENCY & RESOURCES ==============
    currency: {
        hat: '🌾',              // Hạt - Tiền tệ chính
        dat1: '💎',             // Đá Cường Hóa T1
        thacham: '🔮',          // Thạch Âm
        nhua: '💧',             // Nhựa (Thể lực)
    },

    // ============== CLASSES (PHÁI) ==============
    classes: {
        dps: '⚔️',              // DPS
        tanker: '🛡️',           // Tanker
        healer: '💚',           // Healer
    },

    // ============== STATS ==============
    stats: {
        // DPS Stats
        min_attack: '⚔️',       // Tấn Công Tối Thiểu
        max_attack: '🗡️',       // Tấn Công Tối Đa
        critical_rate: '💥',    // Tỉ Lệ Bạo Kích
        critical_damage: '💢', // Sát Thương Bạo Kích
        penetration: '🎯',      // Xuyên Giáp

        // Tanker Stats
        max_hp: '❤️',           // Máu Tối Đa
        defense: '🛡️',          // Phòng Thủ
        evasion: '💨',          // Né Tránh
        damage_reduction: '🔰', // Giảm Sát Thương
        agility: '🏃',          // Nhanh Nhẹn

        // Healer Stats
        momentum: '💫',         // Động Lực
        affinity_rate: '✨',    // Tỉ Lệ Ái Lực

        // New Stats
        the: '⚡',              // Thế
        the_luc: '💪',          // Thể
        ngu: '🔮',              // Ngự
        man: '🦅',              // Mẫn
        luc: '💎',              // Lực
        cooldown: '⏱️',         // Giảm Hồi Chiêu
    },

    // ============== SPECIAL LINES ==============
    special: {
        tank_endurance: '🛡️',  // Chịu Đựng (Tanker)
        dps_assault: '⚔️',      // Tấn Công (DPS)
        healer_restore: '💚',   // Hồi Phục (Healer)
        universal_weapon: '⭐', // Tăng % Vũ Khí (Universal)
    },

    // ============== EQUIPMENT SLOTS (Unicode - Dùng mọi nơi) ==============
    slots: {
        mu: '🎩',               // Mũ
        giap: '🛡️',             // Giáp
        gang: '🧤',             // Găng
        giay: '👟',             // Giày
        vukhi: '⚔️',            // Vũ Khí Chính
        vukhiphu: '🗡️',         // Vũ Khí Phụ
        ngocboi: '💎',          // Ngọc Bội
        khuyentai: '💍',        // Khuyên Tai
    },

    // ============== EQUIPMENT SLOTS - GOLD (Custom Emotes) ==============
    // Dùng trong Embed description/fields - KHÔNG dùng trong footer/select menu
    slotsGold: {
        mu: '<:gear_gold_helmet:EMOTE_ID>',
        giap: '<:gear_gold_armor:EMOTE_ID>',
        gang: '<:gear_gold_gloves:EMOTE_ID>',
        giay: '<:gear_gold_boots:EMOTE_ID>',
        vukhi: '<:gear_gold_sword:EMOTE_ID>',
        vukhiphu: '<:gear_gold_dagger:EMOTE_ID>',
        ngocboi: '<:gear_gold_amulet:EMOTE_ID>',
        khuyentai: '<:gear_gold_earring:EMOTE_ID>',
    },

    // ============== EQUIPMENT SLOTS - PURPLE (Custom Emotes) ==============
    // Dùng trong Embed description/fields - KHÔNG dùng trong footer/select menu
    slotsPurple: {
        mu: '<:gear_purple_helmet:EMOTE_ID>',
        giap: '<:gear_purple_armor:EMOTE_ID>',
        gang: '<:gear_purple_gloves:EMOTE_ID>',
        giay: '<:gear_purple_boots:EMOTE_ID>',
        vukhi: '<:gear_purple_sword:EMOTE_ID>',
        vukhiphu: '<:gear_purple_dagger:EMOTE_ID>',
        ngocboi: '<:gear_purple_amulet:EMOTE_ID>',
        khuyentai: '<:gear_purple_earring:EMOTE_ID>',
    },

    // ============== ITEMS ==============
    items: {
        box: '📦',              // Box T1
        nhuacung: '💊',         // Nhựa Cứng
        tinhthevang: '💠',      // Tinh Thể Vàng
        thachamvang: '🔷',      // Thạch Âm Vàng
        lcp: '🔥',              // Lửa Cầu Phúc
        lcpcl: '🔥',            // Lửa Cầu Phúc Cỡ Lớn
        daden: '🌑',            // Đá Đen
        buakhacyeu: '📜',       // Bùa Khắc Yêu
    },

    // ============== DUNGEONS ==============
    dungeons: {
        solo: '🗡️',             // Solo Dungeon
        coop: '👥',             // Coop Dungeon (5 người)
        boss: '👑',             // Boss Dungeon (10 người)
    },

    // ============== RARITY EMOTES (Custom Discord Emotes) ==============
    // LƯU Ý: Đây là custom emotes của Discord server, cần tạo emotes trước
    rarity: {
        purple: '<:dongtim:1459643794226937938>',           // Dòng Tím
        gold: '<:dongvang:1459647061124317345>',            // Dòng Vàng
        purpleNew: '<:dongtimboclua:1459645111674736670>',  // Dòng Tím Bốc Lửa (mới tune)
        goldNew: '<:dongvangboclua:1459647184981983427>',       // Dòng Vàng Bốc Lửa (mới tune)
        starDecu: '<:saovangdecu2:1460381022456910110>',    // Sao Đề Cử (recommended stat)
    },

    // ============== UI ELEMENTS ==============
    ui: {
        success: '✅',          // Thành công
        error: '❌',            // Lỗi
        warning: '⚠️',          // Cảnh báo
        info: '💡',             // Thông tin
        loading: '⏳',          // Đang tải
        star: '⭐',             // Sao
        fire: '🔥',             // Lửa
        party: '🎉',            // Ăn mừng
        lock: '🔒',             // Khóa
        unlock: '🔓',           // Mở khóa
        bolt: '⚡',             // Tia chớp
        crown: '👑',            // Vương miện
        target: '🎯',           // Mục tiêu
    },

    // ============== BOSS & GUILD ==============
    boss: {
        boss: '👑',             // Boss icon
        calendar: '📅',         // Lịch
        timer: '⏰',             // Đồng hồ
        members: '👥',          // Thành viên
    },

    // ============== QUEST & REWARDS ==============
    quest: {
        quest: '📋',            // Quest
        daily: '📆',            // Daily
        weekly: '📅',           // Weekly
        reward: '🎁',           // Phần thưởng
        progress: '📊',         // Tiến độ
    },
};
