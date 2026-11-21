import type { ItemInstance } from '@riftwarden/rules/loot/types';
import type { Profile } from '../progression/Profile';
import type { RunLedger } from '@riftwarden/rules/progression/run';
import { bankNodeRewards, saveMapProgress } from '@riftwarden/rules/progression/save';
import { getTier, type ThreatTier } from '@riftwarden/rules/progression/tiers';
import { actEffects, type RunCarry, towerRefund } from '@riftwarden/rules/runmap/carry';
import { type MapNode, nodeEffect, segmentTier } from '@riftwarden/rules/runmap/map';
import { defaultEntry, findNode, liveNode, nodePlayable, pathCode, reachable } from '@riftwarden/rules/war/world';
import { buffEffect, type WarState } from '@riftwarden/rules/war/state';
import type { RunMapState } from '@riftwarden/rules/runmap/state';
import type { RunMapView } from '@riftwarden/rules/runmap/view';
import type { NodeSetup } from '../arena/RunNode';
import type { SlotId } from '@riftwarden/rules/progression/items';
import { MODE_EFFECT, type RunMode } from '@riftwarden/rules/runmap/defs';

/** What the map session reads from the live arena (narrow: no Game import). */
export interface MapArena {
  readonly node: { readonly node: MapNode; readonly carry: RunCarry; readonly complete: boolean; exportCarry(): RunCarry } | null;
  readonly wallet: { cores: number };
  readonly loot: { count: number };
  readonly turrets: { turrets: readonly { paid: number; wrecked: boolean; temporary?: boolean }[] };
  readonly planner: { readonly seed: number };
  syncStats(): void;
  /** Sustained weapon DPS of the current loadout (node intel). */
  firepower(): number;
}

/**
 * The run-map side of a solo run (session flow helper): the persisted map state, node entry/completion
 * bookkeeping, banking what a node left unsecured, the resume point and the map screen view.
 */
export class MapSession {
  /** Hub-banking step guard (mirrors activeRun.nodeBank). */
  private step: number;

  constructor(
    private profile: Profile,
    readonly run: RunLedger,
    readonly state: RunMapState,
    /** Deploy-time loadout (profile-owned items; carried by every node). */
    readonly carried: Partial<Record<SlotId, ItemInstance | null>>,
    step = 0,
    /** Defense or survival (every node of the run plays it). */
    readonly mode: RunMode = 'defense',
  ) {
    this.step = step;
    this.sync();
  }

  get seed(): number {
    return this.state.seed;
  }

  /** Nodes the run can travel to now. */
  reachable(): MapNode[] {
    return reachable(this.state.seed, this.war(), this.state.current);
  }

  /** The shared war (live modifiers, unlocked regions); set by the flow. */
  war: () => WarState | null = () => null;

  /** The node to enter first: the chosen node when its region is unlocked, else the front's landing. */
  entry(id?: string | null): MapNode {
    const war = this.war();
    if (id && nodePlayable(war, id) && findNode(this.state.seed, id)) return findNode(this.state.seed, id)!;
    return findNode(this.state.seed, war ? defaultEntry(war) : 'r0n0')!;
  }

  /** Arena configuration for a node: the segment's effective tier, its setup and the run's tower tech. */
  configFor(node0: MapNode, carry: RunCarry | null, baseTier: ThreatTier, mode: RunMode = this.mode): { tier: ThreatTier; setup: NodeSetup } {
    // Live war state at the moment of entry: corruption, stronghold, events, order buffs.
    const war = this.war();
    const node = liveNode(this.state.seed, war, node0.id) ?? node0;
    const effect = nodeEffect(node, [...actEffects(carry ?? { curses: [], blessings: [] }), MODE_EFFECT[mode], buffEffect(war, Date.now())]);
    return { tier: segmentTier(baseTier, effect), setup: { node, mapSeed: this.state.seed, carry, effect } };
  }

  /** The run entered a node: path and act advance (saved; the resume point stays at the last completed node). */
  entered(node: MapNode): void {
    const s = this.state;
    s.current = node.id;
    s.act = node.act;
    // A resumed node is entered again: it is already on the path.
    if (s.path[s.path.length - 1] !== node.id) s.path.push(node.id);
    this.sync();
    this.persist();
  }

  /** An act boss fell. */
  actCleared(): void {
    this.state.actsCleared++;
    this.sync();
  }

  /**
   * Leave the current node (travel to `next`, or extract when null): bank what is still unsecured, count the node,
   * store the resume point. Returns the carry for the next node.
   */
  leave(arena: MapArena, next: string | null): RunCarry | null {
    const carry = arena.node?.exportCarry() ?? null;
    this.bankLeftovers();
    const s = this.state;
    s.cleared++;
    s.carry = next ? carry : null;
    s.next = next;
    arena.syncStats();
    s.ledger = next ? this.run.exportState() : null;
    this.sync();
    this.persist();
    return carry;
  }

  /** Bank whatever the node added after its checkpoint (hub rewards, late pickups). */
  bankLeftovers(): boolean {
    const moved = this.run.bankNode();
    if (!moved || this.run.survival.dev) return false;
    if (!moved.items.length && !moved.salvage && !moved.credits && !moved.components && !moved.shards && !moved.xp) return true;
    this.step++;
    const step = this.step;
    return this.profile.mutate((d) => bankNodeRewards(d, this.run.id, step, moved)) && this.profile.lastWriteOk;
  }

  /** Keep the ledger's map summary current (finalize copies it into the run result). */
  sync(): void {
    const s = this.state;
    this.run.map = { act: s.act, nodes: s.cleared, actsCleared: s.actsCleared, path: pathCode(s.path, s.seed) };
  }

  persist(): void {
    if (this.run.survival.dev) return;
    this.profile.mutate((d) => saveMapProgress(d, this.run.id, this.state));
  }

  /** The map screen's data for the current arena. */
  view(arena: MapArena | null): RunMapView {
    const s = this.state;
    const carry = arena?.node?.carry;
    return {
      seed: s.seed,
      act: s.act,
      current: s.current,
      path: [...s.path],
      reachable: this.reachable().map((n) => n.id),
      // The node on screen counts once it is secured.
      cleared: s.cleared + (arena?.node?.complete ? 1 : 0),
      actsCleared: s.actsCleared,
      cores: arena?.wallet.cores ?? 0,
      refund: arena ? towerRefund(arena.turrets.turrets.filter((t) => !t.temporary)) : 0,
      leftBehind: arena?.loot.count ?? 0,
      curses: [...(carry?.curses ?? [])],
      blessings: [...(carry?.blessings ?? [])],
      lastWave: this.run.wavesCleared,
      plannerSeed: arena?.planner.seed ?? 0,
      tier: this.run.tier,
      mode: this.mode,
      dps: arena?.firepower() ?? 0,
    };
  }

  /** Node by id (any act of this map). */
  node(id: string): MapNode | null {
    return findNode(this.state.seed, id);
  }

  static tierOf(id: number): ThreatTier {
    return getTier(id);
  }
}
