/**
 * Supabase Sync Module
 * Đồng bộ dữ liệu bang chiến giữa Bot (SQLite) và Supabase (Cloud DB)
 * Dùng cho Web Bang Chiến Lang Gia
 */

const { createClient } = require('@supabase/supabase-js');
const { LEAGUE_TIME, normalizeBcTime, getSessionIdentityKey } = require('./bangchienState');
const bangchienRoster = require('./bangchienRoster');

// Khởi tạo Supabase client với service_role key (full quyền)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

let supabase = null;
let supportsBcSessionsLockedColumn = true;
let supportsBcSessionsTeamNamesColumn = true; // Flag auto-fallback cho cột team_names
let supportsBcSessionsDynamicRosterColumns = true;
let supportsBcTacticsSessionIdColumn = true;
let supportsBcTacticsHistorySessionIdColumn = true;
let supportsBcRosterSnapshotsTable = true;
let warnedBcRosterSnapshotsMissing = false;

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

// ═══ HELPER: Xử lý lỗi Supabase gọn gàng (tránh dump HTML 502/503) ═══
let _supabaseBackoffUntil = 0; // Timestamp backoff khi server down
const BACKOFF_DURATION_MS = 30000; // 30 giây backoff

function sanitizeErrorMessage(msg) {
    if (!msg || typeof msg !== 'string') return msg || 'Unknown error';
    // Phát hiện HTML response (502, 503, 504 gateway errors)
    if (msg.includes('<!DOCTYPE') || msg.includes('<html') || msg.includes('<head')) {
        const titleMatch = msg.match(/<title[^>]*>(.*?)<\/title>/i);
        const statusMatch = msg.match(/(\d{3}):\s*([^<]+)/i);
        return titleMatch ? titleMatch[1].trim() : (statusMatch ? `HTTP ${statusMatch[1]}: ${statusMatch[2].trim()}` : 'Supabase trả về HTML (server error)');
    }
    // Cắt ngắn message quá dài
    return msg.length > 200 ? msg.substring(0, 200) + '...' : msg;
}

function isBackingOff() {
    if (Date.now() < _supabaseBackoffUntil) return true;
    return false;
}

function triggerBackoff() {
    _supabaseBackoffUntil = Date.now() + BACKOFF_DURATION_MS;
    console.warn(`[Supabase] ⏸️ Server lỗi → tạm dừng sync ${BACKOFF_DURATION_MS / 1000}s`);
}

function handleSyncError(context, error) {
    const msg = sanitizeErrorMessage(error?.message || String(error));
    // Nếu là lỗi server (502/503/504) → trigger backoff
    if (/502|503|504|Bad gateway|Service Unavailable/i.test(msg)) {
        if (!isBackingOff()) triggerBackoff();
        return; // Không spam log
    }
    console.error(`[Supabase] ❌ ${context}:`, msg);
}

// ═══════════════════════════════════════════════════════════════
function isMissingRosterSnapshotTableError(error) {
    const message = error?.message || String(error || '');
    return /bc_roster_snapshots|schema cache|find the table|relation.*does not exist|does not exist/i.test(message);
}

function parseJsonObject(value, fallback = {}) {
    const parsed = bangchienRoster.parseJson(value, fallback);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
}

function buildRosterSnapshotPayload(guildId, session = {}, source = 'bot') {
    if (!guildId || !session?.id) return null;
    const roster = bangchienRoster.normalizeRoster(session);
    const legacyKeys = bangchienRoster.LEGACY_TEAM_KEYS || ['team_attack1', 'team_attack2', 'team_defense', 'team_forest'];
    const sizeKeys = bangchienRoster.LEGACY_SIZE_KEYS || {
        team_attack1: 'attack1',
        team_attack2: 'attack2',
        team_defense: 'defense',
        team_forest: 'forest'
    };
    const legacyTeams = {
        team_attack1: [],
        team_attack2: [],
        team_defense: [],
        team_forest: []
    };
    const teamSizes = {};
    const teamNames = {};

    roster.layout.slice(0, legacyKeys.length).forEach((team, index) => {
        const legacyKey = legacyKeys[index];
        const sizeKey = sizeKeys[legacyKey];
        legacyTeams[legacyKey] = (roster.teams[team.id] || []).map((member) => ({ ...member, team: legacyKey }));
        if (sizeKey) {
            teamSizes[sizeKey] = Number(team.capacity) || 0;
            teamNames[sizeKey] = team.name || legacyKey;
        }
    });

    const normalizedTime = normalizeBcTime(session.time || LEAGUE_TIME);
    const label = [session.day, normalizedTime, session.note].filter(Boolean).join(' ');

    return {
        guild_id: guildId,
        source_session_id: session.id,
        day: session.day || null,
        time: normalizedTime,
        label: label || null,
        captured_at: new Date().toISOString(),
        source_updated_at: session.updated_at || null,
        team_layout: roster.layout || [],
        teams: roster.teams || {},
        team_attack1: legacyTeams.team_attack1 || [],
        team_attack2: legacyTeams.team_attack2 || [],
        team_defense: legacyTeams.team_defense || [],
        team_forest: legacyTeams.team_forest || [],
        waiting_list: roster.waitingList || [],
        team_sizes: Object.keys(teamSizes).length ? teamSizes : parseJsonObject(session.team_sizes, {}),
        team_names: Object.keys(teamNames).length ? teamNames : parseJsonObject(session.team_names, {}),
        leader_ids: parseJsonObject(session.leader_ids, {}),
        source
    };
}

async function saveRosterSnapshot(guildId, session, source = 'bot') {
    if (!isReady() || !supportsBcRosterSnapshotsTable) return false;
    const payload = buildRosterSnapshotPayload(guildId, session, source);
    if (!payload) return false;
    try {
        const { error } = await supabase
            .from('bc_roster_snapshots')
            .upsert(payload, { onConflict: 'guild_id,source_session_id' });

        if (error) {
            if (isMissingRosterSnapshotTableError(error)) {
                supportsBcRosterSnapshotsTable = false;
                if (!warnedBcRosterSnapshotsMissing) {
                    warnedBcRosterSnapshotsMissing = true;
                    console.warn('[Supabase] bc_roster_snapshots chua san sang, bo qua roster snapshot.');
                }
                return false;
            }
            handleSyncError('saveRosterSnapshot', error);
            return false;
        }
        return true;
    } catch (error) {
        if (isMissingRosterSnapshotTableError(error)) {
            supportsBcRosterSnapshotsTable = false;
            if (!warnedBcRosterSnapshotsMissing) {
                warnedBcRosterSnapshotsMissing = true;
                console.warn('[Supabase] bc_roster_snapshots chua san sang, bo qua roster snapshot.');
            }
            return false;
        }
        handleSyncError('saveRosterSnapshot exception', error);
        return false;
    }
}

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
            team_names = {},
            team_layout = null,
            teams = null,
            status = 'active',
            time = LEAGUE_TIME,
            note = '',
            locked = false
        } = sessionData;
        const normalizedTime = normalizeBcTime(time || LEAGUE_TIME);

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
            time: normalizedTime,
            note: note || ''
        };
        if (supportsBcSessionsLockedColumn) {
            payload.locked = !!locked;
        }
        // team_names: auto-fallback nếu cột chưa tồn tại
        if (supportsBcSessionsTeamNamesColumn) {
            payload.team_names = JSON.stringify(team_names);
        }
        if (supportsBcSessionsDynamicRosterColumns) {
            const roster = bangchienRoster.normalizeRoster({
                team_attack1,
                team_attack2,
                team_defense,
                team_forest,
                waiting_list,
                team_sizes,
                team_names,
                team_layout,
                teams
            });
            payload.team_layout = roster.layout;
            payload.teams = roster.teams;
        }

        let { error } = await supabase
            .from('bc_sessions')
            .upsert(payload, { onConflict: 'guild_id,day,time' });

        if (error && /locked/i.test(error.message || '')) {
            supportsBcSessionsLockedColumn = false;
            delete payload.locked;
            const retry = await supabase
                .from('bc_sessions')
                .upsert(payload, { onConflict: 'guild_id,day,time' });
            error = retry.error || null;
        }

        // Fallback nếu cột team_names chưa tồn tại
        if (error && /team_names/i.test(error.message || '')) {
            supportsBcSessionsTeamNamesColumn = false;
            delete payload.team_names;
            const retry2 = await supabase
                .from('bc_sessions')
                .upsert(payload, { onConflict: 'guild_id,day,time' });
            error = retry2.error || null;
        }
        if (error && /(team_layout|teams)/i.test(error.message || '')) {
            supportsBcSessionsDynamicRosterColumns = false;
            delete payload.team_layout;
            delete payload.teams;
            const retry3 = await supabase
                .from('bc_sessions')
                .upsert(payload, { onConflict: 'guild_id,day,time' });
            error = retry3.error || null;
        }

        if (error) {
            console.error('[Supabase] ❌ Sync BC session lỗi:', error.message);
        } else {
            const activeCount = bangchienRoster.getRosterCounts({ team_attack1, team_attack2, team_defense, team_forest, waiting_list, team_layout, teams }).active;
            console.log(`[Supabase] ✅ Sync BC ${day} ${normalizedTime} thành công (${activeCount} người)`);
            try {
                const { data: savedSession, error: sessionLookupError } = await supabase
                    .from('bc_sessions')
                    .select('*')
                    .eq('guild_id', guildId)
                    .eq('day', day)
                    .eq('time', normalizedTime)
                    .maybeSingle();

                if (sessionLookupError) {
                    handleSyncError('syncBCSession session lookup', sessionLookupError);
                } else if (savedSession?.id) {
                    await saveRosterSnapshot(guildId, savedSession, 'bot_sync');
                    await ensureSessionScopedTacticsPayload(guildId, savedSession);
                }
            } catch (syncError) {
                handleSyncError('syncBCSession tactics sync', syncError);
            }
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
async function deleteBCSession(guildId, day, time = LEAGUE_TIME) {
    const normalizedTime = normalizeBcTime(time || LEAGUE_TIME);
    console.log(`[Supabase] deleteBCSession called: guild=${guildId}, day=${day}, time=${normalizedTime}, ready=${isReady()}`);
    if (!isReady()) {
        console.log('[Supabase] ⚠️ deleteBCSession: Supabase chưa sẵn sàng, bỏ qua!');
        return;
    }
    try {
        // STEP 1: UPDATE status='ended' → web nhận Realtime UPDATE event
        const { data: existingSession, error: snapshotLookupError } = await supabase
            .from('bc_sessions')
            .select('*')
            .eq('guild_id', guildId)
            .eq('day', day)
            .eq('time', normalizedTime)
            .maybeSingle();
        if (snapshotLookupError) {
            handleSyncError('deleteBCSession snapshot lookup', snapshotLookupError);
        } else if (existingSession?.id) {
            await saveRosterSnapshot(guildId, existingSession, 'bot_delete');
        }

        await supabase
            .from('bc_sessions')
            .update({ status: 'ended' })
            .eq('guild_id', guildId)
            .eq('day', day)
            .eq('time', normalizedTime);
        console.log(`[Supabase] Signal ended for ${day} ${normalizedTime}`);

        // Chờ 500ms để web kịp nhận event
        await new Promise(r => setTimeout(r, 500));

        // STEP 2: DELETE hẳn row
        let { error } = await supabase
            .from('bc_sessions')
            .delete()
            .eq('guild_id', guildId)
            .eq('day', day)
            .eq('time', normalizedTime);

        if (error) {
            console.error('[Supabase] ❌ Xóa BC session lỗi:', error.message);
        } else {
            console.log(`[Supabase] Deleted BC session ${day} ${normalizedTime}`);
        }
    } catch (err) {
        console.error('[Supabase] ❌ deleteBCSession exception:', err.message);
    }
}

async function getSessionScopedTacticsRow(guildId, sessionId, day) {
    if (!isReady()) return null;

    if (supportsBcTacticsSessionIdColumn && sessionId) {
        const result = await supabase
            .from('bc_tactics')
            .select('id, session_id, guild_id, day, markers, notes, updated_at, updated_by')
            .eq('guild_id', guildId)
            .eq('session_id', sessionId)
            .maybeSingle();

        if (!result.error) return result.data || null;
        if (/session_id/i.test(result.error.message || '')) {
            supportsBcTacticsSessionIdColumn = false;
        } else {
            handleSyncError('getSessionScopedTacticsRow', result.error);
            return null;
        }
    }

    const fallback = await supabase
        .from('bc_tactics')
        .select('id, guild_id, day, markers, notes, updated_at, updated_by')
        .eq('guild_id', guildId)
        .eq('day', day)
        .order('updated_at', { ascending: false })
        .limit(1);

    if (fallback.error) {
        handleSyncError('getSessionScopedTacticsRow fallback', fallback.error);
        return null;
    }

    return Array.isArray(fallback.data) ? (fallback.data[0] || null) : (fallback.data || null);
}

const ACTIVE_TEAM_KEYS = bangchienRoster.LEGACY_TEAM_KEYS || ['team_attack1', 'team_attack2', 'team_defense', 'team_forest'];

function parseSessionJsonList(value) {
    try {
        return typeof value === 'string' ? JSON.parse(value || '[]') : (value || []);
    } catch (error) {
        return [];
    }
}

function getSessionRosterForTactics(sessionRow) {
    return bangchienRoster.normalizeRoster(sessionRow || {});
}

function getSessionRosterSnapshot(sessionRow) {
    if (!sessionRow) {
        return { attack1: [], attack2: [], defense: [], forest: [], team_layout: [], teams: {} };
    }
    const roster = getSessionRosterForTactics(sessionRow);
    const mirror = bangchienRoster.serializeRosterForStorage(roster);
    return {
        attack1: mirror.team_attack1 || [],
        attack2: mirror.team_attack2 || [],
        defense: mirror.team_defense || [],
        forest: mirror.team_forest || [],
        team_layout: roster.layout,
        teams: roster.teams
    };
}

function getSessionTeamSizes(sessionRow) {
    const mirror = bangchienRoster.serializeRosterForStorage(getSessionRosterForTactics(sessionRow));
    return mirror.team_sizes || { attack1: 10, attack2: 10, defense: 5, forest: 5 };
}

function getSessionActiveSlotLayout(sessionRow) {
    const roster = getSessionRosterForTactics(sessionRow);
    const layout = [];
    roster.layout.forEach((team) => {
        Array.from({ length: Math.max(0, Number(team.capacity) || 0) }).forEach(() => layout.push(team.id));
    });
    return layout;
}

function getSessionFlatActiveRoster(sessionRow) {
    return bangchienRoster.getActiveRosterMembers(sessionRow || {});
}

function normalizeTacticsTeamId(value, fallbackTeam = 'team_attack1') {
    const raw = String(value || '').trim();
    if (raw && raw !== 'enemy' && raw !== 'waiting_list') return raw;
    const fallback = String(fallbackTeam || '').trim();
    return fallback && fallback !== 'enemy' && fallback !== 'waiting_list' ? fallback : 'team_attack1';
}

function normalizeTacticsSlotTemplateEntry(entry, index = 0, fallbackTeam = 'team_attack1') {
    const slotIndex = Number.isFinite(Number(entry?.slot_index)) ? Number(entry.slot_index) : index;
    const team = normalizeTacticsTeamId(entry?.team, fallbackTeam);
    const role = ['DPS', 'Tanker', 'Healer'].includes(entry?.role) ? entry.role : 'DPS';
    const tacticalId = entry?.tactical_id || entry?.player_id || entry?.id || null;
    const reservedFor = entry?.reserved_for || entry?.replacement_for || entry?.player_id || entry?.id || null;
    return {
        slot_index: slotIndex,
        team,
        tactical_id: tacticalId,
        reserved_for: reservedFor,
        original_name: entry?.original_name || entry?.name || '',
        role,
        sub: entry?.sub || ''
    };
}

function normalizeTacticsBotSlot(bot, index = 0) {
    const seq = Number.isFinite(Number(bot?.seq)) ? Number(bot.seq) : (index + 1);
    const role = ['DPS', 'Tanker', 'Healer'].includes(bot?.role) ? bot.role : 'DPS';
    const team = normalizeTacticsTeamId(bot?.team, 'team_attack1');
    return {
        ...bot,
        id: bot?.id || `slotbot_${seq}`,
        seq,
        name: bot?.name || `Bot ${String(seq).padStart(2, '0')}`,
        role,
        sub: bot?.sub || '',
        team,
        isBot: true,
        replacement_for: bot?.replacement_for || null,
        reserved_slot_index: Number.isFinite(Number(bot?.reserved_slot_index)) ? Number(bot.reserved_slot_index) : null,
        original_team: bot?.original_team || team,
        original_name: bot?.original_name || bot?.name || ''
    };
}

function buildSlotTemplateFromRosterSnapshot(rosterSnapshot, payload = {}) {
    const snapshot = rosterSnapshot && typeof rosterSnapshot === 'object'
        ? rosterSnapshot
        : { attack1: [], attack2: [], defense: [], forest: [], team_layout: [], teams: {} };
    const template = [];

    if (snapshot.team_layout || snapshot.teams || snapshot.teams_json) {
        const roster = bangchienRoster.normalizeRoster({
            team_layout: snapshot.team_layout,
            teams: snapshot.teams || snapshot.teams_json,
            waiting_list: []
        });
        roster.layout.forEach((team) => {
            (roster.teams[team.id] || []).forEach((player) => {
                template.push(normalizeTacticsSlotTemplateEntry({
                    slot_index: template.length,
                    team: team.id,
                    tactical_id: player?.id || null,
                    reserved_for: player?.id || null,
                    original_name: player?.gn || player?.name || player?.username || '',
                    role: player?.role || 'DPS',
                    sub: player?.sub || ''
                }, template.length, team.id));
            });
        });
    } else {
        const teamMap = [
            ['attack1', 'team_attack1'],
            ['attack2', 'team_attack2'],
            ['defense', 'team_defense'],
            ['forest', 'team_forest']
        ];
        teamMap.forEach(([rosterKey, teamKey]) => {
            parseSessionJsonList(snapshot[rosterKey]).forEach((player) => {
                template.push(normalizeTacticsSlotTemplateEntry({
                    slot_index: template.length,
                    team: teamKey,
                    tactical_id: player?.id || null,
                    reserved_for: player?.id || null,
                    original_name: player?.gn || player?.name || player?.username || '',
                    role: player?.role || 'DPS',
                    sub: player?.sub || ''
                }, template.length, teamKey));
            });
        });
    }

    (Array.isArray(payload?.botSlots) ? payload.botSlots : []).forEach((bot) => {
        const slotIndex = Number.isFinite(Number(bot?.reserved_slot_index)) ? Number(bot.reserved_slot_index) : -1;
        if (slotIndex < 0) return;
        template[slotIndex] = normalizeTacticsSlotTemplateEntry({
            slot_index: slotIndex,
            team: bot?.original_team || bot?.team || template[slotIndex]?.team || 'team_attack1',
            tactical_id: bot?.id || template[slotIndex]?.tactical_id || null,
            reserved_for: bot?.replacement_for || template[slotIndex]?.reserved_for || null,
            original_name: bot?.original_name || bot?.name || template[slotIndex]?.original_name || '',
            role: bot?.role || template[slotIndex]?.role || 'DPS',
            sub: bot?.sub || template[slotIndex]?.sub || ''
        }, slotIndex, template[slotIndex]?.team || bot?.team || 'team_attack1');
    });

    return template
        .map((entry, index) => normalizeTacticsSlotTemplateEntry(entry || {}, index, entry?.team || 'team_attack1'))
        .sort((a, b) => a.slot_index - b.slot_index);
}

function normalizeLiveTacticsPayload(rawPayload, meta = {}, rosterFallback = null) {
    const payload = (() => {
        try {
            return JSON.parse(JSON.stringify(rawPayload || {}));
        } catch (error) {
            return {};
        }
    })();

    const rosterSnapshot = payload.roster_snapshot || payload.roster || rosterFallback || { attack1: [], attack2: [], defense: [], forest: [] };
    const slotTemplate = Array.isArray(payload.slot_template) && payload.slot_template.length
        ? payload.slot_template.map((entry, index) => normalizeTacticsSlotTemplateEntry(entry, index, entry?.team || 'team_attack1'))
        : buildSlotTemplateFromRosterSnapshot(rosterSnapshot, payload);

    return {
        ...payload,
        version: Math.max(3, Number(payload.version) || 0),
        roster_snapshot: rosterSnapshot,
        slot_template: slotTemplate,
        botSlots: Array.isArray(payload.botSlots) ? payload.botSlots.map((bot, index) => normalizeTacticsBotSlot(bot, index)) : [],
        source_snapshot_meta: {
            ...(payload.source_snapshot_meta || {}),
            source_type: meta.type || payload?.source_snapshot_meta?.source_type || 'live',
            source_session_id: meta.session_id || payload?.source_snapshot_meta?.source_session_id || null,
            source_day: meta.day || payload?.source_snapshot_meta?.source_day || null,
            source_saved_at: meta.saved_at || meta.updated_at || payload?.source_snapshot_meta?.source_saved_at || new Date().toISOString()
        }
    };
}

function createReservedBotForTacticsSlot(slot, existingBot = null) {
    return normalizeTacticsBotSlot({
        ...(existingBot || {}),
        id: existingBot?.id || slot.tactical_id || `slotbot_${slot.slot_index + 1}`,
        seq: existingBot?.seq || Number(slot.slot_index) + 1,
        name: existingBot?.name || slot.original_name || `Bot ${String(slot.slot_index + 1).padStart(2, '0')}`,
        role: slot.role || existingBot?.role || 'DPS',
        sub: slot.sub || existingBot?.sub || '',
        team: slot.team || existingBot?.team || 'team_attack1',
        isBot: true,
        replacement_for: slot.reserved_for || existingBot?.replacement_for || null,
        reserved_slot_index: slot.slot_index,
        original_team: slot.team || existingBot?.original_team || 'team_attack1',
        original_name: slot.original_name || existingBot?.original_name || existingBot?.name || ''
    }, slot.slot_index);
}

function remapTacticsPayloadUnitId(payload, oldId, replacementUnit) {
    if (!payload || !oldId || !replacementUnit || oldId === replacementUnit.id) return;

    const replacementName = replacementUnit.gn || replacementUnit.name || replacementUnit.original_name || replacementUnit.username || replacementUnit.id;
    const replacementRole = replacementUnit.role || 'DPS';
    const replacementSub = replacementUnit.sub || '';
    const replacementTeam = replacementUnit.team || 'team_attack1';
    const isBot = Boolean(replacementUnit.isBot);

    (payload.marks || []).forEach((mark) => {
        (mark.players || []).forEach((player) => {
            if (player.id !== oldId) return;
            player.id = replacementUnit.id;
            player.name = replacementName;
            player.role = replacementRole;
            player.sub = replacementSub;
            player.team = replacementTeam;
            if (isBot) player.isBot = true;
            else delete player.isBot;
        });
        Object.keys(mark.tower_guards || {}).forEach((towerId) => {
            mark.tower_guards[towerId] = (mark.tower_guards[towerId] || []).map((id) =>
                id === oldId ? replacementUnit.id : id
            );
        });
        (mark.targeting || []).forEach((target) => {
            if (target.playerId === oldId) target.playerId = replacementUnit.id;
            if (target.from === oldId) target.from = replacementUnit.id;
        });
        (mark.icon_targets || []).forEach((target) => {
            if (target.playerId === oldId) target.playerId = replacementUnit.id;
            if (target.from === oldId) target.from = replacementUnit.id;
        });
        if (mark.pvp_fighters?.blue === oldId) mark.pvp_fighters.blue = replacementUnit.id;
        Object.values(mark.boss_assignments || {}).forEach((entry) => {
            if (Array.isArray(entry?.blue)) entry.blue = entry.blue.map((id) => id === oldId ? replacementUnit.id : id);
        });
        Object.values(mark.tree_carriers || {}).forEach((entry) => {
            if (entry?.main === oldId) entry.main = replacementUnit.id;
            if (Array.isArray(entry?.support)) entry.support = entry.support.map((id) => id === oldId ? replacementUnit.id : id);
        });
        Object.values(mark.jungle_assignments || {}).forEach((entry) => {
            if (Array.isArray(entry?.blue)) entry.blue = entry.blue.map((id) => id === oldId ? replacementUnit.id : id);
            Object.values(entry?.windows || {}).forEach((windowEntry) => {
                if (Array.isArray(windowEntry?.blue)) windowEntry.blue = windowEntry.blue.map((id) => id === oldId ? replacementUnit.id : id);
            });
        });
        (mark.tasks || []).forEach((task) => {
            if (task?.scope === 'personal' && task.target === oldId) task.target = replacementUnit.id;
        });
    });

    (payload.global_notes || []).forEach((note) => {
        if (note?.scope === 'personal' && note.target === oldId) note.target = replacementUnit.id;
    });

    if (Array.isArray(payload.jungle_default_player_ids)) {
        payload.jungle_default_player_ids = payload.jungle_default_player_ids.map((id) =>
            id === oldId ? replacementUnit.id : id
        );
    }
}

function isTacticsBotLikeId(id) {
    return typeof id === 'string' && /^(bot_|slotbot_|slot_tmp_|idx_slot_tmp_|svc_slot_tmp_)/.test(id);
}

function getReservedHumanSlotId(slot) {
    const ids = [slot?.reserved_for, slot?.player_id, slot?.tactical_id, slot?.id];
    return ids.find((id) => id && !isTacticsBotLikeId(id)) || null;
}

function syncTacticsPayloadToSessionRoster(rawPayload, sessionRow) {
    const payload = normalizeLiveTacticsPayload(rawPayload, {}, getSessionRosterSnapshot(sessionRow));
    const humans = getSessionFlatActiveRoster(sessionRow);
    const humansById = new Map(humans.map((player) => [player.id, player]));
    const usedHumanIds = new Set();
    const layout = getSessionActiveSlotLayout(sessionRow);
    const savedBindings = Array.isArray(payload.slot_template) && payload.slot_template.length
        ? payload.slot_template.map((entry, index) => normalizeTacticsSlotTemplateEntry(entry, index, entry?.team || 'team_attack1'))
        : buildSlotTemplateFromRosterSnapshot(payload.roster_snapshot, payload);
    const existingBots = new Map((payload.botSlots || []).map((bot, index) => {
        const normalized = normalizeTacticsBotSlot(bot, index);
        const slotIndex = Number.isFinite(Number(normalized.reserved_slot_index))
            ? Number(normalized.reserved_slot_index)
            : -1;
        return [slotIndex, normalized];
    }));

    const slotCount = savedBindings.length
        ? Math.max(layout.length, savedBindings.length, humans.length)
        : humans.length;
    const reservedRosterIds = new Set(savedBindings
        .map((entry, index) => getReservedHumanSlotId(normalizeTacticsSlotTemplateEntry(entry || {}, index, entry?.team || layout[index] || 'team_attack1')))
        .filter((id) => id && humansById.has(id)));
    const nextBindings = [];
    const nextBots = [];
    const pendingRemaps = [];
    const claimHumanById = (id) => {
        if (!id || usedHumanIds.has(id)) return null;
        const human = humansById.get(id);
        if (!human) return null;
        usedHumanIds.add(id);
        return human;
    };
    const claimFallbackHuman = (index, options = {}) => {
        const unreservedOnly = Boolean(options.unreservedOnly);
        const canUse = (player) => player?.id
            && !usedHumanIds.has(player.id)
            && (!unreservedOnly || !reservedRosterIds.has(player.id));
        const indexed = humans[index];
        if (canUse(indexed)) {
            usedHumanIds.add(indexed.id);
            return indexed;
        }
        const next = humans.find(canUse);
        if (!next) return null;
        usedHumanIds.add(next.id);
        return next;
    };

    for (let index = 0; index < slotCount; index++) {
        const teamKey = layout[index] || savedBindings[index]?.team || humans[index]?.team || 'team_attack1';
        const previous = normalizeTacticsSlotTemplateEntry(savedBindings[index] || {}, index, teamKey);
        const reservedHumanId = getReservedHumanSlotId(previous);
        const preferredHuman = claimHumanById(previous.reserved_for) || claimHumanById(previous.tactical_id);
        const human = preferredHuman || claimFallbackHuman(index, { unreservedOnly: Boolean(reservedHumanId) });
        const slot = normalizeTacticsSlotTemplateEntry({
            ...previous,
            slot_index: index,
            team: teamKey,
            original_name: previous.original_name || human?.gn || human?.name || human?.username || '',
            role: previous.role || human?.role || 'DPS',
            sub: previous.sub || human?.sub || ''
        }, index, teamKey);

        let replacementUnit = null;
        if (human) {
            replacementUnit = { ...human, team: teamKey, isBot: false };
        } else {
            replacementUnit = createReservedBotForTacticsSlot(slot, existingBots.get(index));
            nextBots.push(replacementUnit);
        }

        const oldId = previous.tactical_id || previous.player_id || null;
        if (oldId && oldId !== replacementUnit.id) {
            pendingRemaps.push({ oldId, replacementUnit, slot });
        }

        nextBindings.push(normalizeTacticsSlotTemplateEntry({
            ...slot,
            tactical_id: replacementUnit.id,
            reserved_for: replacementUnit.isBot
                ? (slot.reserved_for || replacementUnit.replacement_for || null)
                : (replacementUnit.id || null),
            original_name: slot.original_name || replacementUnit.original_name || replacementUnit.gn || replacementUnit.name || ''
        }, index, teamKey));
    }

    if (pendingRemaps.length > 0) {
        const tempRemaps = pendingRemaps.map((entry, index) => ({
            ...entry,
            tempId: `svc_slot_tmp_${Date.now()}_${index}`
        }));
        tempRemaps.forEach((entry) => {
            remapTacticsPayloadUnitId(payload, entry.oldId, {
                id: entry.tempId,
                name: entry.slot.original_name || entry.replacementUnit.original_name || entry.replacementUnit.gn || entry.replacementUnit.name || entry.oldId,
                role: entry.slot.role || entry.replacementUnit.role || 'DPS',
                sub: entry.slot.sub || entry.replacementUnit.sub || '',
                team: entry.slot.team || entry.replacementUnit.team || 'team_attack1',
                isBot: false
            });
        });
        tempRemaps.forEach((entry) => {
            remapTacticsPayloadUnitId(payload, entry.tempId, entry.replacementUnit);
        });
    }

    payload.roster_snapshot = getSessionRosterSnapshot(sessionRow);
    payload.team_layout = payload.roster_snapshot.team_layout || [];
    payload.teams = payload.roster_snapshot.teams || {};
    payload.slot_template = nextBindings;
    payload.botSlots = nextBots;
    payload.version = Math.max(3, Number(payload.version) || 0);
    payload.source_snapshot_meta = {
        ...(payload.source_snapshot_meta || {}),
        current_session_id: sessionRow?.id || payload?.source_snapshot_meta?.current_session_id || null,
        current_day: sessionRow?.day || payload?.source_snapshot_meta?.current_day || null
    };
    return payload;
}

async function fetchLatestGuildTacticsSeedSource(guildId, excludeSessionId = null) {
    if (!isReady()) return null;

    if (supportsBcTacticsSessionIdColumn) {
        const liveResult = await supabase
            .from('bc_tactics')
            .select('markers,notes,updated_at,updated_by,day,session_id')
            .eq('guild_id', guildId)
            .order('updated_at', { ascending: false })
            .limit(10);

        if (liveResult.error) {
            if (/session_id/i.test(liveResult.error.message || '')) {
                supportsBcTacticsSessionIdColumn = false;
            } else {
                handleSyncError('fetchLatestGuildTacticsSeedSource live', liveResult.error);
            }
        } else {
            const picked = (liveResult.data || []).find((row) => row?.markers && String(row.session_id || '') !== String(excludeSessionId || ''));
            if (picked?.markers) {
                return normalizeLiveTacticsPayload(picked.markers, {
                    type: 'live',
                    session_id: picked.session_id || null,
                    day: picked.day || null,
                    updated_at: picked.updated_at || null
                });
            }
        }
    }

    const fallbackLive = await supabase
        .from('bc_tactics')
        .select('markers,notes,updated_at,updated_by,day')
        .eq('guild_id', guildId)
        .order('updated_at', { ascending: false })
        .limit(10);

    if (!fallbackLive.error) {
        const picked = (fallbackLive.data || []).find((row) => row?.markers);
        if (picked?.markers) {
            return normalizeLiveTacticsPayload(picked.markers, {
                type: 'live',
                day: picked.day || null,
                updated_at: picked.updated_at || null
            });
        }
    }

    let historyResult = await supabase
        .from('bc_tactics_history')
        .select('markers,roster,saved_at,day,type,session_id')
        .eq('guild_id', guildId)
        .order('saved_at', { ascending: false })
        .limit(10);

    if (historyResult.error && /session_id/i.test(historyResult.error.message || '')) {
        supportsBcTacticsHistorySessionIdColumn = false;
        historyResult = await supabase
            .from('bc_tactics_history')
            .select('markers,roster,saved_at,day,type')
            .eq('guild_id', guildId)
            .order('saved_at', { ascending: false })
            .limit(10);
    }

    if (historyResult.error) {
        handleSyncError('fetchLatestGuildTacticsSeedSource history', historyResult.error);
        return null;
    }

    const pickedHistory = (historyResult.data || []).find((row) => row?.markers);
    if (!pickedHistory?.markers) return null;

    return normalizeLiveTacticsPayload(
        pickedHistory.markers,
        {
            type: pickedHistory.type || 'history',
            session_id: pickedHistory.session_id || null,
            day: pickedHistory.day || null,
            saved_at: pickedHistory.saved_at || null
        },
        pickedHistory.roster || null
    );
}

async function upsertSessionScopedTacticsPayload(guildId, sessionRow, payload) {
    if (!isReady() || !sessionRow || !payload) return null;

    const upsertPayload = {
        guild_id: guildId,
        day: sessionRow.day,
        markers: payload,
        drawings: [],
        notes: payload?.strategy_name || '',
        updated_by: 'discord-bot'
    };

    if (supportsBcTacticsSessionIdColumn && sessionRow.id) {
        const scoped = await supabase
            .from('bc_tactics')
            .upsert({
                ...upsertPayload,
                session_id: sessionRow.id
            }, { onConflict: 'guild_id,session_id' });

        if (!scoped.error) return null;
        if (/session_id/i.test(scoped.error.message || '')) {
            supportsBcTacticsSessionIdColumn = false;
        } else {
            return scoped.error;
        }
    }

    const fallback = await upsertTacticsPayloadByDay(upsertPayload);
    return fallback?.error || null;
}

async function upsertTacticsPayloadByDay(upsertPayload) {
    const existing = await supabase
        .from('bc_tactics')
        .select('id')
        .eq('guild_id', upsertPayload.guild_id)
        .eq('day', upsertPayload.day)
        .order('updated_at', { ascending: false })
        .limit(1);
    if (existing.error) return { error: existing.error };

    const existingId = existing.data?.[0]?.id;
    if (existingId) {
        return supabase.from('bc_tactics').update(upsertPayload).eq('id', existingId);
    }
    return supabase.from('bc_tactics').insert(upsertPayload);
}

async function ensureSessionScopedTacticsPayload(guildId, sessionRow) {
    if (!isReady() || !sessionRow?.id) return false;

    const currentRow = await getSessionScopedTacticsRow(guildId, sessionRow.id, sessionRow.day);
    const basePayload = currentRow?.markers
        ? normalizeLiveTacticsPayload(currentRow.markers)
        : await fetchLatestGuildTacticsSeedSource(guildId, sessionRow.id);

    const payload = syncTacticsPayloadToSessionRoster(
        basePayload || normalizeLiveTacticsPayload({
            marks: [],
            roster_snapshot: getSessionRosterSnapshot(sessionRow)
        }, {
            type: 'blank',
            session_id: sessionRow.id,
            day: sessionRow.day
        }, getSessionRosterSnapshot(sessionRow)),
        sessionRow
    );

    const error = await upsertSessionScopedTacticsPayload(guildId, sessionRow, payload);
    if (error) {
        handleSyncError('ensureSessionScopedTacticsPayload upsert', error);
        return false;
    }
    return true;
}

async function saveBattleTacticsHistorySnapshot(guildId, day, options = {}) {
    if (!isReady()) return false;
    if (!['sat', 'sun'].includes(String(day || '').toLowerCase())) return false;
    if ((options.time || '19:30') !== '19:30') return false;

    try {
        const session = options.sessionId
            ? { id: options.sessionId, day, time: options.time || '19:30' }
            : await supabase
                .from('bc_sessions')
                .select('id, day, time')
                .eq('guild_id', guildId)
                .eq('day', day)
                .maybeSingle()
                .then(({ data, error }) => {
                    if (error) {
                        handleSyncError('saveBattleTacticsHistorySnapshot session lookup', error);
                        return null;
                    }
                    return data || null;
                });

        if (!session?.id) return false;

        const liveRow = await getSessionScopedTacticsRow(guildId, session.id, day);
        if (!liveRow?.markers) return false;

        const markers = typeof liveRow.markers === 'string'
            ? (() => { try { return JSON.parse(liveRow.markers); } catch (error) { return null; } })()
            : liveRow.markers;
        if (!markers || !Array.isArray(markers.marks || markers?.markers?.marks)) return false;

        const insertPayload = {
            guild_id: guildId,
            day,
            type: 'battle',
            saved_at: new Date().toISOString(),
            saved_by: options.savedBy || 'discord-bot',
            roster: options.roster || null,
            markers,
            result_note: options.resultNote || 'Auto save battle snapshot'
        };

        let { error } = await supabase
            .from('bc_tactics_history')
            .insert({
                ...insertPayload,
                ...(supportsBcTacticsHistorySessionIdColumn ? { session_id: session.id } : {})
            });

        if (error && /session_id/i.test(error.message || '')) {
            supportsBcTacticsHistorySessionIdColumn = false;
            const retry = await supabase
                .from('bc_tactics_history')
                .insert(insertPayload);
            error = retry.error || null;
        }

        if (error) {
            handleSyncError('saveBattleTacticsHistorySnapshot insert', error);
            return false;
        }

        console.log(`[Supabase] ✅ Đã lưu battle snapshot cho ${day} (session=${session.id})`);
        return true;
    } catch (error) {
        handleSyncError('saveBattleTacticsHistorySnapshot exception', error);
        return false;
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
        const { data: existingSessions, error: snapshotLookupError } = await supabase
            .from('bc_sessions')
            .select('*')
            .eq('guild_id', guildId);
        if (snapshotLookupError) {
            handleSyncError('deleteAllBCSessions snapshot lookup', snapshotLookupError);
        } else {
            for (const session of (existingSessions || [])) {
                if (session?.id) await saveRosterSnapshot(guildId, session, 'bot_delete_all');
            }
        }

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
 * @param {Array} users - Mang user objects tu SQLite
 * @param {string} guildId - Guild ID
 * @param {Object} guild - Discord guild object (de kiem tra role LangGia)
 */
function normalizeAccessPosition(position) {
    return String(position || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function isLeftUserRecord(user) {
    return !!user?.left_at || ['khong co', 'left', 'out'].includes(normalizeAccessPosition(user?.position));
}

async function syncUsers(users, guildId, guild = null) {
    if (!isReady()) return;
    try {
        // Tim role LangGia trong Discord guild
        const langGiaRole = guild?.roles?.cache?.find(r => r.name === 'LangGia');

        const records = [];
        for (const u of users) {
            let hasLangGia = false;
            const isLeft = isLeftUserRecord(u);
            if (!isLeft && langGiaRole && guild) {
                try {
                    const member = guild.members.cache.get(u.discord_id);
                    if (member) {
                        hasLangGia = member.roles.cache.has(langGiaRole.id);
                    }
                } catch (e) {}
            }

            records.push({
                discord_id: u.discord_id,
                discord_name: u.discord_name,
                game_username: u.game_username,
                game_uid: u.game_uid,
                position: isLeft ? 'Khong co' : (u.position || 'mem'),
                sub_role: u.sub_role || null,
                guild_id: guildId,
                lang_gia_member: isLeft ? false : hasLangGia
            });
        }

        // Upsert tung batch 50 records
        for (let i = 0; i < records.length; i += 50) {
            const batch = records.slice(i, i + 50);
            const { error } = await supabase
                .from('bc_users')
                .upsert(batch, { onConflict: 'discord_id' });

            if (error) {
                console.error(`[Supabase] Sync users batch ${i} loi:`, error.message);
            }
        }

        // Clear stale Supabase access for users no longer active in SQLite.
        try {
            const activeIds = new Set(records.map(r => String(r.discord_id)));
            const { data: existingUsers, error: listError } = await supabase
                .from('bc_users')
                .select('discord_id')
                .eq('guild_id', guildId);

            if (listError) {
                console.error('[Supabase] List stale users loi:', listError.message);
            } else {
                const staleIds = (existingUsers || [])
                    .map(u => String(u.discord_id))
                    .filter(id => id && !activeIds.has(id));

                for (let i = 0; i < staleIds.length; i += 50) {
                    const batch = staleIds.slice(i, i + 50);
                    const { error } = await supabase
                        .from('bc_users')
                        .update({ lang_gia_member: false, position: 'Khong co' })
                        .in('discord_id', batch);

                    if (error) {
                        console.error(`[Supabase] Clear stale users batch ${i} loi:`, error.message);
                    }
                }
            }
        } catch (staleErr) {
            console.error('[Supabase] Clear stale users exception:', staleErr.message);
        }

        const memberCount = records.filter(r => r.lang_gia_member).length;
        console.log(`[Supabase] Sync ${records.length} users (${memberCount} co role LangGia)`);
    } catch (err) {
        console.error('[Supabase] syncUsers exception:', err.message);
    }
}

/**
 * Sync 1 user duy nhat
 * @param {Object} user - User object tu SQLite
 * @param {string} guildId - Guild ID
 * @param {Object} guild - Discord guild object (de kiem tra role LangGia)
 */
async function syncOneUser(user, guildId, guild = null) {
    if (!isReady()) return;
    try {
        // Kiem tra role LangGia
        let hasLangGia = false;
        const isLeft = isLeftUserRecord(user);
        if (!isLeft && guild) {
            const langGiaRole = guild.roles?.cache?.find(r => r.name === 'LangGia');
            if (langGiaRole) {
                try {
                    const member = guild.members.cache.get(user.discord_id)
                        || await guild.members.fetch(user.discord_id).catch(() => null);
                    if (member) hasLangGia = member.roles.cache.has(langGiaRole.id);
                } catch (e) {}
            }
        }

        const { error } = await supabase
            .from('bc_users')
            .upsert({
                discord_id: user.discord_id,
                discord_name: user.discord_name,
                game_username: user.game_username,
                game_uid: user.game_uid,
                position: isLeft ? 'Khong co' : (user.position || 'mem'),
                sub_role: user.sub_role || null,
                guild_id: guildId,
                lang_gia_member: isLeft ? false : hasLangGia
            }, { onConflict: 'discord_id' });

        if (error) {
            console.error('[Supabase] Sync user loi:', error.message);
        }
    } catch (err) {
        console.error('[Supabase] ❌ syncOneUser exception:', err.message);
    }
}

/**
 * Sync toàn bộ bảng exp_levels lên Supabase (chạy 1 lần khi bot start)
 * @param {Object} economyDb - Database/economy module
 */
async function syncExpLevels(economyDb) {
    if (!isReady()) return;
    try {
        const rows = economyDb.getAllExpLevels();
        if (!rows || rows.length === 0) return;

        // Upsert từng batch 50 records để tránh quá tải payload
        for (let i = 0; i < rows.length; i += 50) {
            const batch = rows.slice(i, i + 50).map(r => ({
                discord_id: r.discord_id,
                level: r.level,
                text_exp: r.text_exp,
                voice_exp: r.voice_exp,
                total_exp: r.total_exp,
                total_messages: r.total_messages,
                total_voice_minutes: r.total_voice_minutes,
                updated_at: new Date().toISOString()
            }));
            const { error } = await supabase
                .from('bc_exp_levels')
                .upsert(batch, { onConflict: 'discord_id' });

            if (error) {
                // Nếu báo lỗi bảng chưa tồn tại thì stop (báo qua console)
                if (/does not exist/i.test(error.message)) {
                    console.error('[Supabase] ❌ Bảng bc_exp_levels chưa tồn tại! Hãy tạo bảng này trên Supabase.');
                    return;
                }
                console.error(`[Supabase] ❌ Sync exp batch ${i} lỗi:`, error.message);
            }
        }
        console.log(`[Supabase] ✅ Sync ${rows.length} exp_levels thành công`);
    } catch (err) {
        console.error('[Supabase] ❌ syncExpLevels exception:', err.message);
    }
}

/**
 * Sync 1 record EXP lên Supabase
 * @param {string} discordId 
 * @param {Object} expData 
 */
async function syncOneExpLevel(discordId, expData) {
    if (!isReady()) return;
    try {
        const payload = {
            discord_id: discordId,
            level: expData.level,
            text_exp: expData.text_exp,
            voice_exp: expData.voice_exp,
            total_exp: expData.total_exp,
            total_messages: expData.total_messages,
            total_voice_minutes: expData.total_voice_minutes,
            updated_at: new Date().toISOString()
        };
        const { error } = await supabase
            .from('bc_exp_levels')
            .upsert(payload, { onConflict: 'discord_id' });
        
        if (error) {
            if (/does not exist/i.test(error.message)) return; // Bảng chưa tạo
            console.error('[Supabase] ❌ syncOneExpLevel lỗi:', error.message);
        }
    } catch (err) {
        console.error('[Supabase] ❌ syncOneExpLevel exception:', err.message);
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
    if (!['sat', 'sun'].includes(day)) return false;
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

async function setSessionLocked(guildId, day, locked = true, time = LEAGUE_TIME) {
    if (!isReady()) return;
    if (!supportsBcSessionsLockedColumn) return true;
    const normalizedTime = normalizeBcTime(time || LEAGUE_TIME);
    try {
        const { error } = await supabase
            .from('bc_sessions')
            .update({ locked: !!locked })
            .eq('guild_id', guildId)
            .eq('day', day)
            .eq('time', normalizedTime);

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

async function pollBcRegulars(db, guildId, options = {}) {
    if (!isReady() || !db) return [];
    const validateRegular = typeof options.validateRegular === 'function'
        ? options.validateRegular
        : null;
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
        for (const remoteItem of remote) {
            if (!['sat', 'sun'].includes(remoteItem.day)) {
                await removeBcRegular(guildId, remoteItem.discord_id, remoteItem.day);
            }
        }

        for (const day of ['sat', 'sun']) {
            const remoteDay = [];
            for (const remoteItem of remote.filter((item) => item.day === day)) {
                let isValid = true;
                if (validateRegular) {
                    try {
                        isValid = await validateRegular(remoteItem, day);
                    } catch (validateError) {
                        isValid = false;
                        console.error('[Supabase] ❌ validate bc_regular lỗi:', validateError.message);
                    }
                }
                if (isValid) remoteDay.push(remoteItem);
            }
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

let _bcRegularChangesListening = false;

function listenForBcRegularChanges(guildId, onRegularChange) {
    if (!isReady()) return;
    if (_bcRegularChangesListening) {
        console.warn('[Supabase] listenForBcRegularChanges da duoc goi roi, bo qua');
        return;
    }
    _bcRegularChangesListening = true;

    supabase
        .channel('bc-regular-changes')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'bc_regulars', filter: `guild_id=eq.${guildId}` },
            (payload) => {
                if (!onRegularChange) return;
                const record = payload.eventType === 'DELETE' ? payload.old : payload.new;
                Promise.resolve(onRegularChange({
                    eventType: payload.eventType,
                    record,
                    new: payload.new,
                    old: payload.old
                })).catch((err) => {
                    console.error('[Supabase] bc_regulars handler loi:', err.message);
                });
            }
        )
        .subscribe((status) => {
            console.log(`[Supabase] bc_regulars subscription: ${status}`);
        });
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
            team_layout: (() => {
                try {
                    return typeof session.team_layout === 'string'
                        ? JSON.parse(session.team_layout || '[]')
                        : (session.team_layout || []);
                } catch (e) { return []; }
            })(),
            teams: (() => {
                try {
                    const rawTeams = session.teams || session.teams_json;
                    return typeof rawTeams === 'string'
                        ? JSON.parse(rawTeams || '{}')
                        : (rawTeams || {});
                } catch (e) { return {}; }
            })(),
            leader_ids: leaderIds,
            time: session.time || '19:30',
            note: session.note || '',
            locked: !!session.locked,
            status: session.status || 'active',
            team_names: (() => {
                try {
                    return typeof session.team_names === 'string'
                        ? JSON.parse(session.team_names || '{}')
                        : (session.team_names || {});
                } catch (e) { return {}; }
            })()
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
                const localKeys = new Set(localSessions.map(s => getSessionIdentityKey(s)));
                const remoteKeys = new Set((data || []).map(s => getSessionIdentityKey(s)));

                // INSERT: session mới từ web (có trong Supabase nhưng không có trong SQLite)
                for (const remoteSession of (data || [])) {
                    if (!localKeys.has(getSessionIdentityKey(remoteSession)) && onSessionChange) {
                        console.log(`[Supabase] 🆕 Polling: Web tạo BC session mới (${remoteSession.day})`);
                        onSessionChange({ ...remoteSession, _inserted: true });
                    }
                }

                // DELETE: session bị xóa từ web (có trong SQLite nhưng không có trong Supabase)
                for (const localSession of localSessions) {
                    if (!remoteKeys.has(getSessionIdentityKey(localSession)) && onSessionChange) {
                        console.log(`[Supabase] 🗑️ Polling: Web xóa BC session (${localSession.day})`);
                        onSessionChange({ day: localSession.day, time: localSession.time || LEAGUE_TIME, _deleted: true });
                    }
                }

                // UPDATE: session thay đổi từ web
                for (const remoteSession of (data || [])) {
                    if (localKeys.has(getSessionIdentityKey(remoteSession)) && onSessionChange) {
                        // So sánh nội dung
                        const remoteKey = getSessionIdentityKey(remoteSession);
                        const local = localSessions.find(s => getSessionIdentityKey(s) === remoteKey);
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
            async (payload) => {
                const time = normalizeBcTime(payload.new.time || LEAGUE_TIME);
                console.log(`[Supabase] Received BC session INSERT (${payload.new.day} ${time})`);
                await saveRosterSnapshot(guildId, payload.new, 'bot_realtime_insert');
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
                    const time = normalizeBcTime(payload.new.time || LEAGUE_TIME);
                    console.log(`[Supabase] Received BC session ended signal (${payload.new.day} ${time})`);
                    await saveRosterSnapshot(guildId, payload.new, 'bot_realtime_ended');
                    if (onSessionChange) {
                        onSessionChange({ day: payload.new.day, time, id: payload.new.id, _deleted: true });
                    }
                    // Dọn row khỏi Supabase (web anon key có thể không xóa được)
                    try {
                        await supabase.from('bc_sessions').delete()
                            .eq('guild_id', guildId)
                            .eq('day', payload.new.day)
                            .eq('time', time);
                        console.log(`[Supabase] Cleaned ended BC session row (${payload.new.day} ${time})`);
                    } catch(e) {}
                    return;
                }
                console.log(`[Supabase] Received BC session UPDATE (${payload.new.day} ${normalizeBcTime(payload.new.time || LEAGUE_TIME)})`);
                await saveRosterSnapshot(guildId, payload.new, 'bot_realtime_update');
                if (onSessionChange) {
                    onSessionChange(payload.new);
                }
            }
        )
        .on('postgres_changes',
            { event: 'DELETE', schema: 'public', table: 'bc_sessions', filter: `guild_id=eq.${guildId}` },
            async (payload) => {
                if (payload.old?.id) await saveRosterSnapshot(guildId, payload.old, 'bot_realtime_delete');
                const deletedDay = payload.old?.day;
                const deletedTime = payload.old?.time || LEAGUE_TIME;
                console.log(`[Supabase] 🗑️ Nhận DELETE event (day=${deletedDay || 'unknown'})`);

                if (deletedDay && onSessionChange) {
                    // Biết chính xác ngày bị xóa
                    onSessionChange({ day: deletedDay, time: deletedTime, id: payload.old?.id, _deleted: true });
                } else if (onSessionChange) {
                    // Không biết ngày (REPLICA IDENTITY chưa FULL) → query Supabase để tìm
                    try {
                        const { data: remainingSessions } = await supabase
                            .from('bc_sessions')
                            .select('day,time')
                            .eq('guild_id', guildId);
                        const remainingKeys = new Set((remainingSessions || []).map(s => getSessionIdentityKey({ ...s, guild_id: guildId })));

                        // So sánh (callback sẽ tự kiểm tra SQLite)
                        // Gửi _deleted_unknown để ready.js xử lý fallback
                        onSessionChange({ _deleted: true, _deleted_unknown: true, remainingKeys: [...remainingKeys] });
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
        const roster = bangchienRoster.normalizeRoster(activeSession);
        const enrichedTeams = {};
        for (const team of roster.layout) {
            enrichedTeams[team.id] = (roster.teams[team.id] || []).map(enrichPlayer);
        }
        const mirrors = bangchienRoster.serializeRosterForStorage({
            layout: roster.layout,
            teams: enrichedTeams,
            waitingList: roster.waitingList.map(enrichPlayer)
        });

        return {
            team_attack1: mirrors.team_attack1,
            team_attack2: mirrors.team_attack2,
            team_defense: mirrors.team_defense,
            team_forest: mirrors.team_forest,
            waiting_list: mirrors.waiting_list,
            leader_ids: {
                team1: activeSession.team1_leader_id,
                team2: activeSession.team2_leader_id,
                team3: activeSession.team3_leader_id,
                team4: activeSession.team4_leader_id,
                commander: activeSession.commander_id,
                teams: activeSession.leader_ids?.teams || {}
            },
            team_sizes: mirrors.team_sizes || teamSizes,
            team_names: mirrors.team_names || (db.getTeamNames ? db.getTeamNames() : {}),
            team_layout: roster.layout,
            teams: enrichedTeams,
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
            .select('day,time')
            .eq('guild_id', guildId)
            .eq('status', 'active');
        const remoteKeys = new Set((remoteSessions || []).map(s => getSessionIdentityKey({ ...s, guild_id: guildId })));

        // Chỉ reconcile nếu Supabase đang có ít nhất 1 session
        // Tránh xóa SQLite nhầm khi Supabase bị clear/reset thủ công
        let reconciledCount = 0;
        if ((remoteSessions || []).length > 0) {
            for (const localSession of localSessions) {
                const day = localSession.day;
                if (day && !remoteKeys.has(getSessionIdentityKey(localSession))) {
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

// ═══════════════════════════════════════════════════════════════
// SYNC EXP LEVELS (cho tab Level trên web profile)
// ═══════════════════════════════════════════════════════════════

let _hasExpLevelsTable = true;

/**
 * Sync toàn bộ exp_levels lên Supabase (bàng bc_exp_levels)
 * Gọi khi bot start
 * @param {Object} db - Database module (economy)
 */
async function syncExpLevels(db) {
    if (!isReady() || !_hasExpLevelsTable) return;
    try {
        let allExp = [];
        if (db && db.db) {
            allExp = db.db.prepare(
                'SELECT discord_id, level, total_exp, text_exp, voice_exp, total_messages, total_voice_minutes FROM exp_levels WHERE total_exp > 0'
            ).all();
        }
        if (!allExp.length) return;

        // Upsert từng batch 50
        for (let i = 0; i < allExp.length; i += 50) {
            const batch = allExp.slice(i, i + 50).map(r => ({
                discord_id: r.discord_id,
                level: r.level || 0,
                total_exp: r.total_exp || 0,
                text_exp: r.text_exp || 0,
                voice_exp: r.voice_exp || 0,
                total_messages: r.total_messages || 0,
                total_voice_minutes: r.total_voice_minutes || 0
            }));
            const { error } = await supabase
                .from('bc_exp_levels')
                .upsert(batch, { onConflict: 'discord_id' });
            if (error) { 
                if (/schema cache|find the table/.test(error.message)) {
                    _hasExpLevelsTable = false;
                    console.error('[Supabase] ❌ Bảng bc_exp_levels chưa được tạo trên Supabase. Đã tắt syncExpLevels để tránh spam lỗi.');
                    return;
                }
                handleSyncError('Sync exp_levels lỗi', error); 
            }
        }
        if (_hasExpLevelsTable) console.log(`[Supabase] ✅ Sync ${allExp.length} exp_levels thành công`);
    } catch (err) {
        handleSyncError('syncExpLevels exception', err);
    }
}

/**
 * Sync 1 user exp lên Supabase (gọi sau khi user lên level hoặc cập nhật exp)
 * @param {string} discordId
 * @param {Object} expRecord - { level, total_exp, text_exp, voice_exp, total_messages, total_voice_minutes }
 */
async function syncOneExpLevel(discordId, expRecord) {
    if (!isReady() || !_hasExpLevelsTable) return;
    try {
        const { error } = await supabase
            .from('bc_exp_levels')
            .upsert({
                discord_id: discordId,
                level: expRecord.level || 0,
                total_exp: expRecord.total_exp || expRecord.totalExp || 0,
                text_exp: expRecord.text_exp || expRecord.textExp || 0,
                voice_exp: expRecord.voice_exp || expRecord.voiceExp || 0,
                total_messages: expRecord.total_messages || expRecord.totalMessages || 0,
                total_voice_minutes: expRecord.total_voice_minutes || expRecord.totalVoiceMinutes || 0
            }, { onConflict: 'discord_id' });
        if (error) { 
            if (/schema cache|find the table/.test(error.message)) {
                _hasExpLevelsTable = false;
                console.error('[Supabase] ❌ Bảng bc_exp_levels chưa có. Đã tắt syncOneExpLevel.');
                return;
            }
            handleSyncError('Sync exp user lỗi', error); 
        }
    } catch (err) {
        handleSyncError('syncOneExpLevel exception', err);
    }
}

/**
 * Báo cáo dung lượng Supabase: đếm row từng bảng + ước tính size
 * Gọi khi bot khởi động để log vào console
 * @returns {Object|null} { tables: [...], totalRows, totalEstimatedKB }
 */
async function getSupabaseStorageReport() {
    if (!isReady()) return null;

    const TABLE_NAMES = [
        'bc_sessions',
        'bc_users',
        'bc_tactics',
        'bc_tactics_history',
        'bc_roster_snapshots',
        'bc_regulars',
        'bc_logs',
        'bc_exp_levels'
    ];

    // Ước tính kích thước trung bình 1 row (bytes) cho từng bảng
    const AVG_ROW_SIZE = {
        'bc_sessions': 4096,        // JSON team lớn
        'bc_users': 512,
        'bc_tactics': 8192,         // markers JSON rất lớn
        'bc_tactics_history': 10240, // markers + roster snapshot
        'bc_roster_snapshots': 8192,
        'bc_regulars': 128,
        'bc_logs': 256,
        'bc_exp_levels': 256
    };

    const results = [];
    let totalRows = 0;
    let totalEstimatedBytes = 0;

    for (const tableName of TABLE_NAMES) {
        try {
            const { count, error } = await supabase
                .from(tableName)
                .select('*', { count: 'exact', head: true });

            if (error) {
                // Bảng chưa tồn tại hoặc lỗi khác → bỏ qua
                if (/schema cache|find the table|relation.*does not exist/i.test(error.message || '')) {
                    results.push({ table: tableName, rows: 0, estimatedKB: 0, note: 'chưa tạo' });
                    continue;
                }
                results.push({ table: tableName, rows: '?', estimatedKB: '?', note: sanitizeErrorMessage(error.message) });
                continue;
            }

            const rowCount = count || 0;
            const avgSize = AVG_ROW_SIZE[tableName] || 256;
            const estimatedBytes = rowCount * avgSize;

            totalRows += rowCount;
            totalEstimatedBytes += estimatedBytes;

            results.push({
                table: tableName,
                rows: rowCount,
                estimatedKB: Math.round(estimatedBytes / 1024 * 10) / 10
            });
        } catch (err) {
            results.push({ table: tableName, rows: '?', estimatedKB: '?', note: err.message });
        }
    }

    const totalEstimatedKB = Math.round(totalEstimatedBytes / 1024 * 10) / 10;
    const totalEstimatedMB = Math.round(totalEstimatedBytes / (1024 * 1024) * 100) / 100;

    return {
        tables: results,
        totalRows,
        totalEstimatedKB,
        totalEstimatedMB
    };
}

module.exports = {
    initSupabase,
    isReady,
    getSupabaseClient: () => supabase,
    syncBCSession,
    saveRosterSnapshot,
    deleteBCSession,
    deleteAllBCSessions,
    saveBattleTacticsHistorySnapshot,
    syncUsers,
    syncOneUser,
    syncBcRegular,
    removeBcRegular,
    setSessionLocked,
    pollBcRegulars,
    logAction,
    listenForBcRegularChanges,
    listenForWebChanges,
    listenForTacticsHistoryChanges,
    formatActiveSession,
    syncAllActiveSessions,
    syncExpLevels,
    syncOneExpLevel,
    getSupabaseStorageReport
};
