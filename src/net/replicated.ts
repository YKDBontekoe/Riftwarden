// Names of the presentation calls replicated from the server to the clients. One list, used by the server's
// capture (recorder.ts) and the client's replay (ClientGame), so a rename on either side is a compile error.
import type { Effects } from '../fx/Effects';
import type { Ordnance, Telegraphs } from '../fx/Hostile';
import type { WeaponFx } from '../fx/WeaponFx';

export const FX_CALLS = ['burst', 'explode', 'impact', 'ring', 'tracer', 'flashLight', 'debrisBurst', 'shieldRipple', 'thrown', 'thrownEnd'] as const satisfies readonly (keyof Effects)[];
export const WFX_CALLS = ['arc'] as const satisfies readonly (keyof WeaponFx)[];
export const ORDNANCE_CALLS = ['lob', 'orb', 'missile'] as const satisfies readonly (keyof Ordnance)[];
/** Telegraph calls that create something (the server streams the id back so later edits can address it). */
export const TELE_CREATE_CALLS = ['marker', 'line'] as const satisfies readonly (keyof Telegraphs)[];
export const TELE_EDIT_CALLS = ['moveLine', 'cancel'] as const satisfies readonly (keyof Telegraphs)[];

export type FxCall = (typeof FX_CALLS)[number];
export type WfxCall = (typeof WFX_CALLS)[number];
export type OrdnanceCall = (typeof ORDNANCE_CALLS)[number];

const inList = <T extends string>(list: readonly T[], name: string): name is T => (list as readonly string[]).includes(name);
export const isFxCall = (n: string): n is FxCall => inList(FX_CALLS, n);
export const isWfxCall = (n: string): n is WfxCall => inList(WFX_CALLS, n);
export const isOrdnanceCall = (n: string): n is OrdnanceCall => inList(ORDNANCE_CALLS, n);

/** Call a replicated method by name with decoded arguments (the one place the argument types are erased). */
export function replay<T extends object>(target: T, method: keyof T & string, args: unknown[]): unknown {
  return (target[method] as unknown as (...a: unknown[]) => unknown).apply(target, args);
}
