/**
 * Economy & Equipment Database Module
 * Quản lý tiền tệ (Hạt, Đá T1, Thạch Âm) và trang bị
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Database file path
const DB_PATH = path.join(__dirname, '../../data/economy.db');

// Tự động tạo thư mục data nếu chưa tồn tại
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('📁 Created data directory:', dataDir);
}

// Initialize database
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ============== VIETNAM TIMEZONE UTILITIES ==============
const VIETNAM_OFFSET_HOURS = 7; // GMT+7

/**
 * Lấy thời gian hiện tại theo múi giờ Việt Nam (GMT+7)
 * @returns {Date} Date object đã điều chỉnh theo Vietnam time
 */
function getVietnamNow() {
    const now = new Date();
    // Chuyển về UTC rồi cộng 7 giờ
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (VIETNAM_OFFSET_HOURS * 3600000));
}

/**
 * Lấy ngày hiện tại (chỉ ngày, không giờ) theo múi giờ Việt Nam
 * @returns {Date} Date object chỉ có ngày (00:00:00)
 */
function getVietnamToday() {
    const vnNow = getVietnamNow();
    return new Date(vnNow.getFullYear(), vnNow.getMonth(), vnNow.getDate());
}

/**
 * Chuyển một Date sang Date theo múi giờ Việt Nam
 * @param {Date} date 
 * @returns {Date}
 */
function toVietnamTime(date) {
    if (!date) return null;
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    return new Date(utc + (VIETNAM_OFFSET_HOURS * 3600000));
}


/**
 * Initialize database schema
 */
function initializeDatabase() {
    // Bảng economy: Tiền tệ người chơi
    db.prepare(`
        CREATE TABLE IF NOT EXISTS economy (
            discord_id TEXT PRIMARY KEY,
            hat INTEGER DEFAULT 0,
            enhancement_stone_t1 INTEGER DEFAULT 0,
            thach_am INTEGER DEFAULT 0,
            nhua INTEGER DEFAULT 500,
            nhua_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            boss_last_claim DATETIME,
            daily_claimed_at DATETIME,
            weekly_claimed_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Bảng equipment: Trang bị
    db.prepare(`
        CREATE TABLE IF NOT EXISTS equipment (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_id TEXT NOT NULL,
            slot TEXT NOT NULL,
            name TEXT NOT NULL,
            tier INTEGER DEFAULT 1,
            rarity TEXT DEFAULT 'purple',
            lines TEXT DEFAULT '[]',
            final_line TEXT,
            is_equipped INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Bảng transactions: Lịch sử giao dịch
    db.prepare(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_id TEXT NOT NULL,
            type TEXT NOT NULL,
            description TEXT,
            amount INTEGER,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Bảng dungeon_sessions: Phiên dungeon đang chạy
    db.prepare(`
        CREATE TABLE IF NOT EXISTS dungeon_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            leader_id TEXT NOT NULL,
            dungeon_type TEXT NOT NULL,
            members TEXT DEFAULT '[]',
            ai_count INTEGER DEFAULT 0,
            started_at DATETIME,
            ends_at DATETIME,
            event_trigger_at DATETIME,
            event_type TEXT,
            event_triggered INTEGER DEFAULT 0,
            phase1_claimed INTEGER DEFAULT 0,
            phase2_claimed INTEGER DEFAULT 0,
            status TEXT DEFAULT 'waiting',
            multiplier INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Thêm columns mới nếu chưa có (migration cho database cũ)
    try {
        db.prepare('ALTER TABLE dungeon_sessions ADD COLUMN phase1_claimed INTEGER DEFAULT 0').run();
    } catch (e) { /* Column already exists */ }
    try {
        db.prepare('ALTER TABLE dungeon_sessions ADD COLUMN phase2_claimed INTEGER DEFAULT 0').run();
    } catch (e) { /* Column already exists */ }

    // Index để tăng tốc query
    try {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_equipment_discord ON equipment(discord_id)').run();
        db.prepare('CREATE INDEX IF NOT EXISTS idx_equipment_equipped ON equipment(is_equipped)').run();
        db.prepare('CREATE INDEX IF NOT EXISTS idx_dungeon_leader ON dungeon_sessions(leader_id)').run();
        db.prepare('CREATE INDEX IF NOT EXISTS idx_dungeon_status ON dungeon_sessions(status)').run();
    } catch (e) {
        // Index đã tồn tại
    }

    // Migrate: Thêm cột nhua nếu chưa có (mỗi cột riêng lẻ)
    try {
        db.prepare('ALTER TABLE economy ADD COLUMN nhua INTEGER DEFAULT 500').run();
        console.log('✅ Added nhua column');
    } catch (e) { /* Column exists */ }

    try {
        db.prepare('ALTER TABLE economy ADD COLUMN nhua_updated_at DATETIME').run();
        console.log('✅ Added nhua_updated_at column');
    } catch (e) { /* Column exists */ }

    try {
        db.prepare('ALTER TABLE economy ADD COLUMN boss_last_claim DATETIME').run();
        console.log('✅ Added boss_last_claim column');
    } catch (e) { /* Column exists */ }

    try {
        db.prepare('ALTER TABLE economy ADD COLUMN boxes_t1 INTEGER DEFAULT 0').run();
        console.log('✅ Added boxes_t1 column');
    } catch (e) { /* Column exists */ }

    try {
        db.prepare('ALTER TABLE equipment ADD COLUMN is_locked INTEGER DEFAULT 0').run();
        console.log('✅ Added is_locked column to equipment');
    } catch (e) { /* Column exists */ }

    try {
        db.prepare('ALTER TABLE economy ADD COLUMN active_title TEXT DEFAULT NULL').run();
        console.log('✅ Added active_title column');
    } catch (e) { /* Column exists */ }

    // New items: Nhựa Cứng, Đá T1 Khắc Ấn, Thạch Âm Khắc Ấn
    try {
        db.prepare('ALTER TABLE economy ADD COLUMN nhua_cung INTEGER DEFAULT 0').run();
        console.log('✅ Added nhua_cung column');
    } catch (e) { /* Column exists */ }

    try {
        db.prepare('ALTER TABLE economy ADD COLUMN da_t1_khac_an INTEGER DEFAULT 0').run();
        console.log('✅ Added da_t1_khac_an column');
    } catch (e) { /* Column exists */ }

    try {
        db.prepare('ALTER TABLE economy ADD COLUMN thach_am_khac_an INTEGER DEFAULT 0').run();
        console.log('✅ Added thach_am_khac_an column');
    } catch (e) { /* Column exists */ }

    // Pity counter cho box (100 box = guarantee gold)
    try {
        db.prepare('ALTER TABLE economy ADD COLUMN box_pity_counter INTEGER DEFAULT 0').run();
        console.log('✅ Added box_pity_counter column');
    } catch (e) { /* Column exists */ }

    // Inventory slots system
    try {
        db.prepare('ALTER TABLE economy ADD COLUMN inv_slots INTEGER DEFAULT 500').run();
        console.log('✅ Added inv_slots column');
    } catch (e) { /* Column exists */ }

    try {
        db.prepare('ALTER TABLE economy ADD COLUMN slot_purchase_count INTEGER DEFAULT 0').run();
        console.log('✅ Added slot_purchase_count column');
    } catch (e) { /* Column exists */ }

    // Buff flags for tune guarantees
    try {
        db.prepare('ALTER TABLE economy ADD COLUMN tune_gold_buff INTEGER DEFAULT 0').run();
        console.log('✅ Added tune_gold_buff column');
    } catch (e) { /* Column exists */ }

    try {
        db.prepare('ALTER TABLE economy ADD COLUMN final_line_gold_buff INTEGER DEFAULT 0').run();
        console.log('✅ Added final_line_gold_buff column');
    } catch (e) { /* Column exists */ }

    // Blessing Fire items (Lửa Cầu Phúc)
    try {
        db.prepare('ALTER TABLE economy ADD COLUMN lcp INTEGER DEFAULT 0').run();
        console.log('✅ Added lcp column');
    } catch (e) { /* Column exists */ }

    try {
        db.prepare('ALTER TABLE economy ADD COLUMN lcpcl INTEGER DEFAULT 0').run();
        console.log('✅ Added lcpcl column');
    } catch (e) { /* Column exists */ }

    try {
        db.prepare('ALTER TABLE economy ADD COLUMN blessing_fire_type TEXT DEFAULT NULL').run();
        console.log('✅ Added blessing_fire_type column');
    } catch (e) { /* Column exists */ }

    try {
        db.prepare('ALTER TABLE economy ADD COLUMN blessing_fire_expires_at DATETIME DEFAULT NULL').run();
        console.log('✅ Added blessing_fire_expires_at column');
    } catch (e) { /* Column exists */ }

    // Auto fire setting (lcp, lcpcl, or null)
    try {
        db.prepare('ALTER TABLE economy ADD COLUMN lcp_auto_type TEXT DEFAULT NULL').run();
        console.log('✅ Added lcp_auto_type column');
    } catch (e) { /* Column exists */ }

    // Bùa Khắc Yêu (dungeon skip item)
    try {
        db.prepare('ALTER TABLE economy ADD COLUMN bua_khac_yeu INTEGER DEFAULT 0').run();
        console.log('✅ Added bua_khac_yeu column');
    } catch (e) { /* Column exists */ }

    // Black Stone (Đá Đen)
    try {
        db.prepare('ALTER TABLE economy ADD COLUMN black_stone_empty INTEGER DEFAULT 0').run();
        console.log('✅ Added black_stone_empty column');
    } catch (e) { /* Column exists */ }

    // Bảng nhiệm vụ ngày
    db.prepare(`
        CREATE TABLE IF NOT EXISTS daily_quests (
            discord_id TEXT PRIMARY KEY,
            quest_date TEXT,
            quest_slots TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Bảng nhiệm vụ tuần
    db.prepare(`
        CREATE TABLE IF NOT EXISTS weekly_quests (
            discord_id TEXT PRIMARY KEY,
            week_start TEXT,
            quest_slots TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Bảng thành tựu
    db.prepare(`
        CREATE TABLE IF NOT EXISTS achievements (
            discord_id TEXT NOT NULL,
            achievement_id INTEGER NOT NULL,
            unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (discord_id, achievement_id)
        )
    `).run();

    // Bảng tiến độ người chơi
    db.prepare(`
        CREATE TABLE IF NOT EXISTS player_progress (
            discord_id TEXT PRIMARY KEY,
            boxes_opened INTEGER DEFAULT 0,
            solo_completed INTEGER DEFAULT 0,
            coop_completed INTEGER DEFAULT 0,
            boss_completed INTEGER DEFAULT 0,
            tune_count INTEGER DEFAULT 0,
            hat_earned_total INTEGER DEFAULT 0,
            nhua_used_total INTEGER DEFAULT 0,
            items_sold INTEGER DEFAULT 0,
            items_dismantled INTEGER DEFAULT 0,
            daily_claimed INTEGER DEFAULT 0,
            weekly_claimed INTEGER DEFAULT 0,
            gold_items_obtained INTEGER DEFAULT 0
        )
    `).run();

    console.log('✅ Economy database initialized');

    // ============== BLACK STONE TABLES ==============

    // Column đá đen trống trong economy
    try {
        db.prepare('ALTER TABLE economy ADD COLUMN black_stone_empty INTEGER DEFAULT 0').run();
        console.log('✅ Added black_stone_empty column');
    } catch (e) { /* Column exists */ }

    // Bảng lưu đá đen đã hút năng lực (mỗi viên có ID riêng)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS black_stones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_id TEXT NOT NULL,
            equipment_type TEXT NOT NULL,
            line_name TEXT NOT NULL,
            line_icon TEXT,
            line_percent INTEGER NOT NULL,
            line_value REAL,
            line_unit TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Bảng tracking số lần khắc trên mỗi gear (để tính chi phí tăng dần)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS enhance_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_id TEXT NOT NULL,
            equipment_id INTEGER NOT NULL,
            enhance_count INTEGER DEFAULT 0,
            UNIQUE(discord_id, equipment_id)
        )
    `).run();

    // Index cho black_stones
    try {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_black_stones_discord ON black_stones(discord_id)').run();
    } catch (e) { /* Index exists */ }

    console.log('✅ Black Stone tables initialized');
}


// ============== ECONOMY FUNCTIONS ==============

/**
 * Lấy hoặc tạo economy record
 */
function getOrCreateEconomy(discordId) {
    let record = db.prepare('SELECT * FROM economy WHERE discord_id = ?').get(discordId);

    if (!record) {
        db.prepare('INSERT INTO economy (discord_id) VALUES (?)').run(discordId);
        record = db.prepare('SELECT * FROM economy WHERE discord_id = ?').get(discordId);
    }

    return record;
}

/**
 * Reset toàn bộ dữ liệu economy của user (xóa tất cả items và trang bị)
 */
function clearUserEconomy(discordId) {
    try {
        // Delete all equipment
        db.prepare('DELETE FROM equipment WHERE discord_id = ?').run(discordId);

        // Reset core economy columns
        db.prepare(`
            UPDATE economy SET
                hat = 0,
                enhancement_stone_t1 = 0,
                thach_am = 0,
                nhua = 500,
                nhua_updated_at = CURRENT_TIMESTAMP
            WHERE discord_id = ?
        `).run(discordId);

        // Reset individual columns safely (may not exist in all databases)
        const columnsToReset = [
            { col: 'boxes_t1', val: 0 },
            { col: 'nhua_cung', val: 0 },
            { col: 'da_t1_khac_an', val: 0 },
            { col: 'thach_am_khac_an', val: 0 },
            { col: 'lcp', val: 0 },
            { col: 'lcpcl', val: 0 },
            { col: 'black_stone_empty', val: 0 },
            { col: 'bua_khac_yeu', val: 0 },
            { col: 'box_pity_counter', val: 0 },
            { col: 'tune_gold_buff', val: 0 },
            { col: 'final_line_gold_buff', val: 0 },
            { col: 'blessing_fire_type', val: null },
            { col: 'blessing_fire_expires_at', val: null },
            { col: 'lcp_auto_type', val: null },
            { col: 'active_title', val: null },
            { col: 'inv_slots', val: 500 },
            { col: 'slot_purchase_count', val: 0 },
            { col: 'daily_claimed_at', val: null },
            { col: 'weekly_claimed_at', val: null },
            { col: 'boss_last_claim', val: null }
        ];

        for (const item of columnsToReset) {
            try {
                if (item.val === null) {
                    db.prepare(`UPDATE economy SET ${item.col} = NULL WHERE discord_id = ?`).run(discordId);
                } else {
                    db.prepare(`UPDATE economy SET ${item.col} = ? WHERE discord_id = ?`).run(item.val, discordId);
                }
                console.log(`✅ Reset ${item.col} to ${item.val}`);
            } catch (e) {
                console.log(`❌ Failed to reset ${item.col}: ${e.message}`);
            }
        }

        // Delete absorbed stones
        try {
            db.prepare('DELETE FROM absorbed_stones WHERE discord_id = ?').run(discordId);
        } catch (e) { /* table might not exist */ }

        // Delete dungeon sessions
        try {
            db.prepare('DELETE FROM dungeon_sessions WHERE leader_id = ?').run(discordId);
        } catch (e) { /* table might not exist */ }

        return { success: true };
    } catch (error) {
        console.error('Error clearing user economy:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Cộng Hạt
 */
function addHat(discordId, amount) {
    getOrCreateEconomy(discordId);
    return db.prepare('UPDATE economy SET hat = hat + ? WHERE discord_id = ?').run(amount, discordId);
}

/**
 * Trừ Hạt
 */
function subtractHat(discordId, amount) {
    const eco = getOrCreateEconomy(discordId);
    if (eco.hat < amount) return { success: false, message: 'Không đủ Hạt' };

    db.prepare('UPDATE economy SET hat = hat - ? WHERE discord_id = ?').run(amount, discordId);
    return { success: true };
}

/**
 * Cộng Đá Cường Hóa T1
 */
function addStoneT1(discordId, amount) {
    getOrCreateEconomy(discordId);
    return db.prepare('UPDATE economy SET enhancement_stone_t1 = enhancement_stone_t1 + ? WHERE discord_id = ?').run(amount, discordId);
}

/**
 * Trừ Đá T1
 */
function subtractStoneT1(discordId, amount) {
    const eco = getOrCreateEconomy(discordId);
    if (eco.enhancement_stone_t1 < amount) return { success: false, message: 'Không đủ Đá T1' };

    db.prepare('UPDATE economy SET enhancement_stone_t1 = enhancement_stone_t1 - ? WHERE discord_id = ?').run(amount, discordId);
    return { success: true };
}

/**
 * Cộng Thạch Âm
 */
function addThachAm(discordId, amount) {
    getOrCreateEconomy(discordId);
    return db.prepare('UPDATE economy SET thach_am = thach_am + ? WHERE discord_id = ?').run(amount, discordId);
}

/**
 * Trừ Thạch Âm
 */
function subtractThachAm(discordId, amount) {
    const eco = getOrCreateEconomy(discordId);
    if (eco.thach_am < amount) return { success: false, message: 'Không đủ Thạch Âm' };

    db.prepare('UPDATE economy SET thach_am = thach_am - ? WHERE discord_id = ?').run(amount, discordId);
    return { success: true };
}

// ============== BOX FUNCTIONS ==============

/**
 * Cộng Box T1
 */
function addBoxesT1(discordId, amount) {
    getOrCreateEconomy(discordId);
    return db.prepare('UPDATE economy SET boxes_t1 = boxes_t1 + ? WHERE discord_id = ?').run(amount, discordId);
}

/**
 * Trừ Box T1
 */
function subtractBoxesT1(discordId, amount) {
    const eco = getOrCreateEconomy(discordId);
    if ((eco.boxes_t1 || 0) < amount) return { success: false, message: 'Không đủ Box' };

    db.prepare('UPDATE economy SET boxes_t1 = boxes_t1 - ? WHERE discord_id = ?').run(amount, discordId);
    return { success: true };
}

// ============== NHỰA CỨNG FUNCTIONS ==============

/**
 * Cộng Nhựa Cứng
 */
function addNhuaCung(discordId, amount) {
    getOrCreateEconomy(discordId);
    return db.prepare('UPDATE economy SET nhua_cung = nhua_cung + ? WHERE discord_id = ?').run(amount, discordId);
}

/**
 * Trừ Nhựa Cứng (dùng để hồi 60 thể lực)
 */
function subtractNhuaCung(discordId, amount) {
    const eco = getOrCreateEconomy(discordId);
    if ((eco.nhua_cung || 0) < amount) return { success: false, message: 'Không đủ Nhựa Cứng' };

    db.prepare('UPDATE economy SET nhua_cung = nhua_cung - ? WHERE discord_id = ?').run(amount, discordId);
    return { success: true };
}
// ============== INVENTORY SLOTS FUNCTIONS ==============

/**
 * Cộng thêm slot kho đồ
 */
function addInvSlots(discordId, amount) {
    getOrCreateEconomy(discordId);
    // Ensure columns exist
    try {
        db.prepare('ALTER TABLE economy ADD COLUMN inv_slots INTEGER DEFAULT 500').run();
    } catch (e) { /* Column already exists */ }
    try {
        db.prepare('ALTER TABLE economy ADD COLUMN slot_purchase_count INTEGER DEFAULT 0').run();
    } catch (e) { /* Column already exists */ }

    return db.prepare('UPDATE economy SET inv_slots = COALESCE(inv_slots, 500) + ? WHERE discord_id = ?').run(amount, discordId);
}

/**
 * Reset slot về 500 và reset purchase count
 */
function resetInvSlots(discordId) {
    getOrCreateEconomy(discordId);
    return db.prepare('UPDATE economy SET inv_slots = 500, slot_purchase_count = 0 WHERE discord_id = ?').run(discordId);
}

/**
 * Lấy số slot hiện tại
 */
function getInvSlots(discordId) {
    const eco = getOrCreateEconomy(discordId);
    return eco.inv_slots || 500;
}

/**
 * Lấy số lần đã mua slot
 */
function getSlotPurchaseCount(discordId) {
    const eco = getOrCreateEconomy(discordId);
    return eco.slot_purchase_count || 0;
}

/**
 * Tính giá mua slot dựa trên số lần đã mua (leo thang)
 * Lần 1-5: 5,000 Hạt
 * Lần 6-10: 10,000 Hạt
 * Lần 11+: 20,000 Hạt
 */
function getSlotPrice(purchaseCount) {
    if (purchaseCount < 5) return 5000;
    if (purchaseCount < 10) return 10000;
    return 20000;
}

/**
 * Mua slot và tăng purchase count
 */
function purchaseSlots(discordId, slotAmount = 100) {
    const eco = getOrCreateEconomy(discordId);
    const purchaseCount = eco.slot_purchase_count || 0;
    const price = getSlotPrice(purchaseCount);

    if (eco.hat < price) {
        return { success: false, message: 'Không đủ Hạt', price, hat: eco.hat };
    }

    // Trừ Hạt
    db.prepare('UPDATE economy SET hat = hat - ? WHERE discord_id = ?').run(price, discordId);
    // Thêm slot
    db.prepare('UPDATE economy SET inv_slots = COALESCE(inv_slots, 500) + ? WHERE discord_id = ?').run(slotAmount, discordId);
    // Tăng purchase count
    db.prepare('UPDATE economy SET slot_purchase_count = COALESCE(slot_purchase_count, 0) + 1 WHERE discord_id = ?').run(discordId);

    const newEco = getOrCreateEconomy(discordId);
    return {
        success: true,
        price,
        newSlots: newEco.inv_slots,
        newPurchaseCount: newEco.slot_purchase_count,
        nextPrice: getSlotPrice(newEco.slot_purchase_count)
    };
}

// ============== ĐÁ T1 KHẮC ẤN FUNCTIONS ==============

/**
 * Cộng Đá T1 Khắc Ấn
 */
function addDaT1KhacAn(discordId, amount) {
    getOrCreateEconomy(discordId);
    return db.prepare('UPDATE economy SET da_t1_khac_an = da_t1_khac_an + ? WHERE discord_id = ?').run(amount, discordId);
}

/**
 * Trừ Đá T1 Khắc Ấn
 */
function subtractDaT1KhacAn(discordId, amount) {
    const eco = getOrCreateEconomy(discordId);
    if ((eco.da_t1_khac_an || 0) < amount) return { success: false, message: 'Không đủ Đá T1 Khắc Ấn' };

    db.prepare('UPDATE economy SET da_t1_khac_an = da_t1_khac_an - ? WHERE discord_id = ?').run(amount, discordId);
    return { success: true };
}

// ============== THẠCH ÂM KHẮC ẤN FUNCTIONS ==============

/**
 * Cộng Thạch Âm Khắc Ấn
 */
function addThachAmKhacAn(discordId, amount) {
    getOrCreateEconomy(discordId);
    return db.prepare('UPDATE economy SET thach_am_khac_an = thach_am_khac_an + ? WHERE discord_id = ?').run(amount, discordId);
}

/**
 * Trừ Thạch Âm Khắc Ấn
 */
function subtractThachAmKhacAn(discordId, amount) {
    const eco = getOrCreateEconomy(discordId);
    if ((eco.thach_am_khac_an || 0) < amount) return { success: false, message: 'Không đủ Thạch Âm Khắc Ấn' };

    db.prepare('UPDATE economy SET thach_am_khac_an = thach_am_khac_an - ? WHERE discord_id = ?').run(amount, discordId);
    return { success: true };
}

// ============== NHỰA FUNCTIONS ==============

const MAX_NHUA = 500;
const NHUA_REGEN_MINUTES = 2.88; // 1 Nhựa mỗi 2.88 phút (1 ngày = đầy 500)

/**
 * Lấy Nhựa hiện tại (tính cả regen)
 */
function getCurrentNhua(discordId) {
    const eco = getOrCreateEconomy(discordId);
    const now = Date.now();

    // Nếu chưa có nhua_updated_at, set mặc định
    if (!eco.nhua_updated_at) {
        db.prepare('UPDATE economy SET nhua = 500, nhua_updated_at = ? WHERE discord_id = ?')
            .run(new Date().toISOString(), discordId);
        return { current: 500, max: MAX_NHUA, regenTime: null };
    }

    const lastUpdate = new Date(eco.nhua_updated_at).getTime();
    const minutesPassed = Math.floor((now - lastUpdate) / (1000 * 60));
    const regenAmount = Math.floor(minutesPassed / NHUA_REGEN_MINUTES);

    let currentNhua = Math.min(MAX_NHUA, (eco.nhua || 0) + regenAmount);

    // Cập nhật DB nếu có regen
    if (regenAmount > 0 && eco.nhua < MAX_NHUA) {
        const newUpdatedAt = new Date(lastUpdate + regenAmount * NHUA_REGEN_MINUTES * 60 * 1000);
        db.prepare('UPDATE economy SET nhua = ?, nhua_updated_at = ? WHERE discord_id = ?')
            .run(currentNhua, newUpdatedAt.toISOString(), discordId);
    }

    // Tính thời gian hồi đầy
    let regenTime = null;
    if (currentNhua < MAX_NHUA) {
        const remaining = MAX_NHUA - currentNhua;
        const minutesToFull = remaining * NHUA_REGEN_MINUTES;
        const hours = Math.floor(minutesToFull / 60);
        const mins = Math.round(minutesToFull % 60);
        regenTime = `${hours}h ${mins}m`;
    }

    return { current: currentNhua, max: MAX_NHUA, regenTime };
}

/**
 * Tiêu thụ Nhựa
 */
function consumeNhua(discordId, amount) {
    const nhuaInfo = getCurrentNhua(discordId);

    if (nhuaInfo.current < amount) {
        return {
            success: false,
            message: `Không đủ Nhựa! Cần ${amount}, hiện có ${nhuaInfo.current}`,
            current: nhuaInfo.current
        };
    }

    const newNhua = nhuaInfo.current - amount;
    db.prepare('UPDATE economy SET nhua = ?, nhua_updated_at = ? WHERE discord_id = ?')
        .run(newNhua, new Date().toISOString(), discordId);

    return { success: true, remaining: newNhua };
}

/**
 * Kiểm tra có thể claim Boss tuần này không
 */
function canClaimBoss(discordId) {
    const eco = getOrCreateEconomy(discordId);
    const now = new Date();
    const lastClaim = eco.boss_last_claim ? new Date(eco.boss_last_claim) : null;

    if (!lastClaim) return { canClaim: true, bossesRemaining: 2 };

    // Tìm thứ 2 tuần này
    const currentDay = now.getDay();
    const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1;
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() - daysFromMonday);
    thisMonday.setHours(0, 0, 0, 0);

    // Nếu lastClaim < thisMonday → tuần mới, reset
    if (lastClaim < thisMonday) {
        return { canClaim: true, bossesRemaining: 2 };
    }

    // Đếm số lần claim tuần này (giả định 2 boss/tuần)
    // TODO: Track chính xác số lần claim
    return { canClaim: false, bossesRemaining: 0, nextReset: getNextMonday() };
}

/**
 * Claim Boss tuần
 */
function claimBoss(discordId) {
    const canClaim = canClaimBoss(discordId);
    if (!canClaim.canClaim) {
        return { success: false, message: 'Đã claim đủ Boss tuần này!' };
    }

    db.prepare('UPDATE economy SET boss_last_claim = ? WHERE discord_id = ?')
        .run(new Date().toISOString(), discordId);

    return { success: true };
}

/**
 * Lấy thứ 2 tuần sau
 */
function getNextMonday() {
    const now = new Date();
    const currentDay = now.getDay();
    const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1;
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() - daysFromMonday);
    thisMonday.setHours(0, 0, 0, 0);

    const nextMonday = new Date(thisMonday);
    nextMonday.setDate(thisMonday.getDate() + 7);
    return nextMonday;
}

/**
 * Claim daily reward (2000 Hạt) - Reset vào 00h theo giờ Việt Nam (GMT+7)
 */
function claimDaily(discordId) {
    const eco = getOrCreateEconomy(discordId);
    const vnNow = getVietnamNow();
    const lastClaim = eco.daily_claimed_at ? new Date(eco.daily_claimed_at) : null;

    // Check if already claimed today (after 00h Vietnam time)
    if (lastClaim) {
        const vnToday = getVietnamToday();
        const vnLastClaim = toVietnamTime(lastClaim);
        const vnLastClaimDay = new Date(vnLastClaim.getFullYear(), vnLastClaim.getMonth(), vnLastClaim.getDate());

        if (vnToday.getTime() === vnLastClaimDay.getTime()) {
            // Tính thời gian đến 00h ngày mai (giờ VN)
            const vnTomorrow = new Date(vnToday);
            vnTomorrow.setDate(vnTomorrow.getDate() + 1);
            const diff = vnTomorrow - vnNow;
            const h = Math.floor(diff / (1000 * 60 * 60));
            const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            return { success: false, message: `Còn ${h}h ${m}m để nhận Daily` };
        }
    }

    // Claim reward
    const reward = 2000;
    db.prepare('UPDATE economy SET hat = hat + ?, daily_claimed_at = ? WHERE discord_id = ?')
        .run(reward, new Date().toISOString(), discordId);

    return { success: true, reward };
}

/**
 * Claim weekly reward (10000 Hạt) - Reset vào thứ 2 theo giờ Việt Nam (GMT+7)
 */
function claimWeekly(discordId) {
    const eco = getOrCreateEconomy(discordId);
    const vnNow = getVietnamNow();
    const lastClaim = eco.weekly_claimed_at ? new Date(eco.weekly_claimed_at) : null;

    // Check if already claimed this week (since Monday Vietnam time)
    if (lastClaim) {
        // Tìm thứ 2 tuần này theo giờ VN
        const currentDay = vnNow.getDay(); // 0=Sunday, 1=Monday, ...
        const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1;

        const vnThisMonday = new Date(vnNow);
        vnThisMonday.setDate(vnNow.getDate() - daysFromMonday);
        vnThisMonday.setHours(0, 0, 0, 0);

        // Chuyển lastClaim sang giờ VN
        const vnLastClaim = toVietnamTime(lastClaim);

        // Nếu lastClaim >= thisMonday (VN) → đã claim tuần này
        if (vnLastClaim >= vnThisMonday) {
            // Tính đến thứ 2 tuần sau
            const vnNextMonday = new Date(vnThisMonday);
            vnNextMonday.setDate(vnThisMonday.getDate() + 7);
            const diff = vnNextMonday - vnNow;
            const d = Math.floor(diff / (1000 * 60 * 60 * 24));
            const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            return { success: false, message: `Còn ${d}d ${h}h để nhận Weekly (Reset thứ 2)` };
        }
    }

    // Claim reward
    const reward = 10000;
    db.prepare('UPDATE economy SET hat = hat + ?, weekly_claimed_at = ? WHERE discord_id = ?')
        .run(reward, new Date().toISOString(), discordId);

    return { success: true, reward };
}

// ============== EQUIPMENT FUNCTIONS ==============

/**
 * Thêm equipment mới
 */
function addEquipment(discordId, equipData) {
    const { slot, name, tier = 1, rarity = 'purple', lines = [] } = equipData;

    const result = db.prepare(`
        INSERT INTO equipment (discord_id, slot, name, tier, rarity, lines)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(discordId, slot, name, tier, rarity, JSON.stringify(lines));

    return { success: true, equipmentId: result.lastInsertRowid };
}

/**
 * Lấy equipment theo ID
 */
function getEquipment(equipmentId) {
    const equip = db.prepare('SELECT * FROM equipment WHERE id = ?').get(equipmentId);
    if (equip) {
        equip.lines = JSON.parse(equip.lines || '[]');
        equip.final_line = equip.final_line ? JSON.parse(equip.final_line) : null;
    }
    return equip;
}

/**
 * Lấy tất cả equipment của user
 */
function getUserEquipment(discordId) {
    const items = db.prepare('SELECT * FROM equipment WHERE discord_id = ? ORDER BY created_at DESC').all(discordId);
    return items.map(item => ({
        ...item,
        lines: JSON.parse(item.lines || '[]'),
        final_line: item.final_line ? JSON.parse(item.final_line) : null
    }));
}

/**
 * Đếm số equipment của user
 */
function countUserEquipment(discordId) {
    const result = db.prepare('SELECT COUNT(*) as count FROM equipment WHERE discord_id = ?').get(discordId);
    return result?.count || 0;
}

/**
 * Lấy equipment Vàng của user (để tune)
 */
function getUserGoldEquipment(discordId) {
    const items = db.prepare("SELECT * FROM equipment WHERE discord_id = ? AND rarity = 'gold' ORDER BY created_at DESC").all(discordId);
    return items.map(item => ({
        ...item,
        lines: JSON.parse(item.lines || '[]'),
        final_line: item.final_line ? JSON.parse(item.final_line) : null
    }));
}

/**
 * Lấy equipment Tím của user (để phân tách)
 */
function getUserPurpleEquipment(discordId) {
    const items = db.prepare("SELECT * FROM equipment WHERE discord_id = ? AND rarity = 'purple' ORDER BY created_at DESC").all(discordId);
    return items.map(item => ({
        ...item,
        lines: JSON.parse(item.lines || '[]'),
        final_line: item.final_line ? JSON.parse(item.final_line) : null
    }));
}

/**
 * Lấy equipment đang mặc của user
 */
function getUserEquippedItems(discordId) {
    const items = db.prepare("SELECT * FROM equipment WHERE discord_id = ? AND is_equipped = 1 ORDER BY slot").all(discordId);
    return items.map(item => ({
        ...item,
        lines: JSON.parse(item.lines || '[]'),
        final_line: item.final_line ? JSON.parse(item.final_line) : null
    }));
}

/**
 * Cập nhật lines của equipment
 */
function updateEquipmentLines(equipmentId, lines) {
    return db.prepare('UPDATE equipment SET lines = ? WHERE id = ?')
        .run(JSON.stringify(lines), equipmentId);
}

/**
 * Cập nhật final line của equipment
 */
function updateEquipmentFinalLine(equipmentId, finalLine) {
    return db.prepare('UPDATE equipment SET final_line = ? WHERE id = ?')
        .run(JSON.stringify(finalLine), equipmentId);
}

/**
 * Xóa equipment (phân tách)
 */
function deleteEquipment(equipmentId) {
    return db.prepare('DELETE FROM equipment WHERE id = ?').run(equipmentId);
}

/**
 * Đếm số equipment của user
 */
function countUserEquipment(discordId) {
    const result = db.prepare('SELECT COUNT(*) as count FROM equipment WHERE discord_id = ?').get(discordId);
    return result.count;
}

/**
 * Trang bị equipment
 */
function equipItem(discordId, equipmentId) {
    const equip = getEquipment(equipmentId);
    if (!equip || equip.discord_id !== discordId) {
        return { success: false, message: 'Không tìm thấy trang bị' };
    }

    // Gỡ đồ cùng slot đang mặc
    db.prepare('UPDATE equipment SET is_equipped = 0 WHERE discord_id = ? AND slot = ?')
        .run(discordId, equip.slot);

    // Mặc đồ mới
    db.prepare('UPDATE equipment SET is_equipped = 1 WHERE id = ?').run(equipmentId);

    return { success: true };
}

/**
 * Lấy equipment đang mặc
 */
function getEquippedItems(discordId) {
    const items = db.prepare('SELECT * FROM equipment WHERE discord_id = ? AND is_equipped = 1').all(discordId);
    return items.map(item => ({
        ...item,
        lines: JSON.parse(item.lines || '[]'),
        final_line: item.final_line ? JSON.parse(item.final_line) : null
    }));
}

/**
 * Gỡ trang bị
 */
function unequipItem(discordId, equipmentId) {
    const equip = getEquipment(equipmentId);
    if (!equip || equip.discord_id !== discordId) {
        return { success: false, message: 'Không tìm thấy trang bị' };
    }

    if (!equip.is_equipped) {
        return { success: false, message: 'Chưa mặc trang bị này' };
    }

    db.prepare('UPDATE equipment SET is_equipped = 0 WHERE id = ?').run(equipmentId);
    return { success: true };
}

/**
 * Khóa/Mở khóa trang bị
 */
function toggleLockItem(equipmentId, lockStatus) {
    db.prepare('UPDATE equipment SET is_locked = ? WHERE id = ?').run(lockStatus, equipmentId);
    return { success: true };
}

// ============== TRANSACTION FUNCTIONS ==============

/**
 * Log transaction
 */
function logTransaction(discordId, type, description, amount) {
    return db.prepare(`
        INSERT INTO transactions (discord_id, type, description, amount)
        VALUES (?, ?, ?, ?)
    `).run(discordId, type, description, amount);
}

// ============== ADMIN FUNCTIONS ==============


// ============== PLAYER PROGRESS FUNCTIONS ==============

/**
 * Lấy hoặc tạo player progress
 */
function getPlayerProgress(discordId) {
    let record = db.prepare('SELECT * FROM player_progress WHERE discord_id = ?').get(discordId);

    if (!record) {
        db.prepare('INSERT INTO player_progress (discord_id) VALUES (?)').run(discordId);
        record = db.prepare('SELECT * FROM player_progress WHERE discord_id = ?').get(discordId);
    }

    return record;
}

/**
 * Cập nhật một field trong player_progress
 */
function updateProgress(discordId, field, amount = 1) {
    getPlayerProgress(discordId); // Ensure record exists
    const validFields = ['boxes_opened', 'solo_completed', 'coop_completed', 'boss_completed',
        'tune_count', 'hat_earned_total', 'nhua_used_total', 'items_sold',
        'items_dismantled', 'daily_claimed', 'weekly_claimed', 'gold_items_obtained'];

    if (!validFields.includes(field)) return;

    db.prepare(`UPDATE player_progress SET ${field} = ${field} + ? WHERE discord_id = ?`).run(amount, discordId);
}

/**
 * Lấy số lượng đồ vàng của user
 */
function countUserGoldItems(discordId) {
    const result = db.prepare("SELECT COUNT(*) as count FROM equipment WHERE discord_id = ? AND rarity = 'gold'").get(discordId);
    return result ? result.count : 0;
}

// Initialize on module load
initializeDatabase();

/**
 * Dọn dẹp dungeon_sessions cũ hơn 7 ngày (status != in_progress)
 * Chạy mỗi khi bot khởi động
 */
function cleanupOldSessions() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = db.prepare(`
        DELETE FROM dungeon_sessions 
        WHERE status != 'in_progress' 
        AND created_at < ?
    `).run(sevenDaysAgo);

    if (result.changes > 0) {
        console.log(`🧹 Cleaned up ${result.changes} old dungeon sessions`);
    }
    return result.changes;
}

// Chạy cleanup khi module load
cleanupOldSessions();

// ============== PITY COUNTER FUNCTIONS ==============

/**
 * Lấy pity counter hiện tại
 */
function getPityCounter(discordId) {
    const eco = getOrCreateEconomy(discordId);
    return eco.box_pity_counter || 0;
}

/**
 * Tăng pity counter lên 1
 * @returns {number} Giá trị counter mới
 */
function incrementPityCounter(discordId) {
    getOrCreateEconomy(discordId);
    db.prepare('UPDATE economy SET box_pity_counter = box_pity_counter + 1 WHERE discord_id = ?').run(discordId);
    return getPityCounter(discordId);
}

/**
 * Reset pity counter về 0
 */
function resetPityCounter(discordId) {
    db.prepare('UPDATE economy SET box_pity_counter = 0 WHERE discord_id = ?').run(discordId);
}

// ============== TUNE BUFF FUNCTIONS ==============

/**
 * Set buff cho dòng tune tiếp theo là Đề Cử Vàng
 */
function setTuneGoldBuff(discordId, active) {
    getOrCreateEconomy(discordId);
    db.prepare('UPDATE economy SET tune_gold_buff = ? WHERE discord_id = ?').run(active ? 1 : 0, discordId);
}

/**
 * Kiểm tra và tiêu thụ buff Tinh Thể Vàng
 * @returns {boolean} true nếu có buff và đã consume
 */
function consumeTuneGoldBuff(discordId) {
    const eco = getOrCreateEconomy(discordId);
    if (eco.tune_gold_buff === 1) {
        db.prepare('UPDATE economy SET tune_gold_buff = 0 WHERE discord_id = ?').run(discordId);
        return true;
    }
    return false;
}

/**
 * Set buff cho dòng cuối tune là Vàng
 */
function setFinalLineGoldBuff(discordId, active) {
    getOrCreateEconomy(discordId);
    db.prepare('UPDATE economy SET final_line_gold_buff = ? WHERE discord_id = ?').run(active ? 1 : 0, discordId);
}

/**
 * Kiểm tra và tiêu thụ buff Thạch Âm Vàng
 * @returns {boolean} true nếu có buff và đã consume
 */
function consumeFinalLineGoldBuff(discordId) {
    const eco = getOrCreateEconomy(discordId);
    if (eco.final_line_gold_buff === 1) {
        db.prepare('UPDATE economy SET final_line_gold_buff = 0 WHERE discord_id = ?').run(discordId);
        return true;
    }
    return false;
}

/**
 * Check if user has any active tune buff
 */
function getTuneBuffStatus(discordId) {
    const eco = getOrCreateEconomy(discordId);
    return {
        tuneGoldBuff: eco.tune_gold_buff === 1,
        finalLineGoldBuff: eco.final_line_gold_buff === 1
    };
}

// ============== BLESSING FIRE FUNCTIONS ==============

/**
 * Thêm Lửa Cầu Phúc (LCP)
 */
function addLcp(discordId, amount = 1) {
    getOrCreateEconomy(discordId);
    db.prepare('UPDATE economy SET lcp = lcp + ? WHERE discord_id = ?').run(amount, discordId);
}

/**
 * Thêm Lửa Cầu Phúc Cỡ Lớn (LCPCL)
 */
function addLcpcl(discordId, amount = 1) {
    getOrCreateEconomy(discordId);
    db.prepare('UPDATE economy SET lcpcl = lcpcl + ? WHERE discord_id = ?').run(amount, discordId);
}

/**
 * Kích hoạt Lửa Cầu Phúc
 * @param {string} discordId 
 * @param {string} type - 'lcp' hoặc 'lcpcl'
 * @param {number} quantity - số lượng muốn dùng (default 1)
 * @returns {{ success: boolean, message: string, expiresAt: Date, usedCount: number }}
 */
function activateBlessingFire(discordId, type, quantity = 1) {
    const eco = getOrCreateEconomy(discordId);
    const column = type === 'lcpcl' ? 'lcpcl' : 'lcp';
    const itemCount = eco[column] || 0;
    const typeName = type === 'lcpcl' ? 'Lửa Cầu Phúc Cỡ Lớn' : 'Lửa Cầu Phúc';

    // Giới hạn số lượng
    const actualQty = Math.min(quantity, itemCount);

    if (itemCount <= 0) {
        return { success: false, message: `Bạn không có ${typeName}!` };
    }

    if (actualQty <= 0) {
        return { success: false, message: `Số lượng không hợp lệ!` };
    }

    // Trừ items
    db.prepare(`UPDATE economy SET ${column} = ${column} - ? WHERE discord_id = ?`).run(actualQty, discordId);

    // Tính thời gian
    const hoursToAdd = actualQty * 3 * 60 * 60 * 1000; // số lượng * 3h mỗi cái
    let expiresAt;

    // Check trạng thái hiện tại
    const currentType = eco.blessing_fire_type;
    const currentExpires = eco.blessing_fire_expires_at ? new Date(eco.blessing_fire_expires_at) : null;
    const now = new Date();

    if (currentType === type && currentExpires && currentExpires > now) {
        // Cùng loại - cộng dồn thời gian
        expiresAt = new Date(currentExpires.getTime() + hoursToAdd);
    } else {
        // Khác loại hoặc không có buff - set mới từ bây giờ
        expiresAt = new Date(Date.now() + hoursToAdd);
    }

    db.prepare(`
        UPDATE economy 
        SET blessing_fire_type = ?, blessing_fire_expires_at = ?
        WHERE discord_id = ?
    `).run(type, expiresAt.toISOString(), discordId);

    return {
        success: true,
        message: `Đã đốt ${actualQty} ${typeName}!`,
        expiresAt,
        usedCount: actualQty
    };
}

/**
 * Lấy trạng thái Blessing Fire hiện tại
 * @returns {{ active: boolean, type: string, expiresAt: Date, bonusPercent: number }}
 */
function getBlessingFireStatus(discordId) {
    const eco = getOrCreateEconomy(discordId);

    if (!eco.blessing_fire_type || !eco.blessing_fire_expires_at) {
        return { active: false, type: null, expiresAt: null, bonusPercent: 0 };
    }

    const expiresAt = new Date(eco.blessing_fire_expires_at);
    const now = new Date();

    if (expiresAt <= now) {
        // Buff đã hết hạn, xóa
        db.prepare('UPDATE economy SET blessing_fire_type = NULL, blessing_fire_expires_at = NULL WHERE discord_id = ?').run(discordId);
        return { active: false, type: null, expiresAt: null, bonusPercent: 0 };
    }

    // Buff còn hiệu lực
    const bonusPercent = eco.blessing_fire_type === 'lcpcl' ? 200 : 100;
    return {
        active: true,
        type: eco.blessing_fire_type,
        expiresAt,
        bonusPercent,
        lcp: eco.lcp || 0,
        lcpcl: eco.lcpcl || 0
    };
}

/**
 * Lấy số lượng LCP và LCPCL
 */
function getLcpCounts(discordId) {
    const eco = getOrCreateEconomy(discordId);
    return {
        lcp: eco.lcp || 0,
        lcpcl: eco.lcpcl || 0
    };
}

/**
 * Set auto fire type (toggle)
 * @param {string} discordId 
 * @param {string|null} type - 'lcp', 'lcpcl', or null to disable
 */
function setLcpAuto(discordId, type) {
    getOrCreateEconomy(discordId);
    db.prepare('UPDATE economy SET lcp_auto_type = ? WHERE discord_id = ?').run(type, discordId);
}

/**
 * Get auto fire type
 * @returns {string|null} - 'lcp', 'lcpcl', or null
 */
function getLcpAuto(discordId) {
    const eco = getOrCreateEconomy(discordId);
    return eco.lcp_auto_type || null;
}

// ============== BLACK STONE FUNCTIONS ==============

/**
 * Cộng Đá Đen trống
 */
function addBlackStone(discordId, amount) {
    getOrCreateEconomy(discordId);
    return db.prepare('UPDATE economy SET black_stone_empty = black_stone_empty + ? WHERE discord_id = ?').run(amount, discordId);
}

/**
 * Trừ Đá Đen trống
 */
function subtractBlackStone(discordId, amount) {
    const eco = getOrCreateEconomy(discordId);
    if ((eco.black_stone_empty || 0) < amount) return { success: false, message: 'Không đủ Đá Đen trống' };

    db.prepare('UPDATE economy SET black_stone_empty = black_stone_empty - ? WHERE discord_id = ?').run(amount, discordId);
    return { success: true };
}

/**
 * Lấy số lượng Đá Đen trống
 */
function getBlackStoneCount(discordId) {
    const eco = getOrCreateEconomy(discordId);
    return eco.black_stone_empty || 0;
}

// ============== BÙA KHẮC YÊU ==============

/**
 * Cộng Bùa Khắc Yêu
 */
function addBuaKhacYeu(discordId, amount) {
    getOrCreateEconomy(discordId);
    return db.prepare('UPDATE economy SET bua_khac_yeu = COALESCE(bua_khac_yeu, 0) + ? WHERE discord_id = ?').run(amount, discordId);
}

/**
 * Trừ Bùa Khắc Yêu
 */
function subtractBuaKhacYeu(discordId, amount) {
    const eco = getOrCreateEconomy(discordId);
    if ((eco.bua_khac_yeu || 0) < amount) return { success: false, message: 'Không đủ Bùa Khắc Yêu' };

    db.prepare('UPDATE economy SET bua_khac_yeu = bua_khac_yeu - ? WHERE discord_id = ?').run(amount, discordId);
    return { success: true };
}

/**
 * Lấy số lượng Bùa Khắc Yêu
 */
function getBuaKhacYeuCount(discordId) {
    const eco = getOrCreateEconomy(discordId);
    return eco.bua_khac_yeu || 0;
}

/**
 * Tạo Đá Đen đã hút năng lực (từ equipment)
 * @returns {Object} { success, stoneId }
 */
function createAbsorbedStone(discordId, stoneData) {
    const { equipment_type, line_name, line_icon, line_percent, line_value, line_unit } = stoneData;

    const result = db.prepare(`
        INSERT INTO black_stones (discord_id, equipment_type, line_name, line_icon, line_percent, line_value, line_unit)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(discordId, equipment_type, line_name, line_icon || '', line_percent, line_value || 0, line_unit || '');

    return { success: true, stoneId: result.lastInsertRowid };
}

/**
 * Lấy tất cả Đá Đen đã hút của user
 */
function getAbsorbedStones(discordId) {
    return db.prepare('SELECT * FROM black_stones WHERE discord_id = ? ORDER BY created_at DESC').all(discordId);
}

/**
 * Lấy Đá Đen đã hút theo ID
 */
function getAbsorbedStone(stoneId) {
    return db.prepare('SELECT * FROM black_stones WHERE id = ?').get(stoneId);
}

/**
 * Xóa Đá Đen đã hút (sau khi khắc)
 */
function deleteAbsorbedStone(stoneId) {
    return db.prepare('DELETE FROM black_stones WHERE id = ?').run(stoneId);
}

/**
 * Lấy số lần đã khắc trên equipment
 */
function getEnhanceCount(discordId, equipmentId) {
    const record = db.prepare('SELECT enhance_count FROM enhance_history WHERE discord_id = ? AND equipment_id = ?').get(discordId, equipmentId);
    return record ? record.enhance_count : 0;
}

/**
 * Tăng số lần khắc trên equipment
 */
function incrementEnhanceCount(discordId, equipmentId) {
    db.prepare(`
        INSERT INTO enhance_history (discord_id, equipment_id, enhance_count)
        VALUES (?, ?, 1)
        ON CONFLICT(discord_id, equipment_id) DO UPDATE SET enhance_count = enhance_count + 1
    `).run(discordId, equipmentId);
}

/**
 * Tính chi phí khắc (2^n viên đá)
 */
function getEnhanceCost(discordId, equipmentId) {
    const count = getEnhanceCount(discordId, equipmentId);
    return Math.pow(2, count); // 1, 2, 4, 8, ...
}

module.exports = {

    db,
    // Economy
    getOrCreateEconomy,
    addHat,
    subtractHat,
    addStoneT1,
    subtractStoneT1,
    addThachAm,
    subtractThachAm,
    addBoxesT1,
    subtractBoxesT1,
    claimDaily,
    claimWeekly,
    // Nhựa
    getCurrentNhua,
    consumeNhua,
    canClaimBoss,
    claimBoss,
    MAX_NHUA,
    // Equipment
    addEquipment,
    getEquipment,
    getUserEquipment,
    countUserEquipment,
    getUserGoldEquipment,
    getUserPurpleEquipment,
    getUserEquippedItems,
    updateEquipmentLines,
    updateEquipmentFinalLine,
    deleteEquipment,
    countUserEquipment,
    equipItem,
    getEquippedItems,
    unequipItem,
    toggleLockItem,
    // Transactions
    logTransaction,
    // Admin
    clearUserEconomy,
    // Progress
    getPlayerProgress,
    updateProgress,
    countUserGoldItems,
    // New Items
    addNhuaCung,
    subtractNhuaCung,
    addDaT1KhacAn,
    subtractDaT1KhacAn,
    addThachAmKhacAn,
    subtractThachAmKhacAn,
    // Pity Counter
    getPityCounter,
    incrementPityCounter,
    resetPityCounter,
    // Tune Buffs
    setTuneGoldBuff,
    consumeTuneGoldBuff,
    setFinalLineGoldBuff,
    consumeFinalLineGoldBuff,
    getTuneBuffStatus,
    // Blessing Fire
    addLcp,
    addLcpcl,
    activateBlessingFire,
    getBlessingFireStatus,
    getLcpCounts,
    setLcpAuto,
    getLcpAuto,
    // Black Stone
    addBlackStone,
    subtractBlackStone,
    getBlackStoneCount,
    createAbsorbedStone,
    getAbsorbedStones,
    getAbsorbedStone,
    deleteAbsorbedStone,
    getEnhanceCount,
    incrementEnhanceCount,
    getEnhanceCost,
    // Bùa Khắc Yêu
    addBuaKhacYeu,
    subtractBuaKhacYeu,
    getBuaKhacYeuCount,
    // Inventory Slots
    addInvSlots,
    resetInvSlots,
    getInvSlots,
    getSlotPurchaseCount,
    getSlotPrice,
    purchaseSlots,
    // Cleanup
    cleanupOldSessions,
    // Database access
    db
};


