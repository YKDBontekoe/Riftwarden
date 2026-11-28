import { ScoreCtx } from './compare';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BoundKey } from './hud/widgets';
import { fmtNum } from '@riftwarden/rules/combat/stats';
import type { Game } from '@riftwarden/game/core/Game';
import { rarity, type RarityId } from '@riftwarden/rules/loot/rarity';
import { type Category, CATEGORY_LABEL } from '@riftwarden/rules/loot/types';
import type { ItemInstance } from '@riftwarden/rules/loot/types';
import { type SlotId, SLOTS } from '@riftwarden/rules/progression/items';
import { ComparePanel, type InvEntry, ItemCard, ItemDetail, ItemGlyph } from './items';
import { Crumb, Hint, RiskTag } from './ds';
import { defaultSlot } from '@riftwarden/rules/progression/items';
import { loadoutScore, swapImpact } from '@riftwarden/rules/loot/loadoutScore';
import { keyLabel } from '@riftwarden/game/core/settings';
import { hudStore, type LootEvent, uiEvents } from '@riftwarden/game/ui/store';
import { useHud } from './useHud';
import { FieldIcon, itemIcon } from './FieldIcon';
import { FieldArt } from './FieldArt';

const cat = (c: string) => (CATEGORY_LABEL as Record<string, string>)[c]?.toUpperCase() ?? c.toUpperCase();

/** Targeted pickup: name, rarity, level, category, quick comparison and the E prompt. */
export function LootPrompt() {
  const t = useHud((s) => s.lootTarget);
  if (!t) return null;
  const r = rarity(t.rarity);
  const delta = t.equippedName ? t.level - t.equippedLevel : null;
  return (
    <div key={t.uid} className={`loot-prompt r-${r.id}`} style={{ ['--rc' as string]: r.color }}>
      <BoundKey action="use" />
      {t.uniqueId ? <FieldArt name={`unique-${t.uniqueId}`} className="loot-portrait" /> : t.defId && <ItemGlyph item={{ defId: t.defId, category: t.category as Category, rarity: t.rarity as RarityId }} size={46} portrait={false} />}
      <div>
        <div className="lp-rarity"><FieldIcon name={itemIcon(t.category)} />{' '}
          {r.label.toUpperCase()} · {cat(t.category)} · LV {fmtNum(t.level)}
          {!!t.levelDelta && <span className={t.levelDelta > 0 ? 'text-ok' : 'text-faint'} title="Item levels against what this wave usually drops on this Rift Level"> ({t.levelDelta > 0 ? '+' : ''}{t.levelDelta} vs RL)</span>}
        </div>
        <b>{t.name}</b>
        {t.set && (
          <span className="lp-set" data-testid="lp-set">
            SET · {t.set.toUpperCase()} · {t.setPieces}/4 IF EQUIPPED
          </span>
        )}
        {(t.newBest || t.verdict === 'upgrade') && (
          <span className="flex gap-[6px] mt-[2px]" data-testid="lp-tags">
            {t.newBest && <em className="not-italic font-mono text-[10px] tracking-[0.14em] px-[6px] py-[1px] bg-orange text-[#1d1410]" data-testid="lp-newbest">NEW BEST</em>}
            {t.verdict === 'upgrade' && <em className="not-italic font-mono text-[10px] tracking-[0.14em] px-[6px] py-[1px] border border-ok text-ok" data-testid="lp-upgrade">▲ UPGRADE FOR YOUR BUILD</em>}
          </span>
        )}
        <span className="lp-sub">
          {t.cargoFull ? (
            <i className="bad">CARGO HOLD FULL · discard in preparation <BoundKey action="inventory" /></i>
          ) : t.category === 'module' ? (
            'Upgrade module · stored for engineering'
          ) : t.equippedName ? (
            <>
              vs {t.equippedName} <i className={delta! > 0 ? 'up' : delta! < 0 ? 'down' : ''}>{delta! > 0 ? `▲ +${delta} LV` : delta! < 0 ? `▼ ${delta} LV` : '= LV'}</i>
            </>
          ) : (
            <i className="up">Slot empty: direct upgrade</i>
          )}
          {t.expiring && <i className="bad"> · EXPIRES AFTER THIS WAVE</i>}
        </span>
        {(t.nearby ?? 0) > 1 && !t.cargoFull && <span className="lp-sweep" data-testid="lp-sweep">HOLD <BoundKey action="use" /> · COLLECT ALL {t.nearby} IN REACH</span>}
      </div>
    </div>
  );
}

export type FeedRow = LootEvent & { id: number; times: number };

/**
 * Add a loot event to the feed (pure): a repeat of the newest row (same kind and item) bumps its ×N count and keeps
 * its place instead of stacking duplicates (pressing use on a full hold, a burst of identical drops). Max 5 rows.
 */
export function pushFeed(list: readonly FeedRow[], e: LootEvent, id: number): { list: FeedRow[]; merged: number | null } {
  const last = list[list.length - 1];
  if (last && last.kind === e.kind && last.name === e.name && last.level === e.level) {
    return { list: [...list.slice(0, -1), { ...last, id, times: last.times + 1 }], merged: last.id };
  }
  return { list: [...list.slice(-4), { ...e, id, times: 1 }], merged: null };
}

/** Concise loot notifications (drops, pickups, full hold, expiry). */
export function LootFeed() {
  const [items, setItems] = useState<FeedRow[]>([]);
  useEffect(() => {
    let id = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const off = uiEvents.on('loot', (e) => {
      // Common drops landing are visible in the world; only announce rare+ drops.
      if (e.kind === 'drop' && rarity(e.rarity).index < 2) return;
      const my = ++id;
      // A merged repeat takes a fresh id, so the old row's timer no longer removes it (its time restarts).
      setItems((l) => pushFeed(l, e, my).list);
      const t = setTimeout(() => {
        timers.delete(t);
        setItems((l) => l.filter((x) => x.id !== my));
      }, e.kind === 'pickup' ? 3600 : 4200);
      timers.add(t);
    });
    return () => {
      off();
      timers.forEach(clearTimeout);
    };
  }, []);
  return (
    <div className="loot-feed">
      {items.map((e) => {
        const r = rarity(e.rarity);
        const tag = e.kind === 'pickup' ? 'COLLECTED · UNSECURED' : e.kind === 'drop' ? `${r.label.toUpperCase()} DROP` : e.kind === 'full' ? 'CARGO FULL' : 'EXPIRED';
        return (
          <div key={e.id} className={`lf-item ${e.kind} r-${r.id}`} style={{ ['--rc' as string]: r.color }}>
            <span className="lf-tag"><FieldIcon name={e.kind === 'pickup' ? 'pickup' : itemIcon(e.category)} /> {tag}</span>
            <b>{e.name}{e.times > 1 && <span className="lf-times"> ×{e.times}</span>}</b>
            {e.level > 0 && (
              <em>
                LV {fmtNum(e.level)} · {cat(e.category)}
              </em>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Rarity-coloured name tags over nearby pickups (imperative DOM pool, no React per frame). */
export function LootLabels({ game }: { game: Game }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pool: HTMLDivElement[] = [];
    let raf = 0;
    const POOL_SIZE = 12;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const h = host.current;
      if (!h) return;
      while (pool.length < POOL_SIZE) {
        const el = document.createElement('div');
        el.className = 'loot-label';
        el.style.visibility = 'hidden';
        h.appendChild(el);
        pool.push(el);
      }
      const eye = game.player.eye;
      const target = game.lootTarget;
      const viewportWidth = h.clientWidth;
      const viewportHeight = h.clientHeight;
      const prompt = target ? h.parentElement?.querySelector('.loot-prompt')?.getBoundingClientRect() : null;
      const near = game.loot.pickups
        .filter((p) => p !== target && game.loot.landed(p))
        .map((p) => ({ p, r: rarity(p.item.rarity), d: Math.hypot(p.focus.x - eye.x, p.focus.z - eye.z) }))
        .filter(({ d, r }) => d < 7 + r.index * 3.5)
        .sort((a, b) => a.d - b.d || b.r.index - a.r.index);
      const candidates: { el: HTMLDivElement; pos: { x: number; y: number }; d: number }[] = [];
      for (const { p, r, d } of near) {
        const pos = game.project(p.focus.x, p.focus.y + 0.75, p.focus.z);
        if (!pos || pos.x <= 0 || pos.x >= viewportWidth || pos.y <= 0 || pos.y >= viewportHeight) continue;
        const el = pool[candidates.length];
        // The verdict cache refreshes when the inventory changes.
        const best = game.verdicts.of(p.item, p.droppedWave).newBest;
        const key = `${p.id}|${p.expiring}|${best}|${r.color}`;
        if (el.dataset.key !== key) {
          el.dataset.key = key;
          el.textContent = best ? `★ ${p.item.name}` : p.item.name;
          el.style.setProperty('--rc', r.color);
          el.className = `loot-label r-${r.id} ${p.expiring ? 'expiring' : ''}`;
        }
        candidates.push({ el, pos, d });
        if (candidates.length === POOL_SIZE) break;
      }

      // Measure after setting the pooled text, then place the labels in a separate write pass.
      const boxes = candidates.map(({ el, pos, d }) => {
        const half = el.offsetWidth / 2;
        return { el, pos, d, left: pos.x - half, right: pos.x + half, top: pos.y - el.offsetHeight, bottom: pos.y };
      });
      const placed: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>[] = prompt ? [prompt] : [];
      const visibleLimit = target ? 2 : 5;
      let visible = 0;
      for (const { el, pos, d, ...box } of boxes) {
        const fits = box.left >= 4 && box.right <= viewportWidth - 4 && box.top >= 4;
        // Keep tags anchored to their items. Suppress tags that would touch a closer tag or the pickup prompt.
        const overlaps = placed.some((p) => box.left < p.right + 8 && box.right > p.left - 8 && box.top < p.bottom + 5 && box.bottom > p.top - 5);
        if (!fits || overlaps || visible >= visibleLimit) {
          el.style.visibility = 'hidden';
          continue;
        }
        placed.push(box);
        visible++;
        el.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -100%)`;
        el.style.setProperty('--label-opacity', String(Math.max(0.35, Math.min(0.86, 1.28 - d / 14)) * (target ? 0.42 : 1)));
        el.style.visibility = 'visible';
      }
      for (let i = candidates.length; i < pool.length; i++) pool[i].style.visibility = 'hidden';
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [game]);
  return <div className="fixed inset-[0] pointer-events-none" ref={host} />;
}

function useInventoryVersion(): number {
  return useSyncExternalStore(hudStore.subscribe, () => hudStore.get().inventoryVersion);
}

/** Arena cargo (I / Tab; canvas "Run cargo · equip in prep"): what was found this run (at risk) next to what was
 * carried in (safe), the selected item compared with the slot it would take, equip only during preparation. */
export function ArenaInventory({ game }: { game: Game }) {
  const version = useInventoryVersion();
  const allowed = useHud((s) => s.equipAllowed);
  const phase = useHud((s) => s.phase);
  const timer = useHud((s) => s.phaseTimer);
  const [, force] = useState(0);
  const inv = game.inventory;
  const entries: InvEntry[] = useMemo(
    () => inv.entries().map((e) => ({ item: e.item, status: e.status, equippedIn: e.equippedIn })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inv, version],
  );
  const equipped = useMemo(() => Object.fromEntries(SLOTS.map((s) => [s.id, inv.equipped(s.id)])) as Record<SlotId, ItemInstance | null>, [inv, version]);
  const equippedList = useMemo(() => SLOTS.map((s) => equipped[s.id]), [equipped]);
  // Build-aware verdicts in the arena: tree, run upgrades, node effects, mastery and the sector faction.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scoreCtx = useMemo(() => game.scoreContext(), [game, version]);
  const base = useMemo(() => loadoutScore(equippedList, scoreCtx), [equippedList, scoreCtx]);
  const found = entries.filter((e) => e.status === 'unsecured');
  const worn = entries.filter((e) => e.status !== 'unsecured' && e.equippedIn);
  const kept = entries.filter((e) => e.status !== 'unsecured' && !e.equippedIn);
  const [sel, setSel] = useState<string | null>(found[0]?.item.uid ?? worn[0]?.item.uid ?? null);
  const cur = entries.find((e) => e.item.uid === sel) ?? null;
  const targetOf = (it: ItemInstance): SlotId | null => defaultSlot(it.category, equipped, inv.lockedSlots);
  const impactOf = (it: ItemInstance) => {
    const slot = targetOf(it);
    if (!slot || it.category === 'module') return null;
    return swapImpact(equippedList, it, equipped[slot], base, 'build', SLOTS.findIndex((x) => x.id === slot), scoreCtx);
  };
  const refresh = () => force((n) => n + 1);
  const run = game.cfg.run;
  const checkpoint = run.wavesCleared + (5 - (run.wavesCleared % 5));
  const equipSel = () => {
    if (!cur || cur.equippedIn || !allowed) return;
    game.equip(cur.item.uid);
    refresh();
  };
  const dropSel = () => {
    if (!cur || cur.status !== 'unsecured' || cur.equippedIn) return;
    game.discard(cur.item.uid);
    setSel(null);
    refresh();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Escape' || e.code === game.settings.keys.inventory || e.code === 'Tab') {
        e.preventDefault();
        void game.closeInventory();
      } else if (e.code === 'Enter') equipSel();
      else if (e.code === 'KeyX') dropSel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const t = Math.max(0, Math.ceil(timer));
  const tile = (e: InvEntry) => (
    <ItemCard key={e.item.uid} e={e} selected={sel === e.item.uid} onSelect={() => setSel(e.item.uid)} impact={e.equippedIn ? null : impactOf(e.item)} />
  );
  const slot = cur ? cur.equippedIn ?? targetOf(cur.item) : null;
  return (
    <div className="screen terminal-screen arena-inv ds-scr cargo-ds">
      <div className="ds-blur" />
      <div className="term-shade" />
      <div className="ds-top">
        <Crumb parts={['Run', phase === 'prep' ? `Prep ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : phase === 'combat' ? 'Combat' : 'Wave secured', 'Cargo']} />
        <span className="ds-grow" />
        <span className="ds-mono">{allowed ? 'EQUIPPING ONLY DURING PREP' : 'INSPECTION ONLY · EQUIP DURING PREP'}</span>
      </div>
      <ScoreCtx.Provider value={scoreCtx}>
        <section className="cargo-left inv-list">
          <span className="ds-row"><span className="ds-h3 ds-grow">FOUND THIS RUN</span><RiskTag>At risk until wave {checkpoint} · {found.length} / {inv.cargoCapacity}</RiskTag></span>
          <div className="cargo-grid">{found.length ? found.map(tile) : <span className="ds-meta">Nothing found yet. Machines drop loot; walk over it and press {keyLabel(game.settings.keys.use)}.</span>}</div>
          <span className="ds-h3">WORN · SAFE (CARRIED IN)</span>
          <div className="cargo-grid worn">{worn.map(tile)}</div>
          {kept.length > 0 && (
            <>
              <span className="ds-h3">SECURED THIS RUN</span>
              <div className="cargo-grid worn">{kept.map(tile)}</div>
            </>
          )}
        </section>
        {cur && (
          <section className="cargo-detail ds-glass ds-cut">
            <ItemDetail item={cur.item} status={cur.status} stage={false} />
            {!cur.equippedIn && cur.item.category !== 'module' && <ComparePanel item={cur.item} against={slot ? equipped[slot] : null} equipped={equippedList} slot={slot} />}
            <span className="ds-meta">
              {cur.status === 'unsecured'
                ? `Equipping it now uses it this run. If the run fails before wave ${checkpoint} you lose it; the item you swap out stays yours either way.`
                : cur.equippedIn ? 'Worn: carried in or secured, it can never be lost.' : 'Secured at a checkpoint: it is already in your storage.'}
            </span>
            <div className="inv-actions">
              {!cur.equippedIn && <button className="primary term-primary" data-key="ENTER" disabled={!allowed || !slot} title={allowed ? '' : 'Equipment can only be changed during the preparation phase between waves.'} onClick={equipSel}>EQUIP NOW</button>}
              {cur.equippedIn && !SLOTS.find((x) => x.id === cur.equippedIn)?.required && <button className="ds-btn" disabled={!allowed} onClick={() => { game.unequip(cur.equippedIn!); refresh(); }}>UNEQUIP</button>}
            </div>
          </section>
        )}
      </ScoreCtx.Provider>
      <div className="ds-bot">
        <Hint keys="X" onClick={dropSel}>Drop</Hint>
        <span className="ds-grow" />
        <Hint keys={[keyLabel(game.settings.keys.inventory)]} onClick={() => void game.closeInventory()}>Close</Hint>
      </div>
    </div>
  );
}
