import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import {
  FACE_NAMES,
  canonical,
  validate,
  exportBBModel,
  importBBModel,
  serialize,
  encodePNG,
  renderPNG,
  sampleAnimation,
  inspect,
  analyzeQuality,
  geometry,
} from '../packages/core/dist/index.js';

// Reproducible authoring fixture. No source returned by a provider is executed.
export function createSentinel() {
  const rgb = (s) => s.match(/../g).map((x) => parseInt(x, 16));
  const palettes = [
    ['344252', '71859c', 'd7e3ea'], // silver plate
    ['273140', '526073', '9dabbc'], // recessed steel
    ['73502d', 'c49749', 'ffe0a0'], // antique gold
    ['140f16', '36212a', '60404c'], // flexible leather
    ['430c22', '8f1737', 'd84058'], // crimson cloth
    ['200914', '58132a', 'a12b47'], // shadowed cloth
    ['131720', '272e3c', '4d5b70'], // pole and glove
    ['718092', 'bdcbd5', 'f3f6f7'], // honed edges
    ['391021', '9d2842', 'ee6b76'], // crest
    ['262d39', '758698', 'c7d7e1'], // ridged plate
    ['070b13', '101b29', '293849'], // visor
    ['4d301c', '876044', 'c39765'], // straps
    ['354557', '99a9b9', 'edf2f5'], // breastplate engraving
    ['330a1b', '941b3c', 'f0bd68'], // cape emblem
    ['17222f', '8398aa', 'e9d9ad'], // helmet mask
    ['330d1b', '83243c', 'e6bb67'], // weapon crest
  ].map((p) => p.map(rgb));
  const pixels = new Uint8Array(128 * 128 * 4);
  for (let t = 0; t < 16; t++)
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const [dark, base, light] = palettes[t];
        const edge = Math.min(x, y, 31 - x, 31 - y);
        let mix = Math.max(0, Math.min(1, 0.12 + (31 - y) / 120 + (31 - x) / 220));
        let color = base.map((v, i) => Math.round(v * (1 - mix) + light[i] * mix));
        if ([0, 1, 2, 7, 9, 12, 14, 15].includes(t)) {
          if (edge === 0) color = dark;
          else if (edge === 1 || (t === 9 && x % 8 === 1)) color = light;
          else if (edge === 2) color = base;
          // Sparse directional wear, not a repeated checker field.
          if ((x > 5 && x < 13 && y === 8) || (x > 23 && y === 24)) color = light;
        }
        if ([4, 5, 8, 13].includes(t)) {
          const fold = Math.abs(((x + 3) % 16) - 8) / 8;
          color = base.map((v, i) => Math.round(v * (0.64 + fold * 0.3) + light[i] * 0.09));
          if (y > 28) color = dark;
          if (t === 13 && (x === 2 || x === 29 || y === 2 || y === 27)) color = light;
        }
        if (t === 12) {
          const chevron = Math.abs(x - 15.5);
          if (Math.abs(y - (9 + chevron * 0.45)) < 1 || Math.abs(y - (22 - chevron * 0.4)) < 1)
            color = light;
          if (x === 15 || x === 16) color = base;
        }
        if (t === 13) {
          const dx = Math.abs(x - 15.5);
          const crest =
            (y > 8 && y < 22 && dx < 1.7) ||
            (y > 7 && y < 15 && Math.abs(dx - (15 - y) * 0.75) < 1.2) ||
            (y >= 20 && y <= 23 && dx < (24 - y) * 1.8);
          if (crest) color = light;
        }
        if (t === 14) {
          color = y > 11 && y < 16 && x > 3 && x < 28 ? palettes[10][0] : color;
          if (y === 11 && x > 4 && x < 27) color = light;
          if (x === 15 || x === 16) color = palettes[2][1];
          if (y > 20 && y < 26 && x % 4 === 1 && x > 7 && x < 25) color = dark;
        }
        if (t === 15 && Math.abs(x - 15.5) + Math.abs(y - 15.5) < 8) color = light;
        pixels.set([...color, 255], (((t >> 2) * 32 + y) * 128 + (t % 4) * 32 + x) * 4);
      }
  const model = {
    version: 2,
    name: 'Crimson Sentinel',
    format: 'free',
    resolution: [128, 128],
    cubes: [],
    groups: [],
    textures: [
      {
        id: 'sentinel_atlas',
        name: 'crimson_sentinel_atlas.png',
        width: 128,
        height: 128,
        pixels: [...pixels],
      },
    ],
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
  const tileUV = (tile) => [
    (tile % 4) * 32 + 1,
    (tile >> 2) * 32 + 1,
    (tile % 4) * 32 + 31,
    (tile >> 2) * 32 + 31,
  ];
  const C = (
    parent,
    name,
    center,
    size,
    tile,
    rotation = [0, 0, 0],
    origin = center,
    faceTiles = {},
  ) => {
    model.cubes.push({
      id: `${parent}/${name}`,
      name: name.replaceAll('_', ' '),
      parent,
      from: center.map((v, i) => v - size[i] / 2),
      to: center.map((v, i) => v + size[i] / 2),
      origin,
      rotation,
      color: 0,
      faces: Object.fromEntries(
        FACE_NAMES.map((f) => [f, { texture: 'sentinel_atlas', uv: tileUV(faceTiles[f] ?? tile) }]),
      ),
    });
  };
  const root = G('sentinel', [0, 0, 0]);
  const body = G(`${root}/body`, [0, 19, 0], root);
  const head = G(`${body}/helmet`, [0, 33.1, 0], body);
  const crest = G(`${head}/crest`, [0, 39.5, 0.6], head);
  const cape = G(`${body}/cape`, [0, 31, 2.5], body, [7, 0, 0]);
  const lowerCape = G(`${cape}/hem`, [0, 22, 4.6], cape, [7, 0, 0]);
  // Waist/chest taper is sculpted in large planes before seams and trim.
  C(body, 'undercoat', [0, 25, 0], [7.2, 10, 4.4], 3);
  C(body, 'waist', [0, 20.2, 0], [6.9, 3.1, 4.8], 1);
  C(body, 'lower_cuirass', [0, 23.6, -0.2], [7.5, 4.3, 5.2], 0);
  C(body, 'upper_cuirass', [0, 28, -0.1], [9.1, 4.7, 5.8], 0, [0, 0, 0], undefined, { north: 12 });
  C(body, 'central_ridge', [0, 27, -3.08], [0.6, 6, 0.35], 7);
  for (const s of [-1, 1]) {
    C(body, `breast_bevel_${s}`, [s * 4, 27.4, -2.9], [1.1, 5.3, 1.3], 0, [0, s * 24, s * -6]);
    C(body, `gorget_${s}`, [s * 2.3, 31, -0.1], [4.6, 0.9, 5], 2, [0, 0, s * 10]);
    C(body, `belt_${s}`, [s * 2.2, 20.3, -2.65], [3.4, 1.05, 0.5], 6);
    C(body, `cape_clasp_${s}`, [s * 3.4, 30.6, -3], [1.3, 1.3, 0.55], 2, [0, 0, 45]);
    for (let i = 0; i < 3; i++)
      C(body, `fauld_${s}_${i}`, [s * 2.8, 19 - i * 1.25, -0.2], [2.9, 1.65, 5.5 + i * 0.3], 0, [
        0,
        0,
        s * (10 + i * 2),
      ]);
  }
  C(body, 'belt_buckle', [0, 20.3, -3.02], [1.6, 1.35, 0.65], 2);
  C(body, 'tabard', [0, 16.6, -3.15], [2.3, 5.4, 0.45], 4, [5, 0, 0]);
  C(body, 'tabard_border', [0, 14.1, -3.45], [2.5, 0.5, 0.45], 2);
  C(head, 'neck', [0, 32.4, 0], [3.4, 2.8, 3.4], 3);
  C(head, 'helmet_core', [0, 36.2, 0], [6.7, 6.6, 5.8], 1);
  C(head, 'faceplate', [0, 35.5, -3.1], [5.5, 4.8, 0.65], 0, [0, 0, 0], undefined, { north: 14 });
  C(head, 'brow', [0, 38, -3.12], [6.5, 0.85, 0.85], 7);
  C(head, 'visor_recess', [0, 36.8, -3.46], [5.4, 0.65, 0.25], 10);
  for (const s of [-1, 1]) {
    C(head, `visor_eye_${s}`, [s * 1.45, 36.8, -3.61], [1.55, 0.18, 0.18], 2);
    C(head, `cheek_${s}`, [s * 2.9, 35.1, -2.52], [1.05, 3.8, 1.7], 0, [0, s * 22, s * 7]);
    C(head, `temple_${s}`, [s * 3.25, 36.7, 0.15], [1.15, 4.8, 5.6], 0, [0, 0, s * 8]);
    C(head, `jaw_trim_${s}`, [s * 2.3, 33.65, -1.1], [1.2, 0.55, 4.1], 2, [0, 0, s * -10]);
    C(head, `helmet_bevel_${s}`, [s * 2.2, 39, 0], [2.5, 1.3, 5.6], 0, [0, 0, s * 18]);
    C(head, `temple_rivet_${s}`, [s * 3.92, 37.7, -1.4], [0.28, 0.55, 0.55], 2);
  }
  C(head, 'crown_ridge', [0, 39.5, 0], [1.25, 0.9, 5.7], 7);
  C(head, 'nasal_guard', [0, 35.5, -3.75], [0.48, 3, 0.38], 2);
  // Swept, bifurcated red plume: taper along a curved chain, not a rectangular fin.
  for (const s of [-1, 1]) {
    const path = [
      [39.8, 0.6, 1.8],
      [42, 1.2, 1.65],
      [44, 2.2, 1.4],
      [45.5, 3.7, 1.15],
      [45.9, 5.7, 0.95],
      [45.1, 7.5, 0.7],
      [43.6, 8.9, 0.4],
    ];
    for (let i = 0; i < path.length - 1; i++) {
      const [a, b] = [path[i], path[i + 1]],
        dy = b[0] - a[0],
        dz = b[1] - a[1];
      C(
        crest,
        `plume_${s}_${i}`,
        [s * (1.05 + i * 0.1), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        [a[2], Math.hypot(dy, dz) + 0.35, a[2] * 0.75],
        8,
        [(Math.atan2(dz, dy) * 180) / Math.PI, 0, s * -3],
      );
    }
  }
  // Cape folds alternate planes; the lower panels belong to an independent bone.
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 1.65;
    C(
      cape,
      `upper_fold_${i}`,
      [x, 26.6, 3.4 + Math.abs(i - 2) * 0.15],
      [1.85, 9.2, 0.65],
      i % 2 === 0 ? 4 : 5,
      [0, (i - 2) * -7, 0],
    );
    C(
      lowerCape,
      `lower_fold_${i}`,
      [x * 1.25, 18.6 + (i % 2) * 0.45, 5.1],
      [2.15, 8.6 - (i % 2) * 0.9, 0.6],
      i % 2 === 0 ? 4 : 5,
      [0, (i - 2) * -9, (i - 2) * -3],
    );
    C(lowerCape, `hem_trim_${i}`, [x * 1.25, 14.5 + (i % 2) * 0.9, 5.25], [2.2, 0.4, 0.55], 2, [
      0,
      (i - 2) * -9,
      (i - 2) * -3,
    ]);
  }
  C(cape, 'woven_emblem', [0, 26.2, 3.86], [3.4, 5.6, 0.18], 4, [0, 0, 0], undefined, {
    south: 13,
  });
  const legs = [],
    arms = [];
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'left' : 'right';
    const leg = G(`${root}/${side}_thigh`, [s * 2.55, 18, 0], root, [0, s * 7, s * 4]);
    const shin = G(`${leg}/shin`, [s * 2.55, 9.3, 0], leg);
    legs.push({ leg, shin });
    C(leg, 'joint', [s * 2.55, 16, 0], [3.1, 4.7, 3.4], 3);
    C(leg, 'thigh_plate', [s * 2.55, 13.8, -0.15], [3.75, 6.3, 3.9], 0);
    C(leg, 'thigh_ridge', [s * 2.55, 13.8, -2.2], [0.45, 5.6, 0.45], 7);
    C(shin, 'knee', [s * 2.55, 9.6, -0.55], [3.7, 2.1, 4.1], 1);
    C(shin, 'knee_cap', [s * 2.55, 9.7, -2.65], [3.2, 2.35, 1.1], 0, [8, 0, 0]);
    C(shin, 'knee_point', [s * 2.55, 8.8, -3.12], [1.8, 1.2, 0.65], 7, [0, 0, 45]);
    C(shin, 'lower_joint', [s * 2.55, 6.8, 0], [2.8, 4.5, 3.1], 3);
    C(shin, 'greave', [s * 2.55, 5.6, -0.1], [3.3, 5.7, 3.8], 0, [0, 0, s * 2]);
    C(shin, 'greave_ridge', [s * 2.55, 5.7, -2.12], [0.5, 5.05, 0.5], 7);
    C(shin, 'ankle', [s * 2.55, 2.5, -0.1], [3.1, 1.3, 3.7], 1);
    C(shin, 'boot', [s * 2.55, 1.45, -1.15], [3.6, 2.3, 5.7], 6);
    C(shin, 'toe', [s * 2.55, 1.85, -2.9], [3.8, 1.8, 2.6], 0, [-9, 0, 0]);
    C(shin, 'sole', [s * 2.55, 0.4, -1.2], [3.8, 0.6, 5.9], 1);
    const arm = G(`${body}/${side}_arm`, [s * 5.6, 29.5, 0], body, [s < 0 ? -9 : 6, 0, s * -7]);
    const forearm = G(`${arm}/forearm`, [s * 6.35, 23.7, 0], arm, [-12, 0, 0]);
    arms.push({ arm, forearm });
    C(arm, 'upper_joint', [s * 5.8, 27.5, 0], [2.9, 5.2, 3.2], 3);
    C(arm, 'shoulder_cap', [s * 5.6, 30.2, 0], [4.4, 2.6, 5.4], 0, [0, 0, s * 15]);
    C(arm, 'shoulder_bevel', [s * 7.2, 29.9, 0], [1.3, 2.8, 5.2], 0, [0, 0, s * 32]);
    C(arm, 'shoulder_trim', [s * 7.5, 28.8, -0.05], [0.45, 0.65, 5.3], 7, [0, 0, s * 32]);
    C(arm, 'upper_plate', [s * 6, 26.3, -0.15], [3.2, 3.6, 3.8], 0);
    C(forearm, 'elbow', [s * 6.35, 23.4, 0], [2.7, 2.2, 3.4], 1);
    C(forearm, 'elbow_cap', [s * 6.35, 23.45, 1.85], [3.1, 1.8, 0.7], 0);
    C(forearm, 'bracer', [s * 6.35, 21, -0.1], [3.3, 3.8, 3.8], 0);
    C(forearm, 'bracer_ridge', [s * 6.35, 21, -2.15], [0.5, 3.3, 0.55], 7);
    C(forearm, 'cuff', [s * 6.35, 19.25, -0.1], [3.45, 0.6, 3.9], 2);
    C(forearm, 'glove', [s * 6.35, 18.15, -0.1], [2.95, 1.7, 3.3], 6);
    for (let i = 0; i < 3; i++)
      C(forearm, `knuckle_${i}`, [s * 6.35 + (i - 1) * 0.8, 18.4, -1.85], [0.7, 0.7, 0.5], 0);
  }
  // Polearm is attached to the right hand and rotates with its forearm.
  const weapon = G(`${arms[1].forearm}/halberd`, [6.35, 18.2, -0.1], arms[1].forearm, [0, 0, -7]);
  C(weapon, 'shaft', [6.35, 23, -0.1], [0.85, 37, 0.85], 6);
  for (let i = 0; i < 7; i++)
    C(weapon, `grip_${i}`, [6.35, 16.9 + i * 0.48, -0.1], [1.03, 0.22, 1.03], 11);
  for (const y of [5, 32.9, 36.1]) C(weapon, `ferrule_${y}`, [6.35, y, -0.1], [1.22, 0.7, 1.22], 2);
  C(weapon, 'pommel', [6.35, 4.25, -0.1], [1.55, 1.25, 1.55], 7, [0, 0, 45]);
  C(weapon, 'socket', [6.35, 38, -0.1], [1.8, 4.5, 1.65], 1, [0, 0, 0], undefined, {
    north: 15,
    south: 15,
  });
  C(weapon, 'spear', [6.35, 42.2, -0.1], [0.75, 3.4, 0.75], 7);
  C(weapon, 'spear_tip', [6.35, 44, -0.1], [0.5, 1.5, 0.5], 7, [0, 0, 45]);
  for (const s of [-1, 1]) {
    C(weapon, `blade_root_${s}`, [6.35 + s * 1.6, 38.3, -0.1], [2.8, 2.5, 0.8], 0, [0, 0, s * 8]);
    C(weapon, `blade_middle_${s}`, [6.35 + s * 3.25, 38.3, -0.1], [2.1, 4.4, 0.8], 0, [
      0,
      0,
      s * -12,
    ]);
    C(weapon, `blade_edge_${s}`, [6.35 + s * 4.15, 38.3, -0.1], [0.55, 4.9, 0.92], 7, [
      0,
      0,
      s * -12,
    ]);
    C(weapon, `blade_upper_${s}`, [6.35 + s * 3.7, 40.7, -0.1], [0.65, 2.45, 0.8], 7, [
      0,
      0,
      s * 27,
    ]);
    C(weapon, `blade_lower_${s}`, [6.35 + s * 3.75, 35.95, -0.1], [0.65, 2.45, 0.8], 7, [
      0,
      0,
      s * -27,
    ]);
  }
  const T = (group, channel, keys) => ({
    group,
    channel,
    keyframes: keys.map(([time, value]) => ({ time, value, interpolation: 'linear' })),
  });
  model.animations.push({
    id: 'idle',
    name: 'idle',
    length: 4,
    loop: true,
    tracks: [
      T(body, 'position', [
        [0, [0, 0, 0]],
        [2, [0, 0.18, 0]],
        [4, [0, 0, 0]],
      ]),
      T(head, 'rotation', [
        [0, [0, -3, 0]],
        [2, [1, 3, 0]],
        [4, [0, -3, 0]],
      ]),
      T(cape, 'rotation', [
        [0, [0, 0, -1]],
        [2, [3, 0, 1]],
        [4, [0, 0, -1]],
      ]),
      T(lowerCape, 'rotation', [
        [0, [0, 0, 0]],
        [1, [4, 0, -1]],
        [3, [-2, 0, 1]],
        [4, [0, 0, 0]],
      ]),
      T(crest, 'rotation', [
        [0, [0, 0, -1]],
        [2, [2, 0, 1]],
        [4, [0, 0, -1]],
      ]),
    ],
  });
  model.animations.push({
    id: 'walk',
    name: 'walk',
    length: 1,
    loop: true,
    tracks: [
      ...legs.flatMap(({ leg, shin }, i) => [
        T(leg, 'rotation', [
          [0, [i ? 24 : -24, 0, 0]],
          [0.5, [i ? -24 : 24, 0, 0]],
          [1, [i ? 24 : -24, 0, 0]],
        ]),
        T(shin, 'rotation', [
          [0, [i ? -28 : 0, 0, 0]],
          [0.5, [i ? 0 : -28, 0, 0]],
          [1, [i ? -28 : 0, 0, 0]],
        ]),
      ]),
      T(arms[0].arm, 'rotation', [
        [0, [20, 0, 0]],
        [0.5, [-20, 0, 0]],
        [1, [20, 0, 0]],
      ]),
      T(lowerCape, 'rotation', [
        [0, [5, 0, 0]],
        [0.5, [-5, 0, 0]],
        [1, [5, 0, 0]],
      ]),
    ],
  });
  model.animations.push({
    id: 'attack',
    name: 'attack',
    length: 1.2,
    loop: false,
    tracks: [
      T(body, 'rotation', [
        [0, [0, 0, 0]],
        [0.35, [0, -24, 0]],
        [0.65, [8, 32, 0]],
        [1.2, [0, 0, 0]],
      ]),
      T(arms[1].arm, 'rotation', [
        [0, [0, 0, 0]],
        [0.35, [-65, 0, -20]],
        [0.65, [40, 0, 10]],
        [1.2, [0, 0, 0]],
      ]),
      T(arms[1].forearm, 'rotation', [
        [0, [0, 0, 0]],
        [0.35, [-35, 0, 0]],
        [0.65, [12, 0, 0]],
        [1.2, [0, 0, 0]],
      ]),
      T(lowerCape, 'rotation', [
        [0, [0, 0, 0]],
        [0.45, [12, 0, 5]],
        [0.85, [-5, 0, -3]],
        [1.2, [0, 0, 0]],
      ]),
    ],
  });
  // Seat the helmet into its collar; group pivots are absolute, not translations.
  for (const g of model.groups.filter((g) => g.id === head || g.id.startsWith(head + '/')))
    g.origin[1] -= 1.1;
  for (const c of model.cubes.filter((c) => c.parent === head || c.parent.startsWith(head + '/'))) {
    c.from[1] -= 1.1;
    c.to[1] -= 1.1;
    c.origin[1] -= 1.1;
  }
  // Seat the pole in front of the glove, so the shaft does not pass through the arm.
  model.groups.find((g) => g.id === weapon).origin[2] -= 1.8;
  for (const c of model.cubes.filter((c) => c.parent === weapon)) {
    c.from[2] -= 1.8;
    c.to[2] -= 1.8;
    c.origin[2] -= 1.8;
  }
  const floor = Math.min(...geometry(canonical(model)).flatMap((c) => c.vertices.map((v) => v[1])));
  for (const g of model.groups) g.origin[1] -= floor;
  for (const c of model.cubes) {
    c.from[1] -= floor;
    c.to[1] -= floor;
    c.origin[1] -= floor;
  }
  return canonical(model);
}

export async function writeSentinel(out) {
  await mkdir(out, { recursive: true });
  const model = createSentinel();
  assert.deepEqual(validate(model), []);
  const native = exportBBModel(model);
  assert.equal(serialize(importBBModel(native)), serialize(model));
  assert.deepEqual(analyzeQuality(model).issues, []);
  const bytes = JSON.stringify(native, null, 2) + '\n';
  await writeFile(resolve(out, 'crimson_sentinel.bbmodel'), bytes);
  await writeFile(resolve(out, 'crimson_sentinel.bbir.json'), serialize(model));
  for (const t of model.textures)
    await writeFile(resolve(out, t.name), encodePNG({ ...t, pixels: Uint8Array.from(t.pixels) }));
  for (const view of ['isometric', 'front', 'back', 'left', 'right', 'top'])
    await writeFile(
      resolve(out, `crimson_sentinel_${view}.png`),
      renderPNG(model, { width: 1024, height: 1024, view, background: '#151c29' }),
    );
  for (const animation of ['idle', 'walk', 'attack']) {
    const frames = [0, animation === 'idle' ? 2 : animation === 'walk' ? 0.25 : 0.65];
    assert.notDeepEqual(
      sampleAnimation(model, animation, frames[0]),
      sampleAnimation(model, animation, frames[1]),
    );
    for (const time of frames)
      await writeFile(
        resolve(out, `${animation}_${time}.png`),
        renderPNG(model, { width: 768, height: 768, animation, time, background: '#151c29' }),
      );
  }
  const report = {
    ...inspect(model),
    quality: analyzeQuality(model),
    canonicalRoundtrip: true,
    animations: model.animations.map((a) => a.id),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  await writeFile(resolve(out, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await writeSentinel(resolve(process.argv[2] ?? 'dist/showcase/crimson_sentinel'));
