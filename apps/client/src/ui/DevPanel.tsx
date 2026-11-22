import { useMemo, useState } from 'react';
import type { Flow } from '../core/Flow';
import type { Game } from '@riftwarden/game/core/Game';
import type { EnemyKind } from '@riftwarden/rules/data/defs';
import { THREAT_TIERS } from '@riftwarden/rules/progression/tiers';
import type { BossId } from '@riftwarden/rules/survival/bosses';
import { ELITE_IDS, ELITE_MODS, type EliteModId } from '@riftwarden/rules/survival/elites';
import { EVENT_IDS, EVENTS, type EventId } from '@riftwarden/rules/survival/events';
import { eliteChance, maxModsFor, SurvivalPlanner } from '@riftwarden/rules/survival/plan';
import type { GateId } from '@riftwarden/rules/world/layout';
import { fmtNum } from './App';

const KINDS: EnemyKind[] = ['walker', 'rusher', 'bulwark', 'enforcer', 'artillery', 'engineer', 'jammer', 'crawler', 'sapper', 'skimmer', 'marksman', 'burrower', 'courier', 'colossus', 'overseer'];

/**
 * Development tools (F4, only with ?dev / ?test). Every action marks the run as a development session:
 * no records, no milestones, no banking of permanent rewards.
 */
export function DevPanel({ game, flow }: { game: Game; flow: Flow }) {
  const [wave, setWave] = useState(String(game.waves.number + 5));
  const [kind, setKind] = useState<EnemyKind>('enforcer');
  const [mods, setMods] = useState<EliteModId[]>([]);
  const [gate, setGate] = useState<GateId>('north');
  const [note, setNote] = useState('');
  const dev = game.cfg.run.survival.dev;
  const act = (label: string, fn: () => void) => () => {
    fn();
    setNote(label);
  };
  const scaling = useMemo(() => {
    const p = new SurvivalPlanner(game.planner.seed, game.cfg.tier);
    return [10, 25, 50, 100, 250, 1000, 10000].map((n) => {
      const w = p.compose(n);
      return { n, hp: w.hpMult, dmg: w.damageMult, spawns: w.spawns.length, budget: w.plan?.budget ?? 0, elite: eliteChance(n, game.cfg.tier), mods: maxModsFor(n, game.cfg.tier), theme: w.plan?.theme ?? '' };
    });
  }, [game]);
  return (
    <div className="screen dim">
      <div className="modal wide panel-frame dev-panel" data-testid="dev-panel">
        <div className="cp-kicker">DEVELOPMENT TOOLS · F4</div>
        <div className="cp-title">SURVIVAL LAB</div>
        <div className="cp-sub">{dev ? 'This run is a development session: records, milestones and checkpoint banking are disabled.' : 'Using any tool marks this run as a development session (no records, no permanent rewards).'}</div>
        <div className="dev-grid">
          <section>
            <h4>WAVES</h4>
            <div className="row">
              <input value={wave} onChange={(e) => setWave(e.target.value)} size={6} />
              <button onClick={act(`Jumped to wave ${wave}`, () => game.dev.jump(Number(wave) || 1))}>JUMP TO WAVE</button>
            </div>
            <div className="row">
              <button onClick={act('Arena reset', () => game.dev.reset())}>RESET ARENA</button>
            </div>
            <h4>ARENA EVOLUTION</h4>
            <div className="row">
              <button onClick={act('Secondary access route opened', () => game.dev.evolve('routes'))}>OPEN SOUTH ROUTE</button>
              <button onClick={act('Reactor instability activated', () => game.dev.evolve('instability'))}>REACTOR INSTABILITY</button>
            </div>
            <h4>NEXT WAVE</h4>
            <div className="row wrap">
              {(['colossus', 'overseer'] as BossId[]).map((b) => (
                <button key={b} onClick={act(`Boss forced: ${b}`, () => game.dev.force({ boss: b }))}>BOSS · {b.toUpperCase()}</button>
              ))}
              {EVENT_IDS.map((id: EventId) => (
                <button key={id} onClick={act(`Event forced: ${EVENTS[id].name}`, () => game.dev.force({ event: id }))}>{EVENTS[id].name.toUpperCase()}</button>
              ))}
            </div>
            <h4>THREAT TIER (NEW DEV RUN)</h4>
            <div className="row">
              {THREAT_TIERS.map((t) => (
                <button key={t.id} onClick={() => void flow.abandonRun().then(() => flow.devDeploy(t.id))}>{t.roman}</button>
              ))}
            </div>
          </section>
          <section>
            <h4>SPAWN</h4>
            <div className="row wrap">
              <select value={kind} onChange={(e) => setKind(e.target.value as EnemyKind)}>
                {KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
              <select value={gate} onChange={(e) => setGate(e.target.value as GateId)}>
                {(['north', 'east', 'west', 'south'] as GateId[]).map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </div>
            <div className="row wrap">
              {ELITE_IDS.map((m) => (
                <label key={m} className="chk">
                  <input type="checkbox" checked={mods.includes(m)} onChange={(e) => setMods(e.target.checked ? [...mods, m] : mods.filter((x) => x !== m))} />
                  {ELITE_MODS[m].name}
                </label>
              ))}
            </div>
            <div className="row">
              <button onClick={act(`Spawned ${kind}`, () => game.dev.spawn(kind, mods, gate))}>SPAWN</button>
            </div>
            <h4>HIGH-WAVE SCALING (THIS SEED + TIER)</h4>
            <table className="rec-table small">
              <thead>
                <tr>
                  <th>WAVE</th>
                  <th>HP ×</th>
                  <th>DMG ×</th>
                  <th>BUDGET</th>
                  <th>SPAWNS</th>
                  <th>ELITE %</th>
                  <th>MODS</th>
                </tr>
              </thead>
              <tbody>
                {scaling.map((r) => (
                  <tr key={r.n}>
                    <td>{r.n}</td>
                    <td>{fmtNum(r.hp)}</td>
                    <td>{r.dmg.toFixed(1)}</td>
                    <td>{fmtNum(r.budget)}</td>
                    <td>{r.spawns}</td>
                    <td>{Math.round(r.elite * 100)}</td>
                    <td>{r.mods}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        {note && <div className="dev-note">{note}</div>}
        <button className="primary" onClick={() => void game.closePanel()}>
          CLOSE
        </button>
      </div>
    </div>
  );
}
