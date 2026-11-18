import type { OpResult } from './ops';
import type { SaveData } from './save';

/** Tutorial operations (filled by the onboarding module). */
export const TUTORIAL_OPS: Record<string, { args: ('str' | 'str?' | 'int' | 'bool' | 'strs' | 'num' | 'json')[]; run(d: SaveData, a: unknown[], txId: string | undefined): OpResult }> = {};
