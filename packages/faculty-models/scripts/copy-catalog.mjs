import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copy the vendored catalog JSON into dist so the built module's
 * `new URL('./catalog/models.json', import.meta.url)` resolves at runtime.
 * tsc only emits .js/.d.ts; the JSON is a data asset that ships alongside.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', 'src', 'catalog', 'models.json');
const destDir = path.join(here, '..', 'dist', 'catalog');
mkdirSync(destDir, { recursive: true });
cpSync(src, path.join(destDir, 'models.json'));
