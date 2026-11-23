// Rift Level picker + briefing (deploy terminal, co-op lobby): endless levels, unlock progress, loot gates and a
// readiness verdict for the current loadout.
import { useState } from 'react';
import { rarity, type RarityId } from '@riftwarden/rules/loot/rarity';
import { gearPower, levelLoot, readiness, recommendedLevel, type Readiness, unlockProgress } from '@riftwarden/rules/progression/riftLevel';
import { getTier, NAMED_LEVELS } from '@riftwarden/rules/progression/tiers';
import { equippedItem, type SaveData } from '@riftwarden/rules/progression/save';
import { SLOT_IDS } from '@riftwarden/rules/progression/items';

const READY: Record<Readiness, { label: string; cls: string; hint: string }> = {
  easy: { label: 'COMFORTABLE', cls: 'text-ok border-ok/50', hint: 'Your gear outclasses these machines. Step up for better drops.' },
  fair: { label: 'MATCHED', cls: 'text-cyan border-cyan/50', hint: 'Your gear matches this level.' },
  hard: { label: 'CHALLENGING', cls: 'text-amber border-amber/50', hint: 'Expect a fight: lean on towers, abilities and run upgrades.' },
  deadly: { label: 'DEADLY', cls: 'text-bad border-bad/60', hint: 'These machines outclass your gear. Unsecured cargo is at real risk.' },
};

const pct = (p: number) => (p <= 0 ? '—' : p >= 0.01 ? `${(p * 100).toFixed(1)}%` : p >= 0.001 ? `${(p * 100).toFixed(2)}%` : `1 in ${Math.round(1 / p).toLocaleString()}`);

/** Power of the profile's equipped gear (readiness verdicts). */
export function savePower(save: SaveData): number {
  return gearPower(SLOT_IDS.map((s) => equippedItem(save, s)));
}

export function RarityName({ id }: { id: RarityId }) {
  const r = rarity(id);
  return <b style={{ color: r.color }}>{r.label}</b>;
}

/** Stepper over unlocked levels with quick jumps, the selected level's name and readiness. */
export function RiftLevelPicker({ value, unlocked, power, onPick, disabled }: { value: number; unlocked: number; power: number; onPick: (rl: number) => void; disabled?: boolean }) {
  const t = getTier(value);
  const rec = recommendedLevel(power, unlocked);
  const ready = READY[readiness(power, value)];
  const set = (v: number) => onPick(Math.max(1, Math.min(unlocked, v)));
  // Global buttons are full-width blocks: size these explicitly.
  const btn = 'm-0 w-auto px-[10px] py-[6px] font-mono text-[11px] tracking-[0.08em]';
  const step = 'm-0 w-[48px] shrink-0 p-0 grid place-items-center font-display text-[22px] leading-none';
  return (
    <div className="grid gap-[8px]" data-testid="rl-picker">
      <div className="flex items-stretch gap-[6px]" role="group" aria-label="Rift Level">
        <button className={step} disabled={disabled || value <= 1} aria-label="Lower Rift Level" onClick={() => set(value - 1)} data-testid="rl-down">−</button>
        <div className="min-w-0 flex-1 grid place-items-center border border-line bg-[rgb(0_0_0/0.25)] py-[6px]" aria-live="polite">
          <div className="font-display text-[30px] leading-[1.05] tracking-[-0.03em] whitespace-nowrap" data-testid="rl-value">RL {value}</div>
          <div className="font-mono text-[10px] tracking-[0.18em] text-muted whitespace-nowrap">{value <= NAMED_LEVELS ? `${t.name} · TIER ${t.roman}` : t.name}</div>
        </div>
        <button className={step} disabled={disabled || value >= unlocked} aria-label="Raise Rift Level" onClick={() => set(value + 1)} data-testid="rl-up">+</button>
      </div>
      <div className="flex flex-wrap gap-[5px]">
        {value !== 1 && <button className={btn} disabled={disabled} onClick={() => set(1)}>RL 1</button>}
        {rec !== value && <button className={btn} disabled={disabled} onClick={() => set(rec)} data-testid="rl-recommended">RECOMMENDED · RL {rec}</button>}
        {unlocked !== value && <button className={btn} disabled={disabled} onClick={() => set(unlocked)} data-testid="rl-highest">HIGHEST · RL {unlocked}</button>}
      </div>
      <div className={`flex items-center justify-between gap-[8px] border px-[9px] py-[6px] ${ready.cls}`} title={ready.hint} data-testid="rl-readiness">
        <span className="font-mono text-[11px] tracking-[0.14em]">{ready.label}{value === rec ? ' · RECOMMENDED' : ''}</span>
        <span className="text-[12px] text-muted text-right">{ready.hint}</span>
      </div>
    </div>
  );
}

/** Unlock progress bar toward the next Rift Level. */
export function UnlockBar({ save }: { save: SaveData }) {
  const p = unlockProgress(save.records, save.threat.unlocked);
  const f = p.need ? p.have / p.need : 1;
  return (
    <div className="grid gap-[5px]" data-testid="rl-unlock">
      <div className="flex justify-between font-mono text-[11px] tracking-[0.08em] text-muted">
        <span>NEXT · RL {p.level}</span>
        <span>{p.have}/{p.need} CHECKPOINTS ON RL {p.level - 1}</span>
      </div>
      <div className="h-[6px] bg-[rgb(255_255_255/0.08)] overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={p.need} aria-valuenow={p.have} aria-label={`Progress to Rift Level ${p.level}`}>
        <div className="h-full bg-cyan transition-[width] duration-500" style={{ width: `${Math.round(f * 100)}%` }} />
      </div>
      <p className="m-0 text-[12px] text-muted">Secure checkpoints on your highest level (Rift Surges count on the level you surged to).</p>
    </div>
  );
}

/** What a level drops: item levels, rarity ceiling and odds, the next rarity gate. */
export function LevelLootCard({ rl }: { rl: number }) {
  const l = levelLoot(rl);
  return (
    <div className="grid gap-[6px] border-y border-line py-[10px]" data-testid="rl-loot">
      <div className="flex justify-between gap-[8px]">
        <span className="font-mono text-[11px] tracking-[0.08em] text-muted">ITEM LEVEL</span>
        <b className="font-mono text-[13px]">{l.levels[0]} – {l.levels[1]}</b>
      </div>
      <div className="flex justify-between gap-[8px]">
        <span className="font-mono text-[11px] tracking-[0.08em] text-muted">BEST ORDINARY DROP</span>
        <RarityName id={l.ceiling} />
      </div>
      <div className="grid grid-cols-3 gap-[6px] text-center">
        {(['epic', 'legendary', 'exotic'] as const).map((r) => (
          <div key={r} className="grid gap-[2px] bg-[rgb(0_0_0/0.22)] py-[5px]">
            <span className="font-mono text-[12px]" style={{ color: rarity(r).color }}>{pct(l.odds[r])}</span>
            <span className="font-mono text-[9px] tracking-[0.12em] text-faint">{rarity(r).label.toUpperCase()}</span>
          </div>
        ))}
      </div>
      {l.next && (
        <p className="m-0 text-[12px] text-muted" data-testid="rl-next-rarity">
          <RarityName id={l.next.rarity} /> drops open at RL {l.next.at}. Bosses and caches find epics one level early.
        </p>
      )}
    </div>
  );
}

const wipeKey = (id: string) => `riftwarden.wipeSeen.${id}`;

/** One-time HQ notice for profiles the v11 migration restarted (Rift Levels replaced the threat tiers). */
export function WipeNotice({ save }: { save: SaveData }) {
  const [seen, setSeen] = useState(() => {
    try {
      return !save.wiped || localStorage.getItem(wipeKey(save.profile.id)) === '1';
    } catch {
      return true;
    }
  });
  if (seen || !save.wiped) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(wipeKey(save.profile.id), '1');
    } catch {
      // storage unavailable: the notice simply shows again next session
    }
    setSeen(true);
  };
  return (
    <div className="border border-cyan/45 bg-[rgb(60_190_210/0.07)] p-[14px_16px] grid gap-[8px] m-[0_0_14px]" role="note" aria-label="Progression restarted" data-testid="wipe-notice">
      <div className="font-mono text-[11px] tracking-[0.16em] text-cyan">COMMAND NOTICE · RIFT LEVELS</div>
      <h3 className="m-0 font-display text-[22px] tracking-[-0.03em]">A new climb begins</h3>
      <p className="m-0 text-[14px] leading-[1.5]">
        Threat tiers are now endless <b>Rift Levels</b>. Each level raises item levels by ten and opens rarer drops: epics from RL 3, legendaries from RL 7, exotics from RL 12. Your warden restarts at RL 1 with fresh gear; your callsign and training are kept.
      </p>
      <p className="m-0 text-[13px] text-muted">Secure checkpoints on your highest level to unlock the next. Deep into a run, the map offers Rift Surges for an extra level.</p>
      <button className="primary justify-self-start" onClick={dismiss} data-testid="wipe-ok">UNDERSTOOD</button>
    </div>
  );
}
