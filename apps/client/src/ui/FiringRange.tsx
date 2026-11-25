// Firing range: the deploy terminal card that opens it and the in-arena readout (measured DPS against frozen dummies).
import { useState, useSyncExternalStore } from 'react';
import type { Flow } from '../core/Flow';
import type { Game } from '@riftwarden/game/core/Game';
import { RANGE_FACTIONS, RANGE_MODS, RANGE_TARGETS, rangeStore } from '@riftwarden/game/arena/Range';
import { fmtBig } from './format';
import { Hint } from './ds';

/** Deploy terminal tab: what the range is and the button that opens it. */
export function RangeCard({ flow }: { flow: Flow }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="range-card">
      <div>
        <div className="ds-lbl">Calibration deck</div>
        <h2>Firing range</h2>
        <p>Test your loadout on training dummies before you commit it to a run. Nothing is earned or lost here: no waves, no loot, no banking.</p>
        <ul className="range-list">
          <li><b>Measured DPS</b> live over 5 s, best 3 s burst, sustained since the first hit, crit rate.</li>
          <li><b>Targets</b> {RANGE_TARGETS.map((t) => t.name).join(', ')}: bare, armored or behind a barrier.</li>
          <li><b>Factions</b> count the dummies as Scrapline, Rime or Crucible to check your element against their affinities.</li>
          <li><b>Packs</b> of three for launchers, flamers and piercing rails.</li>
        </ul>
      </div>
      <button
        className="ds-btn-p range-enter"
        data-testid="range-enter"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void flow.enterRange().then((ok) => !ok && setBusy(false));
        }}
      >
        {busy ? 'OPENING…' : 'ENTER THE FIRING RANGE'}
      </button>
    </div>
  );
}

const label = <T extends { id: unknown; name: string }>(list: readonly T[], id: unknown) => list.find((x) => x.id === id)?.name ?? '—';

/** In-arena readout (right side) while the arena is a firing range. */
export function RangePanel({ game }: { game: Game }) {
  const r = useSyncExternalStore(rangeStore.subscribe, rangeStore.get).range;
  if (!r) return null;
  const s = r.setup;
  const sheet = game.firepower();
  // How the weapon in hand fares against the first dummy (faction, frame and defences).
  const dummy = game.range?.targets[0];
  const aff = dummy ? game.director.affinityOf(dummy, game.weapon.def.element ?? 'kinetic') : 1;
  const rows: [string, string, string][] = [
    ['J', 'Target', label(RANGE_TARGETS, s.target)],
    ['K', 'Defences', label(RANGE_MODS, s.mod)],
    ['L', 'Distance', `${s.distance} m`],
    ['P', 'Group', s.pack ? 'Pack of 3' : 'Single'],
    ['O', 'Faction', label(RANGE_FACTIONS, s.faction)],
  ];
  return (
    <section className="range-panel ds-glass" data-testid="range-panel" aria-label="Firing range readout">
      <div className="ds-lbl">Firing range · nothing is recorded</div>
      <div className="range-dps">
        <b data-testid="range-dps">{fmtBig(Math.round(r.dps))}</b>
        <span>DPS · last 5 s</span>
      </div>
      <dl className="range-stats">
        <div><dt>Best burst</dt><dd data-testid="range-burst">{fmtBig(Math.round(r.burst))}</dd></div>
        <div><dt>Sustained</dt><dd>{fmtBig(Math.round(r.sustained))}</dd></div>
        <div><dt>Sheet DPS</dt><dd title="Weapon DPS from your gear alone (no affinity, statuses or crits on weakpoints)">{fmtBig(Math.round(sheet))}</dd></div>
        <div><dt>Crit rate</dt><dd>{Math.round(r.critRate * 100)}%</dd></div>
        <div><dt>Total</dt><dd data-testid="range-total">{fmtBig(Math.round(r.total))}</dd></div>
        <div><dt>Hits</dt><dd>{r.hits}</dd></div>
        <div><dt>Affinity</dt><dd data-testid="range-aff" className={aff > 1.001 ? 'ds-up' : aff < 0.999 ? 'ds-down' : ''}>×{aff.toFixed(2)}</dd></div>
      </dl>
      <ul className="range-setup">
        {rows.map(([k, name, value]) => (
          <li key={k}><Hint keys={k}>{name}</Hint><b>{value}</b></li>
        ))}
      </ul>
      <div className="range-foot">
        <Hint keys="⌫">Reset meter</Hint>
        <Hint keys="Esc">Leave</Hint>
      </div>
    </section>
  );
}
