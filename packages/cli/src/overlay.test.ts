import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OVERLAY_DIR_NAME,
  OverlayError,
  initOverlay,
  loadOverlayConfig,
  overlayPaths,
} from './overlay.js';

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-overlay-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('overlayPaths', () => {
  it('resolves the spec §7 file layout under the overlay directory', () => {
    const repo = tmp();
    const paths = overlayPaths(path.join(repo, OVERLAY_DIR_NAME));
    expect(paths.repoRoot).toBe(repo);
    expect(paths.audit).toBe(path.join(repo, '.kernloop', 'audit.jsonl'));
    expect(paths.memory).toBe(path.join(repo, '.kernloop', 'memory.sqlite'));
    expect(paths.config).toBe(path.join(repo, '.kernloop', 'overlay.yaml'));
  });
});

describe('initOverlay', () => {
  it('scaffolds overlay.yaml and gitignores the memory database', () => {
    const repo = tmp();
    const result = initOverlay(repo);
    expect(result.created).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    const config = readFileSync(path.join(repo, '.kernloop', 'overlay.yaml'), 'utf8');
    expect(config).toContain(`id: ${path.basename(repo)}`);
    const gitignore = readFileSync(path.join(repo, '.kernloop', '.gitignore'), 'utf8');
    expect(gitignore).toContain('memory.sqlite');
    expect(existsSync(path.join(repo, '.kernloop', 'audit.jsonl'))).toBe(false);
  });

  it('never overwrites existing files on re-init', () => {
    const repo = tmp();
    initOverlay(repo);
    writeFileSync(path.join(repo, '.kernloop', 'overlay.yaml'), 'id: custom\n');
    const second = initOverlay(repo);
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toHaveLength(2);
    expect(readFileSync(path.join(repo, '.kernloop', 'overlay.yaml'), 'utf8')).toBe('id: custom\n');
  });
});

describe('loadOverlayConfig', () => {
  it('derives defaults from the repo directory name when overlay.yaml is absent', () => {
    const repo = tmp();
    const config = loadOverlayConfig(overlayPaths(path.join(repo, OVERLAY_DIR_NAME)));
    expect(config.id).toBe(path.basename(repo));
    expect(config.budgets).toEqual({ tokens: 100_000, usd: 1, wallClockMin: 30 });
    expect(config.briefTokens).toBe(4_000);
  });

  it('loads and validates a committed overlay.yaml', () => {
    const repo = tmp();
    initOverlay(repo);
    writeFileSync(
      path.join(repo, '.kernloop', 'overlay.yaml'),
      'id: my-overlay\nbudgets:\n  tokens: 5\n  usd: 0.1\n  wallClockMin: 2\nbriefTokens: 100\n',
    );
    const config = loadOverlayConfig(overlayPaths(path.join(repo, OVERLAY_DIR_NAME)));
    expect(config.id).toBe('my-overlay');
    expect(config.budgets.tokens).toBe(5);
    expect(config.briefTokens).toBe(100);
  });

  it('rejects unparseable YAML with a typed OverlayError', () => {
    const repo = tmp();
    initOverlay(repo);
    writeFileSync(path.join(repo, '.kernloop', 'overlay.yaml'), 'id: [unclosed\n');
    expect(() => loadOverlayConfig(overlayPaths(path.join(repo, OVERLAY_DIR_NAME)))).toThrow(
      OverlayError,
    );
  });

  it('rejects schema-invalid config with a typed OverlayError', () => {
    const repo = tmp();
    initOverlay(repo);
    writeFileSync(path.join(repo, '.kernloop', 'overlay.yaml'), 'id: ""\n');
    expect(() => loadOverlayConfig(overlayPaths(path.join(repo, OVERLAY_DIR_NAME)))).toThrow(
      OverlayError,
    );
  });
});
