function normalizeQuery(text) {
    return (text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase();
}

function isCoreQuestion(text) {
    const normalized = normalizeQuery(text);
    if (!normalized.trim()) return false;

    const hasStrongKeyword = [
        /\bcore\b/,
        /\bbat\s*am\b/,
        /\broll\b/,
        /\bpull\b/,
        /\bsummon\b/,
        /\bno\s*vang\b/,
        /\b7\s*sac\b/,
        /\bcau\s*vong\b/,
        /\bpity\b/,
    ].some((pattern) => pattern.test(normalized));

    if (hasStrongKeyword) return true;

    const hasSoftKeyword = /\b(quay|bao\s*hiem)\b/.test(normalized);
    const hasCoreContext = /\b(core|bat\s*am|vang|7\s*sac|cau\s*vong|phat|roll|pull|summon|pity)\b/.test(normalized);
    return hasSoftKeyword && hasCoreContext;
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickBucket(weights) {
    const total = weights.early + weights.soft + weights.hard;
    let roll = Math.random() * total;

    roll -= weights.early;
    if (roll <= 0) return 'early';

    roll -= weights.soft;
    if (roll <= 0) return 'soft';

    return 'hard';
}

function getWeightsForFortune(fortuneName) {
    const weights = { early: 20, soft: 75, hard: 5 };
    const name = normalizeQuery(fortuneName);

    if (name.includes('cat')) {
        weights.early += 10;
        weights.soft -= 10;
    } else if (name.includes('hung')) {
        weights.hard += 10;
        weights.soft -= 10;
    }

    return weights;
}

function rollCoreOutcome(fortuneName) {
    const bucket = pickBucket(getWeightsForFortune(fortuneName));
    const pulls = bucket === 'early'
        ? randomInt(1, 69)
        : bucket === 'soft'
            ? randomInt(70, 140)
            : randomInt(141, 150);
    const result = Math.random() < 0.05 ? 'rainbow' : 'gold';
    const outcome = { pulls, result, bucket };

    return {
        ...outcome,
        content: formatCoreOutcome(outcome),
    };
}

function formatCoreOutcome(outcome) {
    if (!outcome) return '';

    if (outcome.result === 'rainbow') {
        return `${outcome.pulls} phát nổ 7 sắc cầu vồng (2 Core / 2 Bát Âm)`;
    }

    return `${outcome.pulls} phát nổ vàng (1 Core / 1 Bát Âm)`;
}

module.exports = {
    isCoreQuestion,
    rollCoreOutcome,
    formatCoreOutcome,
};
