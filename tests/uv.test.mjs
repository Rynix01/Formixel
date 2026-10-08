import test from 'node:test';
import assert from 'node:assert/strict';
import {
  faceUVs,
  parseFXL,
  renderPixels,
  exportBBModel,
  importBBModel,
  serialize,
} from '../packages/core/dist/index.js';

const vertices = {
  north: [
    [0, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [1, 0, 0],
  ],
  east: [
    [1, 0, 0],
    [1, 1, 0],
    [1, 1, 1],
    [1, 0, 1],
  ],
  south: [
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ],
  west: [
    [0, 0, 0],
    [0, 0, 1],
    [0, 1, 1],
    [0, 1, 0],
  ],
  up: [
    [0, 1, 0],
    [0, 1, 1],
    [1, 1, 1],
    [1, 1, 0],
  ],
  down: [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
    [0, 0, 1],
  ],
};
// Independently map each texel position into local XYZ, following the native CubeFace contract.
const local = (face, u, v, rotation) => {
  for (let i = 0; i < rotation; i += 90) [u, v] = [1 - v, u];
  switch (face) {
    case 'north':
      return [1 - u, 1 - v, 0];
    case 'south':
      return [u, 1 - v, 1];
    case 'east':
      return [1, 1 - v, 1 - u];
    case 'west':
      return [0, 1 - v, u];
    case 'up':
      return [u, 1, v];
    case 'down':
      return [u, 0, 1 - v];
  }
};
test('face UV corners match native local coordinates for all faces, turns and reversed rectangles', () => {
  for (const [face, positions] of Object.entries(vertices))
    for (const rotation of [0, 90, 180, 270])
      for (const rect of [
        [2, 3, 8, 11],
        [8, 3, 2, 11],
        [2, 11, 8, 3],
        [8, 11, 2, 3],
      ]) {
        const uv = faceUVs(face, rect, rotation);
        for (let i = 0; i < 4; i++)
          assert.deepEqual(
            local(
              face,
              (uv[i][0] - rect[0]) / (rect[2] - rect[0]),
              (uv[i][1] - rect[1]) / (rect[3] - rect[1]),
              rotation,
            ).map((n) => (n === 0 ? 0 : n)),
            positions[i],
            `${face} ${rotation}`,
          );
      }
  assert.throws(() => faceUVs('north', [0, 0, 1, 1], 45));
});

test('rasterized asymmetric texture preserves native face direction and rotation through roundtrip', () => {
  const m = parseFXL('model uv cube box [0,0,0] [2,2,2]');
  m.textures = [
    {
      id: 'corners',
      name: 'corners.png',
      width: 2,
      height: 2,
      pixels: [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255],
    },
  ];
  m.cubes[0].faces = { north: { texture: 'corners', uv: [0, 0, 2, 2], rotation: 0 } };
  const samples = (rotation) => {
    m.cubes[0].faces.north.rotation = rotation;
    const image = renderPixels(m, { width: 64, height: 64, view: 'front' });
    return [
      [20, 20],
      [44, 20],
      [20, 44],
      [44, 44],
    ].map(([x, y]) =>
      [...image.pixels.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 3)].map((v) => v > 0),
    );
  };
  assert.deepEqual(samples(0), [
    [false, true, false],
    [true, false, false],
    [true, true, false],
    [false, false, true],
  ]);
  assert.deepEqual(samples(90), [
    [true, false, false],
    [false, false, true],
    [false, true, false],
    [true, true, false],
  ]);
  assert.equal(serialize(importBBModel(exportBBModel(m))), serialize(m));
});
