const supaSync = require('./supabaseSync');

function normalizeValue(value) {
    if (value === undefined || value === null || value === '') return '';
    return String(value);
}

function buildChange(field, label, before, after) {
    const oldValue = normalizeValue(before);
    const newValue = normalizeValue(after);
    if (oldValue === newValue) return null;
    return {
        field,
        label,
        before: oldValue || null,
        after: newValue || null
    };
}

function compactDetails(action, details, performedBy) {
    return {
        ...details,
        category: 'member_roster',
        summary: details.summary || action,
        actor_id: details.actor_id || performedBy || null,
        actor_name: details.actor_name || null,
        changes: Array.isArray(details.changes) ? details.changes.filter(Boolean) : [],
        edited_at: details.edited_at || new Date().toISOString()
    };
}

async function logMemberRosterAction(guildId, action, details = {}, performedBy = null, source = 'bot') {
    if (!guildId || !action) return false;
    try {
        if (!supaSync.isReady()) supaSync.initSupabase();
        if (!supaSync.isReady()) return false;
        await supaSync.logAction(guildId, action, compactDetails(action, details, performedBy), performedBy, source);
        return true;
    } catch (_) {
        return false;
    }
}

module.exports = {
    buildChange,
    logMemberRosterAction
};
