export const FUZZY_MATCH_THRESHOLD = 0.85;
export const FUZZY_LOW_CONFIDENCE_THRESHOLD = 0.92;

function jaroDistance(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen === 0 ? 1 : 0;

  const matchDistance = Math.floor(Math.max(aLen, bLen) / 2) - 1;
  const aMatches = new Array(aLen).fill(false);
  const bMatches = new Array(bLen).fill(false);

  let matches = 0;
  for (let i = 0; i < aLen; i += 1) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, bLen);
    for (let j = start; j < end; j += 1) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches += 1;
      break;
    }
  }

  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < aLen; i += 1) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }

  transpositions /= 2;
  return ((matches / aLen) + (matches / bLen) + ((matches - transpositions) / matches)) / 3;
}

export function jaroWinkler(a: string, b: string): number {
  const jaro = jaroDistance(a, b);
  const prefixLength = Math.min(4, Math.min(a.length, b.length));
  let prefixScale = 0;

  for (let i = 0; i < prefixLength; i += 1) {
    if (a[i] === b[i]) prefixScale += 1;
    else break;
  }

  const p = 0.1;
  return jaro + prefixScale * p * (1 - jaro);
}

export function tokenOverlap(a: string, b: string): number {
  const normalize = (value: string) => value
    .toLowerCase()
    .split(/[^\w]+/)
    .filter(Boolean);

  const aTokens = normalize(a);
  const bTokens = normalize(b);
  if (aTokens.length === 0 || bTokens.length === 0) return 0;

  const smaller = aTokens.length <= bTokens.length ? aTokens : bTokens;
  const larger = aTokens.length <= bTokens.length ? bTokens : aTokens;
  const largerSet = new Set(larger);
  const matched = smaller.filter((token) => largerSet.has(token)).length;

  return matched / smaller.length;
}

export function fuzzyMatch(
  input: string,
  candidates: string[],
  threshold: number = FUZZY_MATCH_THRESHOLD,
): { index: number; score: number } | null {
  const filtered = candidates
    .map((candidate, index) => ({ candidate, index, overlap: tokenOverlap(input, candidate) }))
    .filter((entry) => entry.overlap > 0);

  if (filtered.length === 0) return null;

  let best: { index: number; score: number } | null = null;
  for (const entry of filtered) {
    const score = jaroWinkler(input, entry.candidate);
    if (score >= threshold && (!best || score > best.score)) {
      best = { index: entry.index, score };
    }
  }

  return best;
}
