import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import {
  PixelAtlas,
  solveTwoBone,
  inverseRotateVector,
  rotate,
  FACE_NAMES,
  canonical,
  validate,
  geometry,
  inspect,
  serialize,
  exportBBModel,
  importBBModel,
  renderPNG,
  renderGIF,
  animationFraming,
  sampleAnimation,
  analyzeQuality,
} from '../packages/core/dist/index.js';

const rgb = (s) => s.match(/../g).map((v) => parseInt(v, 16));
const colors = {
  steel: ['40566e', '8ea9ba', 'e0e9e9'],
  edge: ['6c8798', 'bccdd5', 'eff6ef'],
  dark: ['0e1926', '283d4e', '647c8a'],
  gold: ['644226', 'c49448', 'f5d899'],
  cloth: ['350d20', '921d3b', 'd74656'],
  crest: ['430820', 'ab233e', 'e75b68'],
  leather: ['160f19', '38232f', '705145'],
};
const noise = (x, y, seed) => {
  let n = Math.imul(x + seed, 374761393) ^ Math.imul(y + 31, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n >>> 0) / 4294967296;
};
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => a.map((n, i) => Math.round(lerp(n, b[i], t)));

export function createPaladin() {
  const atlas = new PixelAtlas(512, 512),
    layout = [];
  const model = {
    version: 2,
    name: 'Crimson Paladin',
    format: 'free',
    resolution: [512, 512],
    cubes: [],
    groups: [],
    textures: [],
    animations: [],
  };
  const G = (id, origin, parent, rotation = [0, 0, 0]) => {
    model.groups.push({
      id,
      name: id.split('/').at(-1).replaceAll('_', ' '),
      origin,
      rotation,
      ...(parent ? { parent } : {}),
    });
    return id;
  };
  let piece = 0;
  const paint = (material, detail, seed) => (x, y, w, h) => {
    const [shade, base, light] = colors[material].map(rgb),
      u = x / Math.max(1, w - 1),
      v = y / Math.max(1, h - 1);
    let c = mix(shade, base, 0.5 + 0.34 * (1 - v) + 0.13 * (1 - u));
    if (material === 'cloth') {
      const fold = 0.5 + 0.5 * Math.cos(u * Math.PI * 4 + seed * 0.13);
      c = mix(shade, base, 0.5 + 0.42 * fold);
      if (detail === 'cape') {
        const dx = Math.abs(u - 0.5),
          dy = v;
        const glyph =
          (dy > 0.22 && dy < 0.7 && dx < 0.035) ||
          (dy > 0.25 && dy < 0.45 && Math.abs(dx - (0.45 - dy) * 0.7) < 0.025) ||
          (dy > 0.67 && dy < 0.77 && dx < (0.8 - dy) * 0.55);
        if (glyph) c = rgb('d7af66');
        if ((x === 4 || x === w - 5) && y > 3 && y < h - 4) c = rgb('bb824c');
      }
    } else if (material === 'crest') {
      c = mix(shade, base, 0.72 + 0.23 * (1 - u) + 0.03 * noise(x, y, seed));
    } else if (material === 'leather' || material === 'dark') {
      c = mix(shade, base, 0.75 + noise(x, y, seed) * 0.12);
      if (material === 'leather' && y % 7 === 0 && x > 2 && x < w - 3) c = mix(base, light, 0.2);
    } else {
      // Top/left light, lower bevel shadow. Avoid a white frame on every surface.
      if (y === 0) c = mix(base, light, 0.65);
      if (y === h - 1) c = shade;
      if (x === 0) c = mix(base, light, 0.22);
      if (x === w - 1) c = mix(shade, base, 0.48);
      if (x > 2 && x < w - 3 && y > 3 && y < h - 3 && noise(x >> 1, y >> 1, seed) > 0.989)
        c = mix(base, light, 0.5);
      if (detail === 'engraving') {
        const dx = Math.abs(u - 0.5);
        if (Math.abs(v - (0.3 + dx * 0.65)) < 0.013 || Math.abs(v - (0.63 - dx * 0.3)) < 0.015)
          c = rgb('b7a481');
        if (dx < 0.018 && v > 0.25 && v < 0.78) c = mix(base, light, 0.65);
      }
      if (detail === 'visor') {
        const slit = v > 0.29 && v < 0.41 && u > 0.1 && u < 0.9;
        if (slit) c = rgb('0a1220');
        if (v > 0.28 && v < 0.3 && u > 0.12 && u < 0.88) c = rgb('eddaa0');
        if (v > 0.31 && v < 0.36 && ((u > 0.15 && u < 0.33) || (u > 0.67 && u < 0.85)))
          c = rgb('dba65a');
        if (v > 0.61 && v < 0.82 && x % 6 < 2 && u > 0.2 && u < 0.8) c = rgb('293843');
      }
    }
    return [...c, 255];
  };
  const C = (
    parent,
    name,
    center,
    size,
    material = 'steel',
    rotation = [0, 0, 0],
    detail,
    origin = center,
  ) => {
    const id = parent + '/' + name,
      faces = {};
    const sizes = {
      north: [size[0], size[1]],
      south: [size[0], size[1]],
      east: [size[2], size[1]],
      west: [size[2], size[1]],
      up: [size[0], size[2]],
      down: [size[0], size[2]],
    };
    // Unique face regions, physical dimensions and padding: no square swatch stretching.
    for (const face of FACE_NAMES) {
      const density = face === 'north' || (detail === 'cape' && face === 'south') ? 6 : 3;
      const [w, h] = sizes[face].map((v) => Math.max(2, Math.ceil(v * density)));
      const region = atlas.allocate(
        id + '/' + face,
        w,
        h,
        paint(
          material,
          (face === 'north' && detail !== 'cape') || (face === 'south' && detail === 'cape')
            ? detail
            : undefined,
          piece,
        ),
      );
      faces[face] = { texture: 'paladin_atlas', uv: region.uv };
      layout.push({ node: id, face, material, ...region });
    }
    model.cubes.push({
      id,
      name: name.replaceAll('_', ' '),
      parent,
      from: center.map((n, i) => n - size[i] / 2),
      to: center.map((n, i) => n + size[i] / 2),
      origin,
      rotation,
      color: 0,
      faces,
    });
    piece++;
  };
  const root = G('paladin', [0, 0, 0]);
  const hips = G(root + '/hips', [0, 15.3, 0], root);
  const torso = G(hips + '/torso', [0, 18, 0], hips);
  const head = G(torso + '/head', [0, 28.6, 0], torso);
  const crest = G(head + '/crest', [0, 35, 0.5], head);
  const cape = G(torso + '/cape', [0, 27.8, 2.3], torso);
  const hem = G(cape + '/hem', [0, 19, 3.86], cape);
  C(hips, 'padded_waist', [0, 17.1, 0.1], [6.6, 4.9, 4.1], 'leather');
  C(hips, 'belt', [0, 18.05, 0], [6.8, 0.9, 4.65], 'dark');
  C(hips, 'buckle', [0, 18.05, -2.48], [1.5, 1.3, 0.55], 'gold', [0, 0, 0], 'engraving');
  C(torso, 'cuirass_core', [0, 22.7, 0.15], [7, 7.9, 4.45]);
  C(torso, 'breast_ridge', [0, 24.3, -2.35], [0.55, 5.5, 0.6], 'edge');
  for (const s of [-1, 1]) {
    C(
      torso,
      `breast_plane_${s}`,
      [s * 1.8, 24.05, -2.35],
      [3.5, 5.2, 0.9],
      'steel',
      [0, s * -14, s * 3],
      'engraving',
    );
    C(torso, `rib_plane_${s}`, [s * 3.5, 22.65, -0.15], [1.15, 6, 3.65], 'steel', [0, 0, s * 8]);
    C(torso, `collar_${s}`, [s * 1.8, 27.9, 0.1], [3.5, 0.75, 4.9], 'gold', [0, 0, s * 9]);
    C(torso, `cape_pin_${s}`, [s * 3.4, 27.45, -2.25], [0.95, 1.2, 0.55], 'gold', [0, 0, s * 15]);
    for (let i = 0; i < 3; i++)
      C(
        hips,
        `hip_lame_${s}_${i}`,
        [s * 2.4, 17 - i * 1.05, -0.2],
        [2.5, 1.35, 4.6 + i * 0.25],
        'steel',
        [0, 0, s * 11],
      );
  }
  C(hips, 'red_tabard', [0, 14.65, -2.5], [1.8, 5.1, 0.3], 'cloth');
  C(hips, 'tabard_hem', [0, 12.2, -2.55], [1.85, 0.4, 0.4], 'gold');
  C(head, 'neck', [0, 28.7, 0], [2.7, 2.1, 2.8], 'dark');
  C(head, 'helmet_shadow', [0, 31.6, 0], [5.75, 5.25, 4.8], 'dark');
  C(head, 'visor', [0, 31.25, -2.55], [5.15, 4.7, 0.55], 'steel', [0, 0, 0], 'visor');
  C(head, 'brow', [0, 33.5, -2.62], [5.8, 0.65, 0.65], 'edge');
  C(head, 'nose_guard', [0, 31.2, -2.93], [0.38, 2.55, 0.36], 'gold');
  C(head, 'crown_flat', [0, 34.5, 0], [2.4, 0.65, 4.9]);
  for (const s of [-1, 1]) {
    C(head, `crown_slope_${s}`, [s * 2, 34.15, 0], [2.7, 0.65, 4.9], 'steel', [0, 0, s * -22]);
    C(head, `temple_${s}`, [s * 2.85, 31.85, 0.1], [0.95, 4.35, 4.55], 'steel', [0, 0, s * -5]);
    C(head, `cheek_plane_${s}`, [s * 2.4, 30.2, -2.2], [1.15, 2.45, 1.1], 'steel', [
      0,
      s * 22,
      s * -10,
    ]);
    C(head, `jaw_gold_${s}`, [s * 1.55, 29.1, -1.9], [3.05, 0.65, 2.05], 'gold', [
      0,
      s * 15,
      s * 9,
    ]);
    C(head, `hinge_${s}`, [s * 3.38, 32.4, -0.9], [0.28, 0.75, 0.75], 'gold');
  }
  C(head, 'nape', [0, 31.7, 2.28], [5.7, 4.3, 0.6], 'steel');
  for (const s of [-1, 1]) {
    // Curl outward as well as backward, so the frontal crest silhouette remains readable.
    const points = [
      [s * 0.85, 34.8, 0.5, 1.7],
      [s * 1.3, 37.3, 0.9, 1.75],
      [s * 2, 39.3, 1.8, 1.6],
      [s * 2.7, 40.4, 3.2, 1.35],
      [s * 3, 40.6, 4.8, 1.1],
      [s * 2.85, 39.8, 6.1, 0.8],
      [s * 2.5, 38.45, 6.8, 0.45],
    ];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1],
        dy = b[1] - a[1],
        dz = b[2] - a[2],
        dx = b[0] - a[0];
      C(
        crest,
        `plume_${s}_${i}`,
        [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
        [a[3], Math.hypot(dx, dy, dz) + 0.4, a[3] * 0.65],
        'crest',
        [
          (Math.atan2(dz, dy) * 180) / Math.PI,
          0,
          (-Math.atan2(dx, Math.hypot(dy, dz)) * 180) / Math.PI,
        ],
      );
    }
  }
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 1.48;
    C(cape, `cape_top_${i}`, [x, 23.45, 3.1 + Math.abs(i - 2) * 0.1], [1.7, 8.85, 0.38], 'cloth', [
      -10,
      (i - 2) * -7,
      0,
    ]);
    C(
      hem,
      `cape_bottom_${i}`,
      [x * 1.2, 14.7 + Math.abs(i - 2) * 0.22, 4.7],
      [1.95, 8.15 - Math.abs(i - 2) * 0.35, 0.35],
      'cloth',
      [-12, (i - 2) * -8, (i - 2) * -2.5],
    );
    C(
      hem,
      `cape_border_${i}`,
      [x * 1.2, 10.7 + Math.abs(i - 2) * 0.39, 5.54],
      [1.97, 0.28, 0.42],
      'gold',
      [-12, (i - 2) * -8, (i - 2) * -2.5],
    );
  }
  C(cape, 'cape_crest', [0, 23.1, 3.39], [2.7, 4.6, 0.15], 'cloth', [-10, 0, 0], 'cape');
  const legs = [],
    arms = [];
  const L1 = 6.4,
    L2 = 6.8,
    ankleY = 2.1,
    hipY = 15.3;
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'left' : 'right',
      x = s * 2.4;
    const thigh = G(`${hips}/${side}_leg`, [x, hipY, 0], hips);
    const shin = G(thigh + '/shin', [x, hipY - L1, 0], thigh);
    const foot = G(shin + '/foot', [x, ankleY, 0], shin);
    legs.push({ thigh, shin, foot, x });
    C(thigh, 'thigh_padding', [x, 12.4, 0], [2.6, 5.6, 2.8], 'leather');
    C(thigh, 'thigh_front', [x, 12, -1.25], [2.9, 4.8, 0.95], 'steel', [-3, 0, 0]);
    for (const t of [-1, 1])
      C(thigh, `thigh_bevel_${t}`, [x + t * 1.25, 12.1, -0.15], [0.65, 4.85, 2.7], 'steel', [
        0,
        t * 17,
        0,
      ]);
    C(shin, 'knee_joint', [x, 8.9, 0], [2.65, 1.35, 2.7], 'dark');
    C(shin, 'knee_cap', [x, 8.95, -1.75], [2.85, 1.65, 0.7], 'edge', [-12, 0, 0]);
    C(shin, 'calf_padding', [x, 5.3, 0.1], [2.4, 5.6, 2.45], 'leather');
    C(shin, 'greave_front', [x, 5.45, -1.2], [2.65, 5.15, 0.9], 'steel', [-2, 0, 0]);
    for (const t of [-1, 1])
      C(shin, `greave_bevel_${t}`, [x + t * 1.15, 5.5, -0.1], [0.65, 5.15, 2.45], 'steel', [
        0,
        t * 20,
        0,
      ]);
    C(shin, 'ankle_band', [x, 2.65, -0.1], [2.65, 0.55, 2.85], 'dark');
    C(foot, 'boot', [x, 1.3, -0.65], [2.85, 1.6, 3.75], 'dark');
    C(foot, 'toe_plate', [x, 1.25, -2.05], [2.95, 1.25, 2.2], 'steel', [-9, 0, 0]);
    C(foot, 'sole', [x, 0.225, -0.7], [3.05, 0.45, 4.05], 'leather');
    for (const c of model.cubes.filter((c) => c.parent === foot)) c.rotation[1] += s * 8;
    const shoulder = [s * 4.75, 26.5, 0],
      upper = G(`${torso}/${side}_arm`, shoulder, torso);
    const forearm = G(upper + '/forearm', [shoulder[0], 21.7, 0], upper);
    const hand = G(forearm + '/hand', [shoulder[0], 17.1, 0], forearm);
    arms.push({ upper, forearm, hand, shoulder, s });
    C(upper, 'arm_padding', [s * 4.75, 24.2, 0], [2.35, 4.75, 2.65], 'leather');
    C(upper, 'shoulder_top', [s * 4.6, 27.3, 0], [3.25, 1.1, 4.3], 'steel', [0, 0, s * 14]);
    C(upper, 'shoulder_front', [s * 4.7, 26.8, -1.75], [3.2, 1.9, 0.6], 'steel', [24, 0, s * 14]);
    C(upper, 'shoulder_back', [s * 4.7, 26.8, 1.75], [3.2, 1.9, 0.6], 'steel', [-24, 0, s * 14]);
    C(upper, 'shoulder_outer', [s * 6, 26.55, 0], [0.7, 2.2, 3.7], 'edge', [0, 0, s * 25]);
    C(upper, 'rerebrace', [s * 4.75, 23.7, -0.1], [2.7, 2.9, 3]);
    C(forearm, 'elbow', [s * 4.75, 21.7, 0], [2.3, 1.35, 2.6], 'dark');
    C(forearm, 'arm_lower', [s * 4.75, 19.35, 0], [2.1, 4.4, 2.4], 'leather');
    C(forearm, 'vambrace', [s * 4.75, 19.35, -0.1], [2.55, 3.3, 2.85], 'steel');
    C(forearm, 'cuff', [s * 4.75, 17.85, -0.1], [2.65, 0.5, 2.95], 'gold');
    C(hand, 'palm', [s * 4.75, 16.65, -0.05], [1.8, 1.5, 1.9], 'leather');
    C(hand, 'hand_plate', [s * 4.75, 16.6, -1.05], [1.75, 1.15, 0.4], 'steel');
    for (let i = 0; i < 3; i++)
      C(hand, `finger_${i}`, [s * 4.75 + (i - 1) * 0.55, 16, -0.45], [0.45, 0.7, 1.15], 'dark');
  }
  const weapon = G(root + '/halberd', [7.3, 17.1, -1.8], root, [0, 0, -8]);
  C(weapon, 'shaft', [7.3, 20.9, -1.8], [0.65, 32, 0.65], 'dark');
  for (let i = 0; i < 8; i++)
    C(weapon, `grip_${i}`, [7.3, 16 + i * 0.38, -1.8], [0.8, 0.17, 0.8], 'leather');
  for (const y of [5.3, 29.4, 31.5])
    C(weapon, 'collar_' + y, [7.3, y, -1.8], [1.15, 0.55, 1.15], 'gold');
  C(weapon, 'socket', [7.3, 33.3, -1.8], [1.4, 3.55, 1.25], 'dark');
  C(weapon, 'crest', [7.3, 33.3, -2.51], [1.55, 2.65, 0.22], 'gold', [0, 0, 0], 'engraving');
  C(weapon, 'red_inset', [7.3, 33.3, -2.66], [0.55, 1.5, 0.15], 'cloth', [0, 0, 45]);
  C(weapon, 'spike', [7.3, 36.4, -1.8], [0.58, 2.8, 0.58], 'edge');
  for (const s of [-1, 1]) {
    C(weapon, `blade_inner_${s}`, [7.3 + s * 1.5, 33.3, -1.8], [2.5, 1.65, 0.65], 'steel', [
      0,
      0,
      s * 5,
    ]);
    C(weapon, `blade_body_${s}`, [7.3 + s * 2.75, 33.3, -1.8], [1.8, 3.8, 0.7], 'steel', [
      0,
      0,
      s * -8,
    ]);
    C(weapon, `blade_edge_${s}`, [7.3 + s * 3.4, 33.3, -1.8], [0.45, 4.65, 0.75], 'edge', [
      0,
      0,
      s * -8,
    ]);
    C(weapon, `upper_hook_${s}`, [7.3 + s * 2.9, 35.8, -1.8], [0.7, 2.5, 0.7], 'edge', [
      0,
      0,
      s * 35,
    ]);
    C(weapon, `lower_hook_${s}`, [7.3 + s * 3.1, 30.8, -1.8], [0.7, 2.5, 0.7], 'edge', [
      0,
      0,
      s * -30,
    ]);
  }
  model.textures = [atlas.texture('paladin_atlas', 'crimson_paladin_atlas.png')];

  // Move the grip into the reachable envelope and seat the helmet in its collar.
  for (const c of model.cubes.filter((c) => c.parent === weapon))
    for (const key of ['from', 'to', 'origin']) c[key] = c[key].map((n, i) => n + [-1, 1, 0.6][i]);
  model.groups.find((g) => g.id === weapon).origin = [6.3, 18.1, -1.2];
  for (const g of model.groups.filter((g) => g.id === head || g.id.startsWith(head + '/')))
    g.origin = g.origin.map((n, i) => n - (i === 1 ? 0.4 : 0));
  for (const c of model.cubes.filter((c) => c.parent === head || c.parent.startsWith(head + '/')))
    for (const key of ['from', 'to', 'origin'])
      c[key] = c[key].map((n, i) => n - (i === 1 ? 0.4 : 0));

  // Solve rest poses and bake phase-controlled motion to interoperable numeric tracks.
  const localGroups = new Map(model.groups.map((g) => [g.id, g]));
  const addAnimation = (id, length, loop, evaluate) => {
    const tracks = new Map(),
      frames = Math.round(length * 48);
    const times = Array.from({ length: frames + 1 }, (_, frame) => frame / 48);
    // Exact toe-off keys prevent interpolation across a contact/swing boundary.
    if (id === 'walk') times.push(0.1, 0.6);
    times.sort((a, b) => a - b);
    for (const time of times) {
      const values = evaluate(time);
      for (const [group, channel, value] of values) {
        const key = group + ':' + channel;
        if (!tracks.has(key)) tracks.set(key, { group, channel, keyframes: [] });
        tracks.get(key).keyframes.push({
          time,
          value: value.map((n) => Math.round(n * 1e7) / 1e7),
          interpolation: 'linear',
        });
      }
    }
    model.animations.push({ id, name: id, length, loop, tracks: [...tracks.values()] });
  };
  const armPose = (a, target, torsoRotation, torsoPosition) => {
    const relative = inverseRotateVector(
      target.map((n, i) => n - torsoPosition[i] - [0, 18, 0][i]),
      torsoRotation,
    ).map((n, i) => n + [0, 18, 0][i]);
    const ik = solveTwoBone(a.shoulder, relative, [a.shoulder[0] + a.s * 4, 22, -7], 4.8, 4.6);
    return {
      ik,
      values: [
        [a.upper, 'rotation', ik.upper],
        [a.forearm, 'rotation', ik.lower],
      ],
    };
  };
  const evaluate = (time, mode) => {
    const walking = mode === 'walk',
      attack = mode === 'attack';
    const phase = (time / (walking ? 1 : 4)) * Math.PI * 2;
    const envelope = attack
      ? time < 0.5
        ? smooth(time / 0.5)
        : time < 0.75
          ? lerp(1, -0.18, smooth((time - 0.5) / 0.25))
          : lerp(-0.18, 0, smooth((time - 0.75) / 0.75))
      : 0;
    const pelvisY = walking ? -0.2 + 0.08 * Math.cos(phase * 2) : -0.12 + 0.045 * Math.sin(phase);
    const torsoRotation = [
      attack ? envelope * -7 : walking ? 1 : 0,
      attack ? envelope * -24 : walking ? Math.sin(phase) * 3 : Math.sin(phase) * 1.1,
      0,
    ];
    const torsoPosition = [0, pelvisY, 0];
    const weaponPosition = [
      attack ? envelope * -5 : 0,
      attack ? envelope * 1.4 : Math.sin(phase) * 0.05,
      attack ? envelope * 1.2 : 0,
    ];
    const weaponRotation = [
      attack ? envelope * -55 : 0,
      attack ? envelope * 30 : 0,
      attack ? envelope * 28 : 0,
    ];
    const w = localGroups.get(weapon),
      worldWeaponRotation = w.rotation.map((n, i) => n + weaponRotation[i]);
    const rightTarget = rotate([6.3, 18.1, -1.2], w.origin, worldWeaponRotation).map(
      (n, i) => n + weaponPosition[i],
    );
    const leftRest = [-4.95, 18, -1.4 + (walking ? Math.sin(phase) * 1.1 : 0)];
    const leftGrip = rotate([6.3, 21.6, -1.2], w.origin, worldWeaponRotation).map(
      (n, i) => n + weaponPosition[i],
    );
    const grasp = smooth(Math.max(0, Math.min(1, (envelope - 0.3) / 0.6)));
    const leftTarget = leftRest.map((n, i) => lerp(n, leftGrip[i], grasp));
    const values = [
      [hips, 'position', torsoPosition],
      [torso, 'rotation', torsoRotation],
      [head, 'rotation', [attack ? envelope * 3 : 0, -torsoRotation[1] * 0.6, 0]],
      [weapon, 'position', weaponPosition],
      [weapon, 'rotation', weaponRotation],
      [
        cape,
        'rotation',
        [
          3 + (walking ? Math.cos(phase) * 3 : attack ? envelope * 9 : Math.sin(phase) * 1.3),
          0,
          Math.sin(phase) * 0.5,
        ],
      ],
      [
        hem,
        'rotation',
        [
          5 +
            (walking
              ? Math.cos(phase - 0.65) * 5
              : attack
                ? envelope * 15
                : Math.sin(phase - 0.65) * 2),
          0,
          Math.sin(phase - 0.65),
        ],
      ],
      [crest, 'rotation', [Math.sin(phase - 0.5) * (walking ? 2 : 1), 0, 0]],
    ];
    const handTargets = [];
    for (const [i, a] of arms.entries()) {
      const result = armPose(a, i ? rightTarget : leftTarget, torsoRotation, torsoPosition);
      values.push(...result.values);
      handTargets.push({
        side: i,
        target: i ? rightTarget : leftTarget,
        clamped: result.ik.clamped,
      });
    }
    const contacts = [];
    for (const [i, l] of legs.entries()) {
      let z = 0,
        lift = 0;
      if (walking) {
        const p = (time + (i ? 0.5 : 0)) % 1;
        if (p < 0.6) z = lerp(-1.35, 1.35, p / 0.6);
        else {
          const u = (p - 0.6) / 0.4;
          z = lerp(1.35, -1.35, smooth(u));
          lift = Math.sin(u * Math.PI) * 0.85;
        }
      }
      const target = [l.x, ankleY + lift - pelvisY, z];
      const ik = solveTwoBone([l.x, hipY, 0], target, [l.x, 9, -8], L1, L2);
      values.push([l.thigh, 'rotation', ik.upper], [l.shin, 'rotation', ik.lower]);
      // Cancel parent pitch for a level sole; rest yaw lives in the cuboid geometry.
      // Leg targets remain in the sagittal plane: both Z/Y rotations are zero.
      values.push([l.foot, 'rotation', [-ik.upper[0] - ik.lower[0], 0, 0]]);
      contacts.push({
        side: i,
        planted: lift < 1e-8,
        target: [l.x, ankleY + lift, z],
        clamped: ik.clamped,
      });
    }
    return { values, contacts, handTargets };
  };
  for (const [id, len, loop] of [
    ['idle', 4, true],
    ['walk', 1, true],
    ['attack', 1.5, false],
  ])
    addAnimation(id, len, loop, (t) => evaluate(t, id).values);
  // Store the solved idle pose in the native bind pose, then make keys relative to it.
  const bind = evaluate(0, 'idle').values;
  for (const [id, channel, value] of bind) {
    if (channel === 'rotation') {
      const g = localGroups.get(id);
      g.rotation = g.rotation.map((n, i) => n + value[i]);
      for (const a of model.animations)
        for (const t of a.tracks.filter((t) => t.group === id && t.channel === channel))
          for (const k of t.keyframes)
            k.value = k.value.map((n, i) => Math.round((n - value[i]) * 1e7) / 1e7);
    } else if (channel === 'position' && id === hips) {
      for (const g of model.groups.filter((g) => g.id === hips || g.id.startsWith(hips + '/')))
        g.origin = g.origin.map((n, i) => n + value[i]);
      for (const c of model.cubes.filter(
        (c) => c.parent === hips || c.parent.startsWith(hips + '/'),
      ))
        for (const key of ['from', 'to', 'origin']) c[key] = c[key].map((n, i) => n + value[i]);
      for (const a of model.animations)
        for (const t of a.tracks.filter((t) => t.group === id && t.channel === channel))
          for (const k of t.keyframes)
            k.value = k.value.map((n, i) => Math.round((n - value[i]) * 1e7) / 1e7);
    }
  }
  const result = canonical(model);
  return {
    model: result,
    layout,
    evaluate,
    rig: { hips, torso, head, weapon, legs, arms, L1, L2, ankleY, hipY },
  };
}

export async function writePaladin(out) {
  await mkdir(out, { recursive: true });
  const { model, layout, rig, evaluate } = createPaladin();
  assert.deepEqual(validate(model), []);
  assert.deepEqual(analyzeQuality(model).issues, []);
  const native = exportBBModel(model),
    bytes = JSON.stringify(native, null, 2) + '\n';
  assert.equal(serialize(importBBModel(native)), serialize(model));
  await writeFile(resolve(out, 'crimson_paladin.bbmodel'), bytes);
  await writeFile(resolve(out, 'crimson_paladin.bbir.json'), serialize(model));
  const atlas = model.textures[0];
  const { encodePNG } = await import('../packages/core/dist/index.js');
  await writeFile(
    resolve(out, atlas.name),
    encodePNG({ ...atlas, pixels: Uint8Array.from(atlas.pixels) }),
  );
  await writeFile(resolve(out, 'atlas-layout.json'), JSON.stringify(layout, null, 2) + '\n');
  // Static previews use the actual idle pose, including solved limb bends.
  for (const view of ['isometric', 'front', 'back', 'left', 'right', 'top'])
    await writeFile(
      resolve(out, `crimson_paladin_${view}.png`),
      renderPNG(model, { width: 1024, height: 1024, view, animation: 'idle', time: 0 }),
    );
  const diagnostics = [];
  for (const a of model.animations) {
    await mkdir(resolve(out, a.id), { recursive: true });
    await writeFile(
      resolve(out, a.id + '.gif'),
      renderGIF(model, { animation: a.id, width: 384, height: 384, fps: 12 }),
    );
    const framing = animationFraming(
      model,
      a.id,
      Array.from({ length: Math.round(a.length * 24) + 1 }, (_, i) => i / 24),
    );
    // Per-clip envelope fixes camera scale/center for every rendered frame.
    for (let i = 0; i < Math.round(a.length * 12); i++)
      await writeFile(
        resolve(out, a.id, String(i).padStart(3, '0') + '.png'),
        renderPNG(model, { width: 512, height: 512, animation: a.id, time: i / 12, framing }),
      );
    for (let i = 0; i <= Math.round(a.length * 48); i++) {
      const t = i / 48;
      diagnostics.push({
        animation: a.id,
        time: t,
        contacts: evaluate(t, a.id).contacts,
        handTargets: evaluate(t, a.id).handTargets,
      });
    }
    await writeFile(resolve(out, a.id, 'camera.json'), JSON.stringify(framing, null, 2) + '\n');
  }
  await writeFile(
    resolve(out, 'rig-targets.json'),
    JSON.stringify({ rig, samples: diagnostics }, null, 2) + '\n',
  );
  await writeFile(
    resolve(out, 'validation.json'),
    JSON.stringify(
      {
        ...inspect(model),
        quality: analyzeQuality(model),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify(inspect(model)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await writePaladin(resolve(process.argv[2] ?? 'dist/showcase/crimson_paladin'));
