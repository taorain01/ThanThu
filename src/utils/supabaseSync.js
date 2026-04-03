/**
 * Supabase Sync Module
 * Đồng bộ dữ liệu bang chiến giữa Bot (SQLite) và Supabase (Cloud DB)
 * Dùng cho Web Bang Chiến Lang Gia
 */

const { createClient } = require('@supabase/supabase-js');

// Khởi tạo Supabase client với service_role key (full quyền)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

let supabase = null;
let supportsBcSessionsLockedColumn = true;

/**
 * Khởi tạo Supabase client (gọi 1 lần khi bot start)
 */
function initSupabase() {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        console.warn('[Supabase] ⚠️ Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_KEY trong .env — bỏ qua sync');
        return false;
    }
    try {
        supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        console.log('[Supabase] ✅ Đã kết nối Supabase:', SUPABASE_URL);
        return true;
    } catch (err) {
        console.error('[Supabase] ❌ Lỗi kết nối:', err.message);
        return false;
    }
}

/**
 * Kiểm tra Supabase đã sẵn sàng chưa
 */
function isReady() {
    return supabase !== null;
}

// ═══════════════════════════════════════════════════════════════
// SYNC BANG CHIẾN SESSIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Sync phiên bang chiến lên Supabase
 * Gọi khi: ?bc, ?bcmove, ?bckick, ?bcadd, ?bcleader, ?bccotds...
 * @param {string} guildId - Guild ID
 * @param {string} day - 'sat' hoặc 'sun'
 * @param {Object} sessionData - Dữ liệu phiên BC
 */
async function syncBCSession(guildId, day, sessionData) {
    if (!isReady()) return;
    try {
        const {
            team_attack1 = [],
            team_attack2 = [],
            team_defense = [],
            team_forest = [],
            waiting_list = [],
            leader_ids = {},
            team_sizes = { attack1: 10, attack2: 10, defense: 5, forest: 5 },
            status = 'active',
            time = '19:30',
            note = '',
            locked = false
        } = sessionData;

        const payload = {
            guild_id: guildId,
            day,
            team_attack1: JSON.stringify(team_attack1),
            team_attack2: JSON.stringify(team_attack2),
            team_defense: JSON.stringify(team_defense),
            team_forest: JSON.stringify(team_forest),
            waiting_list: JSON.stringify(waiting_list),
            leader_ids: JSON.stringify(leader_ids),
            team_sizes: JSON.stringify(team_sizes),
            status,
            time: time || '19:30',
            note: note || ''
        };
        if (supportsBcSessionsLockedColumn) {
            payload.locked = !!locked;
        }

        let { error } = await supabase
            .from('bc_sessions')
            .upsert(payload, { onConflict: 'guild_id,day' });

        if (error && /locked/i.test(error.message || '')) {
            supportsBcSessionsLockedColumn = false;
            delete payload.locked;
            const retry = await supabase
                .from('bc_sessions')
                .upsert(payload, { onConflict: 'guild_id,day' });
            error = retry.error || null;
        }

        if (error) {
            console.error('[Supabase] ❌ Sync BC session lỗi:', error.message);
        } else {
            console.log(`[Supabase] ✅ Sync BC ${day} thành công (${team_attack1.length + team_attack2.length + team_defense.length + team_forest.length} người)`);
        }
    } catch (err) {
        console.error('[Supabase] ❌ syncBCSession exception:', err.message);
    }
}

/**
 * Xóa phiên bang chiến trên Supabase
 * Gọi khi: ?bcend, auto-cleanup hết hạn
 * @param {string} guildId - Guild ID
 * @param {string} day - 'sat', 'sun', 'mon'...
 */
async function deleteBCSession(guildId, day) {
    console.log(`[Supabase] 🗑️ deleteBCSession được gọi: guild=${guildId}, day=${day}, ready=${isReady()}`);
    if (!isReady()) {
        console.log('[Supabase] ⚠️ deleteBCSession: Supabase chưa sẵn sàng, bỏ qua!');
        return;
    }
    try {
        // STEP 1: UPDATE status='ended' → web nhận Realtime UPDATE event
        await supabase
            .from('bc_sessions')
            .update({ status: 'ended' })
            .eq('guild_id', guildId)
            .eq('day', day);
        console.log(`[Supabase] 📡 Signal ended cho ${day}`);

        // Chờ 500ms để web kịp nhận event
        await new Promise(r => setTimeout(r, 500));

        // STEP 2: DELETE hẳn row
        let { error } = await supabase
            .from('bc_sessions')
            .delete()
            .eq('guild_id', guildId)
            .eq('day', day);

        if (error) {
            console.error('[Supabase] ❌ Xóa BC session lỗi:', error.message);
        } else {
            console.log(`[Supabase] ✅ Đã xóa BC session ${day}`);
        }
    } catch (err) {
        console.error('[Supabase] ❌ deleteBCSession exception:', err.message);
    }
}

/**
 * Xóa TẤT CẢ session trên Supabase cho 1 guild
 * Gọi khi: owner ?bcend (không chỉ định ngày)
 * @param {string} guildId - Guild ID
 */
async function deleteAllBCSessions(guildId) {
    console.log(`[Supabase] 🗑️ deleteAllBCSessions được gọi: guild=${guildId}, ready=${isReady()}`);
    if (!isReady()) {
        console.log('[Supabase] ⚠️ deleteAllBCSessions: Supabase chưa sẵn sàng, bỏ qua!');
        return;
    }
    try {
        // STEP 1: UPDATE tất cả status='ended' → web nhận Realtime UPDATE event
        await supabase
            .from('bc_sessions')
            .update({ status: 'ended' })
            .eq('guild_id', guildId);
        console.log(`[Supabase] 📡 Signal ended cho tất cả sessions`);

        // Chờ 500ms để web kịp nhận event
        await new Promise(r => setTimeout(r, 500));

        // STEP 2: DELETE hẳn tất cả rows
        const { error } = await supabase
            .from('bc_sessions')
            .delete()
            .eq('guild_id', guildId);

        if (error) {
            console.error('[Supabase] ❌ Xóa ALL BC sessions lỗi:', error.message);
        } else {
            console.log(`[Supabase] ✅ Đã xóa tất cả BC sessions`);
        }
    } catch (err) {
        console.error('[Supabase] ❌ deleteAllBCSessions exception:', err.message);
    }
}

/**
 * Sync danh sách users lên Supabase (batch)
 * Gọi khi bot start hoặc khi có thay đổi thành viên
 * @param {Array} users - Mảng user objects từ SQLite
 * @param {string} guildId - Guild ID
 */
async function syncUsers(users, guildId) {
    if (!isReady()) return;
    try {
        const records = users.map(u => ({
            discord_id: u.discord_id,
            discord_name: u.discord_name,
            game_username: u.game_username,
            game_uid: u.game_uid,
            position: u.position || 'mem',
            sub_role: u.sub_role || null,
            guild_id: guildId
        }));

        // Upsert từng batch 50 records
        for (let i = 0; i < records.length; i += 50) {
            const batch = records.slice(i, i + 50);
            const { error } = await supabase
                .from('bc_users')
                .upsert(batch, { onConflict: 'discord_id' });

            if (error) {
                console.error(`[Supabase] ❌ Sync users batch ${i} lỗi:`, error.message);
            }
        }
        console.log(`[Supabase] ✅ Sync ${records.length} users thành công`);
    } catch (err) {
        console.error('[Supabase] ❌ syncUsers exception:', err.message);
    }
}

/**
 * Sync 1 user duy nhất
 * @param {Object} user - User object từ SQLite
 * @param {string} guildId - Guild ID
 */
async function syncOneUser(user, guildId) {
    if (!isReady()) return;
    try {
        const { error } = await supabase
            .from('bc_users')
            .upsert({
                discord_id: user.discord_id,
                discord_name: user.discord_name,
                game_username: user.game_username,
                game_uid: user.game_uid,
                position: user.position || 'mem',
                sub_role: user.sub_role || null,
                guild_id: guildId
            }, { onConflict: 'discord_id' });

        if (error) {
            console.error('[Supabase] ❌ Sync user lỗi:', error.message);
        }
    } catch (err) {
        console.error('[Supabase] ❌ syncOneUser exception:', err.message);
    }
}

// ═══════════════════════════════════════════════════════════════
// LOG ACTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Ghi log thay đổi lên Supabase
 * @param {string} guildId - Guild ID
 * @param {string} action - Tên hành động (move, kick, add, setleader...)
 * @param {Object} details - Chi tiết
 * @param {string} performedBy - Discord ID người thực hiện
 * @param {string} source - 'bot' hoặc 'web'
 */
async function logAction(guildId, action, details, performedBy, source = 'bot') {
    if (!isReady()) return;
    try {
        await supabase
            .from('bc_logs')
            .insert({
                guild_id: guildId,
                action,
                details: JSON.stringify(details),
                performed_by: performedBy,
                source
            });
    } catch (err) {
        // Lỗi log không quan trọng, bỏ qua
    }
}

async function syncBcRegular(guildId, discordId, username, day) {
    if (!isReady()) return;
    try {
        const { error } = await supabase
            .from('bc_regulars')
            .upsert({
                guild_id: guildId,
                discord_id: discordId,
                username: username || null,
                day
            }, { onConflict: 'guild_id,discord_id,day' });

        if (error) {
            console.error('[Supabase] ❌ Sync bc_regular lỗi:', error.message);
            return false;
        }
        console.log(`[Supabase] ✅ Synced bc_regular ${discordId} -> ${day}`);
        return true;
    } catch (err) {
        console.error('[Supabase] ❌ syncBcRegular exception:', err.message);
        return false;
    }
}

async function removeBcRegular(guildId, discordId, day) {
    if (!isReady()) return;
    try {
        const { error } = await supabase
            .from('bc_regulars')
            .delete()
            .eq('guild_id', guildId)
            .eq('discord_id', discordId)
            .eq('day', day);

        if (error) {
            console.error('[Supabase] ❌ Remove bc_regular lỗi:', error.message);
            return false;
        }
        console.log(`[Supabase] ✅ Removed bc_regular ${discordId} -> ${day}`);
        return true;
    } catch (err) {
        console.error('[Supabase] ❌ removeBcRegular exception:', err.message);
        return false;
    }
}

async function setSessionLocked(guildId, day, locked = true) {
    if (!isReady()) return;
    if (!supportsBcSessionsLockedColumn) return true;
    try {
        const { error } = await supabase
            .from('bc_sessions')
            .update({ locked: !!locked })
            .eq('guild_id', guildId)
            .eq('day', day);

        if (error && /locked/i.test(error.message || '')) {
            supportsBcSessionsLockedColumn = false;
            console.warn('[Supabase] Locked column missing, skip setSessionLocked');
            return true;
        }

        if (error) {
            console.error('[Supabase] ❌ setSessionLocked lỗi:', error.message);
            return false;
        }
        console.log(`[Supabase] ✅ Session ${day} locked=${!!locked}`);
        return true;
    } catch (err) {
        console.error('[Supabase] ❌ setSessionLocked exception:', err.message);
        return false;
    }
}

async function pollBcRegulars(db, guildId) {
    if (!isReady() || !db) return [];
    try {
        const { data, error } = await supabase
            .from('bc_regulars')
            .select('*')
            .eq('guild_id', guildId);

        if (error) {
            console.error('[Supabase] ❌ pollBcRegulars lỗi:', error.message);
            return [];
        }

        const remote = data || [];
        for (const day of ['sat', 'sun']) {
            const remoteDay = remote.filter((item) => item.day === day);
            const localDay = db.getBcRegulars(guildId, day) || [];

            for (const remoteItem of remoteDay) {
                if (!localDay.some((item) => item.discord_id === remoteItem.discord_id)) {
                    db.addBcRegular(guildId, remoteItem.discord_id, remoteItem.username || remoteItem.discord_id, day);
                    console.log(`[Supabase] ← Added bc_regular from web: ${remoteItem.discord_id} -> ${day}`);
                }
            }

            for (const localItem of localDay) {
                if (!remoteDay.some((item) => item.discord_id === localItem.discord_id)) {
                    db.removeBcRegular(guildId, localItem.discord_id, day);
                    console.log(`[Supabase] ← Removed bc_regular from web: ${localItem.discord_id} -> ${day}`);
                }
            }
        }

        return remote;
    } catch (err) {
        console.error('[Supabase] ❌ pollBcRegulars exception:', err.message);
        return [];
    }
}

// ═══════════════════════════════════════════════════════════════
// LẮNG NGHE THAY ĐỔI TỪ WEB (Realtime)
// ═══════════════════════════════════════════════════════════════

/**
 * Lắng nghe thay đổi từ web → sync ngược về SQLite
 * @param {string} guildId - Guild ID
 * @param {Function} onSessionChange - Callback khi session thay đổi
 */
let _webChangesListening = false;

function listenForWebChanges(guildId, onSessionChange) {
    if (!isReady()) return;
    if (_webChangesListening) {
        console.warn('[Supabase] listenForWebChanges da duoc goi roi, bo qua');
        return;
    }
    _webChangesListening = true;


    let pollingInterval = null;
    let lastPollHash = '';
    const safeParseTeam = (value) => {
        try {
            return typeof value === 'string' ? JSON.parse(value) : (value || []);
        } catch (e) {
            return [];
        }
    };
    const normalizeSessionSignature = (session, isLocal = false) => {
        const leaderIds = isLocal
            ? {
                team1: session.team1_leader_id || null,
                team2: session.team2_leader_id || null,
                team3: session.team3_leader_id || null,
                team4: session.team4_leader_id || null,
                commander: session.commander_id || null
            }
            : (() => {
                try {
                    return typeof session.leader_ids === 'string'
                        ? JSON.parse(session.leader_ids || '{}')
                        : (session.leader_ids || {});
                } catch (e) {
                    return {};
                }
            })();

        return JSON.stringify({
            day: session.day || null,
            team_attack1: isLocal ? (session.team_attack1 || []) : safeParseTeam(session.team_attack1),
            team_attack2: isLocal ? (session.team_attack2 || []) : safeParseTeam(session.team_attack2),
            team_defense: isLocal ? (session.team_defense || []) : safeParseTeam(session.team_defense),
            team_forest: isLocal ? (session.team_forest || []) : safeParseTeam(session.team_forest),
            waiting_list: isLocal ? (session.waiting_list || []) : safeParseTeam(session.waiting_list),
            leader_ids: leaderIds,
            time: session.time || '19:30',
            note: session.note || '',
            locked: !!session.locked,
            status: session.status || 'active'
        });
    };

    // Hàm start polling fallback khi Realtime thất bại
    function startPolling() {
        if (pollingInterval) return;
        console.log('[Supabase] ⚠️ Realtime TIMED_OUT/ERROR → bật polling fallback (mỗi 8 giây)');

        pollingInterval = setInterval(async () => {
            try {
                const { data } = await supabase
                    .from('bc_sessions')
                    .select('*')
                    .eq('guild_id', guildId)
                    .eq('status', 'active');

                const newHash = JSON.stringify((data || []).map((session) => normalizeSessionSignature(session)).sort());
                if (newHash === lastPollHash) return; // Không thay đổi
                lastPollHash = newHash;

                console.log('[Supabase] 🔄 Polling phát hiện thay đổi từ web');

                // So sánh với SQLite để tìm thay đổi
                const db = require('../database/db');
                const localSessions = db.getActiveBangchienByGuild(guildId);
                const localDays = new Set(localSessions.map(s => s.day));
                const remoteDays = new Set((data || []).map(s => s.day));

                // INSERT: session mới từ web (có trong Supabase nhưng không có trong SQLite)
                for (const remoteSession of (data || [])) {
                    if (!localDays.has(remoteSession.day) && onSessionChange) {
                        console.log(`[Supabase] 🆕 Polling: Web tạo BC session mới (${remoteSession.day})`);
                        onSessionChange({ ...remoteSession, _inserted: true });
                    }
                }

                // DELETE: session bị xóa từ web (có trong SQLite nhưng không có trong Supabase)
                for (const localSession of localSessions) {
                    if (!remoteDays.has(localSession.day) && onSessionChange) {
                        console.log(`[Supabase] 🗑️ Polling: Web xóa BC session (${localSession.day})`);
                        onSessionChange({ day: localSession.day, _deleted: true });
                    }
                }

                // UPDATE: session thay đổi từ web
                for (const remoteSession of (data || [])) {
                    if (localDays.has(remoteSession.day) && onSessionChange) {
                        // So sánh nội dung
                        const local = localSessions.find(s => s.day === remoteSession.day);
                        if (local) {
                            if (normalizeSessionSignature(remoteSession) !== normalizeSessionSignature(local, true)) {
                                console.log(`[Supabase] 🔄 Polling: Web sửa BC session (${remoteSession.day})`);
                                onSessionChange(remoteSession);
                            }
                        }
                    }
                }
            } catch (e) {
                // Bỏ qua lỗi poll
            }
        }, 8000);
    }

    function stopPolling() {
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
            console.log('[Supabase] ✅ Realtime hoạt động, tắt polling fallback');
        }
    }

    supabase
        .channel('bc-web-changes')
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'bc_sessions', filter: `guild_id=eq.${guildId}` },
            (payload) => {
                console.log(`[Supabase] 🆕 Web đã tạo BC session mới (${payload.new.day})`);
                if (onSessionChange) {
                    onSessionChange({ ...payload.new, _inserted: true });
                }
            }
        )
        .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'bc_sessions', filter: `guild_id=eq.${guildId}` },
            async (payload) => {
                // Signal+Delete: web gửi status='ended' trước khi xóa
                if (payload.new?.status === 'ended') {
                    console.log(`[Supabase] 🗑️ Web signal ended cho session ${payload.new.day}`);
                    if (onSessionChange) {
                        onSessionChange({ day: payload.new.day, _deleted: true });
                    }
                    // Dọn row khỏi Supabase (web anon key có thể không xóa được)
                    try {
                        await supabase.from('bc_sessions').delete()
                            .eq('guild_id', guildId).eq('day', payload.new.day);
                        console.log(`[Supabase] ✅ Bot đã dọn row ended: ${payload.new.day}`);
                    } catch(e) {}
                    return;
                }
                console.log(`[Supabase] 🔄 Web đã sửa BC session (${payload.new.day})`);
                if (onSessionChange) {
                    onSessionChange(payload.new);
                }
            }
        )
        .on('postgres_changes',
            { event: 'DELETE', schema: 'public', table: 'bc_sessions', filter: `guild_id=eq.${guildId}` },
            async (payload) => {
                const deletedDay = payload.old?.day;
                console.log(`[Supabase] 🗑️ Nhận DELETE event (day=${deletedDay || 'unknown'})`);

                if (deletedDay && onSessionChange) {
                    // Biết chính xác ngày bị xóa
                    onSessionChange({ day: deletedDay, _deleted: true });
                } else if (onSessionChange) {
                    // Không biết ngày (REPLICA IDENTITY chưa FULL) → query Supabase để tìm
                    try {
                        const { data: remainingSessions } = await supabase
                            .from('bc_sessions')
                            .select('day')
                            .eq('guild_id', guildId);
                        const remainingDays = new Set((remainingSessions || []).map(s => s.day));

                        // So sánh (callback sẽ tự kiểm tra SQLite)
                        // Gửi _deleted_unknown để ready.js xử lý fallback
                        onSessionChange({ _deleted: true, _deleted_unknown: true, remainingDays: [...remainingDays] });
                    } catch (e) {
                        console.error('[Supabase] Lỗi query remaining sessions:', e.message);
                    }
                }
            }
        )
        .subscribe((status) => {
            console.log(`[Supabase] 📡 Realtime subscription: ${status}`);
            if (status === 'SUBSCRIBED') {
                stopPolling();
            } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
                startPolling();
            }
        });
}

/**
 * Listen for tactics history inserts from web so bot can react to explicit save actions.
 * @param {string} guildId
 * @param {Function} onHistoryInsert
 */
function listenForTacticsHistoryChanges(guildId, onHistoryInsert) {
    if (!isReady()) return;

    supabase
        .channel(`bc-tactics-history:${guildId}`)
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'bc_tactics_history', filter: `guild_id=eq.${guildId}` },
            (payload) => {
                if (onHistoryInsert) onHistoryInsert(payload.new);
            }
        )
        .subscribe((status) => {
            console.log(`[Supabase] Tactics history subscription: ${status}`);
        });
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Đọc dữ liệu BC từ SQLite → format cho Supabase
// ═══════════════════════════════════════════════════════════════

/**
 * Chuyển đổi dữ liệu từ bảng bangchien_active (SQLite) sang format Supabase
 * @param {Object} activeSession - Row từ bangchien_active
 * @param {Object} db - Database module
 * @returns {Object} sessionData cho syncBCSession
 */
function formatActiveSession(activeSession, db, guild = null) {
    try {
        const teamSizes = db.getAllTeamSizes ? db.getAllTeamSizes() : { attack1: 10, attack2: 10, defense: 5, forest: 5 };

        // Hỗ trợ cả data đã parse (Array) lẫn chưa parse (String JSON)
        const safeParse = (v) => {
            if (Array.isArray(v)) return v;
            if (typeof v === 'string') { try { return JSON.parse(v); } catch(e) { return []; } }
            return v || [];
        };

        // DPS sub-type short tags (giống pickrole)
        const dpsShortTags = { 'Quạt Dù': 'QD', 'Vô Danh': 'VD', 'Song Đao': 'SD', 'Cửu Kiếm': '9K', 'Dù Roi': 'DR', 'Hoành Đao/Mđ': 'HĐ' };
        const dpsSubTypeRoles = Object.keys(dpsShortTags);

        // Enrich player: thêm role, sub, gn
        const enrichPlayer = (p) => {
            const enriched = { ...p };

            // Lookup game_username từ DB
            if (!enriched.gn && db.getUserByDiscordId) {
                const userData = db.getUserByDiscordId(p.id);
                if (userData?.game_username) {
                    enriched.gn = userData.game_username;
                    enriched.name = userData.game_username;
                }
            }

            // Detect role từ Discord guild roles
            if (guild) {
                try {
                    const member = guild.members.cache.get(p.id);
                    if (member) {
                        // Healer/Tanker check trước
                        const healerRole = guild.roles.cache.find(r => r.name === 'Healer');
                        if (healerRole && member.roles.cache.has(healerRole.id)) {
                            enriched.role = 'Healer';
                        } else {
                            const tankerRole = guild.roles.cache.find(r => r.name === 'Tanker');
                            if (tankerRole && member.roles.cache.has(tankerRole.id)) {
                                enriched.role = 'Tanker';
                            } else {
                                // Check DPS
                                const dpsRole = guild.roles.cache.find(r => r.name === 'DPS');
                                if (dpsRole && member.roles.cache.has(dpsRole.id)) {
                                    enriched.role = 'DPS';
                                }
                                // Check DPS sub-types
                                for (const subName of dpsSubTypeRoles) {
                                    const subRole = guild.roles.cache.find(r => r.name === subName);
                                    if (subRole && member.roles.cache.has(subRole.id)) {
                                        enriched.role = 'DPS';
                                        enriched.sub = dpsShortTags[subName];
                                        break;
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {}
            }

            return enriched;
        };

        // Enrich tất cả players
        const enrichTeam = (team) => safeParse(team).map(enrichPlayer);

        return {
            team_attack1: enrichTeam(activeSession.team_attack1),
            team_attack2: enrichTeam(activeSession.team_attack2),
            team_defense: enrichTeam(activeSession.team_defense),
            team_forest: enrichTeam(activeSession.team_forest),
            waiting_list: enrichTeam(activeSession.waiting_list),
            leader_ids: {
                team1: activeSession.team1_leader_id,
                team2: activeSession.team2_leader_id,
                team3: activeSession.team3_leader_id,
                team4: activeSession.team4_leader_id,
                commander: activeSession.commander_id
            },
            team_sizes: teamSizes,
            status: 'active',
            time: activeSession.time || '19:30',
            note: activeSession.note || '',
            locked: !!activeSession.locked
        };
    } catch (err) {
        console.error('[Supabase] ❌ formatActiveSession lỗi:', err.message, err.stack);
        return null;
    }
}

/**
 * Sync toàn bộ phiên BC active từ SQLite lên Supabase
 * Gọi khi bot start — có bước RECONCILE trước để xử lý
 * trường hợp web đã xoá session trong lúc bot offline.
 * @param {Object} db - Database module
 * @param {string} guildId - Guild ID
 * @param {Object} guild - Discord Guild object (để xoá role BC)
 */
async function syncAllActiveSessions(db, guildId, guild = null) {
    if (!isReady()) return;
    try {
        // Lấy tất cả active sessions từ SQLite (dùng helper function, không dùng raw db.db)
        let localSessions = [];
        if (typeof db.getActiveBangchienByGuild === 'function') {
            localSessions = db.getActiveBangchienByGuild(guildId) || [];
        } else if (db.db) {
            // Fallback: raw SQL
            localSessions = db.db.prepare('SELECT * FROM bangchien_active WHERE guild_id = ?').all(guildId);
        }
        console.log(`[Supabase] 🔍 syncAllActiveSessions: tìm thấy ${localSessions.length} sessions trong SQLite (guild=${guildId})`);

        // ═══ RECONCILE: Query Supabase để tìm session đã bị xoá từ web khi bot offline ═══
        const { data: remoteSessions } = await supabase
            .from('bc_sessions')
            .select('day')
            .eq('guild_id', guildId)
            .eq('status', 'active');
        const remoteDays = new Set((remoteSessions || []).map(s => s.day));

        // Chỉ reconcile nếu Supabase đang có ít nhất 1 session
        // Tránh xóa SQLite nhầm khi Supabase bị clear/reset thủ công
        let reconciledCount = 0;
        if ((remoteSessions || []).length > 0) {
            for (const localSession of localSessions) {
                const day = localSession.day;
                if (day && !remoteDays.has(day)) {
                    // Session này tồn tại trong SQLite nhưng Supabase đã xoá → zombie
                    console.log(`[Supabase] 🧹 Reconcile: session ${day} đã bị xoá từ web khi bot offline → xoá SQLite`);

                    // Xoá role BC cho participants
                    if (guild) {
                        const safeParse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : (v || []); } catch(e) { return []; } };
                        const participants = [
                            ...safeParse(localSession.team_attack1),
                            ...safeParse(localSession.team_attack2),
                            ...safeParse(localSession.team_defense),
                            ...safeParse(localSession.team_forest)
                        ];
                        const bcRole = guild.roles.cache.find(r => r.name === 'bc');
                        if (bcRole && participants.length > 0) {
                            for (const p of participants) {
                                try {
                                    const member = await guild.members.fetch(p.id).catch(() => null);
                                    if (member && member.roles.cache.has(bcRole.id)) {
                                        await member.roles.remove(bcRole);
                                        console.log(`[Supabase] 🧹 Reconcile: xoá role BC cho ${member.user.username}`);
                                    }
                                } catch (e) { }
                            }
                        }
                    }

                    // Xoá khỏi SQLite
                    const partyKey = localSession.party_key;
                    db.deleteActiveBangchien(partyKey);

                    // Dọn memory state
                    try {
                        const { bangchienNotifications, bangchienRegistrations } = require('./bangchienState');
                        const notifData = bangchienNotifications.get(partyKey);
                        if (notifData && notifData.intervalId) clearInterval(notifData.intervalId);
                        bangchienNotifications.delete(partyKey);
                        bangchienRegistrations.delete(partyKey);
                    } catch (e) { }

                    reconciledCount++;
                }
            }
        } else {
            console.log(`[Supabase] ⚠️ Supabase rỗng — bỏ qua reconcile, chỉ push SQLite lên`);
        }

        if (reconciledCount > 0) {
            console.log(`[Supabase] 🧹 Reconcile hoàn tất: xoá ${reconciledCount} zombie session(s)`);
        }

        // ═══ SYNC: Push các session còn lại lên Supabase ═══
        const remainingSessions = typeof db.getActiveBangchienByGuild === 'function'
            ? (db.getActiveBangchienByGuild(guildId) || [])
            : (db.db ? db.db.prepare('SELECT * FROM bangchien_active WHERE guild_id = ?').all(guildId) : []);

        // Pre-fetch TẤT CẢ guild members vào cache trước khi đọc role/vũ khí
        // Giải quyết lỗi: guild.members.cache trống khi bot vừa restart
        // → formatActiveSession() (sync) không thể gọi fetch() nên phải dựa vào cache
        if (guild && remainingSessions.length > 0) {
            try {
                await guild.members.fetch();
                console.log(`[Supabase] ✅ Pre-fetched ${guild.members.cache.size} members vào cache`);
            } catch (fetchErr) {
                console.warn(`[Supabase] ⚠️ Pre-fetch members thất bại: ${fetchErr.message}`);
            }
        }

        for (const session of remainingSessions) {
            const day = session.day || 'sat';
            const data = formatActiveSession(session, db, guild);
            if (data) {
                await syncBCSession(guildId, day, data);
            }
        }
        console.log(`[Supabase] ✅ Sync ${remainingSessions.length} active sessions khi bot start`);
    } catch (err) {
        console.error('[Supabase] ❌ syncAllActiveSessions exception:', err.message);
    }
}

module.exports = {
    initSupabase,
    isReady,
    syncBCSession,
    deleteBCSession,
    deleteAllBCSessions,
    syncUsers,
    syncOneUser,
    syncBcRegular,
    removeBcRegular,
    setSessionLocked,
    pollBcRegulars,
    logAction,
    listenForWebChanges,
    listenForTacticsHistoryChanges,
    formatActiveSession,
    syncAllActiveSessions
};
