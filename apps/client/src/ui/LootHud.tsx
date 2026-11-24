import { ScoreCtx } from './compare';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BoundKey } from './hud/widgets';
import { fmtNum } from '@riftwarden/rules/combat/stats';
import type { Game } from '@riftwarden/game/core/Game';
import { rarity, type RarityId } from '@riftwarden/rules/loot/rarity';
import { type Category, CATEGORY_LABEL } from '@riftwarden/rules/loot/types';
import type { ItemInstance } from '@riftwarden/rules/loot/types';
import { type SlotId, SLOTS } from '@riftwarden/rules/progression/items';
import { getTier } from '@riftwarden/rules/progression/tiers';
import { type InvEntry, InventoryView, ItemGlyph, RarityLegend } from './items';
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
      </div>
    </div>
  );
}

/** Concise loot notifications (drops, pickups, full hold, expiry). */
export function LootFeed() {
  const [items, setItems] = useState<(LootEvent & { id: number })[]>([]);
  useEffect(() => {
    let id = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const off = uiEvents.on('loot', (e) => {
      // Common drops landing are visible in the world; only announce rare+ drops.
      if (e.kind === 'drop' && rarity(e.rarity).index < 2) return;
      const my = ++id;
      setItems((l) => [...l.slice(-4), { ...e, id: my }]);
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
            <b>{e.name}</b>
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
    const MAX = 8;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const h = host.current;
      if (!h) return;
      while (pool.length < MAX) {
        const el = document.createElement('div');
        el.className = 'loot-label';
        el.style.display = 'none';
        h.appendChild(el);
        pool.push(el);
      }
      const eye = game.player.eye;
      const near = game.loot.pickups
        .filter((p) => game.loot.landed(p))
        .map((p) => ({ p, d: Math.hypot(p.focus.x - eye.x, p.focus.z - eye.z) }))
        .filter((x) => x.d < 7 + rarity(x.p.item.rarity).index * 3.5)
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX);
      const placed: { x: number; y: number }[] = [];
      for (let i = 0; i < MAX; i++) {
        const el = pool[i];
        const n = near[i];
        const pos = n ? game.project(n.p.focus.x, n.p.focus.y + 0.75, n.p.focus.z) : null;
        // Stack labels that would overlap a nearer one (nearest first keeps priority).
        if (pos) {
          for (let guard = 0; guard < 6 && placed.some((q) => Math.abs(q.x - pos.x) < 120 && Math.abs(q.y - pos.y) < 17); guard++) pos.y -= 17;
          placed.push({ x: pos.x, y: pos.y });
        }
        if (!n || !pos || game.lootTarget === n.p) {
          el.style.display = 'none';
          continue;
        }
        const r = rarity(n.p.item.rarity);
        // Verdicts are cached per item and reset when the inventory changes (the key follows that version).
        const best = game.verdicts.of(n.p.item, n.p.droppedWave).newBest;
        const key = `${n.p.id}|${n.p.expiring}|${best}|${game.inventoryVersion}`;
        if (el.dataset.key !== key) {
          el.dataset.key = key;
          el.textContent = best ? `★ ${n.p.item.name}` : n.p.item.name;
          el.style.setProperty('--rc', r.color);
          el.className = `loot-label r-${r.id} ${n.p.expiring ? 'expiring' : ''}`;
        }
        el.style.display = 'block';
        el.style.opacity = String(Math.max(0.35, Math.min(1, 1.4 - n.d / 14)));
        el.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -100%)`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [game]);
  return <div className="fixed inset-[0] pointer-events-none" ref={host} />;
}

function useInventoryVersion(): number {
  return useSyncExternalStore(hudStore.subscribe, () => hudStore.get().inventoryVersion);
}

/** Arena inventory (I / Tab): inspect any time, change equipment only in preparation. */
export function ArenaInventory({ game }: { game: Game }) {
  const version = useInventoryVersion();
  const allowed = useHud((s) => s.equipAllowed);
  const phase = useHud((s) => s.phase);
  const [, force] = useState(0);
  const inv = game.inventory;
  const entries: InvEntry[] = useMemo(
    () => inv.entries().map((e) => ({ item: e.item, status: e.status, equippedIn: e.equippedIn })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inv, version],
  );
  const equipped = useMemo(() => Object.fromEntries(SLOTS.map((s) => [s.id, inv.equipped(s.id)])) as Record<SlotId, ItemInstance | null>, [inv, version]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Escape' || e.code === game.settings.keys.inventory || e.code === 'Tab') {
        e.preventDefault();
        void game.closeInventory();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);
  const run = game.cfg.run;
  // Build-aware verdicts in the arena: tree, run upgrades, node effects, mastery and the sector faction.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scoreCtx = useMemo(() => game.scoreContext(), [game, version]);
  const refresh = () => force((n) => n + 1);
  const unsecured = run.unsecured.items.length;
  return (
    <div className="screen terminal-screen arena-inv">
      <div className="terminal panel-frame wide inv-term">
        <div className="term-head">
          <div className="term-code">INV</div>
          <div className="flex-[1]">
            <div className="term-title">DRONE CARGO</div>
            <div className="term-sub">
              Rift Level {getTier(game.cfg.tier.id).id} · wave {game.waves.number} · {allowed ? 'preparation: equipment changes allowed' : `${phase === 'combat' ? 'combat' : 'wave resolving'}: inspection only`}
            </div>
          </div>
          <button className="term-close" onClick={() => void game.closeInventory()}>
            <BoundKey action="inventory" />/<kbd>ESC</kbd> CLOSE
          </button>
        </div>
        <div className="term-body">
          <ScoreCtx.Provider value={scoreCtx}>
          <InventoryView
            entries={entries}
            equipped={equipped}
            lockedSlots={inv.lockedSlots}
            extraFilter
            actions={{
              canChange: allowed,
              lockedReason: 'Equipment can only be changed during the preparation phase between waves.',
              equip: (uid, slot) => {
                game.equip(uid, slot);
                refresh();
              },
              unequip: (slot) => {
                game.unequip(slot);
                refresh();
              },
              remove: {
                label: () => 'DISCARD',
                allowed: (e) => e.status === 'unsecured' && !e.equippedIn,
                run: (uid) => {
                  game.discard(uid);
                  refresh();
                },
                confirm: 'Discard this unsecured item?',
              },
            }}
            header={
              <div className="cargo-bar">
                <span>
                  CARGO <b>{unsecured}</b> / {inv.cargoCapacity} UNSECURED
                </span>
                <span>
                  SECURED THIS RUN <b className="c">{run.secured.items.length}</b>
                </span>
                <span className="rule">Unsecured items, even equipped ones, are lost if the reactor falls before the next checkpoint.</span>
                <RarityLegend />
              </div>
            }
          />
          </ScoreCtx.Provider>
        </div>
      </div>
    </div>
  );
}
