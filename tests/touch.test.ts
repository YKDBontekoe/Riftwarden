import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { knobOffset, lookDelta, nextTouchState, isPortrait, stickVector, TOUCH, wantsTouch } from '@riftwarden/game/core/touch';
import { DEFAULT_SETTINGS, mobileDefaults, PRESETS, sanitizeSettings } from '@riftwarden/game/core/settings';
import { serviceWorker, PUBLIC_FILES } from '../apps/client/sw-plugin';

describe('touch stick', () => {
  it('ignores the dead zone and starts at a usable speed outside it', () => {
    expect(stickVector(3, 2)).toEqual({ x: 0, z: 0, mag: 0, sprint: false });
    const v = stickVector(0, -TOUCH.stickRadius * (TOUCH.deadzone + 0.01));
    expect(v.mag).toBeGreaterThanOrEqual(TOUCH.minDrive);
    expect(v.z).toBeGreaterThan(0);
  });
  it('maps screen axes to strafe/forward and clamps at full deflection', () => {
    const up = stickVector(0, -TOUCH.stickRadius);
    expect(up.z).toBeCloseTo(1);
    expect(up.x).toBeCloseTo(0);
    const right = stickVector(TOUCH.stickRadius * 3, 0);
    expect(right.x).toBeCloseTo(1);
    expect(right.mag).toBe(1);
    const diag = stickVector(TOUCH.stickRadius, TOUCH.stickRadius);
    expect(Math.hypot(diag.x, diag.z)).toBeCloseTo(1);
    expect(diag.z).toBeLessThan(0);
  });
  it('sprints only when pushed past the ring roughly forward', () => {
    expect(stickVector(0, -TOUCH.stickRadius * 1.5).sprint).toBe(true);
    expect(stickVector(0, -TOUCH.stickRadius * 0.9).sprint).toBe(false);
    expect(stickVector(TOUCH.stickRadius * 1.5, 0).sprint).toBe(false);
    expect(stickVector(0, TOUCH.stickRadius * 1.5).sprint).toBe(false);
  });
  it('is finite for degenerate input', () => {
    for (const [x, y] of [[NaN, 0], [Infinity, 1], [0, 0]]) {
      const v = stickVector(x, y);
      expect(Number.isFinite(v.x) && Number.isFinite(v.z)).toBe(true);
    }
  });
  it('draws the knob on the ring when the finger leaves it', () => {
    expect(knobOffset(10, 0)).toEqual([10, 0]);
    const [x, y] = knobOffset(300, 400, 50);
    expect(Math.hypot(x, y)).toBeCloseTo(50);
  });
});

describe('touch look and mode', () => {
  it('scales finger movement by the look setting (clamped, finite)', () => {
    expect(lookDelta(100, 1)).toBeCloseTo(100 * TOUCH.lookScale);
    expect(lookDelta(100, 2)).toBeCloseTo(2 * lookDelta(100, 1));
    expect(lookDelta(100, 99)).toBe(lookDelta(100, 3));
    expect(lookDelta(NaN, 1)).toBe(0);
  });
  it('auto turns on for coarse touch screens and follows the last pointer kind', () => {
    expect(wantsTouch('auto', { coarse: true, touchPoints: 5 })).toBe(true);
    expect(wantsTouch('auto', { coarse: false, touchPoints: 10 })).toBe(false);
    expect(wantsTouch('on', { coarse: false, touchPoints: 0 })).toBe(true);
    expect(wantsTouch('off', { coarse: true, touchPoints: 5 })).toBe(false);
    expect(nextTouchState('auto', false, 'touch')).toBe(true);
    expect(nextTouchState('auto', true, 'mouse')).toBe(false);
    expect(nextTouchState('auto', true, 'pen')).toBe(true);
    expect(nextTouchState('off', false, 'touch')).toBe(false);
    expect(nextTouchState('on', true, 'mouse')).toBe(true);
  });
  it('detects portrait', () => {
    expect(isPortrait(390, 844)).toBe(true);
    expect(isPortrait(844, 390)).toBe(false);
    expect(isPortrait(800, 800)).toBe(false);
  });
});

describe('touch settings', () => {
  it('sanitises the touch fields and keeps old saves valid', () => {
    expect(sanitizeSettings({}, 2)).toMatchObject({ touchControls: 'auto', touchLook: 1, touchOpacity: 0.6 });
    expect(sanitizeSettings({ touchControls: 'x', touchLook: 99, touchOpacity: -1 })).toMatchObject({ touchControls: 'auto', touchLook: 3, touchOpacity: 0.2 });
    expect(sanitizeSettings({ touchControls: 'off' }).touchControls).toBe('off');
  });
  it('mobile defaults use the performance preset at a lower render scale', () => {
    const m = mobileDefaults();
    expect(m).toMatchObject({ quality: 'low', shadows: PRESETS.low.shadows, bloom: false, particles: 'low' });
    expect(m.renderScale).toBeLessThan(PRESETS.low.renderScale);
    expect(sanitizeSettings(m)).toEqual(m);
    expect(DEFAULT_SETTINGS.quality).toBe('high');
  });
});

describe('progressive web app', () => {
  const root = new URL('../apps/client/', import.meta.url);
  it('ships a valid manifest with installable icons', () => {
    const m = JSON.parse(readFileSync(new URL('public/manifest.webmanifest', root), 'utf8'));
    expect(m).toMatchObject({ name: 'Riftwarden', start_url: './', scope: './', orientation: 'landscape' });
    expect(['fullscreen', 'standalone']).toContain(m.display);
    const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
    for (const i of m.icons) expect(existsSync(new URL(`public/${i.src}`, root))).toBe(true);
    for (const f of PUBLIC_FILES) expect(existsSync(new URL(`public/${f.slice(2)}`, root))).toBe(true);
  });
  it('index.html links the manifest and the iOS meta tags', () => {
    const html = readFileSync(new URL('index.html', root), 'utf8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('apple-touch-icon');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('theme-color');
  });
  it('the service worker waits for the player before activating an update', () => {
    const emitted: { fileName: string; source: string }[] = [];
    const plugin = serviceWorker();
    const ctx = { emitFile: (f: { fileName: string; source: string }) => emitted.push(f) };
    (plugin.generateBundle as unknown as (this: typeof ctx, o: unknown, b: Record<string, unknown>) => void).call(ctx, {}, { 'assets/a-1.js': {}, 'index.html': {} });
    const sw = emitted.find((f) => f.fileName === 'sw.js')!.source;
    expect(sw).toContain("event.data.type === 'skip-waiting'");
    expect(sw).toContain('if (!self.registration.active) await self.skipWaiting()');
    expect(sw).toContain('./manifest.webmanifest');
    expect(sw).toContain('./icons/icon-192.png');
    expect(() => new Function(sw)).not.toThrow();
  });
});
