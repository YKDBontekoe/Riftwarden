import type { Flow } from '../core/Flow';
import { bestWaveCleared, researchBlocker } from '../economy/transactions';
import type { SaveData } from '../progression/save';
import { archetypeOf, partDef, TECH_LIST } from '../towers/components';
import { TxMessage, useTx } from './economy';

/** Permanent tower blueprint research (HQ). Researched parts persist; deployed towers never do. */
export function TowerTech({ flow, save }: { flow: Flow; save: SaveData }) {
  const tx = useTx(flow, 'workshop');
  const best = bestWaveCleared(save);
  return (
    <div data-testid="tower-tech">
      <div className="muted-note">Blueprints unlock new tower bases, weapons, cores and modifiers for every future run. Best wave cleared: {best}. Starter parts are always available.</div>
      <TxMessage msg={tx.msg} />
      <div className="tech-grid">
        {TECH_LIST.map((t) => {
          const p = partDef(t.slot, t.id)!;
          const done = save.towers.unlocked.includes(`${t.slot}:${t.id}`);
          const why = done ? null : researchBlocker(save, t.slot, t.id);
          return (
            <div key={`${t.slot}:${t.id}`} className={`tech-card ${done ? 'done' : ''}`} data-testid={`tech-${t.slot}-${t.id}`}>
              <h4>{p.name}</h4>
              <div className="muted-note">{t.slot.toUpperCase()} · {archetypeOf(t.slot, t.id)}</div>
              <div className="tp-blurb">{p.blurb}</div>
              <div className="req">Wave {t.tech.wave} · ◇{t.tech.credits} cr{t.tech.components ? ` · ${t.tech.components} comp` : ''}</div>
              {done ? (
                <b style={{ color: 'var(--cyan)' }}>RESEARCHED</b>
              ) : (
                <button className="mini" disabled={!!why} title={why ?? ''} onClick={() => tx.run('research', 'researchTower', [t.slot, t.id], () => `${p.name} researched`)}>
                  {why ?? 'RESEARCH'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
