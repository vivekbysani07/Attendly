// Percentage = attended / held * 100
function pct(attended, held) {
  return held === 0 ? null : (attended / held) * 100;
}

// Minimum x such that (A + x) / (H + x) >= T/100   →  x = ceil((T·H − 100·A) / (100 − T))
function classesNeeded(a, h, t) {
  if (h === 0) return 0;
  if (a * 100 >= t * h) return 0;          // already at/above target
  if (t >= 100) return null;               // unreachable (need 100% but already missed some)
  let x = Math.ceil((t * h - 100 * a) / (100 - t));
  while ((a + x) * 100 < t * (h + x)) x++;                       // float safety
  while (x > 0 && (a + x - 1) * 100 >= t * (h + x - 1)) x--;     // minimality
  return x;
}

// Maximum x such that A / (H + x) >= T/100   →  x = floor((100·A − T·H) / T)
function classesCanMiss(a, h, t) {
  if (h === 0) return 0;
  if (a * 100 < t * h) return 0;           // already below target
  let x = Math.floor((100 * a - t * h) / t);
  if (x < 0) x = 0;
  while (x > 0 && a * 100 < t * (h + x)) x--;
  while (a * 100 >= t * (h + x + 1)) x++;
  return x;
}

// safe ≥ target · warn ≥ target−5 · bad < target−5
function statusOf(p, t) {
  if (p === null) return 'none';
  if (p >= t) return 'safe';
  if (p >= t - 5) return 'warn';
  return 'bad';
}

module.exports = { pct, classesNeeded, classesCanMiss, statusOf };