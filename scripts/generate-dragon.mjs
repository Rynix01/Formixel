import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import {
  PixelAtlas,
  FACE_NAMES,
  rotate,
  solveTwoBone,
  inverseRotateVector,
  relativeRotation,
  canonical,
  validate,
  analyzeQuality,
  serialize,
  exportBBModel,
  importBBModel,
  inspect,
  renderPNG,
  renderGIF,
  renderPixels,
  encodePNG,
  animationFraming,
} from '../packages/core/dist/index.js';

const palette = {
  obsidian: ['1c1e25', '434550', '626570'],
  dark: ['12151c', '292c33', '434750'],
  red: ['4c101a', '962329', 'd0463c'],
  bone: ['8a765c', 'cfb895', 'f4e4bd'],
  belly: ['4f4032', '957b57', 'c2a37a'],
  gold: ['865522', 'c9943d', 'f4d07a'],
  gem: ['530b1c', 'b81c32', 'f44c49'],
  eye: ['035332', '12d75b', 'bfffb1'],
  flame: ['b32317', 'ff831e', 'fff0a0'],
  smoke: ['48494d', '8f8a82', 'c6c0b3'],
};
const rgb = (s) => s.match(/../g).map((v) => parseInt(v, 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
const pulse = (t, a, b, c, d) =>
  t < a || t > d
    ? 0
    : t < b
      ? smooth((t - a) / (b - a))
      : t < c
        ? 1
        : 1 - smooth((t - c) / (d - c));
const noise = (x, y, s) => {
  let n = Math.imul(x + s, 374761393) ^ Math.imul(y + 31, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n >>> 0) / 4294967296;
};
const degrees = (r) => (r * 180) / Math.PI;
const compose = (...rotations) => {
  const [x, y, z] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ].map((axis) => rotations.reduce((v, r) => rotate(v, [0, 0, 0], r), axis));
  const pitch = Math.asin(Math.max(-1, Math.min(1, -x[2]))),
    regular = Math.abs(Math.cos(pitch)) > 1e-8;
  return [
    regular ? Math.atan2(y[2], z[2]) : Math.atan2(-z[1], y[1]),
    pitch,
    regular ? Math.atan2(x[1], x[0]) : 0,
  ].map(degrees);
};

export function createDragon() {
  const headPrefix = 'dragon/body/chest/neck/upper/head';
  const enlargeHead = (p) => p.map((n, i) => [0, 33, -12][i] + (n - [0, 33, -12][i]) * 1.22);
  const atlas = new PixelAtlas(512, 512),
    layout = [],
    regions = new Map();
  const model = {
    version: 2,
    name: 'Obsidian Crimson Dragon',
    format: 'free',
    resolution: [512, 512],
    groups: [],
    cubes: [],
    textures: [],
    animations: [],
  };
  const G = (id, origin, parent) => {
    if (id.startsWith(headPrefix + '/')) origin = enlargeHead(origin);
    model.groups.push({
      id,
      name: id.split('/').at(-1).replaceAll('_', ' '),
      origin: [...origin],
      rotation: [0, 0, 0],
      ...(parent ? { parent } : {}),
    });
    return id;
  };
  const paint = (material, detail, tone) => (x, y, w, h) => {
    const [shade, base, light] = palette[material].map(rgb),
      u = x / Math.max(1, w - 1),
      v = y / Math.max(1, h - 1);
    let c = mix(shade, base, 0.57 + 0.28 * (1 - v) + 0.08 * (1 - u) + (tone - 2) * 0.025);
    if (material === 'red') {
      c = mix(
        shade,
        base,
        0.57 + 0.27 * (1 - u) + 0.12 * Math.sin(v * Math.PI) + (tone - 2) * 0.035,
      );
      if (detail === 'membrane' && (x === 0 || y === h - 1)) c = mix(shade, base, 0.54);
    } else if (material === 'eye') {
      c = mix(
        base,
        light,
        0.28 + 0.65 * Math.max(0, 1 - Math.hypot((u - 0.4) * 1.6, (v - 0.4) * 1.4)),
      );
      if (u > 0.74) c = shade;
      if (u > 0.28 && u < 0.46 && v > 0.2 && v < 0.8) c = rgb('e8ffb7');
    } else if (material === 'gem') {
      c = mix(shade, base, 0.58 + (u < 0.45 && v < 0.55 ? 0.25 : 0));
      if (Math.abs(u - v) < 0.08) c = mix(base, light, 0.48);
      if (y === 0 || x === 0) c = light;
    } else if (material === 'flame') {
      c = mix(base, light, 0.3 + 0.48 * noise(x, y, tone));
      if (tone % 3 === 0) c = mix(shade, base, 0.65);
    } else {
      if (y === 0) c = mix(base, light, 0.24);
      if (y === h - 1) c = mix(shade, base, 0.48);
      if (x === 0) c = mix(base, light, 0.16);
      if (x === w - 1) c = mix(shade, base, 0.5);
      if (detail === 'scale' && y === h - 2 && x > 0 && x < w - 1) c = mix(shade, base, 0.63);
      if (detail === 'scale' && x > 1 && x < w - 2 && y > 1 && y < h - 2)
        c = mix(c, light, noise(Math.floor(x / 2), Math.floor(y / 2), tone) * 0.11);
      if (detail === 'rivet' && Math.abs(u - 0.5) < 0.12 && Math.abs(v - 0.5) < 0.12) c = light;
      if (
        detail === 'engraved' &&
        (Math.abs(u - 0.5) < 0.025 || Math.abs(v - (0.3 + Math.abs(u - 0.5) * 0.55)) < 0.04)
      )
        c = mix(base, light, 0.7);
      if (material === 'bone' && y > 1 && y < h - 2 && x % 7 === 0) c = mix(base, light, 0.16);
    }
    return [...c, 255];
  };
  const C = (
    parent,
    name,
    center,
    size,
    material = 'obsidian',
    rotation = [0, 0, 0],
    detail = 'scale',
    tone = 2,
  ) => {
    if (parent.startsWith(headPrefix)) {
      center = enlargeHead(center);
      size = size.map((n) => n * 1.22);
    }
    if (parent.endsWith('/foot')) {
      const ankle = model.groups.find((g) => g.id === parent).origin;
      const pivot = [ankle[0], ankle[1] - 2.3, ankle[2]];
      center = center.map((n, i) => pivot[i] + (n - pivot[i]) * 1.25);
      size = size.map((n) => n * 1.25);
    }
    const faces = {},
      id = parent + '/' + name;
    const dimensions = {
      north: [size[0], size[1]],
      south: [size[0], size[1]],
      east: [size[2], size[1]],
      west: [size[2], size[1]],
      up: [size[0], size[2]],
      down: [size[0], size[2]],
    };
    for (const face of FACE_NAMES) {
      const focal = material === 'eye' || material === 'gem',
        density = focal ? 6 : 2;
      const [w, h] = dimensions[face].map((v) => Math.max(2, Math.ceil(v * density)));
      // Equal physical dimensions may reuse painted regions. Aspect ratios never reuse square swatches.
      const key = [material, detail, tone, w, h].join(':');
      let region = regions.get(key);
      if (!region) {
        region = atlas.allocate(key, w, h, paint(material, detail, tone));
        regions.set(key, region);
        layout.push({ key, material, detail, tone, ...region });
      }
      faces[face] = { texture: 'dragon_atlas', uv: [...region.uv] };
    }
    model.cubes.push({
      id,
      name: name.replaceAll('_', ' '),
      parent,
      from: center.map((v, i) => v - size[i] / 2),
      to: center.map((v, i) => v + size[i] / 2),
      origin: [...center],
      rotation: [...rotation],
      color: 0,
      faces,
    });
  };
  const rod = (
    parent,
    name,
    a,
    b,
    width,
    depth,
    material = 'obsidian',
    detail = 'scale',
    tone = 2,
  ) => {
    const d = b.map((v, i) => v - a[i]),
      length = Math.hypot(...d),
      axis = d.map((v) => v / length);
    const rotation = [degrees(Math.asin(axis[2])), 0, degrees(Math.atan2(-axis[0], axis[1]))];
    C(
      parent,
      name,
      a.map((v, i) => (v + b[i]) / 2),
      [width, length, depth],
      material,
      rotation,
      detail,
      tone,
    );
    return rotation;
  };
  const spike = (parent, name, a, b, width, material = 'red') => {
    for (let i = 0; i < 3; i++) {
      const start = a.map((v, j) => lerp(v, b[j], i / 3)),
        end = a.map((v, j) => lerp(v, b[j], (i + 1) / 3));
      rod(
        parent,
        name + '_' + i,
        start,
        end,
        width * (1 - i * 0.29),
        width * (0.88 - i * 0.26),
        material,
        'plain',
        i % 3,
      );
    }
  };
  const root = G('dragon', [0, 0, 0]),
    body = G(root + '/body', [0, 18, 5], root);
  const chest = G(body + '/chest', [0, 22, -4], body),
    neck = G(chest + '/neck', [0, 25, -6], chest),
    upperNeck = G(neck + '/upper', [0, 30, -9], neck);
  const head = G(upperNeck + '/head', [0, 33, -12], upperNeck),
    jaw = G(head + '/jaw', [0, 33, -13.4], head);
  // Rounded voxel torso volume and layered scale shingles.
  for (let row = 0; row < 7; row++) {
    const y = 13.8 + row * 1.5,
      r = (y - 18.5) / 5.8,
      width = 2 * 6.3 * Math.sqrt(Math.max(0.12, 1 - r * r));
    C(
      body,
      'body_band_' + row,
      [0, y, 5],
      [width, 1.55, 20 - row * 0.12],
      'dark',
      [0, 0, 0],
      'plain',
    );
  }
  for (let ring = 0; ring < 10; ring++)
    for (let j = 0; j < 14; j++) {
      const angle = ((j + (ring % 2) * 0.35) / 14) * Math.PI * 2;
      if (Math.cos(angle) < -0.48) continue;
      C(
        body,
        `scale_${ring}_${j}`,
        [Math.sin(angle) * 6.3, 18.5 + Math.cos(angle) * 5.4, -5 + ring * 2.15],
        [2.65, 0.8, 2.65],
        'obsidian',
        [0, 0, -degrees(angle)],
        'scale',
        (ring + j) % 4,
      );
    }
  for (let i = 0; i < 8; i++)
    C(
      body,
      'belly_scute_' + i,
      [0, 13.1, -4 + i * 2.5],
      [6.8, 0.65, 2.55],
      'belly',
      [0, 0, 0],
      'plain',
      i % 3,
    );
  C(chest, 'chest_core', [0, 23, -4.8], [10.3, 10.5, 8.4]);
  for (const s of [-1, 1])
    for (let i = 0; i < 4; i++)
      C(
        chest,
        `chest_scale_${s}_${i}`,
        [s * 4.35, 20 + i * 2, -6],
        [2.35, 2.3, 6.3],
        'obsidian',
        [0, s * 8, s * 8],
        'scale',
        i % 3,
      );
  rod(neck, 'neck_base', [0, 25, -6], [0, 31, -9.4], 6.3, 6.1);
  rod(upperNeck, 'neck_upper', [0, 29.6, -8.9], [0, 35, -12.5], 5.8, 5.6);
  for (let i = 0; i < 6; i++) {
    const group = i < 3 ? neck : upperNeck;
    const y = 26 + i * 1.5,
      z = -7 - i * 1.0;
    for (const s of [-1, 1])
      C(
        group,
        `neck_scale_${s}_${i}`,
        [s * 2.9, y, z],
        [1.0, 2.0, 4.9],
        'obsidian',
        [-27, s * 6, 0],
        'scale',
        i % 3,
      );
    C(
      group,
      'throat_' + i,
      [0, y - 0.4, z - 3.05],
      [4.35, 1.9, 0.65],
      'belly',
      [-25, 0, 0],
      'plain',
      i % 3,
    );
    spike(group, 'neck_spine_' + i, [0, y + 0.45, z + 2.7], [0, y + 2.1, z + 5.7], 2.05 - i * 0.11);
  }
  C(head, 'skull_core', [0, 35.5, -14.2], [6.8, 4.8, 6.4], 'dark', [0, 0, 0], 'plain');
  for (let band = 0; band < 4; band++)
    C(
      head,
      'skull_band_' + band,
      [0, 33.8 + band * 1.25, -14.2],
      [[7.25, 8.1, 7.5, 6.2][band], 1.35, [6.9, 7.3, 7.0, 6.4][band]],
      'obsidian',
      [0, 0, 0],
      'scale',
      band % 4,
    );
  C(head, 'snout_upper', [0, 33.8, -19.6], [6.0, 2.2, 6.4]);
  C(head, 'nose_cap', [0, 34, -22.65], [6.25, 2.0, 0.8], 'dark', [0, 0, 0], 'plain');
  C(head, 'forehead', [0, 37.2, -16.1], [5.7, 1.35, 4.6], 'obsidian', [-12, 0, 0]);
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 3; column++)
      C(
        head,
        `snout_shingle_${row}_${column}`,
        [(column - 1) * 2.02, 35.25 + row * 0.12, -21.5 + row * 1.4],
        [2.13, 0.48, 1.7],
        'obsidian',
        [-5, 0, 0],
        'scale',
        (row + column) % 4,
      );
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++)
      C(
        head,
        `cheek_${s}_${i}`,
        [s * (3.2 + i * 0.18), 33.8 + i * 1.25, -15.1 + i * 0.15],
        [1.45, 1.5, 5.1],
        'obsidian',
        [0, s * 7, s * -10],
        'scale',
        i % 3,
      );
    C(
      head,
      'eye_socket_' + s,
      [s * 2.75, 35.25, -18.0],
      [2.65, 1.8, 0.6],
      'dark',
      [0, s * 24, s * -6],
      'plain',
    );
    C(
      head,
      'eye_' + s,
      [s * 2.78, 35.22, -18.37],
      [2.06, 1.05, 0.28],
      'eye',
      [0, s * 24, s * -6],
      'eye',
    );
    C(head, 'side_eye_' + s, [s * 3.95, 35.25, -16.2], [0.3, 1.0, 2.15], 'eye', [0, 0, 0], 'eye');
    C(head, 'brow_' + s, [s * 2.85, 36.37, -17.9], [2.85, 0.9, 1.8], 'obsidian', [
      0,
      s * 14,
      s * -13,
    ]);
    C(head, 'nostril_' + s, [s * 1.78, 34.3, -23.09], [1, 0.48, 0.2], 'dark', [0, 0, 0], 'plain');
    for (let row = 0; row < 4; row++) {
      C(
        head,
        `snout_side_${s}_${row}`,
        [s * 3.4, 33.4, -21.2 + row * 1.5],
        [0.55, 1.75, 1.7],
        'obsidian',
        [0, s * 4, 0],
        'scale',
        row % 4,
      );
      C(
        jaw,
        `jaw_side_${s}_${row}`,
        [s * 3.03, 31.4, -21.2 + row * 1.6],
        [0.48, 1.38, 1.8],
        'obsidian',
        [0, 0, 0],
        'scale',
        row % 3,
      );
    }
    const hornPoints = [
      [s * 3.3, 37.6, -11.3],
      [s * 4.4, 39.8, -9.7],
      [s * 5.4, 42, -7.9],
      [s * 6.5, 44.2, -5.4],
      [s * 7.4, 45.4, -2.7],
      [s * 7.65, 45.2, -0.8],
    ];
    for (let i = 0; i < hornPoints.length - 1; i++)
      rod(
        head,
        `horn_${s}_${i}`,
        hornPoints[i],
        hornPoints[i + 1],
        2.9 - i * 0.51,
        2.7 - i * 0.47,
        'bone',
        'plain',
        i % 3,
      );
    spike(head, 'cheek_horn_' + s, [s * 3.65, 32.8, -12.5], [s * 6.5, 33.5, -10.4], 1.65, 'bone');
    for (let i = 0; i < 4; i++) {
      C(
        head,
        `upper_tooth_${s}_${i}`,
        [s * 2.85, 32.02, -17.4 - i * 1.65],
        [0.65, 0.8, 0.7],
        'bone',
        [0, 0, s * 8],
        'plain',
      );
      C(
        jaw,
        `lower_tooth_${s}_${i}`,
        [s * 2.6, 32.0, -17.2 - i * 1.65],
        [0.52, 0.68, 0.6],
        'bone',
        [0, 0, s * -5],
        'plain',
      );
    }
  }
  C(jaw, 'lower_jaw', [0, 31.38, -18.5], [6.3, 1.65, 9.3]);
  C(jaw, 'mouth_inside', [0, 32.2, -18.7], [5.05, 0.18, 7.7], 'red', [0, 0, 0], 'plain', 0);
  C(jaw, 'tongue', [0, 32.33, -19.4], [2.15, 0.16, 4.3], 'gem', [0, 0, 0], 'plain');
  for (let i = 0; i < 4; i++)
    spike(head, 'crest_' + i, [0, 37.9, -17 + i * 1.8], [0, 40.2 + i * 0.7, -15.9 + i * 2], 1.55);
  for (let i = 0; i < 8; i++)
    spike(
      body,
      'dorsal_' + i,
      [0, 24.5, -3 + i * 2.55],
      [0, 28 - i * 0.15, 0.2 + i * 2.55],
      2.6 - i * 0.09,
    );
  // Layered breastplate, chevrons and a framed ruby.
  C(chest, 'armor_backing', [0, 23.7, -9.2], [9.1, 8.2, 0.85], 'dark', [0, 0, 0], 'plain');
  for (let row = 0; row < 5; row++)
    C(
      chest,
      'breastplate_' + row,
      [0, 26 - row * 1.55, -9.75 - row * 0.12],
      [8.2 - row * 1.3, 1.65, 0.72],
      'gold',
      [0, 0, 0],
      'engraved',
      row % 3,
    );
  for (let row = 0; row < 3; row++)
    for (const s of [-1, 1])
      rod(
        chest,
        `gold_chevron_${row}_${s}`,
        [s * (5 - row * 0.85), 27.1 - row * 2.9, -10.0],
        [0, 24.1 - row * 2.9, -10.75],
        1.15,
        0.75,
        'gold',
        'engraved',
        row % 3,
      );
  C(chest, 'gem_frame', [0, 25.2, -11.0], [2.65, 3.8, 0.65], 'gold', [0, 0, 0], 'engraved');
  C(chest, 'chest_ruby', [0, 25.25, -11.55], [1.45, 2.6, 0.75], 'gem', [0, 0, 0], 'gem');
  for (const s of [-1, 1])
    C(
      chest,
      'ruby_bracket_' + s,
      [s * 1.0, 25.25, -11.6],
      [0.32, 2.4, 0.24],
      'gold',
      [0, 0, s * 12],
      'plain',
    );
  const legs = [];
  for (const kind of ['front', 'rear'])
    for (const s of [-1, 1]) {
      const side = s < 0 ? 'left' : 'right',
        rootPoint = [
          s * (kind === 'front' ? 6.4 : 5.7),
          kind === 'front' ? 22 : 17.5,
          kind === 'front' ? -6 : 11.3,
        ];
      const lengths = kind === 'front' ? [10, 10] : [8.5, 8.5];
      const upper = G(body + '/' + kind + '_' + side, rootPoint, body),
        lower = G(upper + '/lower', [rootPoint[0], rootPoint[1] - lengths[0], rootPoint[2]], upper);
      const ankle = [rootPoint[0], rootPoint[1] - lengths[0] - lengths[1], rootPoint[2]],
        foot = G(lower + '/foot', ankle, lower);
      const target = [s * (kind === 'front' ? 8.1 : 7.4), 2.3, kind === 'front' ? -9.0 : 12.3];
      legs.push({ kind, s, upper, lower, foot, root: rootPoint, lengths, ankle, target });
      C(
        upper,
        'upper_core',
        [rootPoint[0], rootPoint[1] - lengths[0] / 2, rootPoint[2]],
        [kind === 'front' ? 4.1 : 5.4, lengths[0] - 0.6, kind === 'front' ? 4.3 : 5.8],
        'dark',
      );
      for (let r = 0; r < 4; r++)
        for (const face of [-1, 1])
          C(
            upper,
            `upper_scale_${r}_${face}`,
            [
              rootPoint[0] + face * (kind === 'front' ? 1.9 : 2.5),
              rootPoint[1] - 1.7 - r * 1.8,
              rootPoint[2],
            ],
            [1.05, 2.2, kind === 'front' ? 4.7 : 5.7],
            'obsidian',
            [0, 0, face * 9],
            'scale',
            r % 3,
          );
      C(
        upper,
        'shoulder_plate',
        [rootPoint[0], rootPoint[1] - 0.8, rootPoint[2]],
        [kind === 'front' ? 5.25 : 6.1, 3.2, kind === 'front' ? 5.6 : 6.4],
        'obsidian',
        [0, 0, s * 12],
      );
      for (let row = 0; row < 5; row++)
        for (let tile = 0; tile < 8; tile++) {
          const angle = ((tile + (row % 2) * 0.4) * Math.PI) / 4;
          const radius = (kind === 'front' ? 2.65 : 3.15) * (1 - row * 0.035);
          C(
            upper,
            `limb_shingle_${row}_${tile}`,
            [
              rootPoint[0] + Math.sin(angle) * radius,
              rootPoint[1] - 1.1 - row * 1.55,
              rootPoint[2] + Math.cos(angle) * radius,
            ],
            [2.15, 1.8, 0.6],
            'obsidian',
            [0, degrees(angle), 0],
            'scale',
            (row + tile) % 4,
          );
        }
      const kneeY = rootPoint[1] - lengths[0];
      C(lower, 'joint', [rootPoint[0], kneeY, rootPoint[2]], [3.4, 2.25, 3.8], 'dark');
      C(
        lower,
        'lower_core',
        [rootPoint[0], kneeY - lengths[1] / 2, rootPoint[2]],
        [3.1, lengths[1] - 0.3, 3.6],
      );
      for (let r = 0; r < 4; r++)
        C(
          lower,
          'shin_scale_' + r,
          [rootPoint[0], kneeY - 1.9 - r * 1.5, rootPoint[2] - 1.8],
          [3.45, 1.9, 0.72],
          'obsidian',
          [0, 0, 0],
          'scale',
          r % 3,
        );
      for (let row = 0; row < 4; row++)
        for (const side of [-1, 1])
          C(
            lower,
            `shin_side_${row}_${side}`,
            [rootPoint[0] + side * 1.65, kneeY - 1.7 - row * 1.65, rootPoint[2]],
            [0.55, 1.85, 3.95],
            'obsidian',
            [0, 0, side * 5],
            'scale',
            row % 4,
          );
      if (kind === 'front') {
        C(
          lower,
          'guard_back',
          [rootPoint[0], kneeY - 3.25, rootPoint[2] - 2.03],
          [3.75, 4.85, 0.65],
          'gold',
          [0, 0, 0],
          'engraved',
        );
        C(
          lower,
          'guard_inset',
          [rootPoint[0], kneeY - 3.25, rootPoint[2] - 2.44],
          [2.8, 3.9, 0.26],
          'dark',
          [0, 0, 0],
          'plain',
        );
        C(
          lower,
          'guard_ruby',
          [rootPoint[0], kneeY - 3.25, rootPoint[2] - 2.65],
          [1.15, 2.3, 0.35],
          'gem',
          [0, 0, 0],
          'gem',
        );
        for (const edge of [-1, 1])
          C(
            lower,
            'guard_rail_' + edge,
            [rootPoint[0] + edge * 1.57, kneeY - 3.25, rootPoint[2] - 2.7],
            [0.5, 5.25, 0.4],
            'gold',
          );
      }
      const y0 = ankle[1] - 2.3;
      C(foot, 'paw', [ankle[0], y0 + 1.4, ankle[2] - 0.8], [4.6, 2.15, 5.0]);
      C(
        foot,
        'sole',
        [ankle[0], y0 + 0.35, ankle[2] - 0.65],
        [4.7, 0.7, 5.15],
        'dark',
        [0, 0, 0],
        'plain',
      );
      for (let toe = 0; toe < 3; toe++) {
        const x = ankle[0] + (toe - 1) * 1.43;
        C(foot, 'toe_' + toe, [x, y0 + 1.0, ankle[2] - 3.05], [1.24, 1.4, 2.15]);
        spike(
          foot,
          'claw_' + toe,
          [x, y0 + 0.95, ankle[2] - 3.8],
          [x, y0 + 0.5, ankle[2] - 5.4],
          1.1,
          'bone',
        );
      }
      spike(
        foot,
        'side_claw',
        [ankle[0] + s * 2.35, y0 + 1.3, ankle[2] - 0.9],
        [ankle[0] + s * 3.5, y0 + 0.5, ankle[2] - 2.35],
        0.8,
        'bone',
      );
    }
  const wings = [];
  const polygon = [
    [10, 27],
    [16, 43],
    [31, 38],
    [39, 21],
    [32, 23],
    [27, 20],
    [24, 22],
    [20, 19],
    [17, 24],
    [12, 23],
  ];
  const inside = (u, v) => {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i],
        b = polygon[j];
      if (a[1] > v !== b[1] > v && u < ((b[0] - a[0]) * (v - a[1])) / (b[1] - a[1]) + a[0])
        hit = !hit;
    }
    return hit;
  };
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'left' : 'right',
      origin = [s * 5.4, 25, 4.2],
      upper = G(body + '/wing_' + side, origin, body),
      fan = G(upper + '/fan', [s * 12, 30, 6.3], upper);
    wings.push({ s, upper, fan });
    const P = (u, v) => [s * u, v, 5 + (u - 10) * 0.65];
    rod(upper, 'wing_arm', origin, [s * 12, 30, 6.3], 2.1, 2.0, 'obsidian');
    rod(fan, 'wing_forearm', [s * 12, 30, 6.3], P(16, 43), 2.05, 1.75);
    for (let row = 0; row < 12; row++)
      for (let col = 0; col < 15; col++) {
        const u = 10 + col * 2 + 1,
          v = 19 + row * 2 + 1;
        if (!inside(u, v)) continue;
        C(
          fan,
          `membrane_${row}_${col}`,
          P(u, v),
          [2.38, 2.05, 0.3],
          'red',
          [0, -s * degrees(Math.atan(0.65)), 0],
          'membrane',
          (row + col * 3) % 5,
        );
      }
    const border = [
        [16, 43],
        [31, 38],
        [35, 31],
        [39, 21],
      ],
      ribs = [
        [27, 20],
        [20, 19],
        [12, 23],
      ];
    for (let i = 0; i < border.length - 1; i++)
      rod(fan, 'leading_' + i, P(...border[i]), P(...border[i + 1]), 1.4, 1.25, 'dark');
    for (const [i, end] of ribs.entries())
      rod(fan, 'rib_' + i, P(16, 43), P(...end), 1.15, 1.0, 'dark');
    for (const [i, end] of [...ribs, [39, 21]].entries())
      spike(fan, 'wing_tip_' + i, P(...end), P(end[0] + 0.55, end[1] - 2.1), 1.2, 'bone');
    spike(fan, 'thumb', P(16, 43), P(13.2, 45.1), 1.9, 'bone');
    C(fan, 'wrist_joint', P(16, 43), [2.8, 2.5, 2.5], 'obsidian');
  }
  const tail = [];
  const points = [
    [0, 18, 14.5],
    [0, 17.5, 18.2],
    [0.25, 16.6, 22],
    [0.7, 15.3, 25.9],
    [1.25, 13.8, 29.7],
    [1.9, 12.0, 33.5],
    [2.6, 10.4, 37.2],
    [3.35, 9.1, 40.7],
    [4.1, 8.2, 44],
    [4.6, 8, 47.1],
    [4.9, 8.2, 49.8],
  ];
  let parent = body;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1],
      group = G('dragon/tail/segment_' + i, a, parent);
    parent = group;
    tail.push(group);
    const d = b.map((v, j) => v - a[j]),
      length = Math.hypot(...d),
      r = [degrees(Math.atan2(-d[1], d[2])), degrees(Math.atan2(d[0], Math.hypot(d[1], d[2]))), 0],
      mid = a.map((v, j) => (v + b[j]) / 2),
      width = 6.2 - i * 0.46;
    C(group, 'tail_core', mid, [width, width * 0.82, length + 0.4], 'dark', r, 'plain');
    for (let j = 0; j < 8; j++) {
      const angle = (j / 8) * Math.PI * 2,
        local = [Math.sin(angle) * width * 0.48, Math.cos(angle) * width * 0.39, 0],
        center = rotate(local, [0, 0, 0], r).map((v, k) => v + mid[k]);
      C(
        group,
        'tail_scale_' + j,
        center,
        [Math.max(1, width * 0.42), 0.6, length + 0.35],
        'obsidian',
        compose([0, 0, -degrees(angle)], r),
        'scale',
        (i + j) % 4,
      );
    }
    C(
      group,
      'tail_belly',
      [mid[0], mid[1] - width * 0.43, mid[2]],
      [width * 0.7, 0.5, length + 0.25],
      'belly',
      r,
      'plain',
      i % 3,
    );
    spike(
      group,
      'tail_spine',
      [mid[0], mid[1] + width * 0.44, mid[2]],
      [mid[0], mid[1] + width * 0.44 + Math.max(1.6, 3.6 - i * 0.2), mid[2] + 1.9],
      Math.max(0.9, 2 - i * 0.1),
    );
  }
  const tip = tail.at(-1),
    p = points.at(-1);
  for (let i = 0; i < 3; i++)
    C(
      tip,
      'tail_tip_' + i,
      [p[0], p[1], p[2] + i * 1.0],
      [4.8 - i * 1.5, 3.25 - i * 0.8, 1.25],
      'red',
      [0, 0, 0],
      'plain',
      i % 3,
    );
  // Microgeometry in the bind pose; numeric scale animates a bounded visual fire cone.
  const fireOrigin = [0, 33, -23.8],
    fire = G(head + '/fire_preview', fireOrigin, head),
    smoke = G(head + '/smoke_preview', fireOrigin, head),
    charge = G(chest + '/charge_preview', [0, 25.25, -12.05], chest);
  for (let i = 0; i < 36; i++) {
    const distance = 2 + Math.floor(i / 6) * 3.4,
      radius = 0.65 + distance * 0.16,
      angle = ((i % 6) / 6) * Math.PI * 2;
    const center = [Math.cos(angle) * radius, Math.sin(angle) * radius, -distance].map(
      (n, k) => fireOrigin[k] + n / 1000,
    );
    C(
      fire,
      'fire_voxel_' + i,
      center,
      [1.1 + distance * 0.095, 1.1 + distance * 0.095, 1.6 + distance * 0.14].map((n) => n / 1000),
      'flame',
      [0, 0, (i % 4) * 15],
      'plain',
      i % 5,
    );
  }
  for (let i = 0; i < 12; i++) {
    const p = [Math.sin(i * 2.4) * (0.8 + i * 0.11), 1 + i * 0.72, -2 - i * 0.45];
    C(
      smoke,
      'smoke_voxel_' + i,
      p.map((n, k) => fireOrigin[k] + n / 1000),
      [1.5 + i * 0.12, 1.6 + i * 0.1, 1.5 + i * 0.12].map((n) => n / 1000),
      'smoke',
      [0, i * 13, i * 7],
      'plain',
      i % 4,
    );
  }
  C(
    charge,
    'chest_charge',
    [0, 25.25, -12.05],
    [0.0011, 0.002, 0.0003],
    'flame',
    [0, 0, 0],
    'plain',
    1,
  );
  model.textures = [atlas.texture('dragon_atlas', 'obsidian_crimson_dragon_atlas.png')];
  const evaluate = (time, mode) => {
    const phase = (time / (mode === 'walk' ? 1.2 : 3)) * Math.PI * 2,
      bite = mode === 'bite_lunge',
      whip = mode === 'tail_whip',
      breath = mode === 'fire_breath',
      slam = mode === 'wing_slam',
      walk = mode === 'walk';
    const anticipation = bite
      ? pulse(time, 0, 0.28, 0.4, 0.63)
      : slam
        ? pulse(time, 0, 0.27, 0.38, 0.65)
        : 0;
    const lunge = bite
      ? pulse(time, 0.4, 0.65, 0.83, 1.6)
      : slam
        ? pulse(time, 0.33, 0.63, 0.9, 1.8)
        : 0;
    const air = bite
      ? pulse(time, 0.48, 0.62, 0.72, 0.9)
      : slam
        ? pulse(time, 0.34, 0.58, 0.66, 0.9)
        : 0;
    const hit = slam ? pulse(time, 0.72, 0.9, 1.02, 1.3) : 0;
    const inhale = breath ? pulse(time, 0, 0.45, 0.72, 1.15) : 0,
      flame = breath ? pulse(time, 0.58, 0.85, 1.65, 2.15) : 0,
      cooldown = breath ? pulse(time, 1.72, 2.08, 2.2, 2.4) : 0;
    const coiling = whip
      ? time < 0.6
        ? smooth(time / 0.6)
        : time < 1
          ? lerp(1, -1.35, smooth((time - 0.6) / 0.4))
          : lerp(-1.35, 0, smooth((time - 1) / 1))
      : 0;
    const rootRotation = [0, whip ? -coiling * 6 : 0, 0],
      rootPosition = [
        0,
        -0.8 +
          (walk ? 0.17 * Math.cos(phase * 2) : mode === 'idle' ? 0.12 * Math.sin(phase) : 0) -
          anticipation * 1.5 +
          air * 5 -
          hit * 1.3,
        -lunge * (slam ? 5 : 7) + anticipation * 1.1,
      ];
    const values = [
      [root, 'position', rootPosition],
      [root, 'rotation', rootRotation],
      [neck, 'rotation', [anticipation * 8 - lunge * 9 + inhale * 3, 0, 0]],
      [
        upperNeck,
        'rotation',
        [anticipation * 5 - lunge * 7 + inhale * 4, whip ? coiling * 4 : 0, 0],
      ],
      [
        head,
        'rotation',
        [
          anticipation * 5 - lunge * 8 + inhale * 6 + (mode === 'idle' ? Math.sin(phase) * 0.7 : 0),
          whip ? -coiling * 7 : 0,
          0,
        ],
      ],
      [
        jaw,
        'rotation',
        [
          bite
            ? -34 * pulse(time, 0.4, 0.62, 0.72, 1.1)
            : breath
              ? -28 * pulse(time, 0.25, 0.72, 1.78, 2.4)
              : slam
                ? -12 * hit
                : 0,
          0,
          0,
        ],
      ],
      [fire, 'scale', [1 + flame * 1099, 1 + flame * 1099, 1 + flame * 1099]],
      [smoke, 'scale', [1 + cooldown * 899, 1 + cooldown * 899, 1 + cooldown * 899]],
      [
        charge,
        'scale',
        [1 + (inhale + flame) * 650, 1 + (inhale + flame) * 650, 1 + (inhale + flame) * 650],
      ],
    ];
    for (const wing of wings) {
      const rise = slam
        ? 22 * anticipation - 24 * hit
        : mode === 'idle'
          ? Math.sin(phase - 0.3) * 1.5
          : bite
            ? air * 12
            : breath
              ? inhale * 5
              : walk
                ? Math.sin(phase) * 1
                : 0;
      values.push(
        [wing.upper, 'rotation', [0, whip ? wing.s * Math.abs(coiling) * 7 : 0, wing.s * rise]],
        [
          wing.fan,
          'rotation',
          [
            slam ? hit * 7 : 0,
            wing.s * (walk ? 2 * Math.cos(phase - 0.3) : slam ? anticipation * 5 : 0),
            0,
          ],
        ],
      );
    }
    for (const [i, id] of tail.entries()) {
      const delayed = time - i * 0.028;
      const c = whip
        ? delayed < 0.6
          ? smooth(delayed / 0.6)
          : delayed < 1
            ? lerp(1, -1.35, smooth((delayed - 0.6) / 0.4))
            : lerp(-1.35, 0, smooth((delayed - 1) / Math.max(0.1, 1 - i * 0.028)))
        : 0;
      values.push([
        id,
        'rotation',
        [
          slam ? -air * 2 + hit * 0.8 : bite ? -air : 0,
          whip
            ? -c * (5.2 + i * 0.2)
            : mode === 'idle' || walk
              ? Math.sin(phase - i * 0.27) * 0.65
              : 0,
          0,
        ],
      ]);
    }
    const contacts = [];
    for (const leg of legs) {
      let lift = air * (leg.kind === 'front' ? 3.1 : 2),
        z = 0;
      if (walk) {
        const offset = (leg.kind === 'front' ? leg.s < 0 : leg.s > 0) ? 0 : 0.5,
          p = (time / 1.2 + offset) % 1;
        if (p < 0.6) z = lerp(-2.05, 2.05, p / 0.6);
        else {
          const u = (p - 0.6) / 0.4;
          z = lerp(2.05, -2.05, smooth(u));
          lift = Math.sin(u * Math.PI) * (leg.kind === 'front' ? 1.7 : 1.25);
        }
      }
      const target = [
        leg.target[0],
        leg.target[1] + lift,
        leg.target[2] + z - lunge * (slam ? 5 : 7) * (bite ? lerp(0.7, 1, air) : 1),
      ];
      target[1] += air * Math.max(0, rootPosition[1] + 0.8);
      const local = inverseRotateVector(
          target.map((v, i) => v - rootPosition[i]),
          rootRotation,
        ),
        pole = [
          leg.root[0] + leg.s * 2,
          leg.root[1] - leg.lengths[0],
          leg.root[2] + (leg.kind === 'front' ? 6 : -7),
        ];
      const ik = solveTwoBone(leg.root, local, pole, ...leg.lengths);
      values.push(
        [leg.upper, 'rotation', ik.upper],
        [leg.lower, 'rotation', ik.lower],
        [leg.foot, 'rotation', relativeRotation([0, 0, 0], [rootRotation, ik.upper, ik.lower])],
      );
      contacts.push({
        foot: leg.foot,
        target,
        planted: lift < 1e-8 && air < 1e-8,
        clamped: ik.clamped,
      });
    }
    return { values, contacts };
  };
  for (const [id, length, loop] of [
    ['idle', 3, true],
    ['walk', 1.2, true],
    ['bite_lunge', 1.6, false],
    ['tail_whip', 2, false],
    ['fire_breath', 2.4, false],
    ['wing_slam', 1.8, false],
  ]) {
    const fps = ['bite_lunge', 'wing_slam'].includes(id) ? 36 : id === 'walk' ? 30 : 24;
    const frames = Math.ceil(length * fps),
      times = Array.from({ length: frames + 1 }, (_, i) => (length * i) / frames);
    if (id === 'walk') times.push(0.12, 0.6, 0.72);
    if (id === 'bite_lunge') times.push(0.28, 0.4, 0.48, 0.62, 0.65, 0.72, 0.83, 0.9, 1.1);
    if (id === 'wing_slam')
      times.push(0.27, 0.33, 0.34, 0.38, 0.58, 0.63, 0.66, 0.72, 0.9, 1.02, 1.3);
    const tracks = new Map();
    for (const time of [...new Set(times)].sort((a, b) => a - b))
      for (const [group, channel, v] of evaluate(time, id).values) {
        const key = group + ':' + channel;
        if (!tracks.has(key)) tracks.set(key, { group, channel, keyframes: [] });
        const track = tracks.get(key),
          previous = track.keyframes.at(-1),
          value = v.map(
            (n, i) =>
              Math.round(
                (channel === 'rotation' && previous
                  ? n + Math.round((previous.value[i] - n) / 360) * 360
                  : n) * 1e7,
              ) / 1e7,
          );
        track.keyframes.push({ time, value, interpolation: 'linear' });
      }
    for (const track of tracks.values())
      if (track.keyframes.every((k) => k.value.every((n, i) => n === track.keyframes[0].value[i])))
        track.keyframes = [track.keyframes[0], track.keyframes.at(-1)];
    model.animations.push({ id, name: id, length, loop, tracks: [...tracks.values()] });
  }
  const bind = evaluate(0, 'idle').values,
    groups = new Map(model.groups.map((g) => [g.id, g]));
  for (const [id, channel, value] of bind) {
    if (channel === 'rotation') {
      const group = groups.get(id);
      group.rotation = group.rotation.map((v, i) => v + value[i]);
      for (const a of model.animations)
        for (const t of a.tracks.filter((t) => t.group === id && t.channel === channel))
          for (const k of t.keyframes)
            k.value = k.value.map((n, i) => Math.round((n - value[i]) * 1e7) / 1e7);
    } else if (channel === 'position' && id === root) {
      for (const g of model.groups) g.origin = g.origin.map((n, i) => n + value[i]);
      for (const c of model.cubes)
        for (const key of ['from', 'to', 'origin']) c[key] = c[key].map((n, i) => n + value[i]);
      for (const leg of legs) leg.ankle = leg.ankle.map((n, i) => n + value[i]);
      for (const a of model.animations)
        for (const t of a.tracks.filter((t) => t.group === root && t.channel === 'position'))
          for (const k of t.keyframes)
            k.value = k.value.map((n, i) => Math.round((n - value[i]) * 1e7) / 1e7);
    }
  }
  const result = canonical(model);
  return {
    model: result,
    layout,
    evaluate,
    rig: { root, body, chest, neck, upperNeck, head, jaw, fire, smoke, charge, legs, wings, tail },
  };
}

export async function writeDragon(out, { quick = false } = {}) {
  await mkdir(out, { recursive: true });
  const { model, layout, rig } = createDragon();
  assert.deepEqual(validate(model), []);
  assert.deepEqual(analyzeQuality(model).issues, []);
  const native = exportBBModel(model),
    bytes = JSON.stringify(native, null, 2) + '\n';
  assert.equal(serialize(importBBModel(native)), serialize(model));
  await writeFile(resolve(out, 'obsidian_crimson_dragon.bbmodel'), bytes);
  await writeFile(resolve(out, 'obsidian_crimson_dragon.bbir.json'), serialize(model));
  await writeFile(
    resolve(out, 'obsidian_crimson_dragon_atlas.png'),
    encodePNG({ ...model.textures[0], pixels: Uint8Array.from(model.textures[0].pixels) }),
  );
  await writeFile(resolve(out, 'atlas-layout.json'), JSON.stringify(layout, null, 2) + '\n');
  await writeFile(resolve(out, 'rig.json'), JSON.stringify(rig, null, 2) + '\n');
  for (const view of ['front', 'back', 'left', 'right', 'top', 'isometric'])
    await writeFile(
      resolve(out, `dragon_${view}.png`),
      renderPNG(model, { width: 1024, height: 1024, view, background: '#edeae6ff' }),
    );
  if (!quick)
    for (const a of model.animations) {
      await writeFile(
        resolve(out, a.id + '.gif'),
        renderGIF(model, {
          animation: a.id,
          width: 384,
          height: 384,
          fps: 12,
          view: 'isometric',
          background: '#edeae6ff',
        }),
      );
      if (a.loop) continue;
      const times =
        a.id === 'bite_lunge'
          ? [0.25, 0.42, 0.67, 1.45]
          : a.id === 'tail_whip'
            ? [0, 0.55, 0.96, 1.95]
            : a.id === 'fire_breath'
              ? [0.4, 0.72, 1.15, 2.14]
              : [0.26, 0.59, 0.94, 1.7];
      const framing = animationFraming(model, a.id, times, 'isometric'),
        pixels = new Uint8Array(1536 * 384 * 4);
      for (const [i, time] of times.entries()) {
        const frame = renderPixels(model, {
          width: 384,
          height: 384,
          animation: a.id,
          time,
          framing,
          background: '#edeae6ff',
        });
        for (let y = 0; y < 384; y++)
          pixels.set(
            frame.pixels.subarray(y * 384 * 4, (y + 1) * 384 * 4),
            (y * 1536 + i * 384) * 4,
          );
      }
      await writeFile(
        resolve(out, a.id + '_storyboard.png'),
        encodePNG({ width: 1536, height: 384, pixels }),
      );
    }
  const report = {
    ...inspect(model),
    textureRegions: layout.length,
    keyframes: model.animations.reduce(
      (n, a) => n + a.tracks.reduce((v, t) => v + t.keyframes.length, 0),
      0,
    ),
    quality: analyzeQuality(model),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  await writeFile(resolve(out, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await writeDragon(resolve(process.argv[2] ?? 'dist/showcase/dragon'), {
    quick: process.argv.includes('--quick'),
  });
