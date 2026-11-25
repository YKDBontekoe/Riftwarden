// Tower tech (final design): four columns of parts (researched / available / needs a wave), the selected part's
// requirements with have vs need in an aside, RESEARCH at the bottom. Researched parts persist; deployed towers never do.
import { useEffect, useState } from 'react';
import type { Flow } from '../core/Flow';
import { bestWaveCleared, researchBlocker } from '@riftwarden/rules/economy/transactions';
import type { SaveData } from '@riftwarden/rules/progression/save';
import { archetypeOf, BASES, CORES, MODIFIERS, partDef, TECH_LIST, type TowerSlot, WEAPONS } from '@riftwarden/rules/towers/components';
import { TxMessage, useTx } from './economy';

const COLUMNS: { slot: TowerSlot; name: string; parts: Readonly<Record<string, unknown>> }[] = [
  { slot: 'base', name: 'Bases', parts: BASES },
  { slot: 'weapon', name: 'Weapons', parts: WEAPONS },
  { slot: 'core', name: 'Cores', parts: CORES },
  { slot: 'modifier', name: 'Modifiers', parts: MODIFIERS },
];

export function TowerTech({ flow, save }: { flow: Flow; save: SaveData }) {
  const tx = useTx(flow, 'workshop');
  const best = bestWaveCleared(save);
  const techOf = (slot: TowerSlot, id: string) => TECH_LIST.find((t) => t.slot === slot && t.id === id) ?? null;
  const stateOf = (slot: TowerSlot, id: string): 'starter' | 'done' | 'open' | 'locked' => {
    const t = techOf(slot, id);
    if (!t) return 'starter';
    if (save.towers.unlocked.includes(`${slot}:${id}`)) return 'done';
    return t.tech.wave > best ? 'locked' : 'open';
  };
  const firstOpen = TECH_LIST.find((t) => stateOf(t.slot, t.id) === 'open') ?? TECH_LIST[0];
  const [pick, setPick] = useState<{ slot: TowerSlot; id: string } | null>(firstOpen ? { slot: firstOpen.slot, id: firstOpen.id } : null);
  const sel = pick ? partDef(pick.slot, pick.id) : null;
  const selTech = pick ? techOf(pick.slot, pick.id) : null;
  const selState = pick ? stateOf(pick.slot, pick.id) : 'starter';
  const why = pick && selTech && selState !== 'done' ? researchBlocker(save, pick.slot, pick.id) : null;
  const research = () => {
    if (pick && sel && selTech && selState !== 'done' && !why) tx.run('research', 'researchTower', [pick.slot, pick.id], () => `${sel.name} researched`);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' && !e.repeat && !(e.target instanceof HTMLButtonElement)) research();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="tt" data-testid="tower-tech">
      <div className="tt-cols">
        {COLUMNS.map((c) => (
          <section key={c.slot} className="ds-col tt-col">
            <span className="ds-lbl">{c.name}</span>
            {Object.keys(c.parts).map((id) => {
              const p = partDef(c.slot, id);
              if (!p) return null;
              const st = stateOf(c.slot, id);
              const t = techOf(c.slot, id);
              const on = pick?.slot === c.slot && pick.id === id;
              return (
                <button key={id} type="button" className={`tech-card tt-card s-${st} ${st === 'done' ? 'done' : ''} ${on ? 'ds-sel' : ''}`} data-testid={t ? `tech-${c.slot}-${id}` : undefined} aria-pressed={on} onClick={() => setPick({ slot: c.slot, id })}>
                  <b className="ds-d">{p.name}</b>
                  <span className="ds-meta">
                    {st === 'starter' ? 'Starter part' : st === 'done' ? 'Researched' : st === 'locked' ? `Wave ${t!.tech.wave} needed` : `${t!.tech.credits} cr${t!.tech.components ? ` · ${t!.tech.components} comp` : ''}`}
                  </span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
      {sel && pick && (
        <aside className="tt-aside ds-glass ds-cut ds-col">
          <span className="ds-ov ds-em">{pick.slot} · {selState === 'done' ? 'researched' : selState === 'starter' ? 'starter part' : selState === 'locked' ? 'locked' : 'available'}</span>
          <span className="ds-h1" style={{ fontSize: 40 }}>{sel.name}</span>
          <span className="ds-body">{sel.blurb}</span>
          <span className="ds-meta">{archetypeOf(pick.slot, pick.id)}</span>
          {selTech && (
            <div className="ds-col">
              <div className="ds-list-row"><span className="ds-grow">Credits</span><b className="ds-d">{selTech.tech.credits}</b><span className="ds-meta">have {save.resources.credits.toLocaleString()}</span></div>
              {!!selTech.tech.components && <div className="ds-list-row"><span className="ds-grow">Components</span><b className="ds-d">{selTech.tech.components}</b><span className="ds-meta">have {save.resources.components.toLocaleString()}</span></div>}
              <div className="ds-list-row"><span className="ds-grow">Best wave</span><b className={`ds-d ${best >= selTech.tech.wave ? 'ds-up' : 'ds-bad'}`}>{selTech.tech.wave} {best >= selTech.tech.wave ? '✓' : ''}</b><span className="ds-meta">you: {best}</span></div>
            </div>
          )}
          <span className="ds-meta">Researched parts can be built and refitted in every future run.</span>
          <TxMessage msg={tx.msg} />
          {selTech && selState !== 'done' && (
            <button className="ds-btn-p" disabled={!!why} title={why ?? ''} onClick={research}>
              <span className="ds-kd">ENTER</span>{why ?? 'RESEARCH'}
            </button>
          )}
        </aside>
      )}
    </div>
  );
}
