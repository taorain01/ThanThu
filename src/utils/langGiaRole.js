const LANG_GIA_ROLE_NAMES = ['LangGia', 'Lang Gia'];
const LANG_GIA_ROLE_NAME = LANG_GIA_ROLE_NAMES[0];

function normalizeRoleName(name) {
    return String(name || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

function isLangGiaRole(roleOrName) {
    const name = typeof roleOrName === 'string' ? roleOrName : roleOrName?.name;
    return normalizeRoleName(name) === 'langgia';
}

function findLangGiaRole(guildOrRoles) {
    const roles = guildOrRoles?.roles?.cache || guildOrRoles?.cache || guildOrRoles;
    if (!roles?.find) return null;
    return roles.find((role) => isLangGiaRole(role)) || null;
}

function hasLangGiaRole(member) {
    return !!member?.roles?.cache?.some((role) => isLangGiaRole(role));
}

module.exports = {
    LANG_GIA_ROLE_NAME,
    LANG_GIA_ROLE_NAMES,
    normalizeRoleName,
    isLangGiaRole,
    findLangGiaRole,
    hasLangGiaRole
};
