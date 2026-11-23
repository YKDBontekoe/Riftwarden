// Staged unlocks on the session side: announce features as they open, and the automation switch.
import { generateMarket } from '@riftwarden/rules/economy/market';
import { marketProgress } from '@riftwarden/rules/progression/save';
import { newlyUnlocked, setUnlockAll, unlockAllActive } from '@riftwarden/rules/progression/unlocks';
import { sfx } from '@riftwarden/game/audio/Sfx';
import type { Profile } from '@riftwarden/game/progression/Profile';
import { hudStore, uiEvents } from '@riftwarden/game/ui/store';

/** Banner as soon as features open, plus an HQ toast until seen. A profile switch (sign-in) only resets. */
export function watchUnlocks(profile: Profile): void {
  const snap = () => {
    const s = profile.save;
    return { id: s.profile.id, progress: { xp: s.progress.xp }, threat: { unlocked: s.threat.unlocked } };
  };
  let prev = snap();
  profile.store.subscribe(() => {
    const next = snap();
    const opened = next.id === prev.id ? newlyUnlocked(prev, next) : [];
    prev = next;
    if (!opened.length || unlockAllActive()) return;
    const at = Date.now();
    uiEvents.emit('banner', { title: opened.length === 1 ? `UNLOCKED · ${opened[0].label.toUpperCase()}` : `${opened.length} NEW UNLOCKS`, sub: opened.length === 1 ? opened[0].blurb : opened.map((u) => u.label).join(' · '), tone: 'cyan' });
    sfx.play('chargeReady');
    const list = [...(hudStore.get().unlocks ?? []), ...opened.map((u) => ({ id: u.id, label: u.label, blurb: u.blurb, at }))];
    hudStore.set({ unlocks: list.slice(-24) });
  });
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
