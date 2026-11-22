import { sfx } from '../audio/Sfx';
import { nextStep, TUTORIAL, type TutorialStep } from '@riftwarden/rules/progression/tutorial';
import { hudStore } from '../ui/store';

export interface TutorialHost {
  /** Steps already completed (persisted). */
  done(): readonly string[];
  active(): boolean;
  mark(id: string): void;
  skip(): void;
}

export interface TutorialProbe {
  /** Can this step be shown right now? */
  available(id: string): boolean;
  /** Has the player done it (evaluated every frame while shown)? `shownFor` = seconds on screen. */
  complete(id: string, shownFor: number): boolean;
}

/**
 * Shows one contextual tutorial card at a time and completes it from real gameplay state. Hosted by
 * the HQ and the solo arena; completion is persisted through the profile (never repeats).
 */
export class TutorialDirector {
  private cur: TutorialStep | null = null;
  private t = 0;
  private local = new Set<string>();

  constructor(
    private where: 'hq' | 'arena',
    private host: TutorialHost,
    private probe: TutorialProbe,
  ) {}

  get showing(): boolean {
    return !!this.cur;
  }

  update(dt: number, skipPressed: boolean): void {
    if (!this.host.active()) {
      if (this.cur) this.clear();
      return;
    }
    if (skipPressed) {
      this.host.skip();
      this.clear();
      return;
    }
    if (this.cur) {
      this.t += dt;
      if (this.t > 0.6 && this.probe.complete(this.cur.id, this.t)) {
        this.local.add(this.cur.id);
        this.host.mark(this.cur.id);
        sfx.play('beep', { pitch: 1.6, volume: 0.4 });
        this.clear();
      }
      return;
    }
    const done = this.host.done();
    const next = nextStep({ tutorial: { done: [...done, ...this.local], skipped: false } }, this.where, (id) => this.probe.available(id));
    if (next) {
      this.cur = next;
      this.t = 0;
      const all = TUTORIAL.filter((s) => s.where === this.where);
      hudStore.set({ tutorial: { ...next, index: all.indexOf(next) + 1, total: all.length } });
    }
  }

  private clear(): void {
    this.cur = null;
    hudStore.set({ tutorial: null });
  }

  dispose(): void {
    this.clear();
  }
}
