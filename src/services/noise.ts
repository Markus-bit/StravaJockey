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
