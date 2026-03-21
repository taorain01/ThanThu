/**
 * SQLite Database Module
 * Manages user information: Discord name, game username, UID, position, etc.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Database file path
const DB_PATH = path.join(__dirname, '../../data/users.db');

// Tự động tạo thư mục data nếu chưa tồn tại
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('📁 Created data directory:', dataDir);
}

// Initialize database
const db = new Database(DB_PATH);

// Enable WAL mode for better performance and concurrent access
db.pragma('journal_mode = WAL');

/**
 * Initialize database schema
 */
function initializeDatabase() {
    // Create users table with position column
    const createUsersTable = db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            discord_id TEXT PRIMARY KEY,
            discord_name TEXT NOT NULL,
            game_username TEXT,
            game_uid TEXT,
            position TEXT DEFAULT 'mem',
            server_name TEXT,
            notes TEXT,
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            left_at DATETIME,
            rejoin_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    createUsersTable.run();

    // Create config table for custom settings (like kc display name)
    const createConfigTable = db.prepare(`
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    createConfigTable.run();

    // Add position column if not exists (for existing databases)
    try {
        db.prepare('ALTER TABLE users ADD COLUMN position TEXT DEFAULT "mem"').run();
    } catch (e) {
        // Column already exists, ignore
    }

    // Add joined_at column if not exists (for existing databases)
    try {
        db.prepare('ALTER TABLE users ADD COLUMN joined_at DATETIME DEFAULT CURRENT_TIMESTAMP').run();
    } catch (e) {
        // Column already exists, ignore
    }

    // Add left_at column if not exists (for existing databases)
    try {
        db.prepare('ALTER TABLE users ADD COLUMN left_at DATETIME').run();
    } catch (e) {
        // Column already exists, ignore
    }

    // Add rejoin_count column if not exists (for existing databases)
    try {
        db.prepare('ALTER TABLE users ADD COLUMN rejoin_count INTEGER DEFAULT 0').run();
    } catch (e) {
        // Column already exists, ignore
    }

    // Add custom_avatar column for profile card feature
    try {
        db.prepare('ALTER TABLE users ADD COLUMN custom_avatar TEXT').run();
    } catch (e) {
        // Column already exists, ignore
    }

    // Add avatar_banned column for banning users from setting avatar
    try {
        db.prepare('ALTER TABLE users ADD COLUMN avatar_banned INTEGER DEFAULT 0').run();
    } catch (e) {
        // Column already exists, ignore
    }

    // Add backup_avatar column for dual image service (Cloudinary + ImgBB fallback)
    try {
        db.prepare('ALTER TABLE users ADD COLUMN backup_avatar TEXT').run();
    } catch (e) { }

    // Add avatar_random_mode column (0=off, 1=all, 2=list)
    try {
        db.prepare('ALTER TABLE users ADD COLUMN avatar_random_mode INTEGER DEFAULT 0').run();
    } catch (e) { }

    // Add avatar_random_list column (JSON array of image numbers)
    try {
        db.prepare('ALTER TABLE users ADD COLUMN avatar_random_list TEXT').run();
    } catch (e) { }

    // Add kc_subtype column for custom KC position subtypes (ty, tl, etc.)
    try {
        db.prepare('ALTER TABLE users ADD COLUMN kc_subtype TEXT').run();
    } catch (e) {
        // Column already exists, ignore
    }

    // Create bangchien_history table for storing bang chien session history
    const createBangchienHistoryTable = db.prepare(`
        CREATE TABLE IF NOT EXISTS bangchien_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            leader_id TEXT NOT NULL,
            leader_name TEXT NOT NULL,
            participant_count INTEGER NOT NULL,
            participants TEXT NOT NULL,
            message_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    createBangchienHistoryTable.run();

    // Add columns for all registrations if not exists
    try {
        db.prepare('ALTER TABLE bangchien_history ADD COLUMN total_registrations INTEGER DEFAULT 0').run();
    } catch (e) { }
    try {
        db.prepare('ALTER TABLE bangchien_history ADD COLUMN all_participants TEXT').run();
    } catch (e) { }
    // Add result column for win/lose (null = chưa ghi nhận, 'win' = thắng, 'lose' = thua)
    try {
        db.prepare('ALTER TABLE bangchien_history ADD COLUMN result TEXT').run();
    } catch (e) { }
    // Add team columns for team split
    try {
        db.prepare('ALTER TABLE bangchien_history ADD COLUMN team_defense TEXT').run();
    } catch (e) { }
    try {
        db.prepare('ALTER TABLE bangchien_history ADD COLUMN team_offense TEXT').run();
    } catch (e) { }
    // Add commander and team leader columns
    try {
        db.prepare('ALTER TABLE bangchien_history ADD COLUMN commander_id TEXT').run();
    } catch (e) { }
    try {
        db.prepare('ALTER TABLE bangchien_history ADD COLUMN team1_leader_id TEXT').run();
    } catch (e) { }
    try {
        db.prepare('ALTER TABLE bangchien_history ADD COLUMN team2_leader_id TEXT').run();
    } catch (e) { }
    // ======== NEW 4-TEAM COLUMNS ========
    // Team Công 1 (team_attack1) - thay thế team_offense cũ
    try {
        db.prepare('ALTER TABLE bangchien_history ADD COLUMN team_attack1 TEXT').run();
    } catch (e) { }
    // Team Công 2 (team_attack2)
    try {
        db.prepare('ALTER TABLE bangchien_history ADD COLUMN team_attack2 TEXT').run();
    } catch (e) { }
    // Team Rừng (team_forest)
    try {
        db.prepare('ALTER TABLE bangchien_history ADD COLUMN team_forest TEXT').run();
    } catch (e) { }
    // 4 Leader IDs
    try {
        db.prepare('ALTER TABLE bangchien_history ADD COLUMN team3_leader_id TEXT').run();
    } catch (e) { }
    try {
        db.prepare('ALTER TABLE bangchien_history ADD COLUMN team4_leader_id TEXT').run();
    } catch (e) { }

    // Create bangchien_active table for storing ACTIVE sessions (before chốt)
    const createBangchienActiveTable = db.prepare(`
        CREATE TABLE IF NOT EXISTS bangchien_active (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            party_key TEXT NOT NULL UNIQUE,
            leader_id TEXT NOT NULL,
            leader_name TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            message_id TEXT,
            team_defense TEXT DEFAULT '[]',
            team_offense TEXT DEFAULT '[]',
            waiting_list TEXT DEFAULT '[]',
            commander_id TEXT,
            team1_leader_id TEXT,
            team2_leader_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    createBangchienActiveTable.run();

    // ======== NEW 4-TEAM COLUMNS FOR ACTIVE TABLE ========
    try {
        db.prepare('ALTER TABLE bangchien_active ADD COLUMN team_attack1 TEXT DEFAULT "[]"').run();
    } catch (e) { }
    try {
        db.prepare('ALTER TABLE bangchien_active ADD COLUMN team_attack2 TEXT DEFAULT "[]"').run();
    } catch (e) { }
    try {
        db.prepare('ALTER TABLE bangchien_active ADD COLUMN team_forest TEXT DEFAULT "[]"').run();
    } catch (e) { }
    try {
        db.prepare('ALTER TABLE bangchien_active ADD COLUMN team3_leader_id TEXT').run();
    } catch (e) { }
    try {
        db.prepare('ALTER TABLE bangchien_active ADD COLUMN team4_leader_id TEXT').run();
    } catch (e) { }

    // ======== BC PRESET TABLE - Slot cố định cho Team Thủ/Rừng (MULTI-DAY) ========
    // MIGRATION: Recreate table with new UNIQUE constraint including 'day'
    try {
        // Check if we need to migrate (old table has UNIQUE(guild_id, preset_type) without day)
        const tableInfo = db.prepare(`PRAGMA table_info(bangchien_preset)`).all();
        const hasDayColumn = tableInfo.some(col => col.name === 'day');

        if (!hasDayColumn || tableInfo.length > 0) {
            // Check if constraint is old format by checking existing data
            const existingData = db.prepare(`SELECT * FROM bangchien_preset`).all();

            if (existingData.length > 0) {
                // Backup and recreate
                console.log('[db] Migrating bangchien_preset table to MULTI-DAY format...');

                // Drop old table
                db.prepare(`DROP TABLE IF EXISTS bangchien_preset`).run();

                // Create new table with day column
                db.prepare(`
                    CREATE TABLE bangchien_preset (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        preset_type TEXT NOT NULL,
                        members TEXT DEFAULT '[]',
                        day TEXT DEFAULT 'sat',
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(guild_id, preset_type, day)
                    )
                `).run();

                // Restore data with day='sat' (default)
                const insertStmt = db.prepare(`
                    INSERT INTO bangchien_preset (guild_id, preset_type, members, day, updated_at)
                    VALUES (?, ?, ?, 'sat', CURRENT_TIMESTAMP)
                `);
                for (const row of existingData) {
                    insertStmt.run(row.guild_id, row.preset_type, row.members);
                }
                console.log(`[db] Migrated ${existingData.length} preset records to MULTI-DAY format`);
            }
        }
    } catch (e) {
        // Table doesn't exist yet, create it fresh
        console.log('[db] Creating new bangchien_preset table with MULTI-DAY support');
    }

    // Ensure table exists with correct schema
    db.prepare(`
        CREATE TABLE IF NOT EXISTS bangchien_preset (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            preset_type TEXT NOT NULL,
            members TEXT DEFAULT '[]',
            day TEXT DEFAULT 'sat',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(guild_id, preset_type, day)
        )
    `).run();

    // ======== BC REGULAR TABLE - Người tham gia định kỳ (MULTI-DAY) ========
    const createBcRegularTable = db.prepare(`
        CREATE TABLE IF NOT EXISTS bc_regular (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            discord_id TEXT NOT NULL,
            username TEXT NOT NULL,
            day TEXT DEFAULT 'sat',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(guild_id, discord_id, day)
        )
    `);
    createBcRegularTable.run();

    // Migration: Recreate table with correct UNIQUE constraint (guild_id, discord_id, day)
    try {
        // Check unique index - nếu không có day trong index thì cần migrate
        const indexInfo = db.prepare("PRAGMA index_list(bc_regular)").all();
        let needMigration = false;

        for (const idx of indexInfo) {
            if (idx.unique) {
                const cols = db.prepare(`PRAGMA index_info(${idx.name})`).all();
                const colNames = cols.map(c => c.name);
                // Nếu unique index chỉ có guild_id, discord_id mà KHÔNG có day -> cần migrate
                if (colNames.includes('guild_id') && colNames.includes('discord_id') && !colNames.includes('day')) {
                    needMigration = true;
                    break;
                }
            }
        }

        if (needMigration) {
            console.log('[DB] Migrating bc_regular table to add day to unique constraint...');
            db.exec(`
                CREATE TABLE IF NOT EXISTS bc_regular_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guild_id TEXT NOT NULL,
                    discord_id TEXT NOT NULL,
                    username TEXT NOT NULL,
                    day TEXT DEFAULT 'sat',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(guild_id, discord_id, day)
                );
                INSERT OR IGNORE INTO bc_regular_new (guild_id, discord_id, username, day, created_at)
                    SELECT guild_id, discord_id, username, COALESCE(day, 'sat'), created_at FROM bc_regular;
                DROP TABLE bc_regular;
                ALTER TABLE bc_regular_new RENAME TO bc_regular;
            `);
            console.log('[DB] Migrated bc_regular table successfully!');
        }
    } catch (e) {
        console.error('[DB] Migration error:', e.message);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MULTI-DAY COLUMNS (T7/CN)
    // ═══════════════════════════════════════════════════════════════════════════

    // Thêm column 'day' vào bangchien_active
    try {
        db.prepare('ALTER TABLE bangchien_active ADD COLUMN day TEXT').run();
    } catch (e) { }

    // Thêm column 'day' vào bangchien_preset
    try {
        db.prepare('ALTER TABLE bangchien_preset ADD COLUMN day TEXT DEFAULT "sat"').run();
        // Migrate preset cũ → day = 'sat' (Thứ 7)
        db.prepare('UPDATE bangchien_preset SET day = "sat" WHERE day IS NULL').run();
    } catch (e) { }

    // Thêm column 'day' vào bc_regular
    try {
        db.prepare('ALTER TABLE bc_regular ADD COLUMN day TEXT DEFAULT "sat"').run();
        // Migrate regular cũ → day = 'sat' (Thứ 7)
        db.prepare('UPDATE bc_regular SET day = "sat" WHERE day IS NULL').run();
    } catch (e) { }

    // Tạo lại bảng với UNIQUE constraint mới nếu cần
    // (SQLite không hỗ trợ DROP CONSTRAINT nên dùng cách khác nếu cần)
    // Hiện tại chấp nhận UNIQUE cũ, sẽ handle ở application level

    // ═══════════════════════════════════════════════════════════════════════════
    // ALBUM TABLE - Lưu ảnh từ Phòng Ảnh
    // ═══════════════════════════════════════════════════════════════════════════
    const createAlbumTable = db.prepare(`
        CREATE TABLE IF NOT EXISTS album (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            image_url TEXT NOT NULL,
            image_number INTEGER NOT NULL,
            message_id TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, image_number)
        )
    `);
    createAlbumTable.run();

    // Create indexes for album
    try {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_album_user ON album(user_id)').run();
        db.prepare('CREATE INDEX IF NOT EXISTS idx_album_message ON album(message_id)').run();
    } catch (e) { }

    // ═══════════════════════════════════════════════════════════════════════════
    // DISPLAY ROLE SYSTEM - Role hiển thị icon cạnh tên
    // ═══════════════════════════════════════════════════════════════════════════

    // Bảng display_roles - Lưu thông tin display role cho mỗi sub-role
    const createDisplayRolesTable = db.prepare(`
        CREATE TABLE IF NOT EXISTS display_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            sub_role_code TEXT NOT NULL,
            display_role_id TEXT,
            source_role_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(guild_id, sub_role_code)
        )
    `);
    createDisplayRolesTable.run();

    // Bảng user_display - Lưu user đang show icon gì
    const createUserDisplayTable = db.prepare(`
        CREATE TABLE IF NOT EXISTS user_display (
            discord_id TEXT PRIMARY KEY,
            current_display_code TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    createUserDisplayTable.run();

    // Thêm column for_all vào sub_role_mappings config (lưu trong config)
    // Không cần alter table vì sub_roles lưu trong config JSON

    // ═══════════════════════════════════════════════════════════════════════════
    // BOOSTER VOICE ROOM TABLES
    // ═══════════════════════════════════════════════════════════════════════════
    db.prepare(`
        CREATE TABLE IF NOT EXISTS booster_rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT UNIQUE NOT NULL,
            channel_id TEXT NOT NULL,
            guild_id TEXT NOT NULL,
            room_name TEXT,
            mode TEXT DEFAULT 'hidden',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS booster_room_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_owner_id TEXT NOT NULL,
            member_id TEXT NOT NULL,
            UNIQUE(room_owner_id, member_id)
        )
    `).run();

    console.log('✅ Database initialized successfully');
}

// ============== CONFIG FUNCTIONS ==============

/**
 * Get config value by key
 * @param {string} key - Config key
 * @returns {string|null} Config value or null
 */
function getConfig(key) {
    const stmt = db.prepare('SELECT value FROM config WHERE key = ?');
    const result = stmt.get(key);
    return result ? result.value : null;
}

/**
 * Set config value
 * @param {string} key - Config key
 * @param {string} value - Config value
 * @returns {Object} Result object
 */
function setConfig(key, value) {
    const stmt = db.prepare(`
        INSERT INTO config (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP
    `);
    const result = stmt.run(key, value);
    return { success: true, changes: result.changes };
}

/**
 * Get all custom kc names (positions that aren't bc, pbc, kc, mem)
 * @returns {Array} Array of custom position names
 */
function getCustomKcNames() {
    const customNames = getConfig('custom_kc_names');
    return customNames ? JSON.parse(customNames) : [];
}

/**
 * Add custom kc name
 * @param {string} name - Custom position name
 */
function addCustomKcName(name) {
    const current = getCustomKcNames();
    if (!current.includes(name.toLowerCase())) {
        current.push(name.toLowerCase());
        setConfig('custom_kc_names', JSON.stringify(current));
    }
}

// ============== TEAM SIZE FUNCTIONS ==============

/**
 * Get team size for a specific team
 * @param {string} teamType - 'defense' or 'forest'
 * @returns {number} Team size (default: 5)
 */
function getTeamSize(teamType) {
    const key = `team_size_${teamType}`;
    const value = getConfig(key);
    return value ? parseInt(value) : 5; // Default 5
}

/**
 * Set team size for a specific team
 * @param {string} teamType - 'defense' or 'forest'
 * @param {number} size - New team size
 */
function setTeamSize(teamType, size) {
    const key = `team_size_${teamType}`;
    setConfig(key, size.toString());
}

/**
 * Get all team sizes
 * @returns {Object} { attack1: X, attack2: Y, defense: Z, forest: W }
 */
function getAllTeamSizes() {
    return {
        attack1: getTeamSize('attack1') || 10,
        attack2: getTeamSize('attack2') || 10,
        defense: getTeamSize('defense') ?? 5,
        forest: getTeamSize('forest') ?? 5
    };
}

// ============== USER FUNCTIONS ==============

/**
 * Add or update user with position and join date
 * @param {Object} userData - User data object
 * @returns {Object} Result object
 */
function upsertUser(userData) {
    const { discordId, discordName, gameUsername, gameUid, position, serverName, notes, joinedAt } = userData;

    // Use provided joinedAt or current timestamp
    const joinDate = joinedAt || new Date().toISOString();

    const stmt = db.prepare(`
        INSERT INTO users (discord_id, discord_name, game_username, game_uid, position, server_name, notes, joined_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(discord_id) DO UPDATE SET
            discord_name = excluded.discord_name,
            game_username = excluded.game_username,
            game_uid = excluded.game_uid,
            position = excluded.position,
            server_name = excluded.server_name,
            notes = excluded.notes,
            joined_at = excluded.joined_at,
            updated_at = CURRENT_TIMESTAMP
    `);

    const result = stmt.run(discordId, discordName, gameUsername, gameUid, position || 'mem', serverName, notes, joinDate);
    return { success: true, changes: result.changes };
}

/**
 * Get user by Discord ID
 * @param {string} discordId - Discord user ID
 * @returns {Object|null} User object or null
 */
function getUserByDiscordId(discordId) {
    const stmt = db.prepare('SELECT * FROM users WHERE discord_id = ?');
    return stmt.get(discordId);
}

/**
 * Get user by game UID
 * @param {string} gameUid - Game UID
 * @returns {Object|null} User object or null
 */
function getUserByGameUid(gameUid) {
    const stmt = db.prepare('SELECT * FROM users WHERE game_uid = ? ORDER BY left_at ASC');
    return stmt.get(gameUid);
}

/**
 * Get user by game username (exact match, case insensitive)
 * @param {string} gameUsername - Game username
 * @returns {Object|null} User object or null
 */
function getUserByGameUsername(gameUsername) {
    const stmt = db.prepare('SELECT * FROM users WHERE LOWER(game_username) = LOWER(?) ORDER BY left_at ASC');
    return stmt.get(gameUsername);
}

/**
 * Get users by position
 * @param {string} position - Position to search for
 * @returns {Array} Array of user objects
 */
function getUsersByPosition(position) {
    const stmt = db.prepare('SELECT * FROM users WHERE position = ? ORDER BY discord_name ASC');
    return stmt.all(position);
}

/**
 * Check if position exists (for unique positions like bc, pbc)
 * @param {string} position - Position to check
 * @returns {Object|null} User with that position or null
 */
function getUniquePositionHolder(position) {
    const stmt = db.prepare('SELECT * FROM users WHERE position = ? LIMIT 1');
    return stmt.get(position);
}

/**
 * Get all users
 * @returns {Array} Array of user objects
 */
function getAllUsers() {
    const stmt = db.prepare('SELECT * FROM users ORDER BY discord_name ASC');
    return stmt.all();
}

/**
 * Search users by name (Discord or game)
 * @param {string} searchTerm - Search term
 * @returns {Array} Array of matching users
 */
function searchUsers(searchTerm) {
    const stmt = db.prepare(`
        SELECT * FROM users 
        WHERE discord_name LIKE ? OR game_username LIKE ?
        ORDER BY discord_name ASC
    `);
    const term = `%${searchTerm}%`;
    return stmt.all(term, term);
}

/**
 * Delete user by Discord ID
 * @param {string} discordId - Discord user ID
 * @returns {Object} Result object
 */
function deleteUser(discordId) {
    const stmt = db.prepare('DELETE FROM users WHERE discord_id = ?');
    const result = stmt.run(discordId);
    return { success: result.changes > 0, changes: result.changes };
}

/**
 * Get user count
 * @returns {number} Total number of users
 */
function getUserCount() {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM users');
    return stmt.get().count;
}

/**
 * Update user position
 * @param {string} discordId - Discord user ID
 * @param {string} position - New position
 * @returns {Object} Result object
 */
function updateUserPosition(discordId, position) {
    const stmt = db.prepare('UPDATE users SET position = ?, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?');
    const result = stmt.run(position, discordId);
    return { success: result.changes > 0, changes: result.changes };
}

/**
 * Update all users with a specific position to a new position name
 * @param {string} oldPosition - Old position name
 * @param {string} newPosition - New position name
 * @returns {Object} Result object
 */
function updatePositionName(oldPosition, newPosition) {
    const stmt = db.prepare('UPDATE users SET position = ?, updated_at = CURRENT_TIMESTAMP WHERE position = ?');
    const result = stmt.run(newPosition, oldPosition);
    return { success: true, changes: result.changes };
}

/**
 * Set user's KC subtype (ty, tl, etc.)
 * @param {string} discordId - Discord user ID
 * @param {string} subtype - KC subtype (e.g., 'ty', 'tl')
 * @returns {Object} Result object
 */
function setUserKcSubtype(discordId, subtype) {
    const stmt = db.prepare('UPDATE users SET kc_subtype = ?, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?');
    const result = stmt.run(subtype, discordId);
    return { success: result.changes > 0, changes: result.changes };
}

/**
 * Get user's KC subtype
 * @param {string} discordId - Discord user ID
 * @returns {string|null} KC subtype or null
 */
function getUserKcSubtype(discordId) {
    const stmt = db.prepare('SELECT kc_subtype FROM users WHERE discord_id = ?');
    const result = stmt.get(discordId);
    return result ? result.kc_subtype : null;
}

/**
 * Set user's sub_role
 * @param {string} discordId - Discord user ID
 * @param {string} subRole - Sub role code (e.g., 'ty', 'tl')
 * @returns {Object} Result object
 */
function setUserSubRole(discordId, subRole) {
    // First check if sub_role column exists, if not add it
    try {
        db.prepare('SELECT sub_role FROM users LIMIT 1').get();
    } catch (e) {
        db.prepare('ALTER TABLE users ADD COLUMN sub_role TEXT').run();
    }

    const stmt = db.prepare('UPDATE users SET sub_role = ?, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?');
    const result = stmt.run(subRole, discordId);
    return { success: result.changes > 0, changes: result.changes };
}

/**
 * Get user's sub_role
 * @param {string} discordId - Discord user ID
 * @returns {string|null} Sub role or null
 */
function getUserSubRole(discordId) {
    try {
        const stmt = db.prepare('SELECT sub_role FROM users WHERE discord_id = ?');
        const result = stmt.get(discordId);
        return result ? result.sub_role : null;
    } catch (e) {
        return null;
    }
}

// Initialize database on module load
initializeDatabase();

/**
 * Get all active users (not left)
 * @returns {Array} Array of active user objects
 */
function getActiveUsers() {
    const stmt = db.prepare('SELECT * FROM users WHERE left_at IS NULL ORDER BY discord_name ASC');
    return stmt.all();
}

/**
 * Mark user as left guild
 * @param {string} discordId - Discord user ID
 * @param {string} leftAt - Optional ISO timestamp, defaults to current time
 * @returns {Object} Result object
 */
function markUserAsLeft(discordId, leftAt) {
    const leftDate = leftAt || new Date().toISOString();
    const stmt = db.prepare('UPDATE users SET position = ?, left_at = ?, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?');
    const result = stmt.run('Không có', leftDate, discordId);
    return { success: result.changes > 0, changes: result.changes };
}

/**
 * Rejoin user - clear left_at and increment rejoin_count
 * @param {string} discordId - Discord user ID
 * @param {Object} newData - New user data
 * @returns {Object} Result object
 */
function rejoinUser(discordId, newData) {
    const { discordName, gameUsername, gameUid, position, joinedAt } = newData;

    const stmt = db.prepare(`
        UPDATE users SET 
            discord_name = ?,
            game_username = ?,
            game_uid = ?,
            position = ?,
            joined_at = ?,
            left_at = NULL,
            rejoin_count = rejoin_count + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE discord_id = ?
    `);

    const result = stmt.run(discordName, gameUsername, gameUid, position, joinedAt, discordId);
    return { success: result.changes > 0, changes: result.changes };
}

// ============== BANGCHIEN ACTIVE FUNCTIONS ==============

/**
 * Create new active BC session (MULTI-DAY)
 * @param {Object} data - Session data including day
 * @returns {Object} Result with inserted id
 */
function createActiveBangchien(data) {
    // Xóa session cũ nếu có (tránh UNIQUE constraint error)
    try {
        db.prepare('DELETE FROM bangchien_active WHERE party_key = ?').run(data.partyKey);
    } catch (e) { }

    const stmt = db.prepare(`
        INSERT INTO bangchien_active (guild_id, party_key, leader_id, leader_name, channel_id, message_id, team_attack1, day)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // Leader starts in team_attack1 (4-TEAM SYSTEM)
    const leaderData = [{ id: data.leaderId, username: data.leaderName, isLeader: true, joinedAt: Date.now() }];
    const result = stmt.run(
        data.guildId,
        data.partyKey,
        data.leaderId,
        data.leaderName,
        data.channelId,
        data.messageId || null,
        JSON.stringify(leaderData),
        data.day || null  // MULTI-DAY: 'sat' or 'sun'
    );
    return { success: true, id: result.lastInsertRowid };
}


/**
 * Get active BC session by party key
 * @param {string} partyKey - Party key
 * @returns {Object|null} Session data or null
 */
function getActiveBangchien(partyKey) {
    const stmt = db.prepare('SELECT * FROM bangchien_active WHERE party_key = ?');
    const result = stmt.get(partyKey);
    if (result) {
        result.team_defense = JSON.parse(result.team_defense || '[]');
        result.team_offense = JSON.parse(result.team_offense || '[]');
        result.waiting_list = JSON.parse(result.waiting_list || '[]');
        // NEW 4-team columns
        result.team_attack1 = JSON.parse(result.team_attack1 || '[]');
        result.team_attack2 = JSON.parse(result.team_attack2 || '[]');
        result.team_forest = JSON.parse(result.team_forest || '[]');
    }
    return result;
}

/**
 * Get active BC session by guild
 * @param {string} guildId - Guild ID
 * @returns {Array} Array of active sessions
 */
function getActiveBangchienByGuild(guildId) {
    const stmt = db.prepare('SELECT * FROM bangchien_active WHERE guild_id = ?');
    const results = stmt.all(guildId);
    return results.map(r => {
        r.team_defense = JSON.parse(r.team_defense || '[]');
        r.team_offense = JSON.parse(r.team_offense || '[]');
        r.waiting_list = JSON.parse(r.waiting_list || '[]');
        // NEW 4-team columns
        r.team_attack1 = JSON.parse(r.team_attack1 || '[]');
        r.team_attack2 = JSON.parse(r.team_attack2 || '[]');
        r.team_forest = JSON.parse(r.team_forest || '[]');
        return r;
    });
}

/**
 * Get active BC session by guild and day (MULTI-DAY)
 * @param {string} guildId - Guild ID
 * @param {string} day - 'sat' or 'sun'
 * @returns {Object|null} Session data or null
 */
function getActiveBangchienByDay(guildId, day) {
    const stmt = db.prepare('SELECT * FROM bangchien_active WHERE guild_id = ? AND day = ?');
    const result = stmt.get(guildId, day);
    if (result) {
        result.team_defense = JSON.parse(result.team_defense || '[]');
        result.team_offense = JSON.parse(result.team_offense || '[]');
        result.waiting_list = JSON.parse(result.waiting_list || '[]');
        result.team_attack1 = JSON.parse(result.team_attack1 || '[]');
        result.team_attack2 = JSON.parse(result.team_attack2 || '[]');
        result.team_forest = JSON.parse(result.team_forest || '[]');
    }
    return result;
}

/**
 * Add participant to active BC - auto-assign to team (4-TEAM SYSTEM)
 * @param {string} partyKey - Party key
 * @param {Object} participant - { id, username }
 * @param {string} guildId - Guild ID for preset checking
 * @returns {Object} Result with team assignment
 */
function addBangchienParticipant(partyKey, participant, guildId = null) {
    const session = getActiveBangchien(partyKey);
    if (!session) return { success: false, error: 'Session not found' };

    // Check if already exists in any team
    const allParticipants = [
        ...session.team_attack1,
        ...session.team_attack2,
        ...session.team_defense,
        ...session.team_forest,
        ...session.waiting_list
    ];
    if (allParticipants.some(p => p.id === participant.id)) {
        return { success: false, error: 'Already registered' };
    }

    // Team sizes (all dynamic from DB)
    const TEAM_ATTACK1_SIZE = getTeamSize('attack1') || 10;
    const TEAM_ATTACK2_SIZE = getTeamSize('attack2') || 10;
    const TEAM_DEFENSE_SIZE = getTeamSize('defense') ?? 5;
    const TEAM_FOREST_SIZE = getTeamSize('forest') ?? 5;

    const newParticipant = { ...participant, joinedAt: Date.now(), isLeader: false };
    let team = '';

    // Check preset (MULTI-DAY: lấy preset theo ngày của session)
    const sessionDay = session.day || 'sat';
    const presetThu = guildId ? getBcPreset(guildId, 'thu', sessionDay) : [];
    const presetRung = guildId ? getBcPreset(guildId, 'rung', sessionDay) : [];
    const isPresetThu = presetThu.some(p => p.id === participant.id);
    const isPresetRung = presetRung.some(p => p.id === participant.id);

    // Get user role for balancing
    const userRole = participant.role || 'DPS';
    newParticipant.role = userRole;

    // Helper: count role in team
    const countRoleInTeam = (teamArr, role) => teamArr.filter(p => p.role === role).length;

    const attack1Count = session.team_attack1.length;
    const attack2Count = session.team_attack2.length;

    // ========== CASE 1: PRESET THỦ → vào Team Thủ ngay ==========
    if (isPresetThu) {
        if (session.team_defense.length < TEAM_DEFENSE_SIZE) {
            session.team_defense.push(newParticipant);
            team = 'defense';
        } else {
            // Team Thủ full - try to swap non-preset member
            const nonPresetIdx = session.team_defense.findIndex(p => !presetThu.some(pr => pr.id === p.id));
            if (nonPresetIdx !== -1) {
                const [removedPerson] = session.team_defense.splice(nonPresetIdx, 1);
                // Move removed person to Công hoặc Chờ
                if (attack1Count < TEAM_ATTACK1_SIZE) {
                    session.team_attack1.push(removedPerson);
                } else if (attack2Count < TEAM_ATTACK2_SIZE) {
                    session.team_attack2.push(removedPerson);
                } else {
                    session.waiting_list.push(removedPerson);
                }
                session.team_defense.push(newParticipant);
                team = 'defense';
            } else {
                // Tất cả trong Thủ đều là preset → vào Công như bình thường
                team = ''; // Will be handled below
            }
        }
    }
    // ========== CASE 2: PRESET RỪNG → vào Team Rừng ngay ==========
    else if (isPresetRung) {
        if (session.team_forest.length < TEAM_FOREST_SIZE) {
            session.team_forest.push(newParticipant);
            team = 'forest';
        } else {
            // Team Rừng full - try to swap non-preset member
            const nonPresetIdx = session.team_forest.findIndex(p => !presetRung.some(pr => pr.id === p.id));
            if (nonPresetIdx !== -1) {
                const [removedPerson] = session.team_forest.splice(nonPresetIdx, 1);
                // Move removed person to Công hoặc Chờ
                if (attack1Count < TEAM_ATTACK1_SIZE) {
                    session.team_attack1.push(removedPerson);
                } else if (attack2Count < TEAM_ATTACK2_SIZE) {
                    session.team_attack2.push(removedPerson);
                } else {
                    session.waiting_list.push(removedPerson);
                }
                session.team_forest.push(newParticipant);
                team = 'forest';
            } else {
                // Tất cả trong Rừng đều là preset → vào Công như bình thường
                team = ''; // Will be handled below
            }
        }
    }

    // ========== CASE 3: KHÔNG PRESET → chỉ vào Công 1/Công 2 ==========
    if (!team) {
        // Recalculate counts after possible swap
        const att1Count = session.team_attack1.length;
        const att2Count = session.team_attack2.length;

        if (userRole === 'Healer' || userRole === 'Tanker') {
            // Healer/Tanker: cân bằng giữa 2 team Công
            const att1RoleCount = countRoleInTeam(session.team_attack1, userRole);
            const att2RoleCount = countRoleInTeam(session.team_attack2, userRole);

            if (att1Count < TEAM_ATTACK1_SIZE && att2Count < TEAM_ATTACK2_SIZE) {
                if (att1RoleCount <= att2RoleCount) {
                    session.team_attack1.push(newParticipant);
                    team = 'attack1';
                } else {
                    session.team_attack2.push(newParticipant);
                    team = 'attack2';
                }
            } else if (att1Count < TEAM_ATTACK1_SIZE) {
                session.team_attack1.push(newParticipant);
                team = 'attack1';
            } else if (att2Count < TEAM_ATTACK2_SIZE) {
                session.team_attack2.push(newParticipant);
                team = 'attack2';
            }
        } else {
            // DPS: cân bằng số lượng giữa 2 team
            if (att1Count < TEAM_ATTACK1_SIZE && att2Count < TEAM_ATTACK2_SIZE) {
                if (att1Count <= att2Count) {
                    session.team_attack1.push(newParticipant);
                    team = 'attack1';
                } else {
                    session.team_attack2.push(newParticipant);
                    team = 'attack2';
                }
            } else if (att1Count < TEAM_ATTACK1_SIZE) {
                session.team_attack1.push(newParticipant);
                team = 'attack1';
            } else if (att2Count < TEAM_ATTACK2_SIZE) {
                session.team_attack2.push(newParticipant);
                team = 'attack2';
            }
        }

        // ========== Công đã đầy → overflow vào Thủ/Rừng/Chờ ==========
        if (!team) {
            if (session.team_defense.length < TEAM_DEFENSE_SIZE) {
                session.team_defense.push(newParticipant);
                team = 'defense';
            } else if (session.team_forest.length < TEAM_FOREST_SIZE) {
                session.team_forest.push(newParticipant);
                team = 'forest';
            } else {
                session.waiting_list.push(newParticipant);
                team = 'waiting';
            }
        }
    }

    // Update DB
    const stmt = db.prepare(`
        UPDATE bangchien_active
        SET team_attack1 = ?, team_attack2 = ?, team_defense = ?, team_forest = ?, waiting_list = ?, updated_at = CURRENT_TIMESTAMP
        WHERE party_key = ?
    `);
    stmt.run(
        JSON.stringify(session.team_attack1),
        JSON.stringify(session.team_attack2),
        JSON.stringify(session.team_defense),
        JSON.stringify(session.team_forest),
        JSON.stringify(session.waiting_list),
        partyKey
    );

    // Calculate total
    const counts = {
        attack1: session.team_attack1.length,
        attack2: session.team_attack2.length,
        defense: session.team_defense.length,
        forest: session.team_forest.length,
        waiting: session.waiting_list.length
    };

    return {
        success: true,
        team,
        counts
    };
}

/**
 * Remove participant from active BC (4-TEAM SYSTEM)
 * @param {string} partyKey - Party key
 * @param {string} participantId - User ID to remove
 * @returns {Object} Result
 */
function removeBangchienParticipant(partyKey, participantId) {
    const session = getActiveBangchien(partyKey);
    if (!session) return { success: false, error: 'Session not found' };

    // Check if leader (leader now in team_attack1)
    const leader = session.team_attack1.find(p => p.isLeader && p.id === participantId);
    if (leader) return { success: false, error: 'Leader cannot leave' };

    let removed = false;
    let fromTeam = '';

    // Remove from attack1
    const att1Idx = session.team_attack1.findIndex(p => p.id === participantId);
    if (att1Idx !== -1) {
        session.team_attack1.splice(att1Idx, 1);
        removed = true;
        fromTeam = 'attack1';
    }

    // Remove from attack2
    if (!removed) {
        const att2Idx = session.team_attack2.findIndex(p => p.id === participantId);
        if (att2Idx !== -1) {
            session.team_attack2.splice(att2Idx, 1);
            removed = true;
            fromTeam = 'attack2';
        }
    }

    // Remove from defense
    if (!removed) {
        const defIdx = session.team_defense.findIndex(p => p.id === participantId);
        if (defIdx !== -1) {
            session.team_defense.splice(defIdx, 1);
            removed = true;
            fromTeam = 'defense';
        }
    }

    // Remove from forest
    if (!removed) {
        const forIdx = session.team_forest.findIndex(p => p.id === participantId);
        if (forIdx !== -1) {
            session.team_forest.splice(forIdx, 1);
            removed = true;
            fromTeam = 'forest';
        }
    }

    // Remove from waiting
    if (!removed) {
        const waitIdx = session.waiting_list.findIndex(p => p.id === participantId);
        if (waitIdx !== -1) {
            session.waiting_list.splice(waitIdx, 1);
            removed = true;
            fromTeam = 'waiting';
        }
    }

    if (!removed) return { success: false, error: 'Not found in session' };

    // Auto-promote from waiting list to attack teams if space available
    const TEAM_ATTACK_SIZE = 10;
    if (fromTeam !== 'waiting' && session.waiting_list.length > 0) {
        if ((fromTeam === 'attack1' || fromTeam === 'attack2') &&
            (session.team_attack1.length < TEAM_ATTACK_SIZE || session.team_attack2.length < TEAM_ATTACK_SIZE)) {
            const promoted = session.waiting_list.shift();
            if (session.team_attack1.length <= session.team_attack2.length && session.team_attack1.length < TEAM_ATTACK_SIZE) {
                session.team_attack1.push(promoted);
            } else if (session.team_attack2.length < TEAM_ATTACK_SIZE) {
                session.team_attack2.push(promoted);
            } else {
                session.waiting_list.unshift(promoted); // Put back
            }
        }
    }

    // Update DB
    const stmt = db.prepare(`
        UPDATE bangchien_active
        SET team_attack1 = ?, team_attack2 = ?, team_defense = ?, team_forest = ?, waiting_list = ?, updated_at = CURRENT_TIMESTAMP
        WHERE party_key = ?
    `);
    stmt.run(
        JSON.stringify(session.team_attack1),
        JSON.stringify(session.team_attack2),
        JSON.stringify(session.team_defense),
        JSON.stringify(session.team_forest),
        JSON.stringify(session.waiting_list),
        partyKey
    );

    return {
        success: true,
        counts: {
            attack1: session.team_attack1.length,
            attack2: session.team_attack2.length,
            defense: session.team_defense.length,
            forest: session.team_forest.length,
            waiting: session.waiting_list.length
        }
    };
}

/**
 * Update active BC session
 * @param {string} partyKey - Party key
 * @param {Object} updates - Fields to update
 * @returns {Object} Result
 */
function updateActiveBangchien(partyKey, updates) {
    const session = getActiveBangchien(partyKey);
    if (!session) return { success: false, error: 'Session not found' };

    const fields = [];
    const values = [];

    if (updates.team_defense !== undefined) {
        fields.push('team_defense = ?');
        values.push(JSON.stringify(updates.team_defense));
    }
    if (updates.team_offense !== undefined) {
        fields.push('team_offense = ?');
        values.push(JSON.stringify(updates.team_offense));
    }
    if (updates.waiting_list !== undefined) {
        fields.push('waiting_list = ?');
        values.push(JSON.stringify(updates.waiting_list));
    }
    if (updates.message_id !== undefined) {
        fields.push('message_id = ?');
        values.push(updates.message_id);
    }
    if (updates.commander_id !== undefined) {
        fields.push('commander_id = ?');
        values.push(updates.commander_id);
    }
    if (updates.team1_leader_id !== undefined) {
        fields.push('team1_leader_id = ?');
        values.push(updates.team1_leader_id);
    }
    if (updates.team2_leader_id !== undefined) {
        fields.push('team2_leader_id = ?');
        values.push(updates.team2_leader_id);
    }
    // NEW 4-team columns
    if (updates.team_attack1 !== undefined) {
        fields.push('team_attack1 = ?');
        values.push(JSON.stringify(updates.team_attack1));
    }
    if (updates.team_attack2 !== undefined) {
        fields.push('team_attack2 = ?');
        values.push(JSON.stringify(updates.team_attack2));
    }
    if (updates.team_forest !== undefined) {
        fields.push('team_forest = ?');
        values.push(JSON.stringify(updates.team_forest));
    }
    if (updates.team3_leader_id !== undefined) {
        fields.push('team3_leader_id = ?');
        values.push(updates.team3_leader_id);
    }
    if (updates.team4_leader_id !== undefined) {
        fields.push('team4_leader_id = ?');
        values.push(updates.team4_leader_id);
    }

    if (fields.length === 0) return { success: true, changes: 0 };

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(partyKey);

    const stmt = db.prepare(`UPDATE bangchien_active SET ${fields.join(', ')} WHERE party_key = ?`);
    const result = stmt.run(...values);
    return { success: true, changes: result.changes };
}

/**
 * Delete active BC session
 * @param {string} partyKey - Party key
 * @returns {Object} Result
 */
function deleteActiveBangchien(partyKey) {
    const stmt = db.prepare('DELETE FROM bangchien_active WHERE party_key = ?');
    const result = stmt.run(partyKey);
    return { success: true, changes: result.changes };
}

// ============== BANGCHIEN HISTORY FUNCTIONS ==============

/**
 * Save bangchien session to history
 * @param {Object} data - Session data
 * @returns {Object} Result with inserted id
 */
function saveBangchienHistory(data) {
    const stmt = db.prepare(`
        INSERT INTO bangchien_history (
            guild_id, leader_id, leader_name, participant_count, participants, message_id, 
            total_registrations, all_participants, team_defense, team_offense,
            team_attack1, team_attack2, team_forest, 
            commander_id, team1_leader_id, team2_leader_id, team3_leader_id, team4_leader_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const selectedJson = JSON.stringify(data.participants);
    const allJson = JSON.stringify(data.allParticipants || data.participants);
    const totalRegs = data.totalRegistrations || data.participants.length;
    const defenseJson = data.teamDefense ? JSON.stringify(data.teamDefense) : null;
    const offenseJson = data.teamOffense ? JSON.stringify(data.teamOffense) : null;
    // 4-TEAM data
    const attack1Json = data.teamAttack1 ? JSON.stringify(data.teamAttack1) : null;
    const attack2Json = data.teamAttack2 ? JSON.stringify(data.teamAttack2) : null;
    const forestJson = data.teamForest ? JSON.stringify(data.teamForest) : null;

    const result = stmt.run(
        data.guildId,
        data.leaderId,
        data.leaderName,
        data.participants.length,
        selectedJson,
        data.messageId || null,
        totalRegs,
        allJson,
        defenseJson,
        offenseJson,
        // 4-TEAM
        attack1Json,
        attack2Json,
        forestJson,
        // Leaders
        data.commanderId || null,
        data.team1LeaderId || null,
        data.team2LeaderId || null,
        data.team3LeaderId || null,
        data.team4LeaderId || null
    );
    return { success: result.changes > 0, id: result.lastInsertRowid };
}


/**
 * Get bangchien history for a guild
 * @param {string} guildId - Guild ID
 * @param {number} limit - Max records to return (default 20)
 * @returns {Array} Array of history records
 */
function getBangchienHistory(guildId, limit = 20) {
    const stmt = db.prepare(`
        SELECT id, guild_id, leader_id, leader_name, participant_count, participants, message_id, created_at, total_registrations, all_participants, result, team_defense, team_offense, commander_id, team1_leader_id, team2_leader_id, team_attack1, team_attack2, team_forest, team3_leader_id, team4_leader_id
        FROM bangchien_history
        WHERE guild_id = ?
        ORDER BY created_at DESC
        LIMIT ?
    `);
    const rows = stmt.all(guildId, limit);
    return rows.map(row => ({
        ...row,
        participants: JSON.parse(row.participants),
        team_defense: row.team_defense ? JSON.parse(row.team_defense) : [],
        team_offense: row.team_offense ? JSON.parse(row.team_offense) : [],
        // 4-TEAM columns
        team_attack1: row.team_attack1 ? JSON.parse(row.team_attack1) : [],
        team_attack2: row.team_attack2 ? JSON.parse(row.team_attack2) : [],
        team_forest: row.team_forest ? JSON.parse(row.team_forest) : [],
        waiting_list: row.waiting_list ? JSON.parse(row.waiting_list) : []
    }));
}


/**
 * Update bangchien result (win/lose) and update date to current time
 * @param {number} sessionId - Session ID
 * @param {string} result - 'win' or 'lose'
 * @param {Array} updatedParticipants - Optional updated participants with fresh roles
 * @returns {Object} Result object
 */
function updateBangchienResult(sessionId, result, updatedParticipants = null) {
    if (updatedParticipants) {
        // Update với participants mới (có role cập nhật)
        const participantsJson = JSON.stringify(updatedParticipants);
        const stmt = db.prepare('UPDATE bangchien_history SET result = ?, participants = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?');
        const res = stmt.run(result, participantsJson, sessionId);
        return { success: res.changes > 0, changes: res.changes };
    } else {
        // Chỉ update result
        const stmt = db.prepare('UPDATE bangchien_history SET result = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?');
        const res = stmt.run(result, sessionId);
        return { success: res.changes > 0, changes: res.changes };
    }
}

/**
 * Get bangchien session by id
 * @param {number} sessionId - Session ID
 * @returns {Object|null} Session or null
 */
function getBangchienSessionById(sessionId) {
    const stmt = db.prepare(`
        SELECT id, guild_id, leader_id, leader_name, participant_count, participants, message_id, created_at, total_registrations, all_participants, result, team_defense, team_offense, team_attack1, team_attack2, team_forest, commander_id, team1_leader_id, team2_leader_id, team3_leader_id, team4_leader_id
        FROM bangchien_history
        WHERE id = ?
    `);
    const row = stmt.get(sessionId);
    if (!row) return null;
    return {
        ...row,
        participants: JSON.parse(row.participants),
        team_defense: row.team_defense ? JSON.parse(row.team_defense) : [],
        team_offense: row.team_offense ? JSON.parse(row.team_offense) : [],
        team_attack1: row.team_attack1 ? JSON.parse(row.team_attack1) : [],
        team_attack2: row.team_attack2 ? JSON.parse(row.team_attack2) : [],
        team_forest: row.team_forest ? JSON.parse(row.team_forest) : [],
        waiting_list: row.waiting_list ? JSON.parse(row.waiting_list) : []
    };
}


/**
 * Get bangchien history by message ID (for reply-to-tag)
 * @param {string} messageId - Message ID
 * @returns {Object|null} History record or null
 */
function getBangchienHistoryById(messageId) {
    const stmt = db.prepare(`
        SELECT id, guild_id, leader_id, leader_name, participant_count, participants, message_id, created_at
        FROM bangchien_history
        WHERE message_id = ?
    `);
    const row = stmt.get(messageId);
    if (!row) return null;
    return {
        ...row,
        participants: JSON.parse(row.participants)
    };
}

/**
 * Delete a bangchien session by id
 * @param {number} sessionId - Session ID
 * @returns {Object} Result object
 */
function deleteBangchienSession(sessionId) {
    const stmt = db.prepare('DELETE FROM bangchien_history WHERE id = ?');
    const result = stmt.run(sessionId);
    return { success: result.changes > 0, changes: result.changes };
}

/**
 * Delete all bangchien history for a guild
 * @param {string} guildId - Guild ID
 * @returns {Object} Result object
 */
function deleteAllBangchienHistory(guildId) {
    const stmt = db.prepare('DELETE FROM bangchien_history WHERE guild_id = ?');
    const result = stmt.run(guildId);
    return { success: result.changes > 0, changes: result.changes };
}



// ============== BC PRESET FUNCTIONS (NEW) ==============

/**
 * Get BC preset by type (thu/rung) and day (MULTI-DAY)
 * @param {string} guildId - Guild ID
 * @param {string} presetType - 'thu' or 'rung'
 * @param {string} day - 'sat' or 'sun' (default: 'sat')
 * @returns {Array} Array of member objects
 */
function getBcPreset(guildId, presetType, day = 'sat') {
    const stmt = db.prepare('SELECT members FROM bangchien_preset WHERE guild_id = ? AND preset_type = ? AND day = ?');
    const result = stmt.get(guildId, presetType, day);
    return result ? JSON.parse(result.members || '[]') : [];
}

/**
 * Set BC preset (MULTI-DAY)
 * @param {string} guildId - Guild ID
 * @param {string} presetType - 'thu' or 'rung'
 * @param {Array} members - Array of member objects [{id, username}]
 * @param {string} day - 'sat' or 'sun' (default: 'sat')
 * @returns {Object} Result
 */
function setBcPreset(guildId, presetType, members, day = 'sat') {
    // Xóa preset cũ trước (để tránh duplicate key)
    db.prepare('DELETE FROM bangchien_preset WHERE guild_id = ? AND preset_type = ? AND day = ?')
        .run(guildId, presetType, day);

    const stmt = db.prepare(`
        INSERT INTO bangchien_preset (guild_id, preset_type, members, day, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(guildId, presetType, JSON.stringify(members), day);
    return { success: true, changes: result.changes };
}

/**
 * Clear BC preset (MULTI-DAY)
 * @param {string} guildId - Guild ID
 * @param {string} presetType - 'thu' or 'rung' or 'all'
 * @param {string} day - 'sat' or 'sun' or 'all' (default: 'all')
 * @returns {Object} Result
 */
function clearBcPreset(guildId, presetType, day = 'all') {
    if (presetType === 'all' && day === 'all') {
        const stmt = db.prepare('DELETE FROM bangchien_preset WHERE guild_id = ?');
        const result = stmt.run(guildId);
        return { success: true, changes: result.changes };
    }
    if (presetType === 'all') {
        const stmt = db.prepare('DELETE FROM bangchien_preset WHERE guild_id = ? AND day = ?');
        const result = stmt.run(guildId, day);
        return { success: true, changes: result.changes };
    }
    if (day === 'all') {
        const stmt = db.prepare('DELETE FROM bangchien_preset WHERE guild_id = ? AND preset_type = ?');
        const result = stmt.run(guildId, presetType);
        return { success: true, changes: result.changes };
    }
    const stmt = db.prepare('DELETE FROM bangchien_preset WHERE guild_id = ? AND preset_type = ? AND day = ?');
    const result = stmt.run(guildId, presetType, day);
    return { success: true, changes: result.changes };
}

// ============== BC REGULAR PARTICIPANTS (MULTI-DAY) ==============

/**
 * Add user to BC regular participants (MULTI-DAY)
 * @param {string} guildId - Guild ID
 * @param {string} discordId - Discord user ID
 * @param {string} username - Username
 * @param {string} day - 'sat' or 'sun' (default: 'sat')
 * @returns {Object} Result
 */
function addBcRegular(guildId, discordId, username, day = 'sat') {
    // Xóa record cũ trước (để tránh duplicate)
    db.prepare('DELETE FROM bc_regular WHERE guild_id = ? AND discord_id = ? AND day = ?')
        .run(guildId, discordId, day);

    const stmt = db.prepare(`
        INSERT INTO bc_regular (guild_id, discord_id, username, day, created_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(guildId, discordId, username, day);
    return { success: true };
}

/**
 * Remove user from BC regular participants (MULTI-DAY)
 * @param {string} guildId - Guild ID
 * @param {string} discordId - Discord user ID
 * @param {string} day - 'sat' or 'sun' (default: 'sat')
 * @returns {Object} Result
 */
function removeBcRegular(guildId, discordId, day = 'sat') {
    const stmt = db.prepare('DELETE FROM bc_regular WHERE guild_id = ? AND discord_id = ? AND day = ?');
    const result = stmt.run(guildId, discordId, day);
    return { success: true, removed: result.changes > 0 };
}

/**
 * Check if user is BC regular (MULTI-DAY)
 * @param {string} guildId - Guild ID
 * @param {string} discordId - Discord user ID
 * @param {string} day - 'sat' or 'sun' (default: 'sat')
 * @returns {boolean}
 */
function isBcRegular(guildId, discordId, day = 'sat') {
    const stmt = db.prepare('SELECT 1 FROM bc_regular WHERE guild_id = ? AND discord_id = ? AND day = ?');
    return !!stmt.get(guildId, discordId, day);
}

/**
 * Get all BC regular participants for a guild (MULTI-DAY)
 * @param {string} guildId - Guild ID
 * @param {string} day - 'sat' or 'sun' or null for all days
 * @returns {Array} Array of regular participants
 */
function getBcRegulars(guildId, day = null) {
    if (day) {
        const stmt = db.prepare('SELECT discord_id, username, day, created_at FROM bc_regular WHERE guild_id = ? AND day = ?');
        return stmt.all(guildId, day) || [];
    }
    const stmt = db.prepare('SELECT discord_id, username, day, created_at FROM bc_regular WHERE guild_id = ?');
    return stmt.all(guildId) || [];
}

/**
 * Clear all BC regular participants for a guild (MULTI-DAY)
 * @param {string} guildId - Guild ID
 * @param {string} day - 'sat' or 'sun' or 'all' (default: 'all')
 * @returns {Object} Result
 */
function clearBcRegulars(guildId, day = 'all') {
    if (day === 'all') {
        const stmt = db.prepare('DELETE FROM bc_regular WHERE guild_id = ?');
        const result = stmt.run(guildId);
        return { success: true, changes: result.changes };
    }
    const stmt = db.prepare('DELETE FROM bc_regular WHERE guild_id = ? AND day = ?');
    const result = stmt.run(guildId, day);
    return { success: true, changes: result.changes };
}

// ============== CUSTOM AVATAR FUNCTIONS ==============

/**
 * Set user's custom avatar URL (primary and optional backup)
 * @param {string} discordId - Discord user ID
 * @param {string} avatarUrl - Primary URL of custom avatar image
 * @param {string|null} backupUrl - Backup URL (optional, for fallback)
 * @returns {Object} Result object
 */
function setUserAvatar(discordId, avatarUrl, backupUrl = null) {
    const stmt = db.prepare('UPDATE users SET custom_avatar = ?, backup_avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?');
    const result = stmt.run(avatarUrl, backupUrl, discordId);
    return { success: result.changes > 0, changes: result.changes };
}

/**
 * Get user's custom avatar URLs (primary and backup)
 * @param {string} discordId - Discord user ID
 * @returns {Object|null} { primary, backup } or null if no avatar
 */
function getUserAvatar(discordId) {
    const stmt = db.prepare('SELECT custom_avatar, backup_avatar FROM users WHERE discord_id = ?');
    const result = stmt.get(discordId);
    if (!result?.custom_avatar) return null;
    return {
        primary: result.custom_avatar,
        backup: result.backup_avatar || null
    };
}

/**
 * Clear user's custom avatar
 * @param {string} discordId - Discord user ID
 * @returns {Object} Result object
 */
function clearUserAvatar(discordId) {
    const stmt = db.prepare('UPDATE users SET custom_avatar = NULL, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?');
    const result = stmt.run(discordId);
    return { success: result.changes > 0, changes: result.changes };
}

/**
 * Ban user from setting custom avatar
 * @param {string} discordId - Discord user ID
 * @returns {Object} Result object
 */
function banAvatarUser(discordId) {
    // Xóa avatar hiện tại và set flag ban
    const stmt = db.prepare('UPDATE users SET custom_avatar = NULL, avatar_banned = 1, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?');
    const result = stmt.run(discordId);
    return { success: result.changes > 0, changes: result.changes };
}

/**
 * Unban user from setting custom avatar
 * @param {string} discordId - Discord user ID
 * @returns {Object} Result object
 */
function unbanAvatarUser(discordId) {
    const stmt = db.prepare('UPDATE users SET avatar_banned = 0, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?');
    const result = stmt.run(discordId);
    return { success: result.changes > 0, changes: result.changes };
}

/**
 * Check if user is banned from setting avatar
 * @param {string} discordId - Discord user ID
 * @returns {boolean}
 */
function isAvatarBanned(discordId) {
    const stmt = db.prepare('SELECT avatar_banned FROM users WHERE discord_id = ?');
    const result = stmt.get(discordId);
    return result?.avatar_banned === 1;
}

// ============== ALBUM FUNCTIONS ==============

const ALBUM_MAX_IMAGES = 100; // Giới hạn 100 ảnh/người

/**
 * Get album channel ID from config
 * @returns {string|null} Channel ID or null
 */
function getAlbumChannelId() {
    return getConfig('album_channel_id');
}

/**
 * Set album channel ID
 * @param {string} channelId - Discord channel ID
 * @returns {Object} Result object
 */
function setAlbumChannelId(channelId) {
    return setConfig('album_channel_id', channelId);
}

/**
 * Add image to user's album (NEW = #1, old images shift back, delete #100 if over limit)
 * @param {string} userId - Discord user ID
 * @param {string} imageUrl - Image URL
 * @param {string} messageId - Message ID containing the image
 * @returns {Object} Result with image_number or error
 */
function addAlbumImage(userId, imageUrl, messageId) {
    const currentCount = getAlbumImageCount(userId);

    // Nếu đã đủ 100 ảnh, xóa ảnh cũ nhất (số lớn nhất)
    if (currentCount >= ALBUM_MAX_IMAGES) {
        // Xóa ảnh #100 (cũ nhất)
        db.prepare('DELETE FROM album WHERE user_id = ? AND image_number = ?').run(userId, ALBUM_MAX_IMAGES);
    }

    // Đẩy tất cả ảnh cũ lùi 1 số (1 -> 2, 2 -> 3, ...)
    // Phải update theo thứ tự DESC để tránh UNIQUE constraint violation
    const images = db.prepare('SELECT id FROM album WHERE user_id = ? ORDER BY image_number DESC').all(userId);
    const updateStmt = db.prepare('UPDATE album SET image_number = image_number + 1 WHERE id = ?');
    for (const img of images) {
        updateStmt.run(img.id);
    }

    // Thêm ảnh mới với số 1 và timestamp hiện tại
    const now = new Date().toISOString();
    const insertStmt = db.prepare('INSERT INTO album (user_id, image_url, image_number, message_id, created_at) VALUES (?, ?, 1, ?, ?)');
    const insertResult = insertStmt.run(userId, imageUrl, messageId, now);
    return { success: true, image_number: 1, id: insertResult.lastInsertRowid };
}

/**
 * Get user's album images with pagination
 */
function getAlbumImages(userId, page = 1, limit = 5) {
    const offset = (page - 1) * limit;
    const stmt = db.prepare('SELECT id, image_url, image_number, message_id, created_at FROM album WHERE user_id = ? ORDER BY image_number ASC LIMIT ? OFFSET ?');
    return stmt.all(userId, limit, offset);
}

/**
 * Get total image count for a user
 */
function getAlbumImageCount(userId) {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM album WHERE user_id = ?');
    return stmt.get(userId)?.count || 0;
}

/**
 * Get a specific image by user and image number
 */
function getAlbumImageByNumber(userId, imageNumber) {
    const stmt = db.prepare('SELECT * FROM album WHERE user_id = ? AND image_number = ?');
    return stmt.get(userId, imageNumber);
}

/**
 * Delete image and reorder remaining images
 * Khi xóa ảnh #X, các ảnh cũ hơn (#X+1, #X+2...) sẽ lùi về lấp chỗ trống
 */
function deleteAlbumImage(userId, imageNumber) {
    const deleteStmt = db.prepare('DELETE FROM album WHERE user_id = ? AND image_number = ?');
    const result = deleteStmt.run(userId, imageNumber);

    if (result.changes === 0) return { success: false };

    // Reorder từng ảnh một để tránh UNIQUE constraint conflict
    const userImages = db.prepare('SELECT id FROM album WHERE user_id = ? ORDER BY image_number ASC').all(userId);
    const updateStmt = db.prepare('UPDATE album SET image_number = ? WHERE id = ?');
    userImages.forEach((img, i) => updateStmt.run(i + 1, img.id));

    return { success: true };
}

/**
 * Delete image by message ID (when message deleted from channel)
 */
function deleteAlbumImageByMessageId(messageId) {
    const images = db.prepare('SELECT user_id, image_number FROM album WHERE message_id = ?').all(messageId);
    if (images.length === 0) return { success: true, changes: 0 };

    const affectedUsers = new Set(images.map(i => i.user_id));
    db.prepare('DELETE FROM album WHERE message_id = ?').run(messageId);

    // Reorder for each affected user
    for (const userId of affectedUsers) {
        const userImages = db.prepare('SELECT id FROM album WHERE user_id = ? ORDER BY image_number ASC').all(userId);
        const updateStmt = db.prepare('UPDATE album SET image_number = ? WHERE id = ?');
        userImages.forEach((img, i) => updateStmt.run(i + 1, img.id));
    }
    return { success: true, changes: images.length };
}

// ============== DISPLAY ROLE FUNCTIONS ==============

/**
 * Get display role for a sub-role code
 * @param {string} guildId - Guild ID
 * @param {string} subRoleCode - Sub role code (e.g., 'ty', 'tl')
 * @returns {Object|null} Display role data or null
 */
function getDisplayRole(guildId, subRoleCode) {
    const stmt = db.prepare('SELECT * FROM display_roles WHERE guild_id = ? AND sub_role_code = ?');
    return stmt.get(guildId, subRoleCode);
}

/**
 * Set/update display role for a sub-role code
 * @param {string} guildId - Guild ID
 * @param {string} subRoleCode - Sub role code
 * @param {string} displayRoleId - Discord role ID of display role
 * @param {string} sourceRoleId - Discord role ID of source role
 * @returns {Object} Result object
 */
function setDisplayRole(guildId, subRoleCode, displayRoleId, sourceRoleId) {
    const stmt = db.prepare(`
        INSERT INTO display_roles (guild_id, sub_role_code, display_role_id, source_role_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(guild_id, sub_role_code) DO UPDATE SET
            display_role_id = excluded.display_role_id,
            source_role_id = excluded.source_role_id
    `);
    const result = stmt.run(guildId, subRoleCode, displayRoleId, sourceRoleId);
    return { success: true, changes: result.changes };
}

/**
 * Delete display role record
 * @param {string} guildId - Guild ID
 * @param {string} subRoleCode - Sub role code
 * @returns {Object} Result object
 */
function deleteDisplayRole(guildId, subRoleCode) {
    const stmt = db.prepare('DELETE FROM display_roles WHERE guild_id = ? AND sub_role_code = ?');
    const result = stmt.run(guildId, subRoleCode);
    return { success: result.changes > 0, changes: result.changes };
}

/**
 * Get all display roles for a guild
 * @param {string} guildId - Guild ID
 * @returns {Array} Array of display role records
 */
function getAllDisplayRoles(guildId) {
    const stmt = db.prepare('SELECT * FROM display_roles WHERE guild_id = ?');
    return stmt.all(guildId);
}

/**
 * Get user's current display code
 * @param {string} discordId - Discord user ID
 * @returns {string|null} Current display code or null
 */
function getUserDisplay(discordId) {
    const stmt = db.prepare('SELECT current_display_code FROM user_display WHERE discord_id = ?');
    const result = stmt.get(discordId);
    return result ? result.current_display_code : null;
}

/**
 * Set user's current display code
 * @param {string} discordId - Discord user ID
 * @param {string|null} displayCode - Display code or null to clear
 * @returns {Object} Result object
 */
function setUserDisplay(discordId, displayCode) {
    const stmt = db.prepare(`
        INSERT INTO user_display (discord_id, current_display_code, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(discord_id) DO UPDATE SET
            current_display_code = excluded.current_display_code,
            updated_at = CURRENT_TIMESTAMP
    `);
    const result = stmt.run(discordId, displayCode);
    return { success: true, changes: result.changes };
}

/**
 * Clear user's display (set to null)
 * @param {string} discordId - Discord user ID
 * @returns {Object} Result object
 */
function clearUserDisplay(discordId) {
    return setUserDisplay(discordId, null);
}

/**
 * Get all users with a specific display code
 * @param {string} displayCode - Display code to search for
 * @returns {Array} Array of discord IDs
 */
function getUsersByDisplayCode(displayCode) {
    const stmt = db.prepare('SELECT discord_id FROM user_display WHERE current_display_code = ?');
    return stmt.all(displayCode).map(r => r.discord_id);
}

/**
 * Clear display code for all users with specific code (when role deleted)
 * @param {string} displayCode - Display code to clear
 * @returns {Object} Result object with count
 */
function clearDisplayCodeForAll(displayCode) {
    const stmt = db.prepare('UPDATE user_display SET current_display_code = NULL, updated_at = CURRENT_TIMESTAMP WHERE current_display_code = ?');
    const result = stmt.run(displayCode);
    return { success: true, changes: result.changes };
}

// Export all functions
module.exports = {
    db,
    initializeDatabase,
    // Config
    getConfig,
    setConfig,
    getCustomKcNames,
    addCustomKcName,
    // Team sizes
    getTeamSize,
    setTeamSize,
    getAllTeamSizes,
    // Users
    upsertUser,
    getUserByDiscordId,
    getUserByGameUid,
    getUserByGameUsername,
    getUsersByPosition,
    getUniquePositionHolder,
    getAllUsers,
    searchUsers,
    deleteUser,
    getUserCount,
    updateUserPosition,
    updatePositionName,
    setUserKcSubtype,
    getUserKcSubtype,
    setUserSubRole,
    getUserSubRole,
    getActiveUsers,
    markUserAsLeft,
    rejoinUser,
    getActiveGuildMembers: getActiveUsers,
    // Bang chien
    createActiveBangchien,
    getActiveBangchien,
    getActiveBangchienByGuild,
    getActiveBangchienByDay,
    addBangchienParticipant,
    removeBangchienParticipant,
    updateActiveBangchien,
    deleteActiveBangchien,
    saveBangchienHistory,
    getBangchienHistory,
    getBangchienHistoryById,
    getBangchienSessionById,
    deleteBangchienSession,
    deleteAllBangchienHistory,
    updateBangchienResult,
    // BC Preset
    getBcPreset,
    setBcPreset,
    clearBcPreset,
    // BC Regular
    addBcRegular,
    removeBcRegular,
    getBcRegulars,
    isBcRegular,
    clearBcRegulars,
    // Avatar
    setUserAvatar,
    getUserAvatar,
    clearUserAvatar,
    banAvatarUser,
    unbanAvatarUser,
    isAvatarBanned,
    // Album
    getAlbumChannelId,
    setAlbumChannelId,
    addAlbumImage,
    getAlbumImages,
    getAlbumImageCount,
    getAlbumImageByNumber,
    deleteAlbumImage,
    deleteAlbumImageByMessageId,
    // Display Role System
    getDisplayRole,
    setDisplayRole,
    deleteDisplayRole,
    getAllDisplayRoles,
    getUserDisplay,
    setUserDisplay,
    clearUserDisplay,
    getUsersByDisplayCode,
    clearDisplayCodeForAll,

    // Gieo Que
    setGieoQueChannelId,
    getGieoQueChannelId,
    deleteGieoQueChannelId,
    markGieoQueUsed,
    getGieoQueStatus,
    getLastActivityGieoQue,
    setLastActivityGieoQue,
    getGieoQueUsageCountToday,
    clearGieoQueUsage,
    resetGieoQueUsage,
    resetCauDuyenUsage,
    resetAllDailyUsage,

    // Random Avatar
    updateUserRandomAvatar,

    // Cau Duyen
    getCauDuyenStatus,
    markCauDuyenUsed,

    // Boss Channel Persistence
    getBossChannelId,
    setBossChannelId,

    // Booster Voice Room
    createBoosterRoom,
    deleteBoosterRoom,
    getBoosterRoom,
    getBoosterRoomByChannelId,
    setBoosterRoomMode,
    setBoosterRoomName,
    addBoosterRoomMember,
    removeBoosterRoomMember,
    getBoosterRoomMembers,
    isBoosterRoomMember,
    getBoostCategoryId,
    setBoostCategoryId,
    // Level Up Channel
    setLevelUpChannelId,
    getLevelUpChannelId
};

// ═══════════════════════════════════════════════════════════════════════════
// GIEO QUE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

// Create gieoque_usage table
const createGieoQueUsageTable = db.prepare(`
    CREATE TABLE IF NOT EXISTS gieoque_usage (
        user_id TEXT PRIMARY KEY,
        last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        usage_date TEXT -- Format YYYY-MM-DD
    )
`);
createGieoQueUsageTable.run();

// Add fortune_content column if missing (migration)
try {
    db.prepare('ALTER TABLE gieoque_usage ADD COLUMN fortune_content TEXT').run();
} catch (e) { /* column already exists */ }

// Add cauduyen columns (migration)
try {
    db.prepare('ALTER TABLE gieoque_usage ADD COLUMN cauduyen_date TEXT').run();
} catch (e) { }
try {
    db.prepare('ALTER TABLE gieoque_usage ADD COLUMN cauduyen_content TEXT').run();
} catch (e) { }

/**
 * Set Gieo Que Channel ID
 * @param {string} channelId
 */
function setGieoQueChannelId(channelId) {
    setConfig('gieoque_channel_id', channelId);
}

/**
 * Get Gieo Que Channel ID
 * @returns {string|null}
 */
function getGieoQueChannelId() {
    return getConfig('gieoque_channel_id');
}

/**
 * Delete Gieo Que Channel ID (disable feature)
 */
function deleteGieoQueChannelId() {
    db.prepare('DELETE FROM config WHERE key = ?').run('gieoque_channel_id');
}

/**
 * Helper: Get today's date string in Vietnam timezone (UTC+7)
 * @returns {string} YYYY-MM-DD
 */
function getTodayVN() {
    const now = new Date();
    // UTC+7
    const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    return vnTime.toISOString().split('T')[0];
}

/**
 * Check if user can use Gieo Que today
 * @param {string} userId
 * @returns {{ usedToday: boolean, lastFortune: string|null }}
 */
function getGieoQueStatus(userId) {
    const today = getTodayVN();
    const stmt = db.prepare('SELECT usage_date, fortune_content FROM gieoque_usage WHERE user_id = ?');
    const result = stmt.get(userId);

    if (!result) return { usedToday: false, lastFortune: null };

    const usedToday = result.usage_date === today;
    return { usedToday, lastFortune: result.fortune_content };
}

/**
 * Mark user as used Gieo Que today + save fortune content
 * @param {string} userId
 * @param {string} content - The fortune text to save
 */
function markGieoQueUsed(userId, content) {
    const today = getTodayVN();
    const stmt = db.prepare(`
        INSERT INTO gieoque_usage (user_id, last_used_at, usage_date, fortune_content)
        VALUES (?, CURRENT_TIMESTAMP, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            last_used_at = CURRENT_TIMESTAMP,
            usage_date = excluded.usage_date,
            fortune_content = excluded.fortune_content
    `);
    stmt.run(userId, today, content);
}

/**
 * Get usage count today (total server usage)
 * @returns {number}
 */
function getGieoQueUsageCountToday() {
    const today = getTodayVN();
    const stmt = db.prepare('SELECT COUNT(*) as count FROM gieoque_usage WHERE usage_date = ?');
    return stmt.get(today).count;
}

/**
 * Clear ALL usage history (admin / daily reset)
 */
function clearGieoQueUsage() {
    db.prepare('DELETE FROM gieoque_usage').run();
}

/**
 * Reset ALL daily usage at midnight (called by scheduler)
 * Clears both gieoque and cauduyen usage for everyone
 * @returns {{ deleted: number }}
 */
function resetAllDailyUsage() {
    const result = db.prepare('DELETE FROM gieoque_usage').run();
    console.log(`[DailyReset] Đã xóa ${result.changes} bản ghi gieo quẻ/cầu duyên`);
    return { deleted: result.changes };
}

/**
 * Reset Gieo Que usage for a specific user
 * @param {string} userId
 */
function resetGieoQueUsage(userId) {
    const stmt = db.prepare('UPDATE gieoque_usage SET usage_date = NULL, fortune_content = NULL WHERE user_id = ?');
    stmt.run(userId);
}

/**
 * Reset Cau Duyen usage for a specific user
 * @param {string} userId
 */
function resetCauDuyenUsage(userId) {
    const stmt = db.prepare('UPDATE gieoque_usage SET cauduyen_date = NULL, cauduyen_content = NULL WHERE user_id = ?');
    stmt.run(userId);
}

/**
 * Get last activity timestamp for Gieo Que channel (from config)
 * @returns {number|null} timestamp or null
 */
function getLastActivityGieoQue() {
    const val = getConfig('gieoque_last_activity');
    return val ? parseInt(val) : null;
}

/**
 * Set last activity timestamp for Gieo Que channel
 * @param {number} timestamp
 */
function setLastActivityGieoQue(timestamp) {
    setConfig('gieoque_last_activity', timestamp.toString());
}

// ═══════════════════════════════════════════════════════════════════════════
// CAU DUYEN FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if user has used Cau Duyen today
 * @param {string} userId
 * @returns {{ usedToday: boolean, lastFortune: string|null }}
 */
function getCauDuyenStatus(userId) {
    const today = getTodayVN();
    const stmt = db.prepare('SELECT cauduyen_date, cauduyen_content FROM gieoque_usage WHERE user_id = ?');
    const result = stmt.get(userId);
    if (!result) return { usedToday: false, lastFortune: null };
    const usedToday = result.cauduyen_date === today;
    return { usedToday, lastFortune: result.cauduyen_content };
}

/**
 * Mark user as used Cau Duyen today
 * @param {string} userId
 * @param {string} content - The fortune content
 */
function markCauDuyenUsed(userId, content) {
    const today = getTodayVN();
    // Ensure row exists first
    db.prepare(`
        INSERT INTO gieoque_usage (user_id, cauduyen_date, cauduyen_content)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            cauduyen_date = excluded.cauduyen_date,
            cauduyen_content = excluded.cauduyen_content
    `).run(userId, today, content);
}

// ═══════════════════════════════════════════════════════════════════════════
// RANDOM AVATAR & BOSS CHANNEL FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update user's random avatar settings
 * @param {string} discordId 
 * @param {number} mode - 0: Off, 1: All, 2: List
 * @param {string|null} list - JSON stringified array of image numbers
 */
function updateUserRandomAvatar(discordId, mode, list) {
    const stmt = db.prepare(`
        UPDATE users SET avatar_random_mode = ?, avatar_random_list = ?, 
        updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?
    `);
    return stmt.run(mode, list, discordId);
}

/**
 * Get saved Boss Channel ID for a guild
 * @param {string} guildId 
 * @returns {string|null}
 */
function getBossChannelId(guildId) {
    return getConfig(`boss_channel_${guildId}`);
}

/**
 * Set/Save Boss Channel ID for a guild
 * @param {string} guildId 
 * @param {string} channelId 
 */
function setBossChannelId(guildId, channelId) {
    return setConfig(`boss_channel_${guildId}`, channelId);
}

// ═══════════════════════════════════════════════════════════════════════════
// BOOSTER VOICE ROOM FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function createBoosterRoom(userId, channelId, guildId, roomName) {
    const stmt = db.prepare(`
        INSERT INTO booster_rooms (user_id, channel_id, guild_id, room_name)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            channel_id = excluded.channel_id,
            guild_id = excluded.guild_id,
            room_name = excluded.room_name
    `);
    stmt.run(userId, channelId, guildId, roomName);
    return { success: true };
}

function deleteBoosterRoom(userId) {
    db.prepare('DELETE FROM booster_room_members WHERE room_owner_id = ?').run(userId);
    const result = db.prepare('DELETE FROM booster_rooms WHERE user_id = ?').run(userId);
    return { success: result.changes > 0 };
}

function getBoosterRoom(userId) {
    return db.prepare('SELECT * FROM booster_rooms WHERE user_id = ?').get(userId) || null;
}

function getBoosterRoomByChannelId(channelId) {
    return db.prepare('SELECT * FROM booster_rooms WHERE channel_id = ?').get(channelId) || null;
}

function setBoosterRoomMode(userId, mode) {
    const result = db.prepare('UPDATE booster_rooms SET mode = ? WHERE user_id = ?').run(mode, userId);
    return { success: result.changes > 0 };
}

function setBoosterRoomName(userId, roomName) {
    const result = db.prepare('UPDATE booster_rooms SET room_name = ? WHERE user_id = ?').run(roomName, userId);
    return { success: result.changes > 0 };
}

function addBoosterRoomMember(ownerId, memberId) {
    try {
        db.prepare('INSERT OR IGNORE INTO booster_room_members (room_owner_id, member_id) VALUES (?, ?)').run(ownerId, memberId);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function removeBoosterRoomMember(ownerId, memberId) {
    const result = db.prepare('DELETE FROM booster_room_members WHERE room_owner_id = ? AND member_id = ?').run(ownerId, memberId);
    return { success: result.changes > 0 };
}

function getBoosterRoomMembers(ownerId) {
    return db.prepare('SELECT member_id FROM booster_room_members WHERE room_owner_id = ?').all(ownerId).map(r => r.member_id);
}

function isBoosterRoomMember(ownerId, memberId) {
    const row = db.prepare('SELECT 1 FROM booster_room_members WHERE room_owner_id = ? AND member_id = ?').get(ownerId, memberId);
    return !!row;
}

function getBoostCategoryId(guildId) {
    return getConfig(`boost_category_${guildId}`);
}

function setBoostCategoryId(guildId, categoryId) {
    return setConfig(`boost_category_${guildId}`, categoryId);
}

// ═══════════════════════════════════════════════════════════════════════════
// LEVEL UP CHANNEL FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lưu channel ID cho thông báo level up
 * @param {string} channelId
 * @returns {Object} Result
 */
function setLevelUpChannelId(channelId) {
    return setConfig('levelup_channel_id', channelId);
}

/**
 * Lấy channel ID cho thông báo level up
 * @returns {string|null}
 */
function getLevelUpChannelId() {
    return getConfig('levelup_channel_id');
}
