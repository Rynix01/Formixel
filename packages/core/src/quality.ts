import { assertModel, FACE_NAMES, type Model } from './model.js';

/** Technical authoring diagnostics, deliberately not an aesthetic score. */
export function analyzeQuality(model: Model) {
  assertModel(model);
  const textures = new Map((model.textures ?? []).map((t) => [t.id, t]));
  const issues: { node: string; face?: string; code: string; message: string }[] = [];
  let enabledFaces = 0,
    texturedFaces = 0,
    zeroAreaUVs = 0,
    outsideTextureUVs = 0;
  const shapes = new Map<string, string>();
  for (const cube of model.cubes) {
    const shape = JSON.stringify([cube.parent, cube.from, cube.to, cube.origin, cube.rotation]);
    const previous = shapes.get(shape);
    if (previous)
      issues.push({
        node: cube.id,
        code: 'duplicate-cuboid',
        message: `Coincident cuboid geometry with ${previous}; inspect for z-fighting`,
      });
    else shapes.set(shape, cube.id);
    for (const name of FACE_NAMES) {
      const face = cube.faces?.[name];
      if (face?.enabled === false) continue;
      enabledFaces++;
      if (!face?.texture) continue;
      texturedFaces++;
      const texture = textures.get(face.texture)!;
      const [u0, v0, u1, v1] = face.uv;
      if (u0 === u1 || v0 === v1) {
        zeroAreaUVs++;
        issues.push({
          node: cube.id,
          face: name,
          code: 'zero-area-uv',
          message: 'Textured face samples a zero-area UV rectangle',
        });
      }
      if (
        Math.min(u0, u1) < 0 ||
        Math.max(u0, u1) > texture.width ||
        Math.min(v0, v1) < 0 ||
        Math.max(v0, v1) > texture.height
      ) {
        outsideTextureUVs++;
        issues.push({
          node: cube.id,
          face: name,
          code: 'outside-texture-uv',
          message: 'UV rectangle extends beyond the referenced texture',
        });
      }
    }
  }
  return {
    enabledFaces,
    texturedFaces,
    untexturedFaces: enabledFaces - texturedFaces,
    textureCoverage: enabledFaces ? texturedFaces / enabledFaces : 0,
    zeroAreaUVs,
    outsideTextureUVs,
    issues,
    scope: 'Technical UV and duplicate geometry checks; visual quality requires inspection',
  };
}
