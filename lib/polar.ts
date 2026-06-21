// Pure sailing maths. No DOM, no React. Fully typed and testable.

/** A single point on the polar curve: true wind angle (deg) -> boat speed (kn). */
export interface PolarPoint {
  twa: number;
  speed: number;
}

/**
 * The boat polar: true wind angle in degrees mapped to best achievable boat
 * speed in knots. We interpolate linearly between these points.
 */
export const POLAR_TABLE: ReadonlyArray<PolarPoint> = [
  { twa: 0, speed: 0.3 },
  { twa: 20, speed: 2.4 },
  { twa: 30, speed: 5.0 },
  { twa: 40, speed: 6.8 },
  { twa: 52, speed: 7.7 },
  { twa: 60, speed: 8.2 },
  { twa: 75, speed: 8.8 },
  { twa: 90, speed: 9.1 },
  { twa: 110, speed: 9.2 },
  { twa: 120, speed: 9.0 },
  { twa: 135, speed: 8.6 },
  { twa: 150, speed: 7.7 },
  { twa: 165, speed: 6.4 },
  { twa: 180, speed: 5.7 },
];

const DEG2RAD = Math.PI / 180;

/** Clamp a value into the inclusive range [lo, hi]. */
export function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/**
 * Wrap a true wind angle into 0..180 (the polar is symmetric about the wind)
 * and return the linearly interpolated boat speed in knots.
 */
export function polarSpeed(twa: number): number {
  // Normalise into 0..360 then fold into 0..180.
  let a = twa % 360;
  if (a < 0) a += 360;
  if (a > 180) a = 360 - a;

  const table = POLAR_TABLE;
  if (a <= table[0].twa) return table[0].speed;
  const last = table[table.length - 1];
  if (a >= last.twa) return last.speed;

  for (let i = 0; i < table.length - 1; i++) {
    const p0 = table[i];
    const p1 = table[i + 1];
    if (a >= p0.twa && a <= p1.twa) {
      const span = p1.twa - p0.twa;
      const t = span === 0 ? 0 : (a - p0.twa) / span;
      return p0.speed + (p1.speed - p0.speed) * t;
    }
  }
  return last.speed;
}

/**
 * Signed smallest difference between two angles (a - b), in degrees,
 * normalised to the range (-180, 180].
 */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Result of the upwind optimisation: the best beating angle and its VMG. */
export interface OptimumUpwind {
  twa: number;
  vmg: number;
}

/**
 * Scan true wind angles from 25 to 70 degrees in 0.5 degree steps and find the
 * angle that maximises velocity made good upwind: polarSpeed(twa) * cos(twa).
 */
export function optimumUpwind(): OptimumUpwind {
  let bestTwa = 25;
  let bestVmg = -Infinity;
  for (let twa = 25; twa <= 70; twa += 0.5) {
    const vmg = polarSpeed(twa) * Math.cos(twa * DEG2RAD);
    if (vmg > bestVmg) {
      bestVmg = vmg;
      bestTwa = twa;
    }
  }
  return { twa: bestTwa, vmg: bestVmg };
}
