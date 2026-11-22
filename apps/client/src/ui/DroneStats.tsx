import { BASE_STATS, computeStats, fmtNum, formatStat, maxHull, mitigation, type StatKey, STAT_DEFS } from '@riftwarden/rules/combat/stats';
import { ECONOMY, SENTINEL, towerCost } from '@riftwarden/rules/data/defs';
import { equipmentModifiers, weaponDefFor, weaponSummary } from '@riftwarden/rules/loot/equipment';
import { MOVE } from '@riftwarden/game/player/Player';
import type { ItemInstance, SlotId } from '@riftwarden/rules/progression/items';
import { SLOTS } from '@riftwarden/rules/progression/items';
import { ScoreCards, statTooltip, useScore } from './compare';

/** One stat tile. `stats` lists the stat keys feeding it (tooltip: what they do + which items contribute). */
function Stat({ k, v, tone, stats, equipped, note }: { k: string; v: string; tone?: 'up' | 'down'; stats?: StatKey[]; equipped: (ItemInstance | null)[]; note?: string }) {
  const tip = [note, ...(stats ?? []).map((s) => statTooltip(s, equipped))].filter(Boolean).join('\n\n');
  return (
    <div className={`stat ${tone ?? ''} ${tip ? 'has-tip' : ''}`} title={tip || undefined}>
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

/** Calculated drone statistics from the real stat pipeline, with headline scores and per-stat sources. */
export function DroneStats({ equipped }: { equipped: Record<SlotId, ItemInstance | null> }) {
  const all = SLOTS.map((s) => equipped[s.id]);
  const score = useScore(all);
  // Stat sources follow the primary in hand: the holstered secondary's affixes apply only after a swap.
  const list = SLOTS.filter((s) => s.id !== 'weapon2').map((s) => equipped[s.id]);
  const w2 = weaponDefFor(equipped.weapon2);
  const ws2 = w2 ? weaponSummary(w2, computeStats(equipmentModifiers(SLOTS.filter((s) => s.id !== 'weapon').map((s) => equipped[s.id])))) : null;
  const st = score.stats;
  const w = weaponDefFor(equipped.weapon);
  const ws = w ? weaponSummary(w, st) : null;
  const b = BASE_STATS;
  const d = (k: StatKey): 'up' | 'down' | undefined => {
    const def = STAT_DEFS[k];
    if (Math.abs(st[k] - b[k]) < 1e-9) return undefined;
    return (st[k] > b[k]) === (def.better === 'higher') ? 'up' : 'down';
  };
  const S = (p: Omit<Parameters<typeof Stat>[0], 'equipped'>) => <Stat {...p} equipped={list} />;
  return (
    <>
      <div className="col-label">LOADOUT SCORE · hover any value for its sources</div>
      <ScoreCards score={score} />
      {w && ws && (
        <>
          <div className="col-label">PRIMARY · {w.name}</div>
          <div className="stat-grid">
            <S k="DAMAGE / SHOT" v={fmtNum(ws.damage)} tone={d('weaponDamageMult')} stats={['weaponDamageMult']} />
            <S k="FIRE RATE" v={`${fmtNum(ws.rate)}/s`} tone={d('fireRateMult')} stats={['fireRateMult']} />
            <S k="EXPECTED DPS (CRITS)" v={fmtNum(ws.dps)} note="Sustained damage per second including crit chance and damage." />
            <S k="RANGE" v={`${fmtNum(ws.range)} m`} tone={d('rangeMult')} stats={['rangeMult']} />
            <S k="HEAT / SHOT" v={`${fmtNum(ws.heat)}%`} tone={d('heatEfficiency')} stats={['heatEfficiency']} />
            <S k="SHOTS TO OVERHEAT" v={String(ws.shotsToOverheat)} tone={d('heatEfficiency')} stats={['heatEfficiency']} />
            <S k="COOLING" v={`${fmtNum(ws.cool)}%/s`} tone={d('coolRateMult')} stats={['coolRateMult']} />
            <S k="CRIT CHANCE" v={`${formatStat('critChance', st.critChance)} · weakpoints 100%`} tone={d('critChance')} stats={['critChance']} />
            <S k="CRIT DAMAGE" v={formatStat('critMultiplier', st.critMultiplier)} tone={d('critMultiplier')} stats={['critMultiplier']} />
          </div>
        </>
      )}
      {w2 && ws2 && (
        <>
          <div className="col-label">SECONDARY · {w2.name} · swap in the arena</div>
          <div className="stat-grid">
            <S k="DAMAGE / SHOT" v={fmtNum(ws2.damage)} note="With the secondary in hand (its own affixes and modules apply)." />
            <S k="FIRE RATE" v={`${fmtNum(ws2.rate)}/s`} note="With the secondary in hand." />
            <S k="EXPECTED DPS (CRITS)" v={fmtNum(ws2.dps)} note="Sustained damage per second with the secondary in hand." />
            <S k="SHOTS TO OVERHEAT" v={String(ws2.shotsToOverheat)} note="The holstered weapon vents at full rate while the other one fires." />
          </div>
        </>
      )}
      <div className="col-label">DRONE</div>
      <div className="stat-grid">
        <S k="HULL INTEGRITY" v={fmtNum(maxHull(ECONOMY.playerMaxHp, st))} tone={st.maxHealthBonus !== 0 || st.maxHealthMult !== 1 ? 'up' : undefined} stats={['maxHealthBonus', 'maxHealthMult']} />
        <S k="SELF-REPAIR" v="18/s after 4 s" note="Hull repairs itself after 4 s without taking damage." />
        <S k="SHIELD" v={st.shieldCapacity > 0 ? `${fmtNum(st.shieldCapacity)} · +${fmtNum(st.shieldRegen)}/s` : 'NONE'} tone={d('shieldCapacity')} stats={['shieldCapacity', 'shieldRegen']} />
        <S k="SHIELD DELAY" v={st.shieldCapacity > 0 ? formatStat('shieldDelay', st.shieldDelay) : '—'} tone={st.shieldCapacity > 0 ? d('shieldDelay') : undefined} stats={['shieldDelay']} />
        <S k="ARMOR · RESIST" v={`${fmtNum(st.armor)} · ${formatStat('damageResist', st.damageResist)}`} tone={d('armor') ?? d('damageResist')} stats={['armor', 'damageResist']} />
        <S k="DAMAGE REDUCTION (W1)" v={`${fmtNum(mitigation(st) * 100)}%`} note="Share of incoming damage removed by armor and resistance against wave-1 enemies (cap 80%)." />
        <S k="SPEED · SPRINT" v={`${fmtNum(MOVE.runSpeed * st.moveSpeedMult)} · ${fmtNum(MOVE.sprintSpeed * st.moveSpeedMult)} m/s`} tone={d('moveSpeedMult')} stats={['moveSpeedMult']} />
        <S k="DASH RECHARGE" v={`${MOVE.dashCharges} × ${fmtNum(MOVE.dashRecharge / st.dashRechargeMult)} s`} tone={d('dashRechargeMult')} stats={['dashRechargeMult']} />
      </div>
      <div className="col-label">DEFENSES & TACTICAL</div>
      <div className="stat-grid">
        <S k="TURRET DAMAGE" v={formatStat('turretDamageMult', st.turretDamageMult)} tone={d('turretDamageMult')} stats={['turretDamageMult']} />
        <S k="TURRET FIRE RATE" v={formatStat('turretFireRateMult', st.turretFireRateMult)} tone={d('turretFireRateMult')} stats={['turretFireRateMult']} />
        <S k="TURRET RANGE" v={`${fmtNum(SENTINEL.range * st.turretRangeMult)} m`} tone={d('turretRangeMult')} stats={['turretRangeMult']} />
        <S k="SENTINEL COST" v={`${towerCost(SENTINEL, st.buildCostMult)} cores`} tone={d('buildCostMult')} stats={['buildCostMult']} />
        <S k="TACTICAL RECHARGE" v={formatStat('tacticalRechargeMult', st.tacticalRechargeMult)} tone={d('tacticalRechargeMult')} stats={['tacticalRechargeMult']} />
      </div>
    </>
  );
}
