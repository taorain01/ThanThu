const db = require('../database/db');
const supaSync = require('./supabaseSync');

const BC_REGULAR_DAYS = ['sat', 'sun'];
const LANG_GIA_ROLE_NAME = 'LangGia';

function isBcRegularDay(day) {
    return BC_REGULAR_DAYS.includes(day);
}

function hasLangGiaRole(member) {
    return !!member?.roles?.cache?.some((role) => role.name === LANG_GIA_ROLE_NAME);
}

async function fetchMember(guild, discordId, memberOverride = null) {
    if (memberOverride?.id === discordId && memberOverride?.roles?.cache) return memberOverride;
    if (!guild?.members?.fetch || !discordId) return null;
    return guild.members.fetch(discordId).catch(() => null);
}

async function getBcRegularEligibility(guild, discordId, memberOverride = null) {
    if (!guild?.id || !discordId) {
        return { eligible: false, reason: 'missing_context' };
    }

    const userData = db.getUserByDiscordId(discordId);
    if (userData?.left_at) {
        return { eligible: false, reason: 'left_at', userData };
    }

    const member = await fetchMember(guild, discordId, memberOverride);
    if (!member) {
        return { eligible: false, reason: 'not_in_guild', userData };
    }

    if (!hasLangGiaRole(member)) {
        return { eligible: false, reason: 'missing_lang_gia', userData, member };
    }

    return { eligible: true, reason: 'ok', userData, member };
}

async function removeBcRegularDay(guildId, discordId, day, reason = '') {
    if (!guildId || !discordId || !day) return { localRemoved: false, remoteRemoved: false };

    const local = db.removeBcRegular(guildId, discordId, day);
    let remoteRemoved = false;

    if (supaSync.isReady()) {
        remoteRemoved = await supaSync.removeBcRegular(guildId, discordId, day);
    }

    if (local?.removed || remoteRemoved) {
        const suffix = reason ? ` (${reason})` : '';
        console.log(`[bcRegular] Removed ${discordId} from ${day}${suffix}`);
    }

    return { localRemoved: !!local?.removed, remoteRemoved: !!remoteRemoved };
}

async function cleanupWeekendBcRegulars(guildOrId, discordId, reason = '') {
    const guildId = typeof guildOrId === 'string' ? guildOrId : guildOrId?.id;
    const results = [];

    for (const day of BC_REGULAR_DAYS) {
        results.push(await removeBcRegularDay(guildId, discordId, day, reason));
    }

    return results;
}

async function addBcRegularIfEligible(guild, discordId, username, day, memberOverride = null) {
    if (!isBcRegularDay(day)) {
        return { success: false, reason: 'invalid_day' };
    }

    const eligibility = await getBcRegularEligibility(guild, discordId, memberOverride);
    if (!eligibility.eligible) {
        await cleanupWeekendBcRegulars(guild, discordId, `blocked_add:${eligibility.reason}`);
        return { success: false, reason: eligibility.reason };
    }

    const local = db.addBcRegular(guild.id, discordId, username, day);
    if (!local?.success) {
        return { success: false, reason: local?.error || 'local_failed' };
    }

    if (supaSync.isReady()) {
        await supaSync.syncBcRegular(guild.id, discordId, username, day);
    }

    return { success: true, eligibility };
}

async function pruneInvalidBcRegulars(guild, day, regulars = null) {
    if (!guild?.id || !isBcRegularDay(day)) return [];

    const source = Array.isArray(regulars) ? regulars : (db.getBcRegulars(guild.id, day) || []);
    const valid = [];
    const cleaned = new Set();

    for (const reg of source) {
        if (!reg?.discord_id) continue;

        const eligibility = await getBcRegularEligibility(guild, reg.discord_id);
        if (eligibility.eligible) {
            valid.push(reg);
            continue;
        }

        if (!cleaned.has(reg.discord_id)) {
            cleaned.add(reg.discord_id);
            await cleanupWeekendBcRegulars(guild, reg.discord_id, `prune:${day}:${eligibility.reason}`);
        }
    }

    return valid;
}

async function validateRemoteBcRegular(guild, record, day = record?.day) {
    if (!guild?.id || !record?.discord_id || !isBcRegularDay(day)) {
        if (guild?.id && record?.discord_id && day) {
            await removeBcRegularDay(guild.id, record.discord_id, day, 'invalid_remote_day');
        }
        return false;
    }

    const eligibility = await getBcRegularEligibility(guild, record.discord_id);
    if (!eligibility.eligible) {
        await cleanupWeekendBcRegulars(guild, record.discord_id, `invalid_remote:${eligibility.reason}`);
        return false;
    }

    return true;
}

async function applyRemoteBcRegularChange(guild, change) {
    if (!guild?.id || !change) return false;

    const eventType = change.eventType || change.event || '';
    const record = change.record || change.new || change.old;
    if (!record?.discord_id || !record?.day) return false;

    if (eventType === 'DELETE') {
        await removeBcRegularDay(guild.id, record.discord_id, record.day, 'remote_delete');
        return true;
    }

    const valid = await validateRemoteBcRegular(guild, record, record.day);
    if (!valid) return false;

    db.addBcRegular(guild.id, record.discord_id, record.username || record.discord_id, record.day);
    console.log(`[bcRegular] Applied remote ${eventType || 'change'} ${record.discord_id} -> ${record.day}`);
    return true;
}

module.exports = {
    BC_REGULAR_DAYS,
    isBcRegularDay,
    hasLangGiaRole,
    getBcRegularEligibility,
    removeBcRegularDay,
    cleanupWeekendBcRegulars,
    addBcRegularIfEligible,
    pruneInvalidBcRegulars,
    validateRemoteBcRegular,
    applyRemoteBcRegularChange
};
