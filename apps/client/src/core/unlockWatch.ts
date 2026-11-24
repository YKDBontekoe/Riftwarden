// Staged unlocks on the session side: announce features as they open, and the automation switch.
import { generateMarket } from '@riftwarden/rules/economy/market';
import { marketProgress } from '@riftwarden/rules/progression/save';
import { lockedSlots, newlyUnlocked, setUnlockAll, unlockAllActive } from '@riftwarden/rules/progression/unlocks';
import { bestPowers } from '@riftwarden/rules/loot/feedback';
import { ruleOf } from '@riftwarden/rules/progression/seasons';
export { pinnacleBlocker } from '@riftwarden/rules/progression/spikes';
import { breakthroughShards, breakthroughTitle, CODEX } from '@riftwarden/rules/progression/spikes';
import type { SaveData } from '@riftwarden/rules/progression/save';
import { sfx } from '@riftwarden/game/audio/Sfx';
import type { Profile } from '@riftwarden/game/progression/Profile';
import { hudStore, uiEvents } from '@riftwarden/game/ui/store';

/** Banner as soon as features open, plus an HQ toast until seen. A profile switch (sign-in) only resets. */
export function watchUnlocks(profile: Profile): void {
  const snap = () => {
    const s = profile.save;
    return { id: s.profile.id, progress: { xp: s.progress.xp }, threat: { unlocked: s.threat.unlocked }, codex: s.codex?.length ?? 0, bt: [...(s.breakthroughs ?? [])] };
  };
  let prev = snap();
  profile.store.subscribe(() => {
    const next = snap();
    const same = next.id === prev.id;
    const opened = same ? newlyUnlocked(prev, next) : [];
    const codex = same && next.codex > prev.codex ? CODEX.filter((c) => (profile.save.codex ?? []).slice(prev.codex).includes(c.id)) : [];
    const bt = same ? next.bt.filter((x) => !prev.bt.includes(x)) : [];
    prev = next;
    const at0 = Date.now();
    for (const b of bt) {
      uiEvents.emit('banner', { title: `BREAKTHROUGH · RL ${b} CLEARED`, sub: `${breakthroughTitle(b)} · a breakthrough cache and ${breakthroughShards(b)} rift shards are in storage`, tone: 'orange' });
      pushToast([{ id: `bt${b}`, label: `Breakthrough: ${breakthroughTitle(b)}`, blurb: `RL ${b} cleared. Cache item + ${breakthroughShards(b)} rift shards secured in storage.`, at: at0 }]);
    }
    if (codex.length) pushToast(codex.map((c) => ({ id: c.id, label: `Codex: ${c.name}`, blurb: c.shards ? `First find · +${c.shards} rift shards` : 'First find recorded in the codex', at: at0 })));
    if (!opened.length || unlockAllActive()) return;
    const at = Date.now();
    uiEvents.emit('banner', { title: opened.length === 1 ? `UNLOCKED · ${opened[0].label.toUpperCase()}` : `${opened.length} NEW UNLOCKS`, sub: opened.length === 1 ? opened[0].blurb : opened.map((u) => u.label).join(' · '), tone: 'cyan' });
    sfx.play('chargeReady');
    pushToast(opened.map((u) => ({ id: u.id, label: u.label, blurb: u.blurb, at })));
  });
}

function pushToast(entries: NonNullable<ReturnType<typeof hudStore.get>['unlocks']>): void {
  hudStore.set({ unlocks: [...(hudStore.get().unlocks ?? []), ...entries].slice(-24) });
}

/**
 * Automation (`?test` without `&locks`): every staged unlock counts as open, and a fresh profile's first merchant
 * rotation (generated with a fresh warden's locks) is rebuilt without them.
 */
export function unlockAllForTests(profile: Profile): void {
  setUnlockAll(true);
  profile.mutate((d) => {
    if (d.market.rotation !== 0 || d.market.modules.length) return false;
    d.market = generateMarket(d.profile.id, 0, marketProgress(d), d.market.generatedAt);
    return true;
  });
}

/** Profile progress an arena needs at deployment: locked slots, mastery and the best owned item per kind. */
export function arenaProgress(save: SaveData): { lockedSlots: ReturnType<typeof lockedSlots>; mastery: SaveData['progress']['mastery']; ownedBest: Map<string, number>; seasonRule: ReturnType<typeof ruleOf> } {
  return { lockedSlots: lockedSlots(save), mastery: structuredClone(save.progress.mastery), ownedBest: bestPowers(save.items), seasonRule: ruleOf(save) };
}

/** A pinnacle run is harder and luckier throughout (the summoned boss leads wave 1). */
export const PINNACLE_EFFECT = { hp: 1.5, damage: 1.2, luck: 1.3 } as const;
