// Warden-to-warden trading (trade window in a co-op lobby). The sim worker runs the live session; when both
// sides confirm, the gateway applies one trusted `trade` entry to each profile inside one database transaction,
// so either both changes land or neither does. Pure rules shared by worker, gateway replay and the UI. [pure]
import { isUnlocked, lockReason } from '../progression/unlocks';
import type { ItemInstance } from '../loot/types';
import { allOwnedUids, itemByUid, type SaveData, slotOf } from '../progression/save';

export const TRADE = {
  /** Share of the credits that never arrive (the post's cut, a credit sink). */
  tax: 0.1,
  maxItems: 6,
  maxCredits: 10_000_000,
  /** Account age the gateway requires (days); checked server-side against the account record. */
  accountDays: 7,
  /** Seconds a trade window stays open without both confirmations. */
  timeout: 180,
} as const;

/** What one side puts on the table. */
export interface TradeOffer {
  items: string[];
  credits: number;
}

/** One side's change, applied as a trusted log entry (`LogEntry.trade`). */
export interface TradeEntry {
  /** Trade id (also the log device of the entry: a trade applies at most once). */
  id: string;
  give: string[];
  giveCredits: number;
  get: ItemInstance[];
  getCredits: number;
}

export const creditsAfterTax = (credits: number): number => Math.floor(Math.max(0, credits) * (1 - TRADE.tax));

/** Why an item can never be traded (null = tradeable). */
export function tradeLock(item: ItemInstance): string | null {
  if (item.rarity === 'ascended') return 'Ascended items stay with the warden who earned them';
  if (item.bound) return 'Pinnacle items stay with the warden who earned them';
  if (item.uid.startsWith('starter')) return 'Starter gear cannot be traded';
  return null;
}

/** Why this profile cannot trade at all (null = it can). The account-age rule is the gateway's. */
export function tradeGate(d: SaveData): string | null {
  if (!isUnlocked(d, 'trading')) return lockReason(d, 'trading') ?? 'Trading is locked';
  if (d.activeRun) return 'Finish your operation first';
  return null;
}

/** Why `offer` is not a valid offer from `d` (null = valid). */
export function offerProblem(d: SaveData, offer: TradeOffer): string | null {
  const gate = tradeGate(d);
  if (gate) return gate;
  if (!Array.isArray(offer.items) || offer.items.length > TRADE.maxItems) return `At most ${TRADE.maxItems} items per trade`;
  if (new Set(offer.items).size !== offer.items.length) return 'An item is offered twice';
  if (!Number.isInteger(offer.credits) || offer.credits < 0 || offer.credits > TRADE.maxCredits) return 'Invalid credit amount';
  if (offer.credits > d.resources.credits) return 'Not enough credits';
  for (const uid of offer.items) {
    const it = itemByUid(d, uid);
    if (!it) return 'You no longer own an offered item';
    if (slotOf(d, uid)) return `${it.name} is equipped: unequip it first`;
    if (!d.storage.uids.includes(uid)) return `${it.name} is not in storage`;
    if (it.locked) return `${it.name} is locked: unlock it at the reclamation press first`;
    const lock = tradeLock(it);
    if (lock) return lock;
  }
  return null;
}

/** The entry each side's profile receives once both confirmed (credits arrive after tax). */
export function tradeEntries(id: string, a: { doc: SaveData; offer: TradeOffer }, b: { doc: SaveData; offer: TradeOffer }): [TradeEntry, TradeEntry] {
  const items = (d: SaveData, uids: string[]) => uids.map((u) => structuredClone(itemByUid(d, u)!));
  const fromA = items(a.doc, a.offer.items);
  const fromB = items(b.doc, b.offer.items);
  return [
    { id, give: [...a.offer.items], giveCredits: a.offer.credits, get: fromB, getCredits: creditsAfterTax(b.offer.credits) },
    { id, give: [...b.offer.items], giveCredits: b.offer.credits, get: fromA, getCredits: creditsAfterTax(a.offer.credits) },
  ];
}

/**
 * Apply one side of a trade (trusted entry). Validates everything first; returns a reason and leaves `d`
 * untouched when the trade cannot apply (the gateway then rolls back both sides).
 */
export function applyTrade(d: SaveData, e: TradeEntry, sanitize: (v: unknown) => ItemInstance | null): string | null {
  if (!e || typeof e.id !== 'string' || !Array.isArray(e.give) || !Array.isArray(e.get)) return 'malformed trade';
  const bad = offerProblem(d, { items: e.give, credits: e.giveCredits });
  if (bad) return bad;
  if (!Number.isInteger(e.getCredits) || e.getCredits < 0 || e.getCredits > TRADE.maxCredits) return 'Invalid credit amount';
  if (e.get.length > TRADE.maxItems) return `At most ${TRADE.maxItems} items per trade`;
  const incoming = e.get.map((v) => sanitize(v));
  if (incoming.some((i) => !i)) return 'An incoming item is invalid';
  const owned = new Set(allOwnedUids(d));
  for (const it of incoming as ItemInstance[]) {
    if (owned.has(it.uid) || it.socketed?.some((m) => m && owned.has(m.uid))) return 'You already own an incoming item';
    if (tradeLock(it)) return 'An incoming item is trade-locked';
  }
  const after = d.storage.uids.length - e.give.length + incoming.length;
  if (after > d.storage.capacity) return `Not enough storage (${after}/${d.storage.capacity})`;
  const gone = new Set(e.give);
  d.items = d.items.filter((i) => !gone.has(i.uid));
  d.storage.uids = d.storage.uids.filter((u) => !gone.has(u));
  for (const it of incoming as ItemInstance[]) {
    d.items.push(it);
    d.storage.uids.push(it.uid);
  }
  d.resources.credits += e.getCredits - e.giveCredits;
  // Presets that referenced a traded item forget it (like selling).
  for (const p of d.presets ?? []) for (const k of Object.keys(p.slots ?? {}) as (keyof typeof p.slots)[]) if (p.slots[k] && gone.has(p.slots[k]!)) p.slots[k] = null;
  return null;
}
