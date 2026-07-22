// Bangchien (Bang Chiến) Notification State
// Lưu trữ trạng thái thông báo Bang Chiến - Giống bossguild nhưng cho 30 người
const autoFeatures = require('../config/autoFeatures');

// Map lưu trữ thông báo đang chạy
// Key: `${guildId}_${leaderId}`, Value: { intervalId, channelId, leaderId, messageId, message, startTime }
const bangchienNotifications = new Map();

// Map lưu danh sách đăng ký (KHÔNG GIỚI HẠN - khác bossguild)
// Key: `${guildId}_${leaderId}`, Value: [{ id, username, joinedAt }]
const bangchienRegistrations = new Map();

// Số người tối đa mỗi party
const BANGCHIEN_MAX_MEMBERS = 30;

// Giới hạn số party tối đa mỗi guild (T7 + CN + 5 ngày tuần = 7)
const BANGCHIEN_MAX_PARTIES = 16;

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-DAY CONFIG
// ═══════════════════════════════════════════════════════════════════════════

// Cấu hình tất cả các ngày BC
const DAY_CONFIG = {
    mon: { name: 'Thứ 2', color: 0xFF6B35, emoji: '📅' },
    tue: { name: 'Thứ 3', color: 0xE91E63, emoji: '📅' },
    wed: { name: 'Thứ 4', color: 0x9C27B0, emoji: '📅' },
    thu: { name: 'Thứ 5', color: 0x3F51B5, emoji: '📅' },
    fri: { name: 'Thứ 6', color: 0x009688, emoji: '📅' },
    sat: { name: 'Thứ 7', color: 0x00CED1, emoji: '📅', primary: true },
    sun: { name: 'Chủ Nhật', color: 0x87CEEB, emoji: '📅', primary: true }
};

// Ngày mặc định (luôn hiện trên web + overview)
const PRIMARY_DAYS = ['sat', 'sun'];
const LEAGUE_TIME = '19:30';
const WEEKEND_DEFAULT_TIMES = ['19:30', '20:00', '20:30', '21:00', '21:30'];
const VN_OFFSET_MINUTES = 7 * 60;

/**
 * Tính ngày Thứ 7 hoặc Chủ Nhật của tuần này (hoặc tuần tới nếu đã qua)
 * @param {'sat' | 'sun'} day - 'sat' hoặc 'sun'
 * @returns {Date} Ngày cụ thể
 */
// Map day key → getDay() value
const DAY_NUM = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function parseSessionTimestamp(value, fallback = new Date()) {
    if (!value) return fallback;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? fallback : value;

    const raw = String(value).trim();
    if (!raw) return fallback;

    // SQLite CURRENT_TIMESTAMP is UTC but stored without timezone.
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
        ? raw.replace(' ', 'T') + 'Z'
        : raw;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function toVnWallDate(date = new Date()) {
    const source = parseSessionTimestamp(date, new Date());
    return new Date(source.getTime() + (VN_OFFSET_MINUTES + source.getTimezoneOffset()) * 60 * 1000);
}

function fromVnWallDate(vnWallDate) {
    return new Date(Date.UTC(
        vnWallDate.getFullYear(),
        vnWallDate.getMonth(),
        vnWallDate.getDate(),
        vnWallDate.getHours() - 7,
        vnWallDate.getMinutes(),
        vnWallDate.getSeconds(),
        vnWallDate.getMilliseconds()
    ));
}

function formatDateVi(date) {
    const vnDate = toVnWallDate(date);
    const dd = String(vnDate.getDate()).padStart(2, '0');
    const mm = String(vnDate.getMonth() + 1).padStart(2, '0');
    const yyyy = vnDate.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

function getSessionBattleDate(sessionOrDay, time = LEAGUE_TIME) {
    const isSession = sessionOrDay && typeof sessionOrDay === 'object';
    const day = isSession ? sessionOrDay.day : sessionOrDay;
    if (!DAY_NUM.hasOwnProperty(day)) return new Date();

    const normalizedTime = normalizeBcTime(isSession ? (sessionOrDay.time || time) : time);
    const [hour, minute] = normalizedTime.split(':').map(Number);
    const createdAt = parseSessionTimestamp(
        isSession ? (sessionOrDay.created_at || sessionOrDay.createdAt) : null,
        new Date()
    );
    const vnCreated = toVnWallDate(createdAt);
    const targetDay = DAY_NUM[day];
    let daysUntilTarget = (targetDay - vnCreated.getDay() + 7) % 7;

    // A session opened after the 23:00 VN auto-end cutoff belongs to next week.
    if (daysUntilTarget === 0 && vnCreated.getHours() >= 23) {
        daysUntilTarget = 7;
    }

    const battleVn = new Date(vnCreated);
    battleVn.setDate(vnCreated.getDate() + daysUntilTarget);
    battleVn.setHours(hour, minute, 0, 0);
    return fromVnWallDate(battleVn);
}

function getSessionEndDate(sessionOrDay, time = LEAGUE_TIME) {
    const battleDate = getSessionBattleDate(sessionOrDay, time);
    const endVn = toVnWallDate(battleDate);
    endVn.setHours(23, 0, 0, 0);
    return fromVnWallDate(endVn);
}

function formatSessionDateLabel(sessionOrDay, time = LEAGUE_TIME) {
    const isSession = sessionOrDay && typeof sessionOrDay === 'object';
    const day = isSession ? sessionOrDay.day : sessionOrDay;
    if (!day || !DAY_CONFIG[day]) return '';
    return `${DAY_CONFIG[day].name} ${formatDateVi(getSessionBattleDate(sessionOrDay, time))}`;
}

function formatSessionDateTimeLabel(sessionOrDay, time = LEAGUE_TIME) {
    const isSession = sessionOrDay && typeof sessionOrDay === 'object';
    const sessionTime = normalizeBcTime(isSession ? (sessionOrDay.time || time) : time);
    const dateLabel = formatSessionDateLabel(sessionOrDay, sessionTime);
    return dateLabel ? `${dateLabel} lúc ${sessionTime} (GMT+7)` : '';
}

function formatSessionEndLabel(sessionOrDay, time = LEAGUE_TIME) {
    const isSession = sessionOrDay && typeof sessionOrDay === 'object';
    const day = isSession ? sessionOrDay.day : sessionOrDay;
    if (!day || !DAY_CONFIG[day]) return '';
    return `${DAY_CONFIG[day].name} ${formatDateVi(getSessionEndDate(sessionOrDay, time))} lúc 23:00 (GMT+7)`;
}

function getNextDayDate(day) {
    if (!DAY_NUM.hasOwnProperty(day)) return new Date();
    return toVnWallDate(getSessionBattleDate(day, LEAGUE_TIME));
}

/**
 * Lấy tên ngày kèm ngày cụ thể, ví dụ: "Thứ 7 (01/02/2026)"
 * @param {'sat' | 'sun'} day - 'sat' hoặc 'sun'
 * @returns {string} Tên ngày với ngày cụ thể
 */
function getDayNameWithDate(day) {
    if (!day || !DAY_CONFIG[day]) return '';
    return `${DAY_CONFIG[day].name} (${formatDateVi(getSessionBattleDate(day, LEAGUE_TIME))})`;
}

// Aliases cho ngày (để parse từ args)
const DAY_ALIASES = {
    't2': 'mon', 'mon': 'mon', 'monday': 'mon', 'thu2': 'mon', 'thứ2': 'mon',
    't3': 'tue', 'tue': 'tue', 'tuesday': 'tue', 'thu3': 'tue', 'thứ3': 'tue',
    't4': 'wed', 'wed': 'wed', 'wednesday': 'wed', 'thu4': 'wed', 'thứ4': 'wed',
    't5': 'thu', 'thu5': 'thu', 'thứ5': 'thu', 'thursday': 'thu',
    // Lưu ý: 'thu' vừa là alias T5 vừa là key. Ưu tiên T5 vì args[0] thường là thứ
    't6': 'fri', 'fri': 'fri', 'friday': 'fri', 'thu6': 'fri', 'thứ6': 'fri',
    't7': 'sat', 'sat': 'sat', 'saturday': 'sat', 'thu7': 'sat', 'thứ7': 'sat',
    'cn': 'sun', 'sun': 'sun', 'sunday': 'sun', 'chunhat': 'sun', 'chủnhật': 'sun'
};

/**
 * Parse day, time, note từ args
 * VD: ['t2', '21h', 'Đánh', 'guild', 'XXX'] → { day: 'mon', time: '21:00', note: 'Đánh guild XXX' }
 * VD: ['t7'] → { day: 'sat', time: null, note: null }
 * VD: [] → null
 */
function parseDayArg(args) {
    if (!args || args.length === 0) return null;

    // Tìm day ở vị trí đầu tiên
    const firstArg = args[0]?.toLowerCase();
    const day = DAY_ALIASES[firstArg];
    if (!day) return null;

    // Parse time (format: 21h, 21h30, 19:30, 20h00)
    let time = null;
    let noteStartIdx = 1;
    if (args[1]) {
        const timeMatch = args[1].match(/^(\d{1,2})[h:](\d{0,2})$/i);
        if (timeMatch) {
            const h = timeMatch[1].padStart(2, '0');
            const m = (timeMatch[2] || '00').padStart(2, '0');
            time = `${h}:${m}`;
            noteStartIdx = 2;
        }
    }

    // Phần còn lại là ghi chú
    const note = args.slice(noteStartIdx).join(' ').trim() || null;

    return { day, time, note };
}

// Helper: Lấy day từ party key (format: guildId_day_leaderId)
function normalizeBcTime(value, fallback = LEAGUE_TIME) {
    const raw = String(value || fallback || LEAGUE_TIME).trim().toLowerCase();
    const match = raw.match(/^(\d{1,2})(?:[:h](\d{0,2}))?$/);
    if (!match) return fallback || LEAGUE_TIME;
    const hour = Math.max(0, Math.min(23, Number(match[1])));
    const minute = Math.max(0, Math.min(59, Number(match[2] || '0')));
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function timeToPartyKeyPart(time) {
    return normalizeBcTime(time).replace(':', '');
}

function isLeagueSession(sessionOrTime) {
    const time = typeof sessionOrTime === 'string'
        ? sessionOrTime
        : (sessionOrTime?.time || LEAGUE_TIME);
    return normalizeBcTime(time) === LEAGUE_TIME;
}

function getSessionScheduleDate(sessionOrDay, time = LEAGUE_TIME) {
    return getSessionBattleDate(sessionOrDay, time);
}

function compareSessionsBySchedule(a, b) {
    const scheduleDiff = getSessionScheduleDate(a).getTime() - getSessionScheduleDate(b).getTime();
    if (scheduleDiff !== 0) return scheduleDiff;
    const createdDiff = String(a?.created_at || '').localeCompare(String(b?.created_at || ''));
    if (createdDiff !== 0) return createdDiff;
    return String(a?.party_key || '').localeCompare(String(b?.party_key || ''));
}

function getDayFromPartyKey(partyKey) {
    const parts = String(partyKey || '').split('_');
    if (parts.length >= 3) {
        const day = parts[1];
        if (DAY_CONFIG[day]) return day;
    }
    return null;
}

// Helper: Tạo party key mới với day
function getTimeFromPartyKey(partyKey) {
    const parts = String(partyKey || '').split('_');
    if (parts.length >= 4 && /^\d{4}$/.test(parts[2])) {
        return `${parts[2].slice(0, 2)}:${parts[2].slice(2)}`;
    }
    return LEAGUE_TIME;
}

function getSessionIdentityKey(session) {
    if (!session) return '';
    return `${session.guild_id || session.guildId || ''}|${session.day || ''}|${normalizeBcTime(session.time || LEAGUE_TIME)}`;
}

function getListbcDetailKey(guildId, sessionOrPartyKey, day = null, time = LEAGUE_TIME) {
    const partyKey = typeof sessionOrPartyKey === 'string'
        ? sessionOrPartyKey
        : sessionOrPartyKey?.party_key;
    if (partyKey) return `${guildId}_${partyKey}`;
    return `${guildId}_${day || ''}_${normalizeBcTime(time || LEAGUE_TIME)}`;
}

function getRequestedBcTime(parsedDayArg) {
    return normalizeBcTime(parsedDayArg?.time || LEAGUE_TIME);
}

function getActiveBangchienForDayTime(db, guildId, day, time = LEAGUE_TIME) {
    if (!db || !guildId || !day) return null;
    const normalizedTime = normalizeBcTime(time || LEAGUE_TIME);
    if (typeof db.getActiveBangchienByDayTime === 'function') {
        return db.getActiveBangchienByDayTime(guildId, day, normalizedTime);
    }
    return typeof db.getActiveBangchienByDay === 'function'
        ? db.getActiveBangchienByDay(guildId, day)
        : null;
}

function createPartyKey(guildId, day, leaderId, time = LEAGUE_TIME) {
    return `${guildId}_${day}_${timeToPartyKeyPart(time)}_${leaderId}`;
}

// Helper: Lấy tất cả party keys của một guild
function getGuildBangchienKeys(guildId) {
    const keys = [];
    for (const key of bangchienNotifications.keys()) {
        if (key.startsWith(`${guildId}_`)) {
            keys.push(key);
        }
    }
    return keys;
}

// Helper: Kiểm tra user đã đăng ký party nào chưa
function getUserBangchienParty(guildId, userId) {
    for (const [key, registrations] of bangchienRegistrations) {
        if (key.startsWith(`${guildId}_`)) {
            if (registrations.some(r => r.id === userId)) {
                return key;
            }
        }
    }
    return null;
}

// Map lưu danh sách đã chốt (để reply tag)
// Key: messageId của embed chốt, Value: { leaderId, participants: [{ id, username }], guildId }
const bangchienFinalizedParties = new Map();

// ID kênh bangchien (để biết kênh nào cần theo dõi)
// Key: guildId, Value: channelId
const bangchienChannels = new Map();

// Map lưu overview messages (để auto-refresh và update)
// Key: guildId, Value: { messageId, channelId, message }
const bangchienOverviews = new Map();

// Map lưu timer debounce refresh cho BC overview
// Key: guildId, Value: timeoutId
const bcRefreshTimers = new Map();

// Thời gian debounce refresh BC overview (5 phút)
const BC_REFRESH_DEBOUNCE = 5 * 60 * 1000;

// Serialize overview edits/sends per guild so concurrent web INSERT events do not create duplicates.
const bcOverviewLocks = new Map();

// One auto-end timer per guild/day. Do not schedule per session.
const bcAutoEndTimers = new Map();
const bcAutoEndRunning = new Set();

// Map lưu listbc detail messages (để real-time refresh)
// Key: `${guildId}_${day}`, Value: { message, messageId, channelId }
const listbcDetailMessages = new Map();

function isBangchienOverviewMessage(message) {
    if (!message?.author?.bot || !Array.isArray(message.embeds)) return false;
    return message.embeds.some((embed) => String(embed?.title || '').includes('Bang Chiến Lang Gia'));
}

async function fetchOverviewMessages(channel, knownMessage = null) {
    const byId = new Map();
    if (knownMessage && isBangchienOverviewMessage(knownMessage)) {
        byId.set(knownMessage.id, knownMessage);
    }

    try {
        const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        if (fetched) {
            for (const [, message] of fetched) {
                if (isBangchienOverviewMessage(message)) byId.set(message.id, message);
            }
        }
    } catch (e) { }

    return [...byId.values()].sort((a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0));
}

function enqueueOverviewWork(guildId, work) {
    const previous = bcOverviewLocks.get(guildId) || Promise.resolve();
    const next = previous.catch(() => { }).then(work);
    bcOverviewLocks.set(guildId, next);
    next.finally(() => {
        if (bcOverviewLocks.get(guildId) === next) bcOverviewLocks.delete(guildId);
    }).catch(() => { });
    return next;
}

function resolveOverviewChannelId(guildId, channelOrId = null) {
    if (typeof channelOrId === 'string') return channelOrId;
    if (channelOrId?.id) return channelOrId.id;

    const overviewData = bangchienOverviews.get(guildId);
    if (overviewData?.channelId) return overviewData.channelId;

    const trackedChannelId = bangchienChannels.get(guildId);
    if (trackedChannelId) return trackedChannelId;

    try {
        const db = require('../database/db');
        return db.getConfig ? db.getConfig(`bc_channel_${guildId}`) : null;
    } catch (e) {
        return null;
    }
}

async function upsertOverviewEmbed(client, guildId, channelOrId = null, options = {}) {
    return enqueueOverviewWork(guildId, async () => {
        const mode = options?.mode === 'resend' ? 'resend' : 'edit';
        const channelId = resolveOverviewChannelId(guildId, channelOrId);
        if (!channelId) return null;

        const channel = typeof channelOrId === 'object' && channelOrId?.id === channelId
            ? channelOrId
            : await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return null;

        const { createOverviewEmbed, createOverviewButton } = require('../commands/bangchien/bangchien');
        const guild = channel.guild || client.guilds.cache.get(guildId);
        const embed = createOverviewEmbed(guildId, guild);
        const row = createOverviewButton(guildId);
        const editOptions = { embeds: [embed], components: row ? [row] : [] };

        const overviewData = bangchienOverviews.get(guildId);
        let knownMessage = null;
        if (overviewData?.message && overviewData.channelId === channelId) {
            knownMessage = overviewData.message;
        } else if (overviewData?.messageId && overviewData.channelId === channelId) {
            knownMessage = await channel.messages.fetch(overviewData.messageId).catch(() => null);
        }

        const overviewMessages = await fetchOverviewMessages(channel, knownMessage);
        let target = overviewMessages[0] || null;

        if (mode === 'resend') {
            for (const oldMessage of overviewMessages) {
                try { await oldMessage.delete(); } catch (e) { }
            }
            target = await channel.send(editOptions);
        } else if (target) {
            try {
                await target.edit(editOptions);
            } catch (e) {
                try { await target.delete(); } catch (deleteError) { }
                target = null;
            }
        }

        if (!target) {
            target = await channel.send(editOptions);
        }

        for (const duplicate of overviewMessages) {
            if (duplicate.id === target.id) continue;
            try { await duplicate.delete(); } catch (e) { }
        }

        bangchienOverviews.set(guildId, {
            messageId: target.id,
            channelId,
            message: target
        });

        return target;
    });
}

/**
 * Refresh overview embed ở kênh ?bc (edit message mới nhất, xóa bản trùng)
 * Dùng chung cho tất cả handlers khi có thay đổi dữ liệu BC
 * @param {Client} client - Discord client
 * @param {string} guildId - Guild ID
 */
async function refreshOverviewEmbed(client, guildId, channelOrId = null, options = {}) {
    try {
        return await upsertOverviewEmbed(client, guildId, channelOrId, options);
    } catch (e) {
        console.error('[bangchienState] Error refreshing overview:', e.message);
        return null;
    }
}

/**
 * Kiểm tra session BC đã hết hạn chưa (đã qua 23:00 VN ngày BC)
 * @param {Object} session - Session từ DB (có created_at và day)
 * @returns {boolean} true nếu hết hạn
 */
function isSessionExpired(session) {
    if (!session || !session.day || !DAY_CONFIG[session.day]) return false;
    return Date.now() >= getSessionEndDate(session).getTime();
}

/**
 * Tự động dọn dẹp session BC hết hạn (logic giống ?bcend + auto-end 23:00)
 * @param {Client} client - Discord client
 * @param {string} guildId - Guild ID
 * @returns {number} Số session đã cleanup
 */
async function autoCleanupExpiredSessions(client, guildId, options = {}) {
    const db = require('../database/db');

    const activeSessions = db.getActiveBangchienByGuild(guildId);
    if (activeSessions.length === 0) {
        return options.returnDetails ? { cleanedCount: 0, results: [] } : 0;
    }

    let cleanedCount = 0;
    const cleanupResults = [];
    const targetDay = options.day || null;

    for (const session of activeSessions) {
        const sessionDay = session.day || 'sat';
        if (targetDay && sessionDay !== targetDay) continue;
        if (!isSessionExpired(session)) continue;

        const partyKey = session.party_key;

        console.log(`[bangchien] Auto-cleanup session hết hạn: ${partyKey} (${sessionDay})`);

        try {
            const guild = client.guilds.cache.get(guildId);

            // 1. AUTO-SAVE PRESET Team Thủ/Rừng
            const teamDefense = session.team_defense || [];
            const teamForest = session.team_forest || [];
            const presetSaved = { thu: 0, rung: 0 };

            if (teamDefense.length > 0) {
                const currentPreset = db.getBcPreset(guildId, 'thu', sessionDay);
                const newPreset = [...currentPreset];
                for (const p of teamDefense) {
                    if (!newPreset.some(m => m.id === p.id)) {
                        newPreset.push({ id: p.id, username: p.username });
                    }
                }
                db.setBcPreset(guildId, 'thu', newPreset, sessionDay);
                presetSaved.thu = teamDefense.length;
            }

            if (teamForest.length > 0) {
                const currentPreset = db.getBcPreset(guildId, 'rung', sessionDay);
                const newPreset = [...currentPreset];
                for (const p of teamForest) {
                    if (!newPreset.some(m => m.id === p.id)) {
                        newPreset.push({ id: p.id, username: p.username });
                    }
                }
                db.setBcPreset(guildId, 'rung', newPreset, sessionDay);
                presetSaved.rung = teamForest.length;
            }

            // 2. XÓA ROLE BC cho participants
            let participants = [];
            let removedCount = 0;
            if (guild) {
                try {
                    const roster = require('./bangchienRoster');
                    participants = roster.getActiveRosterMembers(session);
                } catch (e) {
                    participants = [
                        ...(session.team_attack1 || []),
                        ...(session.team_attack2 || []),
                        ...(session.team_defense || []),
                        ...(session.team_forest || [])
                    ];
                }

                const bcRole = guild.roles.cache.find(r => r.name === 'bc');
                if (bcRole && participants.length > 0) {
                    for (const p of participants) {
                        try {
                            const member = await guild.members.fetch({ user: p.id, force: true }).catch(() => null);
                            if (member && member.roles.cache.has(bcRole.id)) {
                                await member.roles.remove(bcRole);
                                removedCount++;
                            }
                        } catch (e) { }
                    }
                }
            }

            // 3. XÓA MEMORY DATA
            const notifData = bangchienNotifications.get(partyKey);
            if (notifData) {
                if (notifData.intervalId) clearInterval(notifData.intervalId);
                try { if (notifData.message) await notifData.message.delete(); } catch (e) { }
            }
            bangchienNotifications.delete(partyKey);
            bangchienRegistrations.delete(partyKey);

            // Xóa finalized parties liên quan
            for (const [msgId, data] of bangchienFinalizedParties.entries()) {
                if (data.guildId === guildId && data.leaderId === session.leader_id) {
                    bangchienFinalizedParties.delete(msgId);
                }
            }

            // 4. XÓA SESSION KHỎI DB
            db.deleteActiveBangchien(partyKey);

            // 5. Lưu snapshot thực chiến cuối tuần 19:30 trước khi xóa Supabase
            try {
                if (['sat', 'sun'].includes(sessionDay) && normalizeBcTime(session.time || LEAGUE_TIME) === LEAGUE_TIME) {
                    const { saveBattleTacticsHistorySnapshot } = require('./supabaseSync');
                    await saveBattleTacticsHistorySnapshot(guildId, sessionDay, {
                        time: session.time || LEAGUE_TIME,
                        roster: {
                            attack1: session.team_attack1 || [],
                            attack2: session.team_attack2 || [],
                            defense: session.team_defense || [],
                            forest: session.team_forest || []
                        },
                        resultNote: `Auto-end ${formatSessionEndLabel(session)}`
                    });
                }
            } catch (e) {
                console.log('[bangchien] Auto-cleanup: Lỗi lưu battle snapshot:', e.message);
            }

            // 6. SYNC XÓA TRÊN SUPABASE → web realtime DELETE
            try {
                const { deleteBCSession } = require('./supabaseSync');
                await deleteBCSession(guildId, sessionDay, session.time || LEAGUE_TIME, session.supabase_session_id || null);
            } catch (e) { /* bỏ qua nếu supabase chưa init */ }

            cleanupResults.push({
                guildId,
                partyKey,
                day: sessionDay,
                dayName: formatSessionDateLabel(session) || DAY_CONFIG[sessionDay]?.name || sessionDay,
                dateTimeLabel: formatSessionDateTimeLabel(session),
                endLabel: formatSessionEndLabel(session),
                time: normalizeBcTime(session.time || LEAGUE_TIME),
                channelId: session.channel_id,
                participants: participants.length,
                removed: removedCount,
                presetThu: presetSaved.thu,
                presetRung: presetSaved.rung
            });
            cleanedCount++;
            console.log(`[bangchien] Auto-cleanup xong: ${partyKey} (${sessionDay})`);

        } catch (e) {
            console.error(`[bangchien] Lỗi auto-cleanup ${partyKey}:`, e.message);
        }
    }

    // Cập nhật channels nếu hết session
    if (cleanedCount > 0) {
        const remainingKeys = getGuildBangchienKeys(guildId);
        if (remainingKeys.length === 0) {
            bangchienChannels.delete(guildId);
        }

        // Cập nhật overview embed
        await refreshOverviewEmbed(client, guildId);

        console.log(`[bangchien] Auto-cleanup hoàn tất: ${cleanedCount} session hết hạn đã xóa (guild ${guildId})`);
    }

    return options.returnDetails ? { cleanedCount, results: cleanupResults } : cleanedCount;
}

function getMsUntilBangchienAutoEnd(day) {
    if (!DAY_CONFIG[day]) return null;
    return getSessionEndDate({ day, time: LEAGUE_TIME, created_at: new Date() }).getTime() - Date.now();
}

async function sendBangchienAutoEndSummary(client, guildId, channelId, results) {
    if (!channelId || !Array.isArray(results) || results.length === 0) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const { EmbedBuilder } = require('discord.js');
    const byDay = {};
    let totalParticipants = 0;
    let totalRolesRemoved = 0;

    for (const result of results) {
        const key = result.endLabel || result.dayName || result.day || 'Unknown';
        if (!byDay[key]) byDay[key] = { participants: 0, removed: 0, presetThu: 0, presetRung: 0, times: [] };
        byDay[key].participants += result.participants || 0;
        byDay[key].removed += result.removed || 0;
        byDay[key].presetThu += result.presetThu || 0;
        byDay[key].presetRung += result.presetRung || 0;
        if (result.time) byDay[key].times.push(result.time);
        totalParticipants += result.participants || 0;
        totalRolesRemoved += result.removed || 0;
    }

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ BANG CHIẾN ĐÃ TỰ ĐỘNG KẾT THÚC!')
        .setDescription('⏰ Đã tới mốc 23:00 (GMT+7) - các phiên Bang Chiến dưới đây đã tự động kết thúc.');

    for (const [dayName, info] of Object.entries(byDay)) {
        const times = [...new Set(info.times)].sort().join(', ');
        embed.addFields({
            name: `📅 ${dayName}${times ? ` (${times})` : ''}`,
            value: `👥 ${info.participants} người đi · 🔴 ${info.removed} role xóa · 💾 🛡️${info.presetThu} 🌲${info.presetRung}`,
            inline: false
        });
    }

    embed.setFooter({ text: `Tổng: ${totalParticipants} người · ${totalRolesRemoved} role xóa · ${results.length} phiên` })
        .setTimestamp();

    await channel.send({ embeds: [embed] });
}

async function runBangchienAutoEnd(client, guildId, day) {
    const timerKey = `${guildId}:${day}`;
    const timerData = bcAutoEndTimers.get(timerKey);
    bcAutoEndTimers.delete(timerKey);

    if (bcAutoEndRunning.has(timerKey)) return;
    bcAutoEndRunning.add(timerKey);

    try {
        const cleanup = await autoCleanupExpiredSessions(client, guildId, { day, returnDetails: true });
        const results = cleanup.results || [];
        if (results.length === 0) {
            console.log(`[bangchien] Auto-end ${day}: không có session hết hạn để thông báo.`);
            return;
        }

        const channelId = timerData?.channelId || results.find(r => r.channelId)?.channelId || resolveOverviewChannelId(guildId);
        await sendBangchienAutoEndSummary(client, guildId, channelId, results);

        try {
            const { refreshScheduleEmbed } = require('../commands/thongbao/thongbaoguild');
            await refreshScheduleEmbed(client, guildId, channelId, 'edit');
        } catch (e) {
            console.log('[bangchien] Auto-end: Không thể cập nhật lịch tuần:', e.message);
        }

        console.log(`[bangchien] Auto-end ${day}: đã gửi 1 embed tổng hợp cho ${results.length} session.`);
    } catch (e) {
        console.error(`[bangchien] Lỗi auto-end ${day}:`, e.message);
    } finally {
        bcAutoEndRunning.delete(timerKey);
    }
}

function scheduleBangchienAutoEnd(client, guildId, day, channelId = null) {
    if (!autoFeatures.bangchienAutoEnd) return false;
    if (!client || !guildId || !DAY_CONFIG[day]) return false;

    const timerKey = `${guildId}:${day}`;
    const existing = bcAutoEndTimers.get(timerKey);
    if (existing) {
        if (channelId) existing.channelId = channelId;
        return true;
    }

    const msUntilCleanup = getMsUntilBangchienAutoEnd(day);
    if (!(msUntilCleanup > 0 && msUntilCleanup < 7 * 24 * 60 * 60 * 1000)) return false;

    const timerId = setTimeout(() => {
        runBangchienAutoEnd(client, guildId, day).catch((e) => {
            console.error(`[bangchien] Lỗi timer auto-end ${day}:`, e.message);
        });
    }, msUntilCleanup);

    bcAutoEndTimers.set(timerKey, { timerId, channelId, client });

    const hoursUntil = Math.floor(msUntilCleanup / (60 * 60 * 1000));
    const minutesUntil = Math.floor((msUntilCleanup % (60 * 60 * 1000)) / (60 * 1000));
    console.log(`[bangchien] Đặt lịch auto-end BC 23:00 ${day} sau ${hoursUntil}h${minutesUntil}m (1 timer/ngày)`);
    return true;
}

function scheduleBangchienAutoEndsForGuild(client, guildId) {
    const db = require('../database/db');
    const activeSessions = db.getActiveBangchienByGuild(guildId);
    const byDay = new Map();

    for (const session of activeSessions) {
        const day = session.day;
        if (!DAY_CONFIG[day] || isSessionExpired(session)) continue;
        if (!byDay.has(day)) byDay.set(day, session.channel_id || resolveOverviewChannelId(guildId));
    }

    let scheduled = 0;
    for (const [day, channelId] of byDay) {
        if (scheduleBangchienAutoEnd(client, guildId, day, channelId)) scheduled++;
    }

    return scheduled;
}

// Đặt BC_AUTO_CREATE_DISABLED = false để bật lại việc tự tạo phiên BC cuối tuần.
const BC_AUTO_CREATE_DISABLED = true;

async function ensureWeekendDefaultSessions(guild, options = {}) {
    if (BC_AUTO_CREATE_DISABLED) return [];
    if (!guild?.id) return [];
    const db = require('../database/db');
    const channelId = options.channelId || (db.getConfig ? db.getConfig(`bc_channel_${guild.id}`) : null);
    if (!channelId) return [];

    const created = [];
    for (const day of PRIMARY_DAYS) {
        for (const time of WEEKEND_DEFAULT_TIMES) {
            const normalizedTime = normalizeBcTime(time);
            const existing = db.getActiveBangchienByDayTime
                ? db.getActiveBangchienByDayTime(guild.id, day, normalizedTime)
                : null;
            if (existing) continue;

            const leaderId = `auto_${day}_${timeToPartyKeyPart(normalizedTime)}`;
            const partyKey = createPartyKey(guild.id, day, leaderId, normalizedTime);
            let rosterTemplate = null;
            try {
                const supaSync = require('./supabaseSync');
                if (supaSync.isReady() && typeof supaSync.fetchLatestBcRosterTemplate === 'function') {
                    rosterTemplate = await supaSync.fetchLatestBcRosterTemplate(guild.id, {
                        day,
                        time: normalizedTime,
                        lookbackDays: 14
                    });
                }
            } catch (templateError) {
                console.warn('[bangchien] Không lấy được roster template cho session mặc định:', templateError.message);
            }
            db.createActiveBangchien({
                guildId: guild.id,
                partyKey,
                leaderId,
                leaderName: isLeagueSession(normalizedTime) ? 'LEAGUE' : `Auto ${normalizedTime}`,
                channelId,
                messageId: null,
                day,
                time: normalizedTime,
                note: isLeagueSession(normalizedTime) ? 'LEAGUE' : '',
                team_layout: rosterTemplate?.team_layout || null
            });
            try {
                const roster = require('./bangchienRoster');
                const emptyRoster = roster.serializeRosterForStorage(roster.normalizeRoster({
                    team_layout: rosterTemplate?.team_layout || null
                }));
                db.db.prepare('UPDATE bangchien_active SET team_attack1=?, team_attack2=?, team_defense=?, team_forest=?, waiting_list=?, team_layout=?, teams_json=? WHERE party_key=?')
                    .run('[]', '[]', '[]', '[]', '[]', emptyRoster.team_layout, emptyRoster.teams_json, partyKey);
            } catch (error) {
                db.db.prepare('UPDATE bangchien_active SET team_attack1=? WHERE party_key=?').run('[]', partyKey);
            }

            const session = db.getActiveBangchien(partyKey);
            if (session) {
                bangchienRegistrations.set(partyKey, []);
                bangchienNotifications.set(partyKey, {
                    intervalId: null,
                    channelId,
                    leaderId,
                    leaderName: isLeagueSession(normalizedTime) ? 'LEAGUE' : `Auto ${normalizedTime}`,
                    messageId: null,
                    message: null,
                    startTime: Date.now(),
                    day,
                    time: normalizedTime
                });
                created.push(session);
            }
        }
    }

    if (created.length > 0) {
        bangchienChannels.set(guild.id, channelId);
        try {
            const supaSync = require('./supabaseSync');
            if (supaSync.isReady()) {
                for (const session of created) {
                    const formatted = supaSync.formatActiveSession(session, db, guild);
                    if (formatted) await supaSync.syncBCSession(guild.id, session.day, formatted);
                }
            }
        } catch (error) {
            console.error('[bangchien] ensureWeekendDefaultSessions sync failed:', error.message);
        }
    }

    return created;
}

module.exports = {
    // Maps
    bangchienNotifications,
    bangchienRegistrations,
    bangchienFinalizedParties,
    bangchienChannels,
    bangchienOverviews,
    listbcDetailMessages,
    bcRefreshTimers,
    bcAutoEndTimers,
    // Constants
    BANGCHIEN_MAX_MEMBERS,
    BANGCHIEN_MAX_PARTIES,
    BC_REFRESH_DEBOUNCE,
    LEAGUE_TIME,
    WEEKEND_DEFAULT_TIMES,
    // Multi-day config
    DAY_CONFIG,
    DAY_ALIASES,
    DAY_NUM,
    PRIMARY_DAYS,
    // Helper functions
    parseDayArg,
    normalizeBcTime,
    isLeagueSession,
    getSessionScheduleDate,
    compareSessionsBySchedule,
    getDayFromPartyKey,
    getTimeFromPartyKey,
    getSessionIdentityKey,
    getListbcDetailKey,
    getRequestedBcTime,
    getActiveBangchienForDayTime,
    createPartyKey,
    getGuildBangchienKeys,
    getUserBangchienParty,
    getNextDayDate,
    getDayNameWithDate,
    getSessionBattleDate,
    formatSessionDateLabel,
    formatSessionDateTimeLabel,
    formatSessionEndLabel,
    upsertOverviewEmbed,
    refreshOverviewEmbed,
    // Auto-cleanup
    isSessionExpired,
    autoCleanupExpiredSessions,
    scheduleBangchienAutoEnd,
    scheduleBangchienAutoEndsForGuild,
    ensureWeekendDefaultSessions
};
