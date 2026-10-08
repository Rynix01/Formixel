import { readFile } from 'node:fs/promises';
import { parseFXL, serialize, inspect } from '../packages/core/dist/index.js';
// This fixture uses component instances only, so the expansion preserves semantic IDs and names.
export function expandFXL(source) {
  const model = parseFXL(source);
  const declarations = source
    .split(/\r?\n/)
    .filter((line) => /^(model|skin|material|pattern|texture)\s/.test(line));
  const v = (vec) => '[' + vec.map((n) => Number(n.toFixed(9))).join(',') + ']';
  const clause = (name, vec) => (vec.some((n) => n !== 0) ? ` ${name} ${v(vec)}` : '');
  const nodes = (parent) => {
    const lines = [];
    for (const group of model.groups.filter((g) => g.parent === parent)) {
      lines.push(
        `group ${group.name}${clause('origin', group.origin)}${clause('rotate', group.rotation)} {`,
        ...nodes(group.id),
        '}',
      );
    }
    for (const cube of model.cubes.filter((c) => c.parent === parent)) {
      const size = cube.to.map((n, i) => Number((n - cube.from[i]).toFixed(9)));
      const texture = cube.faces?.north.texture;
      lines.push(
        `cube ${cube.name} ${v(cube.from)} ${v(size)}${clause('origin', cube.origin)}${clause('rotate', cube.rotation)}${cube.color ? ' color ' + cube.color : ''}${cube.material ? ' material ' + cube.material : ''}${texture && texture !== 'formixel_palette' ? ' surface ' + texture : ''}`,
      );
    }
    return lines;
  };
  const animationStart = source.search(/^animation\s/m);
  return (
    [
      ...declarations,
      ...nodes(undefined),
      ...(animationStart >= 0 ? [source.slice(animationStart).trim()] : []),
    ].join('\n') + '\n'
  );
}
export function benchmark(source) {
  source = source.replace(/\r\n/g, '\n'); // Compare LF-normalized UTF-8 source across hosts.
  const compactModel = parseFXL(source),
    expanded = expandFXL(source),
    expandedModel = parseFXL(expanded);
  // Decimal addition/subtraction may differ at machine precision; compare canonical numbers at 1e-8.
  const comparable = (model) =>
    JSON.stringify(JSON.parse(serialize(model)), (_key, value) =>
      typeof value === 'number' ? Number(value.toFixed(8)) : value,
    );
  if (comparable(compactModel) !== comparable(expandedModel))
    throw new Error('Expanded fixture changes model semantics');
  const compactSourceBytes = Buffer.byteLength(source),
    expandedSourceBytes = Buffer.byteLength(expanded);
  return {
    fixture: 'examples/ironroot_knight.fxl',
    compactSourceBytes,
    expandedSourceBytes,
    sourceByteReduction: 1 - compactSourceBytes / expandedSourceBytes,
    cubes: inspect(compactModel).cubes,
    groups: inspect(compactModel).groups,
    tokenSavingsMeasured: false,
    comparison:
      'Same canonical model including UVs, within 1e-8 numerical precision. UTF-8 source bytes are not provider tokens.',
  };
}
if (process.argv[1]?.endsWith('benchmark.mjs'))
  console.log(
    JSON.stringify(benchmark(await readFile('examples/ironroot_knight.fxl', 'utf8')), null, 2),
  );
