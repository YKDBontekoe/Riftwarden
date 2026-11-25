// Run upgrade choice (three cards) and the in-run upgrade / buff badges.
import { useEffect } from 'react';
import type { Game } from '@riftwarden/game/core/Game';
import { CATEGORY_LABEL, RARITY_COLOR, upgradeDef } from '@riftwarden/rules/roguelite/upgrades';
import { useHud } from './useHud';
import { Backdrop, Crumb, ElementGem, ELEMENT_PATH, Gem, Hint } from './ds';

// ------------------------------------------------------------------ upgrade selection

export function UpgradePanel({ game }: { game: Game }) {
  const offer = game.offer ?? [];
  const build = game.director.build;
  const coop = useHud((s) => s.coop);
  const waiting = coop?.offerChooser;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
      if (!e.repeat && !waiting && i >= 0 && game.offer?.[i]) {
        e.preventDefault();
        game.chooseUpgrade(game.offer[i].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game, waiting]);
  // Synergy: picks already taken that share a tag with the offered card; the run's tag totals for the footer.
  const owned = [...build.stacks.entries()].map(([id, n]) => ({ def: upgradeDef(id), n })).filter((p) => p.def);
  const tagCount = new Map<string, number>();
  for (const p of owned) for (const t of p.def!.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + p.n);
  const runTags = [...tagCount.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
  const node = useHud((s) => s.node);
  return (
    <div className="screen dim upgrade-screen ds-scr" data-testid="upgrade-panel">
      <Backdrop scrim="none" />
      <div className="ds-top">
        <Crumb parts={['Run', node?.name ?? 'Sector', 'Run upgrade']} />
        <span className="ds-grow" />
        <span className="ds-mono">{coop ? `TEAM PICK · ${coop.offerLeft} S` : 'WORLD PAUSED'}</span>
      </div>
      <div className="ds-abs ds-col" style={{ left: 0, right: 0, top: 62, alignItems: 'center', gap: 4, textAlign: 'center' }}>
        <span className="ds-ov ds-up">Wave {game.waves.number - 1} cleared · {coop ? 'team upgrade' : 'world paused'}</span>
        <span className="ds-hero">{waiting ? `${waiting} is choosing` : coop ? 'Choose a team upgrade' : 'Choose an upgrade'}</span>
        <span className="ds-meta">{coop ? (waiting ? 'Team upgrades are picked in turn; this one applies to every warden.' : 'Your turn: this upgrade applies to the whole team.') : 'Lasts for this run · numbers include what you already took'}</span>
        {coop && <button className="ds-btn" style={{ minHeight: 36, marginTop: 6 }} onClick={() => void game.closePanel?.()}>BACK TO THE ARENA</button>}
      </div>
      <div className="upgrade-cards ds-abs" style={{ left: 'max(24px, 9vw)', right: 'max(24px, 9vw)', top: coop ? 236 : 200, display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, offer.length)}, minmax(0, 1fr))`, gap: 28 }}>
        {offer.map((u, i) => {
          const have = build.count(u.id);
          const color = UP_COLOR[u.rarity] ?? RARITY_COLOR[u.rarity];
          const el = u.tags.find((t) => t in ELEMENT_PATH);
          const syn = owned.filter((p) => p.def!.id !== u.id && p.def!.tags.some((t) => u.tags.includes(t) && t !== u.category));
          const synTag = syn.length ? u.tags.find((t) => syn.some((p) => p.def!.tags.includes(t))) : null;
          return (
            <button key={u.id} data-testid={`upgrade-card-${i}`} data-id={u.id} className="ucard ds-card" disabled={!!waiting} style={{ '--r': color } as React.CSSProperties} onClick={() => game.chooseUpgrade(u.id)}>
              <span className="ds-row" style={{ justifyContent: 'space-between', width: '100%' }}>
                <span style={{ font: '700 13px var(--ds-d)', letterSpacing: '0.3em', color }}>{u.rarity.toUpperCase()}</span>
                <span className="ds-k">{i + 1}</span>
              </span>
              <span style={{ margin: '6px 0 4px 8px' }}>
                {el ? <ElementGem el={el} size={54} /> : <Gem color={color} size={54}><span aria-hidden="true" style={{ font: '700 22px var(--ds-d)', color }}>{u.icon}</span></Gem>}
              </span>
              <span style={{ font: "800 34px/0.95 var(--ds-d)", letterSpacing: '0.03em', textTransform: 'uppercase' }}>{u.name}</span>
              <span className="ds-body" style={{ fontSize: 15 }}>{u.text(have + 1)}</span>
              {u.hint && <span className="ds-meta">{u.hint}</span>}
              <span className="ds-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span className="ds-chip">{CATEGORY_LABEL[u.category]}</span>
                {u.tags.filter((t) => t !== u.category).slice(0, 2).map((t) => <span key={t} className="ds-chip">{t}</span>)}
                {u.needs?.towers ? <span className="ds-chip">Towers</span> : null}
              </span>
              {synTag && <span style={{ font: '700 14px var(--ds-d)', letterSpacing: '0.12em', color: 'var(--ds-up)', textTransform: 'uppercase' }}>▲ Synergy · {syn.length} {synTag} pick{syn.length > 1 ? 's' : ''} taken</span>}
              <span className="ds-meta" style={{ marginTop: 'auto' }}>{have > 0 ? `Owned ${have} · stack ${have + 1} of ${u.maxStacks}` : u.maxStacks > 1 ? `New · stacks to ${u.maxStacks}` : 'New · unique'}</span>
            </button>
          );
        })}
      </div>
      <div className="ds-bot">
        {runTags.length > 0 && (
          <span className="ds-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="ds-lbl">Your run</span>
            {runTags.map(([t, n]) => <span key={t} className="ds-chip">{t} {n}</span>)}
          </span>
        )}
        <span className="ds-grow" />
        {!waiting && <span className="ds-hint"><span className="ds-k">1</span><span className="ds-k">2</span><span className="ds-k">3</span>Pick</span>}
        <Hint keys="ESC">Free cursor</Hint>
      </div>
      <div className="ds-grain" />
    </div>
  );
}

const UP_COLOR: Record<string, string> = { common: '#c9cdc4', rare: '#8cc4ff', epic: '#d4b2ff', legendary: '#ffcf73' };

// ------------------------------------------------------------------ in-run HUD additions

export function RunBadges() {
  const m5 = useHud((s) => s.m5);
  if (!m5) return null;
  return (
    <div className="m5-badges">
      {m5.upgrades > 0 && <div className="m5-chip">▲ {m5.upgrades} UPGRADES <kbd>U</kbd></div>}
      {m5.buffs.map((b) => (
        <div key={b.name} className="m5-chip buff">{b.name}{b.stacks > 1 ? ` ×${b.stacks}` : ''} · {b.t.toFixed(0)}s</div>
      ))}
      {m5.network > 0.5 && <div className="m5-chip net">NETWORK {Math.floor(m5.network)}</div>}
      {m5.grid > 0.5 && <div className="m5-chip net">GRID {Math.floor(m5.grid)}</div>}
      {m5.empowered > 0 && <div className="m5-chip emp">⟁ {m5.empowered} TOWERS EMPOWERED</div>}
      {m5.note && <div className="m5-chip note">{m5.note}</div>}
    </div>
  );
}

