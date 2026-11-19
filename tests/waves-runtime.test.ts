import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, sanitizeSettings } from '../src/core/settings';
import { MAX_ACTIVE_ENEMIES, WaveManager } from '../src/waves/WaveManager';
import { getWave } from '../src/waves/waves';
import { PACE, earlyCallBonus, prepTime } from '../src/waves/pace';

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
    for (let i = 0; i < 60 * (PACE.cleared + 0.5); i++) h.wm.update(1 / 60, 1 / 60);
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
    h.wm.update(PACE.prepFirst - 0.1, 0);
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
    expect(sanitizeSettings({ sensitivity: 99, fov: 'x', quality: 'ultra', volume: -1 })).toMatchObject({ sensitivity: 3, fov: DEFAULT_SETTINGS.fov, quality: 'high', volume: 0 });
  });
  it('M7: v1 settings derive performance options from their preset; v2 values are clamped', () => {
    const v1 = sanitizeSettings({ quality: 'low', volume: 0.5 }, 1);
    expect(v1).toMatchObject({ quality: 'low', shadows: 'off', particles: 'low', bloom: false, renderScale: 0.75, sfxVolume: 1 });
    const v2 = sanitizeSettings({ quality: 'medium', shadows: 'high', uiScale: 9, shake: -2, renderScale: 0.1, colorblind: 'x', reduceMotion: true }, 2);
    expect(v2).toMatchObject({ quality: 'medium', shadows: 'high', uiScale: 1.3, shake: 0, renderScale: 0.5, colorblind: 'off', reduceMotion: true });
  });
  it('M7: key bindings never contain duplicates and remap physical keys', async () => {
    const { keyRemap } = await import('../src/core/settings');
    const s = sanitizeSettings({ keys: { dash: 'KeyC', jump: 'KeyC' } }, 2);
    expect(s.keys.jump).toBe('KeyC');
    expect(s.keys.dash).toBe('ShiftLeft');
    const m = keyRemap(s);
    expect(m.get('KeyC')).toBe('Space');
    expect(m.get('Space')).toBe('__unbound');
  });
  it('recovers from corrupt storage', () => {
    localStorage.setItem('riftwarden.settings', '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('run tempo', () => {
  it('keeps dead time short and pays for early calls', () => {
    expect(prepTime(1)).toBe(PACE.prepFirst);
    expect(prepTime(7)).toBe(PACE.prepNext);
    expect(PACE.prepNext).toBeLessThanOrEqual(15);
    expect(PACE.cleared).toBeLessThan(3);
    expect(getWave(5).prepTime).toBe(PACE.prepNext);
    expect(earlyCallBonus(0)).toBe(0);
    expect(earlyCallBonus(-3)).toBe(0);
    expect(earlyCallBonus(Number.NaN)).toBe(0);
    expect(earlyCallBonus(11.7)).toBe(11 * PACE.earlyCallCores);
  });

  it('compresses the spawn schedule but keeps its order', () => {
    const w = getWave(2);
    expect(w.spawns[w.spawns.length - 1].time).toBeLessThan(30);
    for (let i = 1; i < w.spawns.length; i++) expect(w.spawns[i].time).toBeGreaterThanOrEqual(w.spawns[i - 1].time);
  });
});
