/**
 * Team Split Algorithm for Bang Chien
 * Chia 30 người thành 2 team: Phòng Thủ (Defense) và Tấn Công (Offense)
 */

const TEAM_SIZE = 15;

/**
 * Split participants into 2 teams based on their roles
 * @param {Array} participants - Array of { id, username, role }
 * @param {Object} guild - Discord guild object for role lookup
 * @returns {Object} { defense: [], offense: [], warnings: [] }
 */
function splitTeams(participants, guild) {
    // All role names (DPS sub-types first for priority detection)
    const dpsSubTypes = ['Quạt Dù', 'Vô Danh', 'Song Đao', 'Cửu Kiếm'];
    const allRoleNames = [...dpsSubTypes, 'DPS', 'Healer', 'Tanker'];

    // Get role for each participant
    const withRoles = participants.map(p => {
        let role = null;
        if (guild) {
            try {
                const member = guild.members.cache.get(p.id);
                if (member) {
                    for (const roleName of allRoleNames) {
                        const discordRole = guild.roles.cache.find(r => r.name === roleName);
                        if (discordRole && member.roles.cache.has(discordRole.id)) {
                            // Gom tất cả DPS sub-types vào một role display
                            if (dpsSubTypes.includes(roleName) || roleName === 'DPS') {
                                role = 'DPS';
                            } else {
                                role = roleName;
                            }
                            break;
                        }
                    }
                }
            } catch (e) { }
        }
        return { ...p, role: role || 'Unknown' };
    });

    // Separate by role
    const healers = withRoles.filter(p => p.role === 'Healer');
    const tankers = withRoles.filter(p => p.role === 'Tanker');
    const dps = withRoles.filter(p => p.role === 'DPS');
    const unknown = withRoles.filter(p => p.role === 'Unknown');

    // Initialize teams
    const defense = [];
    const offense = [];
    const warnings = [];

    // Helper: add to team with size check
    function addToTeam(team, member) {
        if (team.length < TEAM_SIZE) {
            team.push(member);
            return true;
        }
        return false;
    }

    // Step 1: Distribute Healers (Defense gets ~60%)
    const defenseHealerCount = Math.ceil(healers.length * 0.6);
    healers.forEach((h, i) => {
        if (i < defenseHealerCount) {
            addToTeam(defense, h);
        } else {
            addToTeam(offense, h);
        }
    });

    // Step 2: Distribute Tankers (Defense gets ~60%)
    const defenseTankerCount = Math.ceil(tankers.length * 0.6);
    tankers.forEach((t, i) => {
        if (i < defenseTankerCount) {
            addToTeam(defense, t);
        } else {
            addToTeam(offense, t);
        }
    });

    // Step 3: Distribute DPS (fill remaining slots, prefer Offense)
    const defenseNeeded = TEAM_SIZE - defense.length;
    const offenseNeeded = TEAM_SIZE - offense.length;

    // DPS goes to Offense first, then Defense
    let dpsIndex = 0;
    while (dpsIndex < dps.length && offense.length < TEAM_SIZE) {
        addToTeam(offense, dps[dpsIndex]);
        dpsIndex++;
    }
    while (dpsIndex < dps.length && defense.length < TEAM_SIZE) {
        addToTeam(defense, dps[dpsIndex]);
        dpsIndex++;
    }

    // Step 4: Distribute Unknown (fill remaining)
    let unknownIndex = 0;
    while (unknownIndex < unknown.length && defense.length < TEAM_SIZE) {
        addToTeam(defense, unknown[unknownIndex]);
        unknownIndex++;
    }
    while (unknownIndex < unknown.length && offense.length < TEAM_SIZE) {
        addToTeam(offense, unknown[unknownIndex]);
        unknownIndex++;
    }

    // Step 5: Generate warnings
    const defenseHealers = defense.filter(p => p.role === 'Healer').length;
    const offenseHealers = offense.filter(p => p.role === 'Healer').length;
    const defenseTankers = defense.filter(p => p.role === 'Tanker').length;
    const offenseTankers = offense.filter(p => p.role === 'Tanker').length;

    if (offenseHealers < 2 && healers.length >= 2) {
        warnings.push('⚠️ Team Tấn Công ít Healer!');
    }
    if (offenseTankers < 2 && tankers.length >= 2) {
        warnings.push('⚠️ Team Tấn Công ít Tanker!');
    }
    if (defenseHealers === 0) {
        warnings.push('⚠️ Team Phòng Thủ không có Healer!');
    }
    if (defenseTankers === 0) {
        warnings.push('⚠️ Team Phòng Thủ không có Tanker!');
    }

    return {
        defense,
        offense,
        warnings,
        stats: {
            defense: {
                healer: defenseHealers,
                tanker: defenseTankers,
                dps: defense.filter(p => p.role === 'DPS').length,
                unknown: defense.filter(p => p.role === 'Unknown').length
            },
            offense: {
                healer: offenseHealers,
                tanker: offenseTankers,
                dps: offense.filter(p => p.role === 'DPS').length,
                unknown: offense.filter(p => p.role === 'Unknown').length
            }
        }
    };
}

module.exports = { splitTeams, TEAM_SIZE };
