// Smooth pseudo-random signal in roughly [-1, 1]: a sum of sine waves with random
// phases and lengths. `periods` are in the same unit as the input (metres or seconds).
export function smoothNoise(periods: number[], rand: () => number = Math.random) {
  const waves = periods.map((period, i) => ({
    // randomise each period ±30 % so the waves never line up into a repeating pattern
    period: period * (0.7 + 0.6 * rand()),
    phase: rand() * 2 * Math.PI,
    weight: 1 / (i + 1) // longer waves dominate, shorter ones add texture
  }));
  const total = waves.reduce((s, w) => s + w.weight, 0);
  return (x: number) =>
    waves.reduce((s, w) => s + w.weight * Math.sin((2 * Math.PI * x) / w.period + w.phase), 0) / total;
}

// Small seeded PRNG (mulberry32). The same seed gives the same sequence, so the
// chart preview and the downloaded GPX get exactly the same pace/heart rate curves.
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Separate streams for pace and heart rate, derived from one seed
export const paceRandom = (seed?: number) => (seed === undefined ? Math.random : seededRandom(seed));
export const heartRateRandom = (seed?: number) =>
  seed === undefined ? Math.random : seededRandom((seed ^ 0x9e3779b9) >>> 0);
