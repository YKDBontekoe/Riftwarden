import type { OpResult } from './ops';
import type { SaveData } from './save';

/**
 * Onboarding (M7): contextual, gameplay-driven prompts for a new profile. Steps are completed by
 * doing the thing (moving, building, collecting...); completion persists in the save so prompts
 * never repeat, and the player can skip or replay them from the settings.
 */
export interface TutorialStep {
  id: string;
  where: 'hq' | 'arena';
  title: string;
  text: string;
  keys?: string[];
}

export const TUTORIAL: readonly TutorialStep[] = [
  { id: 'hq_look', where: 'hq', title: 'WELCOME TO HEADQUARTERS', text: 'Look around with the mouse and fly with WASD. This is your base: everything you secure in operations comes back here.', keys: ['WASD', 'MOUSE'] },
  { id: 'hq_deploy', where: 'hq', title: 'YOUR FIRST OPERATION', text: 'Head north into the Launch Bay and use the Deployment Terminal to start a survival operation.', keys: ['E'] },
  { id: 'move', where: 'arena', title: 'FLIGHT CONTROLS', text: 'You are a combat drone. Move with WASD, jump with Space and press Space again in the air for a boost.', keys: ['WASD', 'SPACE'] },
  { id: 'dash', where: 'arena', title: 'DASH', text: 'Shift dashes (two charges). Hold it while moving forward to sprint.', keys: ['SHIFT'] },
  { id: 'reactor', where: 'arena', title: 'DEFEND THE REACTOR', text: 'Machines come down the orange lanes for the reactor. If it is destroyed the operation fails; your drone respawns, the reactor does not.' },
  { id: 'tower', where: 'arena', title: 'BUILD A TOWER', text: 'Press B to enter build mode and click to place a Sentinel beside a lane. Towers cost cores; kills earn more.', keys: ['B', 'LMB'] },
  { id: 'wave', where: 'arena', title: 'START THE WAVE', text: 'You are preparing. Press G to start the wave early, or wait for the countdown.', keys: ['G'] },
  { id: 'shoot', where: 'arena', title: 'OPEN FIRE', text: 'Shoot with the left mouse button. Glowing visors and cores are weakpoints: hits there always crit.', keys: ['LMB'] },
  { id: 'heat', where: 'arena', title: 'WEAPON HEAT', text: 'Energy weapons never run out, but they heat up. Overheat locks the trigger until it cools: fire in bursts.' },
  { id: 'loot', where: 'arena', title: 'LOOT', text: 'Destroyed machines drop equipment. Look at a hologram and press E to collect it. It stays unsecured until the next checkpoint.', keys: ['E'] },
  { id: 'upgrade', where: 'arena', title: 'RUN UPGRADES', text: 'After each wave pick one upgrade. Upgrades stack into powerful builds but last only for this operation.' },
  { id: 'tactical', where: 'arena', title: 'TACTICAL TIME', text: 'Q slows every enemy and opens build mode so you can place several towers mid-fight. It drains energy that recharges.', keys: ['Q'] },
  { id: 'bank', where: 'arena', title: 'CHECKPOINT', text: 'Every five waves everything you collected is banked to HQ. You can continue for more, or return home with it safe.', keys: ['H'] },
  { id: 'hq_return', where: 'hq', title: 'BACK HOME', text: 'Secured loot is in the Storage terminal; equip it at Drone Configuration, upgrade it in the Workshop, and build out your base at the Architect Console.' },
];

type Op = { args: ('str' | 'str?' | 'int' | 'bool' | 'strs' | 'num' | 'json')[]; run(d: SaveData, a: unknown[], txId: string | undefined): OpResult };

export const TUTORIAL_OPS: Record<string, Op> = {
  tutorialStep: {
    args: ['str'],
    run: (d, a) => {
      const id = a[0] as string;
      if (!TUTORIAL.some((s) => s.id === id)) return { ok: false, reason: 'Unknown step' };
      if (d.tutorial.done.includes(id)) return { ok: false, reason: 'Already done' };
      d.tutorial.done.push(id);
      if (TUTORIAL.every((s) => d.tutorial.done.includes(s.id))) d.tutorial.done.push('complete');
      return { ok: true };
    },
  },
  tutorialSkip: {
    args: [],
    run: (d) => {
      d.tutorial.skipped = true;
      return { ok: true };
    },
  },
  tutorialReset: {
    args: [],
    run: (d) => {
      d.tutorial = { done: [], skipped: false };
      return { ok: true };
    },
  },
};

export function tutorialActive(d: Pick<SaveData, 'tutorial'>): boolean {
  return !d.tutorial.skipped && !d.tutorial.done.includes('complete');
}

/** Next pending step for a location (in order). */
export function nextStep(d: Pick<SaveData, 'tutorial'>, where: 'hq' | 'arena', available: (id: string) => boolean): TutorialStep | null {
  if (!tutorialActive(d)) return null;
  for (const s of TUTORIAL) if (s.where === where && !d.tutorial.done.includes(s.id) && available(s.id)) return s;
  return null;
}
