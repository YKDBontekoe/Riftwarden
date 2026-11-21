// Co-op snapshot object (ServerGame.netSnapshot + personal block) <-> protobuf `Snapshot`.
// Values the simulation already rounds travel as scaled integers; decoding divides them back, which
// yields the same doubles as the server's own `Math.round(v * k) / k`.
import type { MessageInitShape } from '@bufbuild/protobuf';
import type { Snapshot, SnapshotSchema } from './gen/riftwarden/v1/snapshot_pb';
import { fromDoc, fromValue, toDoc, toValueInit } from './value';

type SnapshotInit = MessageInitShape<typeof SnapshotSchema>;
type Row = readonly unknown[];

const q = (v: unknown, k: number) => Math.round((v as number) * k);
const n = (v: unknown) => v as number;
const b = (v: unknown) => v === 1 || v === true;
const f = (v: boolean) => (v ? 1 : 0);

export function snapshotToProto(s: Record<string, unknown>): SnapshotInit {
  const w = s.w as Row;
  const tac = s.tac as Row;
  const cp = s.cp as Row;
  const of = s.of as Row | 0;
  const me = s.me as Record<string, unknown> | undefined;
  return {
    t: n(s.t),
    wave: { number: n(w[0]), phase: w[1] as string, timerD: q(w[2], 10), enemiesLeft: n(w[3]), remainingToSpawn: n(w[4]) },
    reactor: n(s.r),
    cores: n(s.c),
    tactical: { energy: n(tac[0]), active: b(tac[1]), hostileScaleC: q(tac[2], 100) },
    enemies: (s.e as Row[]).map((e) => {
      const ai = e[15];
      return {
        id: n(e[0]),
        xCm: q(e[1], 100),
        yCm: q(e[2], 100),
        zCm: q(e[3], 100),
        yawMrad: q(e[4], 1000),
        hp: n(e[5]),
        maxHp: n(e[6]),
        shield: n(e[7]),
        armor: n(e[8]),
        attacking: b(e[9]),
        chargeC: q(e[10], 100),
        buffD: q(e[11], 10),
        boostD: q(e[12], 10),
        dischargeC: q(e[13], 100),
        status: (e[14] as number[]).map((x) => Math.round(x)),
        ai: ai && typeof ai === 'object' ? Object.fromEntries(Object.entries(ai).map(([k, v]) => [k, toValueInit(v)])) : {},
        seg: n(e[16]),
      };
    }),
    avatars: (s.a as Row[]).map((a) => ({
      id: a[0] as string,
      xCm: q(a[1], 100),
      yCm: q(a[2], 100),
      zCm: q(a[3], 100),
      yawMrad: q(a[4], 1000),
      pitchMrad: q(a[5], 1000),
      hp: n(a[6]),
      maxHp: n(a[7]),
      shield: n(a[8]),
      maxShield: n(a[9]),
      alive: b(a[10]),
      respawnD: q(a[11], 10),
      respawns: n(a[12]),
      flags: n(a[13]),
      heatC: q(a[14], 100),
      family: a[15] as string,
      connected: b(a[16]),
      speedD: q(a[17], 10),
      vote: n(a[18]),
      name: a[19] as string,
    })),
    towers: (s.tw as Row[]).map((t) => ({
      id: n(t[0]),
      yawMrad: q(t[1], 1000),
      pitchMrad: q(t[2], 1000),
      disabled: b(t[3]),
      empowered: b(t[4]),
      building: b(t[5]),
      kills: n(t[6]),
      damage: n(t[7]),
      hp: n(t[8]),
      maxHp: n(t[9]),
      wrecked: b(t[10]),
    })),
    telegraphs: (s.tl as number[][]).map((v) => ({ v })),
    ordnance: (s.or as number[][]).map((v) => ({ v })),
    survival: toValueInit(s.sv),
    boss: toValueInit(s.boss),
    checkpoint: { open: b(cp[0]), atCheckpoint: b(cp[1]), voteOpen: b(cp[2]), voteSeconds: n(cp[3]) },
    offer: of ? { ids: of[0] as string[], chooser: (of[1] as string | null) ?? undefined, seconds: n(of[2]) } : undefined,
    upgrades: n(s.ups),
    node: toValueInit(s.nd),
    mapVote: toValueInit(s.mv),
    hostileT: n(s.ht),
    me: me
      ? {
          seq: n(me.seq),
          run: toValueInit(me.run),
          ult: n(me.ult),
          inventory: me.inv === undefined ? undefined : toDoc(me.inv),
          stats: me.st === undefined ? undefined : toDoc(me.st),
        }
      : undefined,
  };
}

export function snapshotFromProto(p: Snapshot): Record<string, unknown> {
  const w = p.wave;
  const tac = p.tactical;
  const cp = p.checkpoint;
  const out: Record<string, unknown> = {
    t: p.t,
    w: [w?.number ?? 0, w?.phase ?? '', (w?.timerD ?? 0) / 10, w?.enemiesLeft ?? 0, w?.remainingToSpawn ?? 0],
    r: p.reactor,
    c: p.cores,
    tac: [tac?.energy ?? 0, f(!!tac?.active), (tac?.hostileScaleC ?? 0) / 100],
    e: p.enemies.map((e) => {
      const keys = Object.keys(e.ai);
      return [
        e.id,
        e.xCm / 100,
        e.yCm / 100,
        e.zCm / 100,
        e.yawMrad / 1000,
        e.hp,
        e.maxHp,
        e.shield,
        e.armor,
        f(e.attacking),
        e.chargeC / 100,
        e.buffD / 10,
        e.boostD / 10,
        e.dischargeC / 100,
        [...e.status],
        keys.length ? Object.fromEntries(keys.map((k) => [k, fromValue(e.ai[k])])) : 0,
        e.seg,
      ];
    }),
    a: p.avatars.map((a) => [
      a.id,
      a.xCm / 100,
      a.yCm / 100,
      a.zCm / 100,
      a.yawMrad / 1000,
      a.pitchMrad / 1000,
      a.hp,
      a.maxHp,
      a.shield,
      a.maxShield,
      f(a.alive),
      a.respawnD / 10,
      a.respawns,
      a.flags,
      a.heatC / 100,
      a.family,
      f(a.connected),
      a.speedD / 10,
      a.vote,
      a.name,
    ]),
    tw: p.towers.map((t) => [t.id, t.yawMrad / 1000, t.pitchMrad / 1000, f(t.disabled), f(t.empowered), f(t.building), t.kills, t.damage, t.hp, t.maxHp, f(t.wrecked)]),
    tl: p.telegraphs.map((x) => [...x.v]),
    or: p.ordnance.map((x) => [...x.v]),
    sv: fromValue(p.survival),
    boss: fromValue(p.boss),
    cp: [f(!!cp?.open), f(!!cp?.atCheckpoint), f(!!cp?.voteOpen), cp?.voteSeconds ?? 0],
    of: p.offer ? [[...p.offer.ids], p.offer.chooser ?? null, p.offer.seconds] : 0,
    ups: p.upgrades,
    nd: fromValue(p.node),
    mv: fromValue(p.mapVote),
    ht: p.hostileT,
  };
  if (p.me) {
    const me: Record<string, unknown> = { seq: p.me.seq, run: fromValue(p.me.run), ult: p.me.ult };
    if (p.me.inventory) me.inv = fromDoc(p.me.inventory);
    if (p.me.stats) me.st = fromDoc(p.me.stats);
    out.me = me;
  }
  return out;
}
