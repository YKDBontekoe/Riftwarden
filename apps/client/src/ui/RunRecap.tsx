// Run recap (docs/progression-design.md §6): the best finds of the run, the loadout power gained since the run
// started and the weapon mastery earned, so even a small step forward reads as progress.
import { powerGain } from '@riftwarden/rules/loot/feedback';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { FAMILY_NAME, MASTERY_FAMILIES, addMastery } from '@riftwarden/rules/progression/mastery';
import type { RunResult } from '@riftwarden/rules/progression/run';

export function RunRecap({ result, powerAfter }: { result: RunResult; powerAfter?: number }) {
  // The ledger lists secured items best first (loot/feedback bestFinds).
  const finds = (result.securedItems ?? []).slice(0, 3);
  const gain = result.powerAtStart && powerAfter ? powerGain(result.powerAtStart, powerAfter) : 0;
  const mastery = addMastery(result.masterySecured, result.masteryKept);
  const fams = MASTERY_FAMILIES.filter((f) => (mastery[f] ?? 0) > 0);
  if (!finds.length && Math.abs(gain) < 0.005 && !fams.length) return null;
  return (
    <div className="grid gap-[6px] border border-line p-[10px_12px]" data-testid="run-recap">
      <div className="flex items-baseline justify-between gap-[10px]">
        <span className="cp-label m-0">RUN RECAP</span>
        {Math.abs(gain) >= 0.005 && (
          <b className={`font-mono text-[12px] ${gain > 0 ? 'text-ok' : 'text-muted'}`} data-testid="recap-power" title="Equipped gear power now against the start of the run">
            {gain > 0 ? '▲ +' : ''}{Math.round(gain * 1000) / 10}% LOADOUT POWER
          </b>
        )}
      </div>
      {finds.length > 0 && (
        <div className="grid gap-[3px]" data-testid="recap-finds">
          {finds.map((it, i) => (
            <div key={it.uid} className="flex justify-between gap-[10px] text-[13px]">
              <span><span className="font-mono text-[10px] text-faint">{i === 0 ? 'BEST FIND' : `#${i + 1}`}</span> <b style={{ color: rarity(it.rarity).color }}>{it.name}</b></span>
              <span className="font-mono text-[11px] text-faint">{rarity(it.rarity).label.toUpperCase()} · LV {it.level}</span>
            </div>
          ))}
        </div>
      )}
      {fams.length > 0 && (
        <div className="text-[12.5px] text-muted" data-testid="recap-mastery">
          Mastery: {fams.map((f) => `+${mastery[f]} ${FAMILY_NAME[f]}`).join(' · ')}
        </div>
      )}
    </div>
  );
}
