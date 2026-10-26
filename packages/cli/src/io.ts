import { readFile, writeFile, rename, link, unlink, stat } from 'node:fs/promises';
import { extname, dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseFXL, importBBModel, assertModel, canonical, type Model } from '@formixel/core';
import { parseDesignDocument, authorDesign } from '@formixel/core';

export async function readBounded(path: string): Promise<string> {
  const s = await stat(path);
  if (!s.isFile() || s.size > 16_000_000) throw new Error('Input must be a file up to 16 MB');
  const text = await readFile(path, 'utf8');
  if (Buffer.byteLength(text) > 16_000_000) throw new Error('Input budget exceeded');
  return text;
}
export function loadText(text: string, extension: string): Model {
  if (extension === '.fxl' || extension === '.bbscript') return parseFXL(text);
  const data: unknown = JSON.parse(text);
  if (extension === '.bbmodel') return importBBModel(data);
  if (data && typeof data === 'object' && 'source' in data) {
    const result = authorDesign(parseDesignDocument(data));
    if (!result.report.passed)
      throw new Error('Design rig review failed: ' + JSON.stringify(result.report));
    return result.model;
  }
  assertModel(data);
  return canonical(data);
}
export async function atomicWrite(
  path: string,
  text: string | Uint8Array,
  overwrite = false,
): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, text, { flag: 'wx' });
    if (overwrite) await rename(temp, path);
    else await link(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
export const modelExtension = (path: string) => extname(path).toLowerCase();
