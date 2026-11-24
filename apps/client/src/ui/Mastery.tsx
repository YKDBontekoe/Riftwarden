// Weapon-family mastery in the HQ (workshop MASTERY tab) and the arena (mastery gain toast on the weapon card).
import { useEffect, useState } from 'react';
import type { Flow } from '../core/Flow';
import type { WeaponFamily } from '@riftwarden/rules/data/defs';
import { STAT_DEFS } from '@riftwarden/rules/combat/stats';
import {
  COMPONENT_RANKS,
  FAMILY_NAME,
  FINISH_RANKS,
  MASTERY_FAMILIES,
  MAX_RANK,
  masteryTitle,
  PERK_EVERY,
  perkOptions,
  perkTiers,
  type PerkDef,
  rankDamage,
  rankInfo,
} from '@riftwarden/rules/progression/mastery';
import { componentDef } from '@riftwarden/rules/weapons/components';
import { isUnlocked, requirementText, unlockDef } from '@riftwarden/rules/progression/unlocks';
import type { SaveData } from '@riftwarden/rules/progression/save';
import { uiEvents } from '@riftwarden/game/ui/store';
import { sfx } from '@riftwarden/game/audio/Sfx';

/** Warden level a family opens at (0 = from the start): the list follows the unlock track. */
const familyGateLevel = (f: WeaponFamily): number => {
  const u = FAMILY_UNLOCK[f] ? unlockDef(FAMILY_UNLOCK[f]!) : undefined;
  return u && 'warden' in u.by ? u.by.warden : 0;
};

const FAMILY_UNLOCK: Record<WeaponFamily, string | null> = { plasma: null, rail: 'family:rail', beam: 'family:beam', swarm: 'family:swarm', launcher: 'family:launcher', flamer: 'family:flamer' };

const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 1000) / 10}%`;
function perkText(p: PerkDef): string {
  const d = STAT_DEFS[p.stat];
  const v = p.op === 'add' && d.kind !== 'chance' ? `${p.value > 0 ? '+' : ''}${Math.round(p.value * 1000) / 1000}` : pct(p.value);
  return `${v} ${d.label.toLowerCase()}`;
}

/** Workshop tab: every family's rank, bonus, component unlocks, perk choices and finishes. */
export function MasteryBench({ flow, save }: { flow: Flow; save: SaveData }) {
  const [fam, setFam] = useState<WeaponFamily>('plasma');
  const [msg, setMsg] = useState<string | null>(null);
  const m = save.progress.mastery?.[fam];
  const info = rankInfo(m?.xp ?? 0);
  const tiers = perkTiers(info.rank);
  const locked = FAMILY_UNLOCK[fam] && !isUnlocked(save, FAMILY_UNLOCK[fam]!);
  const op = (name: string, args: unknown[], ok: string) => {
    const r = flow.profile.op(name, args);
    sfx.play(r.ok ? 'install' : 'buildDeny');
    setMsg(r.ok ? ok : (r as { reason?: string }).reason ?? 'Refused');
  };
  return (
    <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-[16px]" data-testid="mastery-bench">
      <div className="grid content-start gap-[6px]">
        <div className="col-label">WEAPON FAMILIES</div>
        {[...MASTERY_FAMILIES].sort((a, b) => familyGateLevel(a) - familyGateLevel(b)).map((f) => {
          const r = rankInfo(save.progress.mastery?.[f]?.xp ?? 0);
          const gate = FAMILY_UNLOCK[f] && !isUnlocked(save, FAMILY_UNLOCK[f]!) ? unlockDef(FAMILY_UNLOCK[f]!) : undefined;
          return (
            <button key={f} className={`m-0 text-left ${f === fam ? 'on [border-color:var(--amber)]' : ''} ${gate ? 'opacity-55' : ''}`} data-family={f} data-locked={gate ? 1 : undefined} onClick={() => (setFam(f), setMsg(null))}>
              <b className="block">{FAMILY_NAME[f]}</b>
              <span className="font-mono text-[10.5px] text-faint">{gate ? `${requirementText(gate).toUpperCase()}` : `RANK ${r.rank}/${MAX_RANK}`}</span>
              <span className="block h-[3px] mt-[4px] bg-[rgb(255_255_255/0.08)]"><span className="block h-full bg-amber" style={{ width: `${Math.round((r.rank + r.frac) / MAX_RANK * 100)}%` }} /></span>
            </button>
          );
        })}
      </div>
      <div className="grid content-start gap-[12px] min-w-0">
        <div className="flex items-baseline justify-between gap-[12px]">
          <div>
            <h3 className="m-0 font-display text-[24px] tracking-[-0.03em]">{masteryTitle(fam, info.rank)}</h3>
            <span className="text-[13px] text-muted">Kills with a {FAMILY_NAME[fam].toLowerCase()} weapon earn mastery XP: banked at checkpoints like Warden XP (25% kept if the run is lost). In co-op every other warden adds +10%.</span>
          </div>
          <div className="text-right whitespace-nowrap">
            <b className="font-display text-[28px]" data-testid="mastery-rank">R{info.rank}</b>
            <div className="font-mono text-[11px] text-amber">{pct(rankDamage(info.rank))} DAMAGE</div>
          </div>
        </div>
        {locked && <div className="prot-note">{FAMILY_NAME[fam]} weapons are not unlocked yet: mastery starts once they drop.</div>}
        <div className="grid gap-[4px]">
          <div className="h-[6px] bg-[rgb(255_255_255/0.08)]"><div className="h-full bg-amber" style={{ width: `${Math.round(info.frac * 100)}%` }} /></div>
          <span className="font-mono text-[11px] text-faint">{info.rank >= MAX_RANK ? 'MASTERED' : `${info.into.toLocaleString()} / ${info.need.toLocaleString()} XP to rank ${info.rank + 1}`}</span>
        </div>
        <div className="grid grid-cols-2 gap-[12px]">
          <div className="grid content-start gap-[5px]">
            <div className="col-label">COMPONENT UNLOCKS</div>
            {COMPONENT_RANKS[fam].map(([c, r]) => (
              <div key={c} className={`flex justify-between text-[13px] ${info.rank >= r ? '' : 'text-muted'}`}>
                <span>{info.rank >= r ? '✓ ' : ''}{componentDef(c)?.name ?? c}</span>
                <span className="font-mono text-[10.5px] text-faint">RANK {r}</span>
              </div>
            ))}
            <span className="text-[12px] text-faint">Locked components never drop, craft or refit on this family's weapons.</span>
          </div>
          <div className="grid content-start gap-[5px]">
            <div className="col-label">FINISHES</div>
            <div className="flex flex-wrap gap-[5px]">
              <button className={`mini m-0 w-auto ${!m?.finish ? 'on' : ''}`} onClick={() => op('masteryFinish', [fam, null], 'Item finish restored')}>ITEM'S OWN</button>
              {FINISH_RANKS.map(([f, r]) => (
                <button key={f} className={`mini m-0 w-auto ${m?.finish === f ? 'on' : ''}`} disabled={info.rank < r} title={info.rank < r ? `Rank ${r}` : undefined} data-finish={f} onClick={() => op('masteryFinish', [fam, f], `${f} finish applied to every ${FAMILY_NAME[fam].toLowerCase()} weapon`)}>
                  {f.toUpperCase()}{info.rank < r ? ` · R${r}` : ''}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="col-label">PERKS · ONE OF TWO EVERY {PERK_EVERY} RANKS (FREE TO CHANGE)</div>
        <div className="grid grid-cols-2 gap-[6px]" data-testid="mastery-perks">
          {Array.from({ length: Math.min(MAX_RANK / PERK_EVERY, Math.max(1, tiers + 1)) }, (_, i) => i + 1).map((t) => {
            const opts = perkOptions(fam, t);
            const chosen = m?.perks[t - 1];
            const open = t <= tiers;
            return opts.map((p, o) => (
              <button key={`${t}-${o}`} className={`m-0 text-left ${chosen === o ? 'on [border-color:var(--amber)] [background:rgb(255_181_71/0.12)] [box-shadow:inset_3px_0_0_var(--amber)]' : ''}`} disabled={!open} data-perk={`${t}-${o}`} onClick={() => op('masteryPerk', [fam, t, o], `${p.name} chosen`)}>
                <span className="font-mono text-[10px] text-faint">RANK {t * PERK_EVERY}{open ? '' : ' · LOCKED'}</span>
                <b className="block">{chosen === o ? '✓ ' : ''}{p.name}</b>
                <span className="text-[12.5px] text-muted">{perkText(p)} with {FAMILY_NAME[fam].toLowerCase()} weapons</span>
              </button>
            ));
          })}
        </div>
        {msg && <div className="term-msg">{msg}</div>}
      </div>
    </div>
  );
}

/** Arena: "+30 RAILGUN MASTERY" floats briefly above the weapon card (merged within 1.2 s). */
export function MasteryGainToast() {
  const [g, setG] = useState<{ family: string; xp: number; id: number } | null>(null);
  useEffect(() => {
    let id = 0;
    let t: ReturnType<typeof setTimeout>;
    const off = uiEvents.on('mastery', (e) => {
      setG((cur) => ({ family: e.family, xp: (cur && cur.family === e.family ? cur.xp : 0) + e.xp, id: ++id }));
      clearTimeout(t);
      t = setTimeout(() => setG(null), 1200);
    });
    return () => {
      off();
      clearTimeout(t);
    };
  }, []);
  if (!g) return null;
  return (
    <div className="fixed right-[26px] bottom-[176px] font-mono text-[11px] tracking-[0.14em] text-amber pointer-events-none [animation:rise_.18s_ease-out]" data-testid="mastery-gain">
      +{g.xp} {(FAMILY_NAME[g.family as WeaponFamily] ?? g.family).toUpperCase()} MASTERY
    </div>
  );
}
