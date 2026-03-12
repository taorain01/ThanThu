/**
 * Member Card Cache
 * Cache ảnh member card để giảm thời gian render
 * TTL: 5 phút - tự động xóa entries cũ
 */

// Simple LRU-like cache với TTL
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 phút
const MAX_CACHE_SIZE = 100; // Tối đa 100 entries (~5MB)

/**
 * Tạo cache key từ user data
 */
function generateCacheKey(userData, customAvatar, subRoleCode) {
    const position = userData.position || 'mem';
    const displayCode = userData.display_code || '';
    const gameUsername = userData.game_username || '';
    const avatarHash = customAvatar ? customAvatar.substring(customAvatar.length - 20) : 'default';

    return `${userData.discord_id}_${position}_${subRoleCode || ''}_${displayCode}_${gameUsername}_${avatarHash}`;
}

/**
 * Lấy từ cache
 * @returns {Buffer|null} - Buffer của ảnh card hoặc null nếu không có/hết hạn
 */
function get(cacheKey) {
    const entry = cache.get(cacheKey);

    if (!entry) return null;

    // Kiểm tra TTL
    if (Date.now() - entry.timestamp > CACHE_TTL) {
        cache.delete(cacheKey);
        return null;
    }

    console.log(`[MemberCardCache] Cache HIT: ${cacheKey.substring(0, 30)}...`);
    return entry.buffer;
}

/**
 * Lưu vào cache
 */
function set(cacheKey, buffer) {
    // Xóa entries cũ nếu đầy
    if (cache.size >= MAX_CACHE_SIZE) {
        // Xóa entry cũ nhất
        const oldestKey = cache.keys().next().value;
        cache.delete(oldestKey);
        console.log(`[MemberCardCache] Evicted oldest entry`);
    }

    cache.set(cacheKey, {
        buffer: buffer,
        timestamp: Date.now()
    });

    console.log(`[MemberCardCache] Cache SET: ${cacheKey.substring(0, 30)}... (size: ${cache.size})`);
}

/**
 * Xóa cache của một user (khi thay đổi avatar, position, etc.)
 */
function invalidateUser(userId) {
    let count = 0;
    for (const key of cache.keys()) {
        if (key.startsWith(userId)) {
            cache.delete(key);
            count++;
        }
    }
    if (count > 0) {
        console.log(`[MemberCardCache] Invalidated ${count} entries for user ${userId}`);
    }
}

/**
 * Xóa toàn bộ cache
 */
function clear() {
    cache.clear();
    console.log(`[MemberCardCache] Cache cleared`);
}

/**
 * Lấy stats cache
 */
function getStats() {
    return {
        size: cache.size,
        maxSize: MAX_CACHE_SIZE,
        ttlMinutes: CACHE_TTL / 60000
    };
}

// Tự động cleanup mỗi 10 phút
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of cache.entries()) {
        if (now - entry.timestamp > CACHE_TTL) {
            cache.delete(key);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        console.log(`[MemberCardCache] Auto cleanup: removed ${cleaned} expired entries`);
    }
}, 10 * 60 * 1000);

module.exports = {
    generateCacheKey,
    get,
    set,
    invalidateUser,
    clear,
    getStats
};
