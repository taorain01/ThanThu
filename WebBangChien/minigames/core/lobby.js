export const DEFAULT_MAX_RACERS = 40;

export function normalizeRacerName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function splitRacerNames(value, maxRacers = DEFAULT_MAX_RACERS) {
  return String(value ?? "")
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, maxRacers);
}

export function findDuplicatedRacerNames(names) {
  const seen = new Set();
  const duplicates = [];

  for (const name of Array.isArray(names) ? names : []) {
    const key = normalizeRacerName(name);
    if (!key) continue;
    if (seen.has(key) && !duplicates.some((item) => normalizeRacerName(item) === key)) {
      duplicates.push(name);
    }
    seen.add(key);
  }

  return duplicates;
}
