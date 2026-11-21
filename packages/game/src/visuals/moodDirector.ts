import { Color3, type DirectionalLight, type Scene } from '@babylonjs/core';
import { BASE_FOG, blendMood, calmMood, moodFor, type MoodInput } from './mood';
import type { PostFx } from './postfx';

/** Applies the pure arena mood (fog, sun colour, grade) to the scene with smoothing. */
export class MoodDirector {
  readonly cur = calmMood();
  private clock = 0;
  private readonly fog = new Color3(...BASE_FOG);
  private readonly sunBase: Color3;
  private readonly densityBase: number;

  constructor(private scene: Scene, private sun: DirectionalLight, private post: PostFx) {
    this.sunBase = sun.diffuse.clone();
    this.densityBase = scene.fogDensity;
    scene.fogColor = this.fog;
  }

  update(dt: number, input: Omit<MoodInput, 'time'>): void {
    this.clock += dt;
    const m = blendMood(this.cur, moodFor({ ...input, time: this.clock }), dt);
    this.fog.set(m.fog[0], m.fog[1], m.fog[2]);
    this.scene.fogDensity = this.densityBase * m.fogMul;
    this.sun.diffuse.set(this.sunBase.r * m.sunTint[0], this.sunBase.g * m.sunTint[1], this.sunBase.b * m.sunTint[2]);
    this.post.mood = { exposure: m.exposureAdd + m.flicker, contrast: m.contrastAdd, vignette: m.vignetteAdd };
  }
}
