// Live trade windows between two members of one co-op lobby. The desk validates every offer against the
// worker's copy of both profiles (economy/trade.ts); when both sides locked in and confirmed, it asks the gateway
// to apply both trusted entries in one transaction and reports the outcome to both players.
import type { ServerMsg, TradeOp, TradeSideView, TradeView } from '@riftwarden/protocol/protocol';
import { applyTrade, offerProblem, TRADE, type TradeEntry, type TradeOffer, tradeEntries, tradeGate } from '@riftwarden/rules/economy/trade';
import { itemByUid, sanitizeItem, type SaveData } from '@riftwarden/rules/progression/save';

interface Party {
  id: string;
  name: string;
  offer: TradeOffer;
  locked: boolean;
  confirmed: boolean;
}

interface Trade {
  id: string;
  a: Party;
  b: Party;
  status: TradeView['status'];
  reason: string;
  expiresAt: number;
}

export interface TradeDeskDeps {
  /** Current profile of a player this worker holds (null = unknown). */
  profile(id: string): { data: SaveData } | null;
  send(id: string, msg: ServerMsg): void;
  /** Ask the gateway to apply both sides atomically; the answer arrives through `result`. */
  commit(t: { id: string; a: string; b: string; entryA: TradeEntry; entryB: TradeEntry }): void;
  now(): number;
  newId(): string;
}

/** Who the player may trade with: another connected member of the same lobby. */
export interface TradeContext {
  me: { id: string; name: string };
  /** Members of the player's room (connected), or null when they are in no lobby. */
  roomMembers: { id: string; name: string }[] | null;
  inLobby: boolean;
}

export class TradeDesk {
  private readonly byPlayer = new Map<string, Trade>();

  constructor(private readonly deps: TradeDeskDeps) {}

  /** One trade command; returns an error message for the sender or null. */
  command(ctx: TradeContext, msg: { op: TradeOp; with?: string; items?: string[]; credits?: number }): string | null {
    const me = ctx.me.id;
    const t = this.byPlayer.get(me);
    if (msg.op === 'open') return this.open(ctx, msg.with ?? '');
    if (!t) return 'You are not trading';
    if (msg.op === 'cancel') {
      if (t.status === 'committing') return 'The trade is being applied';
      this.close(t, null);
      return null;
    }
    if (t.status !== 'open') return t.status === 'committing' ? 'The trade is being applied' : 'This trade is over';
    const side = t.a.id === me ? t.a : t.b;
    const other = side === t.a ? t.b : t.a;
    switch (msg.op) {
      case 'offer': {
        const offer = { items: msg.items ?? [], credits: msg.credits ?? 0 };
        const prof = this.deps.profile(me);
        const bad = prof ? offerProblem(prof.data, offer) : 'Your profile has not synced yet';
        if (bad) return bad;
        side.offer = offer;
        // Any change unlocks both sides (what you locked in is what you get).
        this.unlockAll(t);
        break;
      }
      case 'lock':
        side.locked = true;
        break;
      case 'unlock':
        this.unlockAll(t);
        break;
      case 'confirm': {
        if (!side.locked || !other.locked) return 'Both sides must lock in first';
        side.confirmed = true;
        if (other.confirmed) return this.finish(t);
        break;
      }
    }
    t.reason = '';
    t.expiresAt = this.deps.now() + TRADE.timeout * 1000;
    this.push(t);
    return null;
  }

  private open(ctx: TradeContext, withId: string): string | null {
    const me = ctx.me.id;
    if (!ctx.roomMembers || !ctx.inLobby) return 'Trading happens in a co-op lobby';
    if (withId === me) return 'You cannot trade with yourself';
    const them = ctx.roomMembers.find((m) => m.id === withId);
    if (!them) return 'That warden is not in your lobby';
    if (this.byPlayer.has(me)) return 'Finish your current trade first';
    if (this.byPlayer.has(withId)) return `${them.name} is already trading`;
    for (const id of [me, withId]) {
      const p = this.deps.profile(id);
      const gate = p ? tradeGate(p.data) : 'profile not synced';
      if (gate) return id === me ? gate : `${them.name} cannot trade yet (${gate})`;
    }
    const party = (id: string, name: string): Party => ({ id, name, offer: { items: [], credits: 0 }, locked: false, confirmed: false });
    const t: Trade = { id: this.deps.newId(), a: party(me, ctx.me.name), b: party(withId, them.name), status: 'open', reason: '', expiresAt: this.deps.now() + TRADE.timeout * 1000 };
    this.byPlayer.set(me, t);
    this.byPlayer.set(withId, t);
    this.push(t);
    return null;
  }

  private unlockAll(t: Trade): void {
    for (const s of [t.a, t.b]) {
      s.locked = false;
      s.confirmed = false;
    }
  }

  /** Both confirmed: check both sides again on fresh copies, then hand the entries to the gateway. */
  private finish(t: Trade): string | null {
    const pa = this.deps.profile(t.a.id);
    const pb = this.deps.profile(t.b.id);
    if (!pa || !pb) return this.fail(t, 'A profile is not synced');
    const [entryA, entryB] = tradeEntries(t.id, { doc: pa.data, offer: t.a.offer }, { doc: pb.data, offer: t.b.offer });
    const dry = (d: SaveData, e: TradeEntry) => applyTrade(structuredClone(d), e, (v) => sanitizeItem(v));
    const bad = dry(pa.data, entryA) ?? dry(pb.data, entryB);
    if (bad) return this.fail(t, bad);
    t.status = 'committing';
    t.reason = '';
    this.push(t);
    this.deps.commit({ id: t.id, a: t.a.id, b: t.b.id, entryA, entryB });
    return null;
  }

  /** A check failed before committing: both sides unlock and see why. */
  private fail(t: Trade, reason: string): null {
    this.unlockAll(t);
    t.reason = reason;
    this.push(t);
    return null;
  }

  /** The gateway applied (or refused) the trade. */
  result(id: string, ok: boolean, reason: string): void {
    const t = [...new Set(this.byPlayer.values())].find((x) => x.id === id);
    if (!t) return;
    t.status = ok ? 'done' : 'failed';
    t.reason = ok ? '' : reason || 'The trade could not be applied';
    this.push(t);
    this.byPlayer.delete(t.a.id);
    this.byPlayer.delete(t.b.id);
  }

  /** A player left the lobby or disconnected: their trade closes (unless it is already being applied). */
  left(id: string): void {
    const t = this.byPlayer.get(id);
    if (t && t.status === 'open') this.close(t, `${(t.a.id === id ? t.a : t.b).name} left`);
  }

  tick(now = this.deps.now()): void {
    for (const t of new Set(this.byPlayer.values())) if (t.status === 'open' && now > t.expiresAt) this.close(t, 'The trade window timed out');
  }

  private close(t: Trade, reason: string | null): void {
    this.byPlayer.delete(t.a.id);
    this.byPlayer.delete(t.b.id);
    if (reason) {
      t.status = 'failed';
      t.reason = reason;
      this.push(t);
    } else for (const p of [t.a, t.b]) this.deps.send(p.id, { t: 'trade', trade: null });
  }

  private view(t: Trade): TradeView {
    const side = (s: Party): TradeSideView => {
      const d = this.deps.profile(s.id)?.data;
      return { id: s.id, name: s.name, items: d ? s.offer.items.map((u) => itemByUid(d, u)).filter(Boolean) : [], credits: s.offer.credits, locked: s.locked, confirmed: s.confirmed };
    };
    return { id: t.id, a: side(t.a), b: side(t.b), status: t.status, reason: t.reason, expiresAt: t.expiresAt };
  }

  private push(t: Trade): void {
    const v = this.view(t);
    for (const p of [t.a, t.b]) this.deps.send(p.id, { t: 'trade', trade: v });
  }
}
