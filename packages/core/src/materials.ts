import {
  assertModel,
  canonical,
  FACE_NAMES,
  type Model,
  type Texture,
  type Cube,
} from './model.js';
export function rgba(hex: string): number[] {
  if (!/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(hex)) throw new Error('Expected hex color');
  const s = hex.slice(1);
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
    s.length === 8 ? parseInt(s.slice(6, 8), 16) : 255,
  ];
}
export function checkerTexture(
  id: string,
  width: number,
  height: number,
  a: string,
  b: string,
): Texture {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 262144
  )
    throw new Error('Pattern texture budget exceeded');
  const pixels: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) pixels.push(...rgba((x + y) % 2 ? a : b));
  return { id, name: id, width, height, pixels };
}
/** Stable one-texel swatches; patterns/custom images retain explicit UVs. */
export function bakeMaterials(input: Model): Model {
  assertModel(input);
  const m = canonical(input),
    materials = m.materials ?? [];
  if (!materials.length || !m.cubes.some((c) => c.material && !c.faces)) return m;
  const id = 'formixel_palette';
  const existing = m.textures?.find((t) => t.id === id);
  const width = 2 ** Math.ceil(Math.log2(Math.max(1, materials.length))),
    pixels = new Array<number>(width * 4).fill(0);
  materials.forEach((mat, i) => pixels.splice(i * 4, 4, ...rgba(mat.color)));
  if (existing) {
    if (
      existing.width !== width ||
      existing.height !== 1 ||
      existing.pixels.some((v, i) => v !== pixels[i])
    )
      throw new Error(
        'Existing palette differs from materials; update its UVs and pixels explicitly',
      );
  } else m.textures!.push({ id, name: 'Formixel palette', width, height: 1, pixels });
  for (const cube of m.cubes) {
    if (!cube.material || cube.faces) continue;
    const x = materials.findIndex((mat) => mat.id === cube.material);
    cube.faces = Object.fromEntries(
      FACE_NAMES.map((f) => [f, { uv: [x, 0, x + 1, 1], texture: id }]),
    ) as NonNullable<Cube['faces']>;
  }
  assertModel(m);
  return canonical(m);
}
