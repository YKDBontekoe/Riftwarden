// Drone statistics (final design "Drone configuration · stats"): grouped rows from the real stat pipeline; the selected
// row's sources (base value, every equipped item's modifier, set bonuses) show in the aside.
import { useState } from 'react';
import { activeSetBonuses } from '@riftwarden/rules/loot/sets';
import { BASE_STATS, computeStats, fmtNum, formatStat, maxHull, mitigation, type StatKey, STAT_DEFS } from '@riftwarden/rules/combat/stats';
import { ECONOMY, SENTINEL, towerCost } from '@riftwarden/rules/data/defs';
import { equipmentModifiers, weaponDefFor, weaponSummary } from '@riftwarden/rules/loot/equipment';
import { statSources } from '@riftwarden/rules/loot/loadoutScore';
import { MOVE } from '@riftwarden/game/player/Player';
import type { ItemInstance, SlotId } from '@riftwarden/rules/progression/items';
import { SLOTS } from '@riftwarden/rules/progression/items';
import { ScoreCards, useScore } from './compare';
import { STAT_HELP } from './statHelp';

interface Row {
  k: string;
  v: string;
  tone?: 'up' | 'down';
  /** Stat keys feeding the value (sources in the aside). */
  stats?: StatKey[];
  note?: string;
}

function StatRow({ r, on, pick }: { r: Row; on: boolean; pick: () => void }) {
  return (
    <button type="button" className={`ds-stat-row ${on ? 'ds-sel' : ''} ${r.tone ?? ''}`} aria-pressed={on} onClick={pick} onMouseEnter={pick}>
      <span className="ds-grow">{r.k}</span>
      <b className="ds-d">{r.v}</b>
    </button>
  );
}

/** Calculated drone statistics from the real stat pipeline, with headline scores and per-stat sources. */
export function DroneStats({ equipped, compact }: { equipped: Record<SlotId, ItemInstance | null>; compact?: boolean }) {
  const all = SLOTS.map((s) => equipped[s.id]);
  const score = useScore(all);
  // Stat sources follow the primary in hand: the holstered secondary's affixes apply only after a swap.
  const list = SLOTS.filter((s) => s.id !== 'weapon2').map((s) => equipped[s.id]);
  const w2 = weaponDefFor(equipped.weapon2);
  const ws2 = w2 ? weaponSummary(w2, computeStats(equipmentModifiers(SLOTS.filter((s) => s.id !== 'weapon').map((s) => equipped[s.id])))) : null;
  const st = score.stats;
  const w = weaponDefFor(equipped.weapon);
  const ws = w ? weaponSummary(w, st) : null;
  const d = (k: StatKey): 'up' | 'down' | undefined => {
    if (Math.abs(st[k] - BASE_STATS[k]) < 1e-9) return undefined;
    return (st[k] > BASE_STATS[k]) === (STAT_DEFS[k].better === 'higher') ? 'up' : 'down';
  };
  const groups: { name: string; rows: Row[] }[] = [];
  if (w && ws)
    groups.push({
      name: `Primary · ${w.name}`,
      rows: [
        { k: 'Damage per shot', v: fmtNum(ws.damage), tone: d('weaponDamageMult'), stats: ['weaponDamageMult'] },
        { k: 'Shots per second', v: `${fmtNum(ws.rate)}`, tone: d('fireRateMult'), stats: ['fireRateMult'] },
        { k: 'Expected DPS (crits)', v: fmtNum(ws.dps), note: 'Sustained damage per second including crit chance and damage.' },
        ...(ws.packDps > ws.dps * 1.05 ? [{ k: 'Pack DPS (3 machines)', v: fmtNum(ws.packDps), note: 'Damage per second against three machines standing together (blast, spray cone or pierce).' }] : []),
        { k: 'Crit chance', v: formatStat('critChance', st.critChance), tone: d('critChance'), stats: ['critChance'], note: 'Weakpoint hits always crit.' },
        { k: 'Crit damage', v: formatStat('critMultiplier', st.critMultiplier), tone: d('critMultiplier'), stats: ['critMultiplier'] },
        { k: 'Range', v: `${fmtNum(ws.range)} m`, tone: d('rangeMult'), stats: ['rangeMult'] },
        { k: 'Heat per shot', v: `${fmtNum(ws.heat)}%`, tone: d('heatEfficiency'), stats: ['heatEfficiency'] },
        { k: 'Shots to overheat', v: String(ws.shotsToOverheat), tone: d('heatEfficiency'), stats: ['heatEfficiency'] },
        { k: 'Cooling', v: `${fmtNum(ws.cool)}%/s`, tone: d('coolRateMult'), stats: ['coolRateMult'] },
        { k: 'Elemental power', v: formatStat('elementalPower', st.elementalPower), tone: d('elementalPower'), stats: ['elementalPower'] },
      ],
    });
  if (w2 && ws2)
    groups.push({
      name: `Secondary · ${w2.name}`,
      rows: [
        { k: 'Damage per shot', v: fmtNum(ws2.damage), note: 'With the secondary in hand (its own affixes and modules apply).' },
        { k: 'Expected DPS (crits)', v: fmtNum(ws2.dps), note: 'Sustained damage per second with the secondary in hand.' },
        { k: 'Shots to overheat', v: String(ws2.shotsToOverheat), note: 'The holstered weapon vents at full rate while the other one fires.' },
      ],
    });
  groups.push({
    name: 'Defense',
    rows: [
      { k: 'Hull', v: fmtNum(maxHull(ECONOMY.playerMaxHp, st)), tone: st.maxHealthBonus !== 0 || st.maxHealthMult !== 1 ? 'up' : undefined, stats: ['maxHealthBonus', 'maxHealthMult'] },
      { k: 'Self-repair', v: '18/s after 4 s', note: 'Hull repairs itself after 4 s without taking damage.' },
      { k: 'Shield', v: st.shieldCapacity > 0 ? fmtNum(st.shieldCapacity) : 'none', tone: d('shieldCapacity'), stats: ['shieldCapacity'] },
      { k: 'Shield regen', v: st.shieldCapacity > 0 ? `${fmtNum(st.shieldRegen)} / s` : '—', tone: d('shieldRegen'), stats: ['shieldRegen'] },
      { k: 'Shield delay', v: st.shieldCapacity > 0 ? formatStat('shieldDelay', st.shieldDelay) : '—', tone: st.shieldCapacity > 0 ? d('shieldDelay') : undefined, stats: ['shieldDelay'] },
      { k: 'Armour', v: fmtNum(st.armor), tone: d('armor'), stats: ['armor'] },
      { k: 'Resist', v: formatStat('damageResist', st.damageResist), tone: d('damageResist'), stats: ['damageResist'] },
      { k: 'Damage reduction (W1)', v: `${fmtNum(mitigation(st) * 100)}%`, note: 'Share of incoming damage removed by armour and resistance against wave-1 enemies (cap 80%).' },
      { k: 'Effective hull', v: fmtNum(score.ehp), note: '(Hull + shield) / (1 − damage reduction) at wave 1.' },
    ],
  });
  groups.push({
    name: 'Mobility · towers',
    rows: [
      { k: 'Move speed', v: `${fmtNum(MOVE.runSpeed * st.moveSpeedMult)} m/s`, tone: d('moveSpeedMult'), stats: ['moveSpeedMult'] },
      { k: 'Sprint', v: `${fmtNum(MOVE.sprintSpeed * st.moveSpeedMult)} m/s`, tone: d('moveSpeedMult'), stats: ['moveSpeedMult'] },
      { k: 'Dash recharge', v: `${MOVE.dashCharges} × ${fmtNum(MOVE.dashRecharge / st.dashRechargeMult)} s`, tone: d('dashRechargeMult'), stats: ['dashRechargeMult'] },
      { k: 'Ability power', v: formatStat('abilityPowerMult', st.abilityPowerMult), tone: d('abilityPowerMult'), stats: ['abilityPowerMult'] },
      { k: 'Ability cooldown', v: formatStat('abilityCooldownMult', st.abilityCooldownMult), tone: d('abilityCooldownMult'), stats: ['abilityCooldownMult'] },
      { k: 'Tower damage', v: formatStat('turretDamageMult', st.turretDamageMult), tone: d('turretDamageMult'), stats: ['turretDamageMult'] },
      { k: 'Tower fire rate', v: formatStat('turretFireRateMult', st.turretFireRateMult), tone: d('turretFireRateMult'), stats: ['turretFireRateMult'] },
      { k: 'Tower range', v: `${fmtNum(SENTINEL.range * st.turretRangeMult)} m`, tone: d('turretRangeMult'), stats: ['turretRangeMult'] },
      { k: 'Sentinel cost', v: `${towerCost(SENTINEL, st.buildCostMult)} cores`, tone: d('buildCostMult'), stats: ['buildCostMult'] },
      { k: 'Tactical recharge', v: formatStat('tacticalRechargeMult', st.tacticalRechargeMult), tone: d('tacticalRechargeMult'), stats: ['tacticalRechargeMult'] },
    ],
  });
  const flat = groups.flatMap((g) => g.rows.map((r) => ({ g: g.name, r })));
  const [pick, setPick] = useState(flat[0] ? `${flat[0].g}|${flat[0].r.k}` : '');
  const cur = flat.find((x) => `${x.g}|${x.r.k}` === pick)?.r ?? flat[0]?.r;
  const sets = activeSetBonuses(list);
  return (
    <div className={`drone-stats ${compact ? 'compact' : ''}`}>
      <ScoreCards score={score} />
      {sets.length > 0 && (
        <div className="ds-row" data-testid="drone-sets" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="ds-lbl">Sets</span>
          {sets.map((a) => (
            <span key={a.set.id} className={`ds-chip ${a.bonuses.length ? 'green' : ''}`} title={a.set.bonuses.map((b) => `${b.pieces} pieces: ${b.text}`).join('\n')}>
              {a.set.name} {a.pieces}/4 · {a.bonuses.length ? a.bonuses[a.bonuses.length - 1].text : `${2 - a.pieces} more for the first bonus`}
            </span>
          ))}
        </div>
      )}
      <div className="dst-body">
        <div className="dst-groups">
          {groups.map((g) => (
            <section key={g.name} className="ds-col">
              <span className="ds-h3 dst-head">{g.name}</span>
              {g.rows.map((r) => <StatRow key={r.k} r={r} on={cur === r} pick={() => setPick(`${g.name}|${r.k}`)} />)}
            </section>
          ))}
        </div>
        {cur && (
          <aside className="dst-aside ds-glass ds-cut ds-col" aria-live="polite">
            <span className="ds-ov ds-em">Where it comes from</span>
            <span className="ds-row" style={{ alignItems: 'baseline' }}><span className="ds-h2 ds-grow">{cur.k}</span><span className="ds-num">{cur.v}</span></span>
            {cur.stats?.map((k) => {
              const src = statSources(list, k);
              return (
                <div key={k} className="ds-col">
                  <div className="ds-list-row"><span className="ds-grow">Base {STAT_DEFS[k].label.toLowerCase()}</span><b>{formatStat(k, BASE_STATS[k])}</b></div>
                  {src.map((s) => <div key={s.uid + s.op} className="ds-list-row"><span className="ds-grow">{s.name}</span><b className={s.value >= 0 === (STAT_DEFS[k].better === 'higher') ? 'ds-up' : 'ds-bad'}>{s.text}</b></div>)}
                  {!src.length && <span className="ds-meta">No equipped item changes it.</span>}
                  <span className="ds-meta">{STAT_HELP[k]}</span>
                </div>
              );
            })}
            {cur.note && <span className="ds-meta">{cur.note}</span>}
            <span className="ds-meta">Skill tree, mastery and run upgrades apply on top in the arena. Conditional affixes count at their expected uptime in scores.</span>
          </aside>
        )}
      </div>
    </div>
  );
}
