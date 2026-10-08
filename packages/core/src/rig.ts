import type { Vec3 } from './model.js';
import { rotate } from './geometry.js';

const sub = (a: Vec3, b: Vec3): Vec3 => a.map((n, i) => n - b[i]!) as Vec3;
const dot = (a: Vec3, b: Vec3) => a.reduce((s, n, i) => s + n * b[i]!, 0);
const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v);
  if (n < 1e-10) throw new Error('Undefined rig direction');
  return v.map((x) => x / n) as Vec3;
};
const downRotation = (v: Vec3): Vec3 => {
  const d = unit(v);
  return [
    (Math.asin(Math.max(-1, Math.min(1, -d[2]))) * 180) / Math.PI,
    0,
    (Math.atan2(d[0], -d[1]) * 180) / Math.PI,
  ];
};
/** Invert the XYZ Euler rotation used by geometry; translation/pivots are separate. */
export function inverseRotateVector(v: Vec3, r: Vec3): Vec3 {
  let p = rotate(v, [0, 0, 0], [0, 0, -r[2]]);
  p = rotate(p, [0, 0, 0], [0, -r[1], 0]);
  return rotate(p, [0, 0, 0], [-r[0], 0, 0]);
}
/** Two bones rest along negative Y. Pole selects the elbow/knee bend plane.
 * Targets outside the reachable annulus are clamped and explicitly reported.
 * Output rotations use the same XYZ convention as BBIR's hierarchical renderer.
 */
export function solveTwoBone(
  root: Vec3,
  target: Vec3,
  pole: Vec3,
  upperLength: number,
  lowerLength: number,
) {
  if (
    ![root, target, pole].every(
      (v) =>
        Array.isArray(v) &&
        v.length === 3 &&
        v.every((n) => Number.isFinite(n) && Math.abs(n) <= 1_000_000),
    ) ||
    ![upperLength, lowerLength].every((n) => Number.isFinite(n) && n >= 0.000001 && n <= 1_000_000)
  )
    throw new Error('Expected finite rig vectors and positive bone lengths');
  const delta = sub(target, root),
    distance = Math.hypot(...delta);
  if (distance < 1e-9) throw new Error('Rig target coincides with root');
  const axis = unit(delta),
    min = Math.abs(upperLength - lowerLength) + 1e-7,
    max = upperLength + lowerLength - 1e-7;
  const d = Math.max(min, Math.min(max, distance));
  const desired: Vec3 = root.map((n, i) => n + axis[i]! * d) as Vec3;
  const hint = sub(pole, root);
  let bend: Vec3 = hint.map((n, i) => n - axis[i]! * dot(hint, axis)) as Vec3;
  if (Math.hypot(...bend) < 1e-8) {
    const fallback: Vec3 = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    bend = fallback.map((n, i) => n - axis[i]! * dot(fallback, axis)) as Vec3;
  }
  bend = unit(bend);
  const along = (upperLength ** 2 - lowerLength ** 2 + d ** 2) / (2 * d);
  const height = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2));
  const joint: Vec3 = root.map((n, i) => n + axis[i]! * along + bend[i]! * height) as Vec3;
  const upper = downRotation(sub(joint, root));
  const lower = downRotation(inverseRotateVector(sub(desired, joint), upper));
  return { upper, lower, joint, end: desired, clamped: Math.abs(d - distance) > 1e-8 };
}
