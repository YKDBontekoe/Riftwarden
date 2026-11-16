import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, sanitizeSettings } from '../src/core/settings';
import { MAX_ACTIVE_ENEMIES, WaveManager } from '../src/waves/WaveManager';
import { getWave } from '../src/waves/waves';

function harness() {
  let alive = 0;
  const log: string[] = [];
  const wm = new WaveManager({
    spawn: () => {
      alive++;
    },
    aliveCount: () => alive,
    onWaveStart: (w) => log.push(`start${w.number}`),
    onWaveCleared: (w) => log.push(`clear${w.number}`),
    onPrepStart: (w) => log.push(`prep${w.number}`),
  });
  return { wm, log, kill: (n = 1) => (alive = Math.max(0, alive - n)), alive: () => alive };
}

describe('wave lifecycle', () => {
  it('prep -> combat -> cleared -> next prep', () => {
    const h = harness();
    h.wm.reset();
    expect(h.wm.phase).toBe('prep');
    h.wm.startNow();
    h.wm.update(1 / 60, 1 / 60);
    expect(h.wm.phase).toBe('combat');
    // run until everything spawned, killing as we go
    for (let i = 0; i < 60 * 120 && h.wm.phase === 'combat'; i++) {
      h.wm.update(1 / 60, 1 / 60);
      h.kill(5);
    }
    expect(h.wm.phase).toBe('cleared');
    for (let i = 0; i < 60 * 4; i++) h.wm.update(1 / 60, 1 / 60);
    expect(h.wm.phase).toBe('prep');
    expect(h.wm.number).toBe(2);
    expect(h.log).toEqual(['prep1', 'start1', 'clear1', 'prep2']);
  });

  it('does not clear while enemies are alive', () => {
    const h = harness();
    h.wm.reset();
    h.wm.startNow();
    for (let i = 0; i < 60 * 120; i++) h.wm.update(1 / 60, 1 / 60);
    expect(h.wm.phase).toBe('combat');
    expect(h.wm.enemiesLeft).toBe(h.alive());
    h.kill(1000);
    h.wm.update(1 / 60, 1 / 60);
    expect(h.wm.phase).toBe('cleared');
  });

  it('respects the active-enemy cap', () => {
    const h = harness();
    h.wm.reset();
    h.wm.wave = getWave(20); // jump straight to a big generated wave
    expect(h.wm.wave.spawns.length).toBeGreaterThan(MAX_ACTIVE_ENEMIES);
    h.wm.startNow();
    for (let i = 0; i < 60 * 200; i++) h.wm.update(1 / 60, 1 / 60);
    expect(h.alive()).toBe(MAX_ACTIVE_ENEMIES);
    expect(h.wm.remainingToSpawn).toBeGreaterThan(0);
    h.kill(1000);
    for (let i = 0; i < 60 * 200 && h.wm.phase === 'combat'; i++) {
      h.wm.update(1 / 60, 1 / 60);
      h.kill(3);
    }
    expect(h.wm.phase).toBe('cleared');
  });

  it('hostile time dilation slows spawning but not prep', () => {
    const h = harness();
    h.wm.reset();
    h.wm.update(29.9, 0);
    expect(h.wm.phase).toBe('prep');
    h.wm.update(0.2, 0);
    expect(h.wm.phase).toBe('combat');
    h.wm.update(1 / 60, 0); // zero hostile time: nothing spawns
    expect(h.alive()).toBe(0);
  });
});

describe('settings persistence', () => {
  beforeEach(() => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    });
  });
  it('clamps and repairs invalid data', () => {
    expect(sanitizeSettings({ sensitivity: 99, fov: 'x', quality: 'ultra', volume: -1 })).toEqual({ sensitivity: 3, fov: DEFAULT_SETTINGS.fov, quality: 'high', volume: 0 });
  });
  it('recovers from corrupt storage', () => {
    localStorage.setItem('riftwarden.settings', '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
