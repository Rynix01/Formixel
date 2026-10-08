import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
} from '../packages/core/dist/index.js';

// Trusted, deterministic showcase authoring code; never evaluated from FXL/provider text.
const out = resolve(process.argv[2] ?? 'dist/showcase/elderwood_warden');
await mkdir(out, { recursive: true });
const hex = (s) => [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
const noise = (x, y, seed) => {
  let n = Math.imul(x + seed * 131, 374761393) ^ Math.imul(y + 19, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n >>> 0) / 4294967296;
};
const palettes = [
  ['403025', '78563d', 'b28a60'], // bark ridges
  ['283537', '526466', '8d9c95'], // cold stone
  ['17282a', '314b4c', '688c82'], // recessed stone
  ['243e26', '4d7736', '94b653'], // moss
  ['625036', 'aa8652', 'edc978'], // antique brass
  ['15434a', '287f86', '75d9c5'], // jade
  ['163b3e', '38c6b2', 'bcfff0'], // turquoise crystal
  ['100f15', '262c30', '46504e'], // dark joints
  ['35231d', '694330', 'a6714b'], // root / leather
  ['45514b', '829282', 'bec4a0'], // worn edges
  ['303f20', '6c8635', 'c0cf69'], // leaves
  ['273834', '4d6860', '97aa80'], // lichened stone
  ['432c29', '88524a', 'c68b67'], // mushroom
  ['8a6c43', 'bca06d', 'ede1a6'], // branch tips
  ['092c30', '145958', '328d7e'], // deep jade
  ['283c25', '527840', '9bb859'], // leaf cutout
].map((p) => p.map(hex));
const pixels = new Uint8Array(128 * 128 * 4);
for (let tile = 0; tile < 16; tile++) {
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const [dark, base, light] = palettes[tile];
      const n = noise(x >> 1, y >> 1, tile + 9);
      const grain = tile === 0 || tile === 8;
      const seam = grain
        ? (x + Math.floor(Math.sin(y * 0.23 + tile) * 2) + 32) % 9 < 2
        : ((x + Math.floor(y / 9) * 7) % 19 === 0 && y % 9 < 7) || y % 15 === 0;
      let c = seam ? dark : n > 0.81 ? light : n < 0.17 ? dark : base;
      if (tile === 3 || tile === 10 || tile === 15) {
        c = n < 0.22 ? dark : n > 0.68 ? light : base;
        if (tile === 10 || tile === 15) {
          const mid = 16 + Math.sin(y * 0.16) * 2;
          if (Math.abs(x - mid) < 1 || (x + y * 2) % 11 === 0) c = light;
        }
      }
      if (tile === 4)
        c =
          x % 16 < 2 || y % 16 < 2
            ? dark
            : x % 16 === 2 || y % 16 === 2
              ? light
              : n > 0.85
                ? light
                : base;
      if (tile === 6) c = Math.abs(x - 13) < 3 ? light : x < 13 ? base : dark;
      if (tile === 9 && (x < 3 || y < 3)) c = light;
      const alpha = tile === 15 && Math.abs(x - 16) > 15 - Math.abs(y - 16) * 0.7 ? 0 : 255;
      const index = (((tile >> 2) * 32 + y) * 128 + (tile % 4) * 32 + x) * 4;
      pixels.set([...c, alpha], index);
    }
}
const runes = new Uint8Array(64 * 64 * 4);
for (let y = 0; y < 64; y++)
  for (let x = 0; x < 64; x++) {
    const tx = x % 32,
      ty = y % 32,
      tile = (x >> 5) + (y >> 5) * 2;
    let c = [12, 37, 39];
    const ring = Math.max(Math.abs(tx - 15.5), Math.abs(ty - 15.5));
    const diamond = Math.abs(tx - 15.5) + Math.abs(ty - 15.5);
    const symbol =
      tile === 0
        ? (tx > 3 && tx < 28 && ty > 12 && ty < 19) || (tx > 10 && tx < 21 && ty > 8 && ty < 24)
        : tile === 1
          ? Math.abs(diamond - 10) < 1.6 || (Math.abs(tx - 16) < 1.5 && ty > 8 && ty < 24)
          : tile === 2
            ? (ring > 10 && ring < 12) ||
              (tx > 13 && tx < 18 && ty > 5 && ty < 27) ||
              (ty > 13 && ty < 18 && tx > 7 && tx < 25)
            : Math.abs(diamond - 11) < 1.7 || Math.abs(diamond - 5) < 1.2;
    if (ring > 14) c = [77, 111, 91];
    else if (symbol) c = noise(tx, ty, tile) > 0.8 ? [220, 255, 233] : [77, 230, 196];
    else if (noise(tx >> 1, ty >> 1, 33) > 0.8) c = [22, 55, 52];
    runes.set([...c, 255], (y * 64 + x) * 4);
  }
const model = {
  version: 2,
  name: 'Elderwood Warden',
  format: 'free',
  resolution: [128, 128],
  cubes: [],
  groups: [],
  materials: [],
  textures: [
    {
      id: 'warden_atlas',
      name: 'elderwood_surfaces.png',
      width: 128,
      height: 128,
      pixels: Array.from(pixels),
    },
    {
      id: 'warden_runes',
      name: 'elderwood_runes.png',
      width: 64,
      height: 64,
      pixels: Array.from(runes),
    },
  ],
  animations: [],
};
const group = (id, name, origin, parent, rotation = [0, 0, 0]) => {
  model.groups.push({ id, name, origin, rotation, ...(parent ? { parent } : {}) });
  return id;
};
const root = group('root', 'Elderwood Warden', [0, 0, 0]);
const body = group('root/body', 'Runestone cuirass', [0, 22, 0], root);
const head = group('root/body/head', 'Ancient mask and antlers', [0, 33, 0], body);
const crown = group('root/body/head/crown', 'Branch crown', [0, 39, 0], head);
const core = group('root/body/core', 'Heart of the grove', [0, 28, -4], body);
const mantle = group('root/body/mantle', 'Living leaf mantle', [0, 32, 3], body);
let counter = 0;
function cube(
  parent,
  name,
  center,
  size,
  tile,
  rotation = [0, 0, 0],
  origin = center,
  glyph = false,
) {
  const dimensions = {
    north: [size[0], size[1]],
    south: [size[0], size[1]],
    east: [size[2], size[1]],
    west: [size[2], size[1]],
    up: [size[0], size[2]],
    down: [size[0], size[2]],
  };
  const count = counter++;
  const faces = Object.fromEntries(
    FACE_NAMES.map((face, j) => {
      const [w, h] = dimensions[face].map((n) => Math.min(28, Math.max(2, Math.round(n * 2))));
      const ox = 2 + ((count * 3 + j * 5) % Math.max(1, 28 - w));
      const oy = 2 + ((count * 7 + j * 3) % Math.max(1, 28 - h));
      return [
        face,
        {
          texture: glyph ? 'warden_runes' : 'warden_atlas',
          uv: glyph
            ? [(tile % 2) * 32, (tile >> 1) * 32, (tile % 2) * 32 + 32, (tile >> 1) * 32 + 32]
            : [
                (tile % 4) * 32 + ox,
                (tile >> 2) * 32 + oy,
                (tile % 4) * 32 + ox + w,
                (tile >> 2) * 32 + oy + h,
              ],
        },
      ];
    }),
  );
  const c = {
    id: `${parent}/${name}`,
    name: name.replaceAll('_', ' '),
    parent,
    from: center.map((v, i) => v - size[i] / 2),
    to: center.map((v, i) => v + size[i] / 2),
    origin,
    rotation,
    color: tile % 8,
    faces,
  };
  model.cubes.push(c);
  return c;
}
const C = cube;
// Tapered, layered torso with deliberate depth between ribs and rune plates.
C(body, 'wooden_spine', [0, 25, 1], [7, 15, 6], 0);
C(body, 'obsidian_undercoat', [0, 27, -0.4], [10, 11, 5.5], 7);
C(body, 'upper_cuirass', [0, 30.8, -0.4], [13.5, 4, 7], 1);
C(body, 'waist_block', [0, 20, 0], [7.5, 4, 5], 2);
for (const s of [-1, 1]) {
  C(body, `pectoral_${s}`, [s * 4.4, 28.8, -3.6], [4.8, 5.4, 2.4], 11, [0, s * -8, s * -9]);
  C(body, `collar_${s}`, [s * 3.8, 33.1, -2], [6.4, 1.4, 4.5], 9, [0, 0, s * -11]);
  for (let i = 0; i < 3; i++) {
    C(
      body,
      `rib_${s}_${i}`,
      [s * (4.1 - i * 0.4), 25.5 - i * 2.25, -2.7],
      [3.3, 1.7, 2.3],
      i % 2 ? 2 : 1,
      [0, s * -10, s * -8],
    );
    C(
      body,
      `rib_brass_${s}_${i}`,
      [s * (4.1 - i * 0.4), 25.9 - i * 2.25, -4],
      [2.7, 0.35, 0.3],
      4,
      [0, 0, s * -8],
    );
  }
  C(body, `hip_plate_${s}`, [s * 4.6, 17.5, -0.2], [3.4, 5, 6], 1, [0, 0, s * -16]);
  C(body, `hip_moss_${s}`, [s * 4.9, 19.4, -3.4], [2.8, 1.1, 0.6], 3);
  C(body, `belt_trim_${s}`, [s * 3.1, 20.1, -3.4], [4.7, 0.65, 0.8], 4);
}
C(body, 'belt_center', [0, 20, -3.3], [3, 2.8, 1], 4);
C(body, 'belt_sigil', [0, 20, -3.95], [1.8, 1.8, 0.3], 1, [0, 0, 0], [0, 20, -3.95], true);
C(core, 'heart_socket', [0, 28.6, -4.3], [4.8, 5.2, 1.2], 7);
for (const s of [-1, 1]) {
  C(core, `heart_frame_v_${s}`, [s * 2.4, 28.6, -5], [0.6, 4.8, 0.65], 4);
  C(core, `heart_frame_h_${s}`, [0, 28.6 + s * 2.4, -5], [4.6, 0.6, 0.65], 4);
}
C(core, 'heart_glyph', [0, 28.6, -5], [3.5, 4.1, 0.6], 3, [0, 0, 0], [0, 28.6, -5], true);
C(core, 'heart_crystal', [0, 28.6, -5.7], [1.3, 1.3, 1.1], 6, [0, 0, 45]);
// Boots, segmented roots, knee gems and ankle armour.
for (const s of [-1, 1]) {
  const leg = group(
    `root/leg_${s}`,
    s < 0 ? 'Left root leg' : 'Right root leg',
    [s * 3.4, 17, 0],
    root,
    [0, 0, s * -4],
  );
  const shin = group(`${leg}/shin`, 'Articulated shin', [s * 3.6, 9.3, 0], leg);
  C(leg, 'thigh', [s * 3.6, 13.6, 0], [4.1, 7, 4.8], 0);
  C(leg, 'thigh_plate', [s * 3.6, 14, -2.5], [4.8, 5.6, 1.4], 1);
  C(leg, 'thigh_trim', [s * 3.6, 16.6, -3.2], [4.6, 0.7, 0.4], 9);
  C(shin, 'knee_socket', [s * 3.7, 9.7, -0.3], [4.3, 2.8, 5.2], 7);
  C(shin, 'knee_cap', [s * 3.7, 9.7, -3], [4.4, 2.6, 1.4], 9, [8, 0, 0]);
  C(shin, 'knee_jade', [s * 3.7, 9.7, -3.9], [1.4, 1.4, 0.5], 5, [0, 0, 45]);
  C(shin, 'shin_core', [s * 3.8, 5.5, 0.5], [3.5, 6.8, 3.7], 0);
  C(shin, 'shin_plate', [s * 3.8, 5.6, -1.8], [4.4, 5.5, 1.5], 11);
  C(
    shin,
    'shin_rune',
    [s * 3.8, 5.8, -2.65],
    [1.7, 2.8, 0.3],
    2,
    [0, 0, 0],
    [s * 3.8, 5.8, -2.65],
    true,
  );
  for (let i = 0; i < 3; i++) {
    C(shin, `ankle_band_${i}`, [s * 3.8, 2.6 + i * 1.15, 0], [4.2, 0.6, 4.4], i === 1 ? 4 : 8);
    C(
      shin,
      `toe_root_${i}`,
      [s * 3.8 + (i - 1) * 1.4, 0.9, -2.1],
      [1.25, 1.8, 6.2 - Math.abs(i - 1)],
      8,
    );
    C(
      shin,
      `toe_tip_${i}`,
      [s * 3.8 + (i - 1) * 1.4, 0.8, -5 + Math.abs(i - 1) * 0.4],
      [1.2, 1.5, 1.4],
      13,
    );
  }
  C(shin, 'heel', [s * 3.8, 1.1, 1.3], [4.5, 2.2, 3.8], 1);
  C(shin, 'ankle_moss', [s * 5.6, 3.9, -1], [1, 2.1, 2.8], 3);
}
// Mask: recessed eyes, angular brow, brass inlay and a split beard.
C(head, 'neck', [0, 34, 0], [4, 3, 4], 0);
C(head, 'mask_back', [0, 38, 0], [8.5, 7.4, 6.7], 0);
C(head, 'mask_face', [0, 37.8, -3.1], [8.7, 6.2, 1.7], 1);
C(head, 'forehead_plate', [0, 40.8, -3.4], [7.5, 1.9, 1.8], 11);
C(head, 'central_crest', [0, 41.6, -4.4], [1.2, 3.5, 0.8], 4, [0, 0, 0]);
C(head, 'forehead_gem', [0, 40.3, -4.45], [1.7, 1.7, 0.4], 6, [0, 0, 45]);
for (const s of [-1, 1]) {
  C(head, `eye_socket_${s}`, [s * 2.15, 38.5, -4.05], [3.4, 1.8, 0.65], 7);
  C(
    head,
    `eye_${s}`,
    [s * 2.15, 38.4, -4.45],
    [2.7, 0.9, 0.25],
    0,
    [0, 0, 0],
    [s * 2.15, 38.4, -4.45],
    true,
  );
  C(head, `brow_${s}`, [s * 2.35, 39.4, -4.2], [4.1, 0.85, 1], 9, [0, 0, s * 10]);
  C(head, `cheek_${s}`, [s * 3.65, 36.8, -3.75], [2, 3.2, 1.8], 11, [0, s * -12, s * -12]);
  C(head, `cheek_inlay_${s}`, [s * 3.4, 37, -4.8], [0.45, 2.1, 0.3], 4, [0, 0, s * -12]);
  C(head, `jaw_branch_${s}`, [s * 2.4, 34.9, -1.8], [2.5, 3, 3.6], 8, [0, 0, s * 17]);
  C(head, `ear_plate_${s}`, [s * 5.2, 38.3, 0], [1.4, 4.5, 4.2], 5, [0, 0, s * -18]);
}
C(head, 'nose_bridge', [0, 37.3, -4.35], [1.4, 2.7, 1.2], 9);
C(head, 'mouth_recess', [0, 35.7, -4.15], [4.2, 0.6, 0.4], 7);
for (let i = -1; i <= 1; i++)
  C(
    head,
    `beard_${i}`,
    [i * 1.4, 33.8 + Math.abs(i) * 0.4, -2.8],
    [1.1, 3.7 - Math.abs(i), 1.8],
    0,
    [9, 0, i * -8],
  );
// Antler branches use rotated timber beams with stone collars and pale cut tips.
for (const s of [-1, 1]) {
  C(crown, `antler_base_${s}`, [s * 4, 42.3, 0.5], [2.7, 3.8, 2.7], 0, [0, 0, s * -24]);
  C(crown, `antler_collar_${s}`, [s * 4.8, 43.3, 0.5], [3.1, 0.7, 3.1], 4, [0, 0, s * -24]);
  C(crown, `antler_main_${s}`, [s * 6.5, 46, 0.8], [1.8, 6.6, 1.8], 0, [0, 0, s * -29]);
  C(crown, `antler_tip_${s}`, [s * 8.1, 49.1, 0.8], [1.2, 2.2, 1.2], 13, [0, 0, s * -14]);
  C(crown, `antler_outer_${s}`, [s * 9.2, 46.1, 0.8], [1.4, 5.2, 1.4], 8, [0, 0, s * -62]);
  C(crown, `antler_outer_tip_${s}`, [s * 11.3, 47.1, 0.8], [1, 2.6, 1], 13, [0, 0, s * -22]);
  C(crown, `antler_inner_${s}`, [s * 4.7, 47.5, 1.1], [1.1, 3.7, 1.1], 8, [0, 0, s * 18]);
  C(crown, `antler_back_${s}`, [s * 6.5, 44.7, 2.4], [1.2, 4.2, 1.2], 0, [-38, 0, s * -18]);
  for (let j = 0; j < 3; j++)
    C(crown, `crown_leaf_${s}_${j}`, [s * (5.9 + j), 45 + j * 0.65, -0.2], [2.4, 0.35, 1.8], 10, [
      s * 12,
      j * 23,
      s * 22,
    ]);
}
// Asymmetric layered shoulder armour and articulated, curled wooden fingers.
const arms = [];
for (const s of [-1, 1]) {
  const arm = group(
    `root/body/arm_${s}`,
    s < 0 ? 'Moss shoulder and left arm' : 'Right arm and staff',
    [s * 8, 31.4, 0],
    body,
    [0, 0, s * -6],
  );
  const forearm = group(`${arm}/forearm`, 'Root gauntlet', [s * 9.7, 24, 0], arm);
  const hand = group(`${forearm}/hand`, 'Carved wooden hand', [s * 10.2, 17.9, -0.3], forearm);
  arms.push({ s, arm, forearm, hand });
  C(arm, 'shoulder_joint', [s * 8, 31, 0], [4.3, 4.3, 5.2], 7);
  C(arm, 'upper_arm', [s * 9, 27.5, 0], [3.8, 7, 4], 0);
  for (let j = 0; j < 3; j++) {
    C(
      arm,
      `pauldron_${j}`,
      [s * (8.4 + j * 1.1), 33.1 - j * 1.1, 0],
      [5.8 - j * 0.55, 1.6, 7.4 - j * 0.4],
      s < 0 ? 11 : 1,
      [0, 0, s * -14],
    );
    C(
      arm,
      `pauldron_edge_${j}`,
      [s * (8.4 + j * 1.1), 33.2 - j * 1.1, -3.85 + j * 0.2],
      [5.5 - j * 0.55, 0.5, 0.55],
      4,
      [0, 0, s * -14],
    );
  }
  C(arm, 'bicep_plate', [s * 9.4, 27.4, -2.6], [4.5, 4.9, 1.4], 5);
  C(
    arm,
    'bicep_rune',
    [s * 9.4, 27.4, -3.45],
    [2, 2.8, 0.3],
    1,
    [0, 0, 0],
    [s * 9.4, 27.4, -3.45],
    true,
  );
  C(forearm, 'elbow', [s * 9.7, 24, 0], [3.5, 2.2, 4.2], 7);
  C(forearm, 'forearm_roots', [s * 10, 20.8, 0], [3.7, 6.1, 4.2], 8);
  C(forearm, 'gauntlet_plate', [s * 10.1, 21, -2.4], [4.8, 5.5, 1.5], 1);
  for (let j = 0; j < 3; j++)
    C(
      forearm,
      `gauntlet_band_${j}`,
      [s * 10.1, 18.8 + j * 1.8, -0.2],
      [4.6, 0.55, 4.9],
      j === 1 ? 4 : 9,
    );
  C(hand, 'palm', [s * 10.3, 16.8, -0.2], [3.7, 3.1, 3.7], 0);
  C(hand, 'knuckle_guard', [s * 10.3, 16.9, -2.4], [4.1, 1.2, 0.9], 4);
  for (let j = 0; j < 3; j++) {
    C(hand, `finger_${j}`, [s * 10.3 + (j - 1) * 1.2, 14.9, -1.1], [0.9, 2.2, 1.2], 8, [12, 0, 0]);
    C(
      hand,
      `finger_tip_${j}`,
      [s * 10.3 + (j - 1) * 1.2, 14.3, -2],
      [0.85, 1.1, 1.5],
      13,
      [28, 0, 0],
    );
  }
  C(hand, 'thumb', [s * 8.6, 16, -0.8], [1.1, 2.1, 1.1], 8, [0, 0, s * 28]);
  if (s < 0) {
    for (let j = 0; j < 6; j++) {
      C(
        arm,
        `shoulder_moss_${j}`,
        [-8 - (j % 3) * 1.2, 34.1 - Math.floor(j / 3) * 0.6, (j % 2) * 2 - 1],
        [2.5, 0.8, 2.8],
        3,
        [0, j * 23, -12],
      );
      C(arm, `shoulder_leaf_${j}`, [-10.1 - (j % 2), 33.5 - j * 0.75, 1.4], [3.4, 0.4, 2.3], 15, [
        0,
        25,
        20 + j * 5,
      ]);
    }
    C(arm, 'mushroom_stem', [-9.8, 35.1, 1.6], [0.6, 2.5, 0.6], 13);
    C(arm, 'mushroom_cap', [-9.8, 36.3, 1.6], [3.2, 0.7, 2.7], 12);
    C(arm, 'small_mushroom', [-7.8, 35.2, 2.3], [1.8, 0.5, 1.6], 12);
  }
}
// Feather-like overlapping leaf mantle, back roots and brass clasps.
for (let row = 0; row < 4; row++)
  for (let col = -2; col <= 2; col++) {
    C(
      mantle,
      `mantle_leaf_${row}_${col}`,
      [col * (2.4 - row * 0.22), 31 - row * 3.1, 4 + row * 0.35],
      [3.7 - row * 0.35, 4.7, 0.55],
      15,
      [-14, col * 10, col * 8],
    );
  }
for (const s of [-1, 1]) {
  C(mantle, `mantle_clasp_${s}`, [s * 4.8, 32.5, 3.2], [2.3, 1, 1.5], 4);
  C(body, `back_root_${s}`, [s * 2.9, 26, 3.1], [1.1, 11, 1.1], 0, [-8, 0, s * 9]);
  for (let j = 0; j < 4; j++)
    C(
      body,
      `front_vine_${s}_${j}`,
      [s * (5.6 - j * 0.35), 30.8 - j * 2.4, -4.3],
      [0.55, 2.8, 0.55],
      3,
      [0, 0, s * (j % 2 ? -12 : 15)],
    );
}
// Ritual staff attached to the right hand so animation preserves the grip.
const staff = group(
  `${arms[1].hand}/staff`,
  'Grove lantern staff',
  [12.1, 16.3, -1.4],
  arms[1].hand,
);
C(staff, 'staff_shaft', [12.1, 19.4, -1.4], [1.5, 35.4, 1.5], 0);
C(staff, 'staff_foot', [12.1, 2.2, -1.4], [2.1, 2.7, 2.1], 4);
for (let j = 0; j < 8; j++)
  C(staff, `shaft_wrap_${j}`, [12.1, 10 + j * 0.85, -1.4], [1.9, 0.4, 1.9], 8, [0, j * 8, 0]);
for (let j = 0; j < 4; j++)
  C(staff, `shaft_band_${j}`, [12.1, 21 + j * 4.1, -1.4], [2, 0.65, 2], 4);
C(staff, 'lantern_base', [12.1, 36.5, -1.4], [5.2, 1.2, 5.2], 4);
C(staff, 'lantern_top', [12.1, 43, -1.4], [4.5, 0.9, 4.5], 4);
for (const x of [-1, 1])
  for (const z of [-1, 1])
    C(
      staff,
      `lantern_pillar_${x}_${z}`,
      [12.1 + x * 2.1, 39.7, -1.4 + z * 2.1],
      [0.6, 6.1, 0.6],
      5,
      [0, 0, 0],
    );
C(staff, 'lantern_crystal', [12.1, 39.8, -1.4], [2.5, 4.4, 2.5], 6, [0, 30, 0]);
C(staff, 'lantern_crystal_cap', [12.1, 42.1, -1.4], [1.4, 1.4, 1.4], 6, [0, 30, 45]);
C(
  staff,
  'lantern_rune',
  [12.1, 39.8, -3.6],
  [2.3, 2.8, 0.35],
  3,
  [0, 0, 0],
  [12.1, 39.8, -3.6],
  true,
);
for (const s of [-1, 1]) {
  C(staff, `staff_branch_${s}`, [12.1 + s * 2.1, 44.4, -1.4], [1.1, 4.3, 1.1], 8, [0, 0, s * -35]);
  C(staff, `staff_leaf_${s}`, [12.1 + s * 3, 45.3, -1.4], [2.7, 0.4, 2.2], 15, [12, 0, s * 25]);
}
const track = (group, channel, values) => ({
  group,
  channel,
  keyframes: values.map(([time, value]) => ({ time, value, interpolation: 'linear' })),
});
model.animations.push({
  id: 'idle',
  name: 'idle',
  length: 4,
  loop: true,
  tracks: [
    track(body, 'position', [
      [0, [0, 0, 0]],
      [2, [0, 0.35, 0]],
      [4, [0, 0, 0]],
    ]),
    track(head, 'rotation', [
      [0, [0, -3, 0]],
      [2, [1, 3, 0]],
      [4, [0, -3, 0]],
    ]),
    track(mantle, 'rotation', [
      [0, [-1, 0, 0]],
      [2, [2, 0, 0]],
      [4, [-1, 0, 0]],
    ]),
    track(core, 'scale', [
      [0, [1, 1, 1]],
      [2, [1.035, 1.035, 1.035]],
      [4, [1, 1, 1]],
    ]),
  ],
});
model.animations.push({
  id: 'awaken',
  name: 'awaken',
  length: 2,
  loop: false,
  tracks: [
    track(head, 'rotation', [
      [0, [15, 0, 0]],
      [1.5, [-4, 0, 0]],
      [2, [0, 0, 0]],
    ]),
    track(arms[0].arm, 'rotation', [
      [0, [8, 0, 4]],
      [1, [-6, 0, -5]],
      [2, [0, 0, 0]],
    ]),
    track(core, 'scale', [
      [0, [0.7, 0.7, 0.7]],
      [1.4, [1.07, 1.07, 1.07]],
      [2, [1, 1, 1]],
    ]),
  ],
});
model.animations.push({
  id: 'look_around',
  name: 'look_around',
  length: 6,
  loop: true,
  tracks: [
    track(head, 'rotation', [
      [0, [0, 0, 0]],
      [1.5, [0, -22, 0]],
      [3, [0, 0, 0]],
      [4.5, [0, 22, 0]],
      [6, [0, 0, 0]],
    ]),
    track(crown, 'rotation', [
      [0, [0, 0, 0]],
      [1.5, [0, 2, 0]],
      [3, [0, 0, 0]],
      [4.5, [0, -2, 0]],
      [6, [0, 0, 0]],
    ]),
  ],
});
const m = canonical(model);
assert.deepEqual(validate(m), []);
const native = exportBBModel(m);
assert.equal(serialize(importBBModel(native)), serialize(m));
assert.ok(
  m.cubes.every((c) => FACE_NAMES.every((f) => c.faces[f].texture && c.faces[f].enabled !== false)),
);
assert.notDeepEqual(sampleAnimation(m, 'look_around', 1.5), sampleAnimation(m, 'look_around', 4.5));
await writeFile(resolve(out, 'elderwood_warden.bbir.json'), serialize(m));
await writeFile(resolve(out, 'elderwood_warden.bbmodel'), JSON.stringify(native, null, 2));
for (const t of m.textures)
  await writeFile(
    resolve(out, t.name),
    encodePNG({ width: t.width, height: t.height, pixels: Uint8Array.from(t.pixels) }),
  );
await writeFile(resolve(out, 'elderwood_warden.png'), renderPNG(m, { width: 1024, height: 1024 }));
// Turntable views are separate transformed copies; exported rig stays unchanged.
for (const [name, yaw] of [
  ['front', -35],
  ['back', 145],
]) {
  const view = structuredClone(m);
  view.groups.find((g) => g.id === root).rotation[1] = yaw;
  await writeFile(
    resolve(out, `elderwood_warden_${name}.png`),
    renderPNG(view, { width: 1024, height: 1024 }),
  );
}
const pose0 = renderPNG(m, { width: 512, height: 512, animation: 'idle', time: 0 });
const pose2 = renderPNG(m, { width: 512, height: 512, animation: 'idle', time: 2 });
assert.equal(Buffer.from(pose0).equals(Buffer.from(pose2)), false);
const report = {
  ...inspect(m),
  textures: m.textures.map((t) => ({ name: t.name, width: t.width, height: t.height })),
  animations: m.animations.map((a) => a.name),
  allFacesTextured: true,
  canonicalRoundtrip: true,
  animatedRasterChanges: true,
  bbmodelSHA256: createHash('sha256')
    .update(JSON.stringify(native, null, 2))
    .digest('hex'),
};
await writeFile(resolve(out, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
