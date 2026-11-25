// Browser automation API (`window.__rift` with `?test`): state, fixed-step simulation, debug actions.
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { buildWeaponModel } from '@riftwarden/game/weapons/model';
import { rarity, type RarityId } from '@riftwarden/rules/loot/rarity';
import { generateUnique, uniqueDef } from '@riftwarden/rules/loot/uniques';
import { generateItem } from '@riftwarden/rules/loot/generate';
import type { Category, ItemInstance } from '@riftwarden/rules/loot/types';
import * as TX from '@riftwarden/rules/economy/transactions';
import { equipFromStorage, uninstallModule, type SaveData } from '@riftwarden/rules/progression/save';
import type { DevTools } from '@riftwarden/game/arena/DevTools';
import { SurvivalPlanner } from '@riftwarden/rules/survival/plan';
import { lootLevel } from '@riftwarden/rules/progression/tiers';
import { hudStore, uiEvents } from '@riftwarden/game/ui/store';
import { Flow } from './Flow';

/** Debug ids/seeds from the browser's CSPRNG (Web Crypto; `crypto` from Node is not available in the bundle). */
const randomU32 = (): number => globalThis.crypto.getRandomValues(new Uint32Array(1))[0];

/** Debug/test surface (window.__rift in ?test mode). */
export function debugApi(flow: Flow) {
  const stepOnce = () => {
    const w = flow.world;
    if (!w || flow.busy) return;
    w.step(1 / 60, 60);
    flow.input.endFrame();
  };
  return {
    flow,
    profile: flow.profile,
    get game() {
      return flow.arena;
    },
    get home() {
      return flow.home;
    },
    state: () => ({
      ...(flow.arena ? flow.arena.snapshot() : flow.home ? flow.home.snapshot() : {}),
      location: flow.location,
      screen: hudStore.get().screen,
      busy: flow.busy,
      transitions: flow.transitions,
      salvage: flow.profile.save.resources.salvage,
      tierSelected: flow.profile.save.threat.selected,
      tierUnlocked: flow.profile.save.threat.unlocked,
      runs: flow.profile.save.totals.runs,
      activeRun: flow.profile.save.activeRun?.id ?? null,
    }),
    /** Run the simulation at a fixed 60 Hz for `seconds` without rendering. */
    advance: (seconds: number) => {
      const n = Math.round(seconds * 60);
      for (let i = 0; i < n; i++) stepOnce();
    },
    /** Show the loading screen for an arena seed without loading anything (screenshots / visual checks). */
    previewLoading: (seed: number, stage = 1) => {
      const layout = Flow.layoutFor(seed);
      hudStore.set({ screen: 'transit', transit: { title: 'DEPLOYING · THREAT TIER II', sub: `${layout.name} · Hardened`, kind: 'arena', stage, sector: { name: layout.name ?? '', code: layout.code ?? '', layout, tier: 'II', tierName: 'HARDENED' } } });
    },
    stopLoop: () => {
      flow.engine.stopRenderLoop();
      flow.loopStopped = true;
      if (flow.world) flow.world.scene.useConstantAnimationDeltaTime = true;
    },
    render: (frames = 1) => {
      for (let i = 0; i < frames; i++) flow.world?.scene.render();
    },
    look: (yaw: number, pitch: number) => {
      const p = flow.arena?.player ?? flow.home?.player;
      if (p) {
        p.yaw = yaw;
        p.pitch = pitch;
      }
    },
    /** Kill every active enemy through the real damage pipeline (salvage, kills, feedback). */
    killAll: () => {
      const a = flow.arena;
      if (!a) return 0;
      const list = [...a.enemies.active];
      for (const e of list) a.damageEnemy('player', e, 1e6, e.center(), false);
      return list.length;
    },
    /** Move the player (arena or HQ) to x/z on the floor. */
    teleport: (x: number, z: number, y = 1) => {
      const p = flow.arena?.player ?? flow.home?.player;
      if (!p) return;
      p.controller.setPosition(new Vector3(x, y, z));
      p.controller.setVelocity(Vector3.Zero());
    },
    /** Spawn a generated drop at x/z (arena). Returns the item uid. */
    spawnLoot: (o: { x?: number; z?: number; rarity?: RarityId; category?: Category; baseId?: string; level?: number; seed?: number; set?: ItemInstance['set'] } = {}) => {
      const a = flow.arena;
      if (!a) return null;
      const item = generateItem({
        uid: `${a.cfg.run.id}.dbg${randomU32()}`,
        seed: o.seed ?? randomU32(),
        level: o.level ?? lootLevel(a.cfg.tier, a.waves.number),
        rarity: o.rarity ?? 'rare',
        category: o.category ?? 'weapon',
        baseId: o.baseId,
        allowExclusive: o.baseId ? [o.baseId] : [], source: a.cfg.run.id,
      });
      Object.assign(item, o.set ? { set: o.set } : {});
      const p = a.spawnPickup(item, new Vector3(o.x ?? 0, 1.5, o.z ?? -12), a.waves.number);
      return p ? item.uid : null;
    },
    /** Generate an item without placing it (tests search seeds for specific affixes). */
    makeItem: (o: { seed: number; rarity?: RarityId; category?: Category; baseId?: string; level?: number; fixedRoll?: number }) =>
      generateItem({ uid: `dbg_${o.seed}_${randomU32()}`, seed: o.seed, level: o.level ?? 5, rarity: o.rarity ?? 'rare', category: o.category, baseId: o.baseId, source: flow.arena?.cfg.run.id ?? 'debug', fixedRoll: o.fixedRoll }),
    /** A hand-made unique (loot/uniques.ts) at a level. */
    makeUnique: (id: string, seed = 1, level = 5) => {
      const def = uniqueDef(id);
      return def ? generateUnique(def, { uid: `dbg_u_${id}_${randomU32()}`, seed, level, source: flow.arena?.cfg.run.id ?? 'debug' }) : null;
    },
    /** Put an item straight into the run cargo (as if picked up). */
    grant: (item: ReturnType<typeof generateItem>) => {
      const a = flow.arena;
      if (!a || !a.inventory.collect(item)) return false;
      a.inventoryVersion++;
      return true;
    },
    V3: Vector3,
    /** Encounter plan a run with upgrade seed `seed` on `tier` will follow (same derivation as Game). */
    planFor: (seed: number, tier: number, n: number) => new SurvivalPlanner((seed >>> 0) ^ 0x6d2b79f5, tier).plan(n),
    /** M6 development tools (every call marks the run as non-record-eligible). */
    dev: {
      jump: (n: number) => flow.arena?.dev.jump(n),
      spawn: (kind: Parameters<DevTools['spawn']>[0], mods: Parameters<DevTools['spawn']>[1] = [], gate: Parameters<DevTools['spawn']>[2] = 'north') => flow.arena?.dev.spawn(kind, mods, gate) ?? null,
      force: (o: Parameters<DevTools['force']>[0]) => flow.arena?.dev.force(o),
      evolve: (id: Parameters<DevTools['evolve']>[0]) => flow.arena?.dev.evolve(id),
      reset: () => flow.arena?.dev.reset(),
      /** Deploy on any tier (ignores unlocks) as a development session. */
      deploy: (tier: number) => flow.devDeploy(tier),
    },
    /** Damage the reactor through the real path (defeat when it reaches 0). */
    damageReactor: (amount: number) => flow.arena?.debugDamageReactor(amount),
    /** Pickups currently in the arena (id, uid, rarity, distance to the player, landed). */
    pickups: () => {
      const a = flow.arena;
      if (!a) return [];
      const pp = a.player.position;
      return a.loot.pickups.map((p) => ({ id: p.id, uid: p.item.uid, name: p.item.name, rarity: p.item.rarity, category: p.item.category, droppedWave: p.droppedWave, x: p.ground.x, z: p.ground.z, dist: Math.hypot(p.ground.x - pp.x, p.ground.z - pp.z), landed: a.loot.landed(p), expiring: p.expiring }));
    },
    /** Stand next to a pickup and face its hologram. */
    approach: (id: number) => {
      const a = flow.arena;
      const p = a?.loot.pickups.find((q) => q.id === id);
      if (!a || !p) return false;
      const pl = a.player;
      const x = p.ground.x;
      const z = p.ground.z - 2;
      pl.controller.setPosition(new Vector3(x, p.ground.y + 1, z));
      pl.controller.setVelocity(Vector3.Zero());
      pl.yaw = Math.atan2(p.focus.x - x, p.focus.z - z);
      pl.pitch = 0.05;
      return true;
    },
    /**
     * Visual QA: show weapon models for `items` in front of the camera (rendering group 1),
     * stacked vertically, 3/4 side view. Returns a disposer.
     */
    lab: (items: ItemInstance[], o: { yaw?: number; pitch?: number; scale?: number; spacing?: number; x?: number } = {}) => {
      const sc = flow.world?.scene;
      const cam = sc?.activeCamera;
      if (!sc || !cam) return null;
      const rigs = items.map((it, i) => {
        const rig = buildWeaponModel(sc, it.build!, it.socketed, { renderingGroupId: 1, name: 'lab', mount: false, element: it.weapon?.element, uniqueId: it.uniqueId }, rarity(it.rarity).index);
        rig.root.parent = cam;
        const sp = o.spacing ?? 0.3;
        rig.root.position.set(o.x ?? 0, ((items.length - 1) / 2 - i) * sp - 0.04, 1.25);
        rig.root.rotation.set(o.pitch ?? 0.12, -Math.PI / 2 + (o.yaw ?? 0.45), 0);
        rig.root.scaling.setAll(o.scale ?? 1);
        rig.root.position.x -= ((rig.front + rig.rear) / 2) * (o.scale ?? 1) * 0;
        return rig;
      });
      if (flow.arena) flow.arena.weapon.setVisible(false);
      document.body.classList.add('lab');
      return () => rigs.forEach((r) => r.dispose());
    },
    /**
     * M4 economy: run a transaction from economy/transactions.ts through Profile.transact
     * (validated, persisted, rolled back on failed writes), e.g. econ('buyItem', 'equipment', id).
     */
    econ: (name: keyof typeof TX, ...args: unknown[]) => {
      const fn = TX[name] as unknown as (d: SaveData, ...a: unknown[]) => { ok: boolean };
      return flow.profile.transact((d) => fn(d, ...args));
    },
    econPure: TX,
    equipFromStorage,
    uninstallModule,
    /** Resource counters for leak checks across transitions. */
    leakStats: () => {
      const sc = flow.world?.scene;
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return {
        scenes: flow.engine.scenes.length,
        textures: flow.engine.getLoadedTexturesCache().length,
        meshes: sc?.meshes.length ?? 0,
        materials: sc?.materials.length ?? 0,
        lights: sc?.lights.length ?? 0,
        particleSystems: sc?.particleSystems.length ?? 0,
        postProcesses: sc?.postProcesses.length ?? 0,
        hudListeners: hudStore.listenerCount,
        uiListeners: uiEvents.listenerCount(),
        profileListeners: flow.profile.store.listenerCount,
        heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
      };
    },
  };
}
