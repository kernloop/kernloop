/**
 * Workshop namespace tests (CLM-0053): traversal-guarded names, listing,
 * and human-ratified retirement with history preserved.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { RatificationRequiredError, UnknownToolError, WorkshopNameError } from './errors.js';
import { loadLifecycle, registerTool } from './lifecycle.js';
import { listTools, retire, toolDir, workshopDir } from './workshop.js';

const tmpDirs: string[] = [];
function overlay(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolsmith-workshop-test-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function installFake(overlayDir: string, name: string): void {
  const dir = path.join(overlayDir, 'workshop', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ name: `workshop/${name}` }),
    'utf8',
  );
  registerTool({ overlayDir, name, at: 1000 });
}

describe('workshop namespace', () => {
  it('rejects path-traversal tool names', () => {
    const overlayDir = overlay();
    for (const bad of ['../evil', 'a/b', '.hidden', 'UPPER', '', '..', 'a b']) {
      expect(() => toolDir(overlayDir, bad)).toThrow(WorkshopNameError);
    }
    expect(toolDir(overlayDir, 'repo-stats')).toBe(path.join(overlayDir, 'workshop', 'repo-stats'));
  });

  it('lists only live tools, sorted, ignoring .retired and strays', () => {
    const overlayDir = overlay();
    expect(listTools(overlayDir)).toEqual([]);
    installFake(overlayDir, 'beta');
    installFake(overlayDir, 'alpha');
    fs.mkdirSync(path.join(workshopDir(overlayDir), '.retired', 'old-1'), { recursive: true });
    fs.mkdirSync(path.join(workshopDir(overlayDir), 'no-manifest'), { recursive: true });
    expect(listTools(overlayDir).map((t) => t.name)).toEqual(['alpha', 'beta']);
  });
});

describe('retire (CLM-0053)', () => {
  it('requires human ratification: missing ratifiedBy refuses', () => {
    const overlayDir = overlay();
    installFake(overlayDir, 'doomed');
    expect(() => retire({ overlayDir, name: 'doomed', ratifiedBy: '' })).toThrow(
      RatificationRequiredError,
    );
    expect(() =>
      retire({ overlayDir, name: 'doomed' } as unknown as Parameters<typeof retire>[0]),
    ).toThrow(RatificationRequiredError);
    expect(listTools(overlayDir).map((t) => t.name)).toEqual(['doomed']);
  });

  it('refuses to retire a tool that does not exist', () => {
    expect(() => retire({ overlayDir: overlay(), name: 'ghost', ratifiedBy: 'william' })).toThrow(
      UnknownToolError,
    );
  });

  it('retire moves the tool to workshop/.retired preserving history', () => {
    const overlayDir = overlay();
    installFake(overlayDir, 'veteran');
    const result = retire({
      overlayDir,
      name: 'veteran',
      ratifiedBy: 'william',
      clock: () => 2000,
    });
    expect(result.retiredDir).toBe(path.join(workshopDir(overlayDir), '.retired', 'veteran-2000'));
    expect(fs.existsSync(path.join(result.retiredDir, 'manifest.json'))).toBe(true);
    expect(listTools(overlayDir)).toEqual([]);
    const lifecycle = loadLifecycle(overlayDir);
    expect(lifecycle.tools['veteran']).toBeUndefined();
    expect(lifecycle.history.at(-1)).toMatchObject({
      tool: 'veteran',
      event: 'retired',
      ratifiedBy: 'william',
      at: 2000,
    });
  });
});
