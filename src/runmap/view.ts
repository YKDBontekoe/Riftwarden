import type { BlessingId, CurseId, NodeKind, NodeModId } from './defs';

/** HUD chip for the current node (published at 20 Hz with the arena HUD). */
export interface NodeHud {
  id: string;
  act: number;
  row: number;
  kind: NodeKind;
  name: string;
  glyph: string;
  /** Wave range of a combat node (null for hubs). */
  waves: [number, number] | null;
  complete: boolean;
  mods: NodeModId[];
  curses: CurseId[];
  blessings: BlessingId[];
  noTowers: boolean;
  /** Station under the crosshair: interaction prompt. */
  prompt: { title: string; sub: string; used: boolean } | null;
  /** Guardians still to defeat (vault / ambush), null when none are active. */
  guardians: number | null;
}

/** Data for the run map screen (published when it opens and when votes change). */
export interface RunMapView {
  seed: number;
  act: number;
  current: string | null;
  path: string[];
  reachable: string[];
  cleared: number;
  actsCleared: number;
  cores: number;
  /** Cores the towers left behind will refund. */
  refund: number;
  /** Uncollected drops that stay behind when the run travels. */
  leftBehind: number;
  curses: CurseId[];
  blessings: BlessingId[];
  /** Waves completed so far (the next combat node starts at lastWave + 1). */
  lastWave: number;
  /** Co-op: votes per player (node id or 'home'), seconds left. */
  votes?: { name: string; vote: string | null; you: boolean; host: boolean }[];
  voteLeft?: number;
  /** Co-op client: a vote is open (the server resolves it). */
  coop?: boolean;
}

/** Station panel (merchant / forge / rest / anomaly / vault) opened with E. */
export interface StationOption {
  id: string;
  label: string;
  text: string;
  price: number | null;
  disabled: string | null;
  /** Merchant items: the item itself (for the item card). */
  item?: import('../loot/types').ItemInstance;
}

export interface StationPanel {
  station: 'merchant' | 'forge' | 'rest' | 'event' | 'vault';
  title: string;
  lore: string;
  options: StationOption[];
  cores: number;
  /** Result line of the last action. */
  note: string;
  /** Single-use station already used. */
  used: boolean;
}
