/**
 * Standalone EXP / level database module.
 * Keeps chat and voice EXP independent from the removed minigame economy DB.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../data/exp.db');
const LEGACY_ECONOMY_DB_PATH = path.join(__dirname, '../../data/economy.db');
const VIETNAM_OFFSET_HOURS = 7;

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('[EXP] Created data directory:', dataDir);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function getVietnamNow() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (VIETNAM_OFFSET_HOURS * 3600000));
}

function initializeDatabase() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS exp_levels (
            discord_id TEXT PRIMARY KEY,
            text_exp INTEGER DEFAULT 0,
            voice_exp INTEGER DEFAULT 0,
            total_exp INTEGER DEFAULT 0,
            level INTEGER DEFAULT 0,
            last_text_exp_at DATETIME,
            total_messages INTEGER DEFAULT 0,
            total_voice_minutes INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            voice_unmuted_minutes INTEGER DEFAULT 0,
            voice_muted_minutes INTEGER DEFAULT 0
        )
    `).run();

    try {
        db.prepare('ALTER TABLE exp_levels ADD COLUMN voice_unmuted_minutes INTEGER DEFAULT 0').run();
    } catch (e) { }
    try {
        db.prepare('ALTER TABLE exp_levels ADD COLUMN voice_muted_minutes INTEGER DEFAULT 0').run();
    } catch (e) { }

    db.prepare(`
        CREATE TABLE IF NOT EXISTS exp_periodic (
            discord_id TEXT NOT NULL,
            period_type TEXT NOT NULL,
            period_key TEXT NOT NULL,
            text_exp INTEGER DEFAULT 0,
            voice_exp INTEGER DEFAULT 0,
            total_exp INTEGER DEFAULT 0,
            PRIMARY KEY (discord_id, period_type, period_key)
        )
    `).run();

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_exp_total ON exp_levels(total_exp)').run();
        db.prepare('CREATE INDEX IF NOT EXISTS idx_exp_level ON exp_levels(level)').run();
        db.prepare('CREATE INDEX IF NOT EXISTS idx_exp_periodic_lookup ON exp_periodic(period_type, period_key, total_exp)').run();
    } catch (e) { }

    migrateLegacyExpData();
    cleanupExpiredPeriodic();
    console.log('[EXP] Database initialized');
}

function tableExists(sourceDb, tableName) {
    const row = sourceDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(tableName);
    return !!row;
}

function migrateLegacyExpData() {
    if (!fs.existsSync(LEGACY_ECONOMY_DB_PATH)) return;

    let legacyDb;
    try {
        legacyDb = new Database(LEGACY_ECONOMY_DB_PATH, { readonly: true, fileMustExist: true });

        if (tableExists(legacyDb, 'exp_levels')) {
            const rows = legacyDb.prepare('SELECT * FROM exp_levels').all();
            const upsertLevel = db.prepare(`
                INSERT INTO exp_levels (
                    discord_id, text_exp, voice_exp, total_exp, level, last_text_exp_at,
                    total_messages, total_voice_minutes, created_at, voice_unmuted_minutes,
                    voice_muted_minutes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(discord_id) DO UPDATE SET
                    text_exp = excluded.text_exp,
                    voice_exp = excluded.voice_exp,
                    total_exp = excluded.total_exp,
                    level = excluded.level,
                    last_text_exp_at = excluded.last_text_exp_at,
                    total_messages = excluded.total_messages,
                    total_voice_minutes = excluded.total_voice_minutes,
                    created_at = COALESCE(excluded.created_at, exp_levels.created_at),
                    voice_unmuted_minutes = excluded.voice_unmuted_minutes,
                    voice_muted_minutes = excluded.voice_muted_minutes
            `);
            const copyLevels = db.transaction(() => {
                for (const row of rows) {
                    upsertLevel.run(
                        row.discord_id,
                        row.text_exp || 0,
                        row.voice_exp || 0,
                        row.total_exp || 0,
                        row.level || 0,
                        row.last_text_exp_at || null,
                        row.total_messages || 0,
                        row.total_voice_minutes || 0,
                        row.created_at || null,
                        row.voice_unmuted_minutes || 0,
                        row.voice_muted_minutes || 0
                    );
                }
            });
            copyLevels();
            if (rows.length > 0) console.log(`[EXP] Migrated ${rows.length} exp_levels rows from economy.db`);
        }

        if (tableExists(legacyDb, 'exp_periodic')) {
            const rows = legacyDb.prepare('SELECT * FROM exp_periodic').all();
            const upsertPeriodic = db.prepare(`
                INSERT INTO exp_periodic (discord_id, period_type, period_key, text_exp, voice_exp, total_exp)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(discord_id, period_type, period_key) DO UPDATE SET
                    text_exp = excluded.text_exp,
                    voice_exp = excluded.voice_exp,
                    total_exp = excluded.total_exp
            `);
            const copyPeriodic = db.transaction(() => {
                for (const row of rows) {
                    upsertPeriodic.run(
                        row.discord_id,
                        row.period_type,
                        row.period_key,
                        row.text_exp || 0,
                        row.voice_exp || 0,
                        row.total_exp || 0
                    );
                }
            });
            copyPeriodic();
            if (rows.length > 0) console.log(`[EXP] Migrated ${rows.length} exp_periodic rows from economy.db`);
        }
    } catch (error) {
        console.error('[EXP] Legacy migration skipped:', error.message);
    } finally {
        if (legacyDb) legacyDb.close();
    }
}

function getExpForLevel(level) {
    return 5 * (level * level) + 50 * level + 100;
}

function getTotalExpForLevel(targetLevel) {
    let total = 0;
    for (let i = 0; i < targetLevel; i++) {
        total += getExpForLevel(i);
    }
    return total;
}

function getExpMultiplier(level) {
    return 100 / (100 + level * 5);
}

function getOrCreateExp(discordId) {
    let record = db.prepare('SELECT * FROM exp_levels WHERE discord_id = ?').get(discordId);
    if (!record) {
        db.prepare('INSERT INTO exp_levels (discord_id) VALUES (?)').run(discordId);
        record = db.prepare('SELECT * FROM exp_levels WHERE discord_id = ?').get(discordId);
    }
    return record;
}

function addTextExp(discordId) {
    const record = getOrCreateExp(discordId);
    const now = Date.now();
    const lastExp = record.last_text_exp_at ? new Date(record.last_text_exp_at).getTime() : 0;

    if (now - lastExp < 60000) {
        return { success: false, reason: 'cooldown' };
    }

    const baseExp = Math.floor(Math.random() * 11) + 15;
    const expGained = Math.max(3, Math.floor(baseExp * getExpMultiplier(record.level)));
    const newTextExp = record.text_exp + expGained;
    const newTotalExp = record.total_exp + expGained;
    const newMessages = record.total_messages + 1;

    let newLevel = record.level;
    let expForNext = getExpForLevel(newLevel);
    let currentLevelExp = newTotalExp - getTotalExpForLevel(newLevel);
    let leveledUp = false;

    while (currentLevelExp >= expForNext) {
        newLevel++;
        expForNext = getExpForLevel(newLevel);
        currentLevelExp = newTotalExp - getTotalExpForLevel(newLevel);
        leveledUp = true;
    }

    db.prepare(`
        UPDATE exp_levels SET
            text_exp = ?, total_exp = ?, level = ?,
            last_text_exp_at = ?, total_messages = ?
        WHERE discord_id = ?
    `).run(newTextExp, newTotalExp, newLevel, new Date().toISOString(), newMessages, discordId);

    addPeriodicExp(discordId, expGained, 'text');

    try {
        const supaSync = require('../utils/supabaseSync');
        supaSync.syncOneExpLevel(discordId, {
            level: newLevel,
            total_exp: newTotalExp,
            text_exp: newTextExp,
            voice_exp: record.voice_exp,
            total_messages: newMessages,
            total_voice_minutes: record.total_voice_minutes
        });
    } catch (e) { }

    return {
        success: true,
        expGained,
        levelUp: leveledUp,
        oldLevel: record.level,
        newLevel,
        totalExp: newTotalExp
    };
}

function addVoiceExp(discordId, minutes = 1, isMuted = false) {
    const record = getOrCreateExp(discordId);
    const baseRate = isMuted ? 1.25 : 10;
    const baseExp = baseRate * minutes;
    const minExp = isMuted ? 1 : 2 * minutes;
    const expGained = Math.max(minExp, Math.floor(baseExp * getExpMultiplier(record.level)));

    const newVoiceExp = record.voice_exp + expGained;
    const newTotalExp = record.total_exp + expGained;
    const newVoiceMinutes = record.total_voice_minutes + minutes;
    const unmutedAdd = isMuted ? 0 : minutes;
    const mutedAdd = isMuted ? minutes : 0;

    let newLevel = record.level;
    let expForNext = getExpForLevel(newLevel);
    let currentLevelExp = newTotalExp - getTotalExpForLevel(newLevel);
    let leveledUp = false;

    while (currentLevelExp >= expForNext) {
        newLevel++;
        expForNext = getExpForLevel(newLevel);
        currentLevelExp = newTotalExp - getTotalExpForLevel(newLevel);
        leveledUp = true;
    }

    db.prepare(`
        UPDATE exp_levels SET
            voice_exp = ?, total_exp = ?, level = ?,
            total_voice_minutes = ?,
            voice_unmuted_minutes = COALESCE(voice_unmuted_minutes, 0) + ?,
            voice_muted_minutes = COALESCE(voice_muted_minutes, 0) + ?
        WHERE discord_id = ?
    `).run(newVoiceExp, newTotalExp, newLevel, newVoiceMinutes, unmutedAdd, mutedAdd, discordId);

    addPeriodicExp(discordId, expGained, 'voice');

    try {
        const supaSync = require('../utils/supabaseSync');
        supaSync.syncOneExpLevel(discordId, {
            level: newLevel,
            total_exp: newTotalExp,
            text_exp: record.text_exp,
            voice_exp: newVoiceExp,
            total_messages: record.total_messages,
            total_voice_minutes: newVoiceMinutes
        });
    } catch (e) { }

    return {
        success: true,
        expGained,
        levelUp: leveledUp,
        oldLevel: record.level,
        newLevel,
        totalExp: newTotalExp
    };
}

function getExpInfo(discordId) {
    const record = getOrCreateExp(discordId);
    const expForNext = getExpForLevel(record.level);
    const totalExpForCurrentLevel = getTotalExpForLevel(record.level);
    const currentLevelExp = record.total_exp - totalExpForCurrentLevel;
    const rankResult = db
        .prepare('SELECT COUNT(*) as rank FROM exp_levels WHERE total_exp > ?')
        .get(record.total_exp);

    return {
        level: record.level,
        totalExp: record.total_exp,
        textExp: record.text_exp,
        voiceExp: record.voice_exp,
        expForNext,
        currentLevelExp,
        totalMessages: record.total_messages,
        totalVoiceMinutes: record.total_voice_minutes,
        rank: rankResult.rank + 1,
        createdAt: record.created_at
    };
}

function getExpLeaderboard(type = 'total', limit = 10) {
    let orderBy = 'total_exp';
    if (type === 'text') orderBy = 'text_exp';
    if (type === 'voice') orderBy = 'voice_exp';

    return db.prepare(`
        SELECT * FROM exp_levels
        WHERE ${orderBy} > 0
        ORDER BY ${orderBy} DESC
        LIMIT ?
    `).all(limit);
}

function getExpUserCount() {
    return db.prepare('SELECT COUNT(*) as count FROM exp_levels WHERE total_exp > 0').get().count;
}

function getAllExpLevels() {
    return db.prepare('SELECT * FROM exp_levels').all();
}

function getCurrentPeriodKeys() {
    const vn = getVietnamNow();
    const y = vn.getFullYear();
    const m = String(vn.getMonth() + 1).padStart(2, '0');
    const d = String(vn.getDate()).padStart(2, '0');
    const jan1 = new Date(y, 0, 1);
    const dayOfYear = Math.ceil((vn - jan1) / 86400000) + 1;
    const weekNum = Math.ceil((dayOfYear + jan1.getDay()) / 7);
    const w = String(weekNum).padStart(2, '0');

    return {
        day: `${y}-${m}-${d}`,
        week: `${y}-W${w}`,
        month: `${y}-${m}`,
        year: `${y}`
    };
}

function addPeriodicExp(discordId, expAmount, expType = 'text') {
    const keys = getCurrentPeriodKeys();
    const textAdd = expType === 'text' ? expAmount : 0;
    const voiceAdd = expType === 'voice' ? expAmount : 0;
    const upsert = db.prepare(`
        INSERT INTO exp_periodic (discord_id, period_type, period_key, text_exp, voice_exp, total_exp)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(discord_id, period_type, period_key)
        DO UPDATE SET
            text_exp = text_exp + ?,
            voice_exp = voice_exp + ?,
            total_exp = total_exp + ?
    `);

    const runAll = db.transaction(() => {
        for (const [type, key] of Object.entries(keys)) {
            upsert.run(discordId, type, key, textAdd, voiceAdd, expAmount, textAdd, voiceAdd, expAmount);
        }
    });
    runAll();
}

function getPeriodicLeaderboard(periodType = 'day', limit = 5) {
    const keys = getCurrentPeriodKeys();
    const periodKey = keys[periodType];
    if (!periodKey) return [];

    return db.prepare(`
        SELECT * FROM exp_periodic
        WHERE period_type = ? AND period_key = ? AND total_exp > 0
        ORDER BY total_exp DESC
        LIMIT ?
    `).all(periodType, periodKey, limit);
}

function getPeriodicExpInfo(discordId, periodType = 'day') {
    const keys = getCurrentPeriodKeys();
    const periodKey = keys[periodType];
    if (!periodKey) return null;

    return db.prepare(`
        SELECT * FROM exp_periodic
        WHERE discord_id = ? AND period_type = ? AND period_key = ?
    `).get(discordId, periodType, periodKey) || { total_exp: 0, text_exp: 0, voice_exp: 0 };
}

function cleanupExpiredPeriodic() {
    const keys = getCurrentPeriodKeys();
    const deleteOld = db.transaction(() => {
        for (const [type, key] of Object.entries(keys)) {
            const result = db.prepare(`
                DELETE FROM exp_periodic WHERE period_type = ? AND period_key != ?
            `).run(type, key);
            if (result.changes > 0) {
                console.log(`[EXP] Deleted ${result.changes} old exp_periodic rows (${type}, kept ${key})`);
            }
        }
    });
    deleteOld();
}

const LEVEL_REWARDS = {
    5: { roleName: 'lv5', emoji: '\u{1F331}' },
    10: { roleName: 'lv10', emoji: '\u2694\uFE0F' },
    20: { roleName: 'lv20', emoji: '\u{1F5E1}\uFE0F' },
    30: { roleName: 'lv30', emoji: '\u{1F6E1}\uFE0F' },
    50: { roleName: 'lv50', emoji: '\u{1F451}' },
    70: { roleName: 'lv70', emoji: '\u{1F31F}' },
    100: { roleName: 'lv100', emoji: '\u{1F48E}' }
};

function getLevelReward(newLevel) {
    return LEVEL_REWARDS[newLevel] || null;
}

initializeDatabase();

module.exports = {
    db,
    getOrCreateExp,
    addTextExp,
    addVoiceExp,
    getExpInfo,
    getExpLeaderboard,
    getExpUserCount,
    getAllExpLevels,
    getExpForLevel,
    getTotalExpForLevel,
    getLevelReward,
    LEVEL_REWARDS,
    addPeriodicExp,
    getPeriodicLeaderboard,
    getPeriodicExpInfo,
    cleanupExpiredPeriodic,
    getCurrentPeriodKeys
};
