import { DeployMapPanel, ResumeCard } from '../DeployMap';
import { useState } from 'react';
import type { Flow } from '../../core/Flow';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { ARENA } from '@riftwarden/rules/world/layout';
import { SLOTS } from '@riftwarden/rules/progression/items';
import { deployBlocker, equippedItem, type SaveData } from '@riftwarden/rules/progression/save';
import { CHECKPOINT_INTERVAL, getTier, type ThreatTier } from '@riftwarden/rules/progression/tiers';
import { LevelLootCard, RiftLevelPicker, savePower, UnlockBar, WipeNotice } from '../RiftLevel';
import { PinnacleCard } from '../Spikes';
import { SeasonBar } from '../Seasons';
import { useSave } from '../useSave';
import { Shell } from '../shell';
import { CoopPanel } from '../Coop';
import { RangeCard } from '../FiringRange';

const multiplier = (value: number) => `${Number(value.toFixed(2))}×`;

export function DeployTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'solo' | 'coop' | 'range'>(flow.net ? 'coop' : 'solo');
  const selected = getTier(Math.min(save.threat.selected, save.threat.unlocked));
  const weapon = equippedItem(save, 'weapon');
  const blocker = deployBlocker(save);
  const gearCount = SLOTS.filter((s) => save.loadout[s.id]).length;
  const [entry, setEntry] = useState<string | null>(null);
  const deploy = () => {
    if (busy) return;
    setBusy(true);
    void flow.deploy(selected.id, entry ?? undefined).then((ok) => {
      if (!ok) setBusy(false);
    });
  };
  return (
    <Shell code="DP-01" title="DEPLOYMENT" sub="Launch bay · survival operations" close={close} wide>
      <WipeNotice save={save} />
      <div className="tabs m-[0_0_14px]">
        <button className={mode === 'solo' ? 'on' : ''} data-testid="deploy-solo" onClick={() => setMode('solo')}>
          SOLO OPERATION
        </button>
        <button className={mode === 'coop' ? 'on' : ''} data-testid="deploy-coop" onClick={() => setMode('coop')}>
          CO-OP OPERATION · 2-4 WARDENS
        </button>
        <button className={mode === 'range' ? 'on' : ''} data-testid="deploy-range" onClick={() => setMode('range')}>
          FIRING RANGE
        </button>
      </div>
      {mode === 'range' ? (
        <RangeCard flow={flow} />
      ) : mode === 'coop' ? (
        <CoopPanel flow={flow} />
      ) : (
      <>
      <SeasonBar flow={flow} save={save} />
      <div className={`deploy-grid${flow.mapMode ? ' war' : ''}`}>
        <div className="arena-card">
          <ResumeCard flow={flow} save={save} />
          {flow.mapMode ? <DeployMapPanel flow={flow} save={save} entry={entry} onEntry={setEntry} /> : <><div className="operation-heading"><h2>Reactor yard</h2><span>Sector 07</span></div>
          <FacilityPlan /></>}
          <p>Hold the reactor. Build along the marked approaches and bank your haul every {CHECKPOINT_INTERVAL} waves.</p>
          <details className="field-notes">
            <summary>Survival rules</summary>
            <ul className="rules">
              <li>Each checkpoint banks collected equipment and salvage, awards a cache, and opens a route home.</li>
              <li>Reactor loss costs all unsecured cargo, including newly found gear you equip. Your starting gear stays safe.</li>
              <li>The sealed southern approach opens as the facility evolves. Keep its marked lane clear for machines.</li>
              <li>Higher Rift Levels raise item levels, open rarer drops and harden the machines. Watch for event and boss warnings.</li>
            </ul>
          </details>
          <div className="loadout-line">
            <span>LOADOUT · {gearCount}/{SLOTS.length} SLOTS</span>
            <b style={weapon ? { color: rarity(weapon.rarity).color } : undefined}>{weapon?.name.toUpperCase() ?? 'NO WEAPON'}</b>
          </div>
          {blocker && <div className="deploy-block">{blocker}</div>}
        </div>
        <div className="tier-col">
          <div className="col-label">SELECT RIFT LEVEL</div>
          <RiftLevelPicker value={selected.id} unlocked={save.threat.unlocked} power={savePower(save)} disabled={busy} onPick={(rl) => flow.selectTier(rl)} />
          <PinnacleCard flow={flow} save={save} rl={selected.id} busy={busy} onDeploy={() => {
            if (busy) return;
            setBusy(true);
            void flow.deploy(selected.id, undefined, 'defense', true).then((ok) => !ok && setBusy(false));
          }} />
          <TierBrief tier={selected} save={save} />
          <button className="primary deploy" disabled={busy || !!blocker} onClick={deploy}>
            <span>{busy ? 'LAUNCHING…' : `DEPLOY · RL ${selected.id}`}</span>
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      </div>
      </>
      )}
    </Shell>
  );
}

function FacilityPlan() {
  return <figure className="facility-plan">
    <svg viewBox="-84 -64 168 128" role="img" aria-label="North-up yard plan. North, east and west lanes converge on the reactor. The southern gate starts sealed.">
      <g transform="scale(1 -1)">
        {ARENA.boxes.filter(box => box.kind !== 'reactor').map(({ min, max, kind }, i) =>
          <rect key={i} className={`plan-${kind}`} x={min[0]} y={min[2]} width={max[0] - min[0]} height={max[2] - min[2]} />)}
        {ARENA.ramps.map((r, i) => <rect key={i} className="plan-ramp" x={r.x0} y={r.z0} width={r.x1 - r.x0} height={r.z1 - r.z0} />)}
        {Object.values(ARENA.routes).map(route => <polyline key={route.gate} className={ARENA.initialGates.includes(route.gate) ? 'plan-lane' : 'plan-sealed'}
          points={route.points.map(p => `${p.x},${p.z}`).join(' ')} />)}
        <circle className="[fill:none] [stroke:#bbe8cc] [stroke-width:.7]" cx={ARENA.reactor.x} cy={ARENA.reactor.z} r={ARENA.reactor.radius + 2} />
        <circle className="[fill:#bbe8cc]" cx={ARENA.reactor.x} cy={ARENA.reactor.z} r={ARENA.reactor.radius} />
      </g>
      <text x="-77" y="-49">N ↑</text>
    </svg>
    <figcaption><span><i className="open" />Open lane</span><span><i className="sealed" />Sealed lane</span><span><i className="core" />Reactor</span></figcaption>
  </figure>;
}

function TierBrief({ tier, save }: { tier: ThreatTier; save: SaveData }) {
  const record = save.records[String(tier.id)];
  const modifiers = [
    ['Enemy hull', multiplier(tier.hpMult)], ['Enemy damage', multiplier(tier.damageMult)],
    ['Movement speed', multiplier(tier.speedMult)], ['Spawn count', multiplier(tier.countMult)],
    ['Salvage', multiplier(tier.salvageMult)], ['Elite rate', multiplier(tier.eliteRate)],
    ['Max elite modifiers', tier.maxMods], ['Bosses from', `Wave ${tier.bossFirstWave}`],
  ];
  return <div className="tier-brief">
    <p>{tier.blurb}</p>
    <LevelLootCard rl={tier.id} />
    <div className="tier-facts">
      <div><b>{multiplier(tier.hpMult)}</b><span>Machine hull</span></div>
      <div><b>{tier.bossFirstWave}</b><span>First possible boss wave</span></div>
      <div><b>{record?.bestWave ?? '—'}</b><span>Best wave · {record?.runs ?? 0} runs</span></div>
    </div>
    <details className="field-notes"><summary>Level modifiers</summary>
      <dl className="tier-modifiers">{modifiers.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </details>
    <UnlockBar save={save} />
  </div>;
}

export function Stat({ k, v, tone }: { k: string; v: string; tone?: 'up' | 'down' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}
