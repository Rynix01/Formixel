import type { FaceName, Face } from './model.js';

// Corner order matches the outward-facing quads in render.ts, not the editor's vertex numbering.
const corners: Record<FaceName, [number, number][]> = {
  north: [
    [1, 1],
    [1, 0],
    [0, 0],
    [0, 1],
  ],
  east: [
    [1, 1],
    [1, 0],
    [0, 0],
    [0, 1],
  ],
  south: [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ],
  west: [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ],
  up: [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ],
  down: [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ],
};

/** Inverse of Blockbench CubeFace.UVToLocal, including quarter turns and reversed UV endpoints. */
export function faceUVs(
  name: FaceName,
  uv: Face['uv'],
  rotation: NonNullable<Face['rotation']> = 0,
): [number, number][] {
  if (!corners[name] || ![0, 90, 180, 270].includes(rotation))
    throw new Error('Invalid face or UV rotation');
  return corners[name].map(([u0, v0]) => {
    let u = u0,
      v = v0;
    for (let i = 0; i < rotation; i += 90) [u, v] = [v, 1 - u];
    return [uv[0] + u * (uv[2] - uv[0]), uv[1] + v * (uv[3] - uv[1])];
  });
}
