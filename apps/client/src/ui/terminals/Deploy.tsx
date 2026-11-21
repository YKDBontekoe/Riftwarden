import { DeployMapPanel, ResumeCard } from '../DeployMap';
import { useState } from 'react';
import type { Flow } from '../../core/Flow';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { ARENA } from '@riftwarden/rules/world/layout';
import { SLOTS } from '@riftwarden/rules/progression/items';
import { deployBlocker, equippedItem, type SaveData } from '@riftwarden/rules/progression/save';
import { CHECKPOINT_INTERVAL, THREAT_TIERS, type ThreatTier, unlockText } from '@riftwarden/rules/progression/tiers';
import { useSave } from '../App';
import { Shell } from '../shell';
import { CoopPanel } from '../Coop';

const multiplier = (value: number) => `${Number(value.toFixed(2))}×`;

export function DeployTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'solo' | 'coop'>(flow.net ? 'coop' : 'solo');
  const selected = THREAT_TIERS.find((t) => t.id === save.threat.selected) ?? THREAT_TIERS[0];
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
      <div className="tabs deploy-mode">
        <button className={mode === 'solo' ? 'on' : ''} data-testid="deploy-solo" onClick={() => setMode('solo')}>
          SOLO OPERATION
        </button>
        <button className={mode === 'coop' ? 'on' : ''} data-testid="deploy-coop" onClick={() => setMode('coop')}>
          CO-OP OPERATION · 2-4 WARDENS
        </button>
      </div>
      {mode === 'coop' ? (
        <CoopPanel flow={flow} />
      ) : (
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
              <li>Higher tiers increase rewards and enemy strength. Watch for event and boss warnings before a wave.</li>
            </ul>
          </details>
          <div className="loadout-line">
            <span>LOADOUT · {gearCount}/{SLOTS.length} SLOTS</span>
            <b style={weapon ? { color: rarity(weapon.rarity).color } : undefined}>{weapon?.name.toUpperCase() ?? 'NO WEAPON'}</b>
          </div>
          {blocker && <div className="deploy-block">{blocker}</div>}
        </div>
        <div className="tier-col">
          <div className="col-label">SELECT THREAT TIER</div>
          <div className="tier-selector" role="group" aria-label="Threat tier">
            {THREAT_TIERS.map(t => {
              const locked = t.id > save.threat.unlocked;
              return <button key={t.id} className={`tier-card ${t.id === selected.id ? 'on' : ''}`} disabled={locked || busy}
                aria-pressed={t.id === selected.id} aria-label={`Tier ${t.roman}, ${t.name}`}
                title={locked ? `${t.name} · ${unlockText(t.id)}` : t.name} onClick={() => flow.selectTier(t.id)}>{t.roman}</button>;
            })}
          </div>
          <TierBrief tier={selected} save={save} />
          <button className="primary deploy" disabled={busy || !!blocker} onClick={deploy}>
            <span>{busy ? 'LAUNCHING…' : `DEPLOY · TIER ${selected.roman}`}</span>
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      </div>
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
        <circle className="plan-ring" cx={ARENA.reactor.x} cy={ARENA.reactor.z} r={ARENA.reactor.radius + 2} />
        <circle className="plan-core" cx={ARENA.reactor.x} cy={ARENA.reactor.z} r={ARENA.reactor.radius} />
      </g>
      <text x="-77" y="-49">N ↑</text>
    </svg>
    <figcaption><span><i className="open" />Open lane</span><span><i className="sealed" />Sealed lane</span><span><i className="core" />Reactor</span></figcaption>
  </figure>;
}

function TierBrief({ tier, save }: { tier: ThreatTier; save: SaveData }) {
  const record = save.records[String(tier.id)];
  const next = THREAT_TIERS.find(t => t.id === save.threat.unlocked + 1);
  const modifiers = [
    ['Enemy health', multiplier(tier.hpMult)], ['Enemy damage', multiplier(tier.damageMult)],
    ['Movement speed', multiplier(tier.speedMult)], ['Spawn count', multiplier(tier.countMult)],
    ['Salvage', multiplier(tier.salvageMult)], ['Item level', `+${tier.lootLevelBonus}`],
    ['Loot luck', multiplier(tier.lootLuck)], ['Elite rate', multiplier(tier.eliteRate)],
    ['Max elite modifiers', tier.maxMods], ['Bosses from', `Wave ${tier.bossFirstWave}`],
  ];
  return <div className="tier-brief">
    <h3>{tier.name.toLowerCase()}</h3><p>{tier.blurb}</p>
    <div className="tier-facts">
      <div><b>{multiplier(tier.salvageMult)}</b><span>Salvage</span></div>
      <div><b>{tier.bossFirstWave}</b><span>First possible boss wave</span></div>
      <div><b>{record?.bestWave ?? '—'}</b><span>Best wave · {record?.runs ?? 0} runs</span></div>
    </div>
    <details className="field-notes"><summary>Tier modifiers</summary>
      <dl className="tier-modifiers">{modifiers.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </details>
    {next && <p className="next-tier"><strong>Tier {next.roman} · {next.name.toLowerCase()}</strong> {unlockText(next.id)}</p>}
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
