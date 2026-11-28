// Weapon-family mastery in the HQ (workshop MASTERY tab) and the arena (mastery gain toast on the weapon card).
import { useEffect, useState } from 'react';
import { Bar } from './ds';
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

/** Rank track (final design): every reward of the family in rank order, done / next / locked. */
function RankTrack({ fam, rank }: { fam: WeaponFamily; rank: number }) {
  const items: { r: number; text: string }[] = [
    ...COMPONENT_RANKS[fam].map(([c, r]) => ({ r, text: componentDef(c)?.name ?? c })),
    ...FINISH_RANKS.map(([f, r]) => ({ r, text: `${f} finish` })),
    ...Array.from({ length: MAX_RANK / PERK_EVERY }, (_, i) => ({ r: (i + 1) * PERK_EVERY, text: 'Perk choice' })),
  ].sort((a, b) => a.r - b.r);
  const next = items.find((x) => x.r > rank)?.r;
  return (
    <div className="ms-track" data-testid="mastery-track">
      {items.filter((x) => x.r <= (next ?? MAX_RANK) + 15).map((x, i) => (
        <span key={i} className={`ms-step ${x.r <= rank ? 'done' : x.r === next ? 'next' : ''}`}>
          <b className="ds-d">{x.r}</b>
          <span>{x.text}</span>
          <em>{x.r <= rank ? 'Unlocked' : x.r === next ? `${x.r - rank} rank${x.r - rank === 1 ? '' : 's'}` : 'Locked'}</em>
        </span>
      ))}
    </div>
  );
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
    <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-[24px]" data-testid="mastery-bench">
      <div className="grid content-start gap-[6px]">
        <span className="ds-lbl">Weapon families</span>
        {[...MASTERY_FAMILIES].sort((a, b) => familyGateLevel(a) - familyGateLevel(b)).map((f) => {
          const r = rankInfo(save.progress.mastery?.[f]?.xp ?? 0);
          const gate = FAMILY_UNLOCK[f] && !isUnlocked(save, FAMILY_UNLOCK[f]!) ? unlockDef(FAMILY_UNLOCK[f]!) : undefined;
          return (
            <button key={f} className={`ms-fam ${f === fam ? 'on ds-sel' : ''} ${gate ? 'opacity-55' : ''}`} data-family={f} data-locked={gate ? 1 : undefined} onClick={() => (setFam(f), setMsg(null))}>
              <span className="ds-row"><b className="ds-d ds-grow">{FAMILY_NAME[f]}</b><span className="ds-meta">{gate ? requirementText(gate) : `Rank ${r.rank}`}</span></span>
              <Bar value={(r.rank + r.frac) / MAX_RANK} color="#ff8a3d" height={3} />
            </button>
          );
        })}
      </div>
      <div className="grid content-start gap-[12px] min-w-0">
        <div className="flex items-baseline justify-between gap-[12px]">
          <div>
            <h3 className="ds-h1" style={{ fontSize: 40 }}>{masteryTitle(fam, info.rank)}</h3>
            <span className="text-[13px] text-muted">Kills with a {FAMILY_NAME[fam].toLowerCase()} weapon earn mastery XP: banked at checkpoints like Warden XP (25% kept if the run is lost). In co-op every other warden adds +10%.</span>
          </div>
          <div className="text-right whitespace-nowrap">
            <b className="ds-numxl" data-testid="mastery-rank">R{info.rank}</b>
            <div className="font-mono text-[11px] text-amber">{pct(rankDamage(info.rank))} DAMAGE</div>
          </div>
        </div>
        {locked && <div className="prot-note">{FAMILY_NAME[fam]} weapons are not unlocked yet: mastery starts once they drop.</div>}
        <div className="grid gap-[4px]">
          <Bar value={info.frac} color="#ff8a3d" height={6} />
          <RankTrack fam={fam} rank={info.rank} />
          <span className="font-mono text-[11px] text-faint">{info.rank >= MAX_RANK ? 'MASTERED' : `${info.into.toLocaleString()} / ${info.need.toLocaleString()} XP to rank ${info.rank + 1}`}</span>
        </div>
        <div className="grid grid-cols-2 gap-[12px]">
          <div className="grid content-start gap-[5px]">
            <span className="ds-lbl">Component unlocks</span>
            {COMPONENT_RANKS[fam].map(([c, r]) => (
              <div key={c} className={`flex justify-between text-[13px] ${info.rank >= r ? '' : 'text-muted'}`}>
                <span>{info.rank >= r ? '✓ ' : ''}{componentDef(c)?.name ?? c}</span>
                <span className="font-mono text-[10.5px] text-faint">RANK {r}</span>
              </div>
            ))}
            <span className="text-[12px] text-faint">Locked components never drop, craft or refit on this family's weapons.</span>
          </div>
          <div className="grid content-start gap-[5px]">
            <span className="ds-lbl">Finishes</span>
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
        <span className="ds-lbl">Perks · one of two every {PERK_EVERY} ranks · free to change</span>
        <div className="grid grid-cols-2 gap-[6px]" data-testid="mastery-perks">
          {Array.from({ length: Math.min(MAX_RANK / PERK_EVERY, Math.max(1, tiers + 1)) }, (_, i) => i + 1).map((t) => {
            const opts = perkOptions(fam, t);
            const chosen = m?.perks[t - 1];
            const open = t <= tiers;
            return opts.map((p, o) => (
              <button key={`${t}-${o}`} className={`ms-perk ${chosen === o ? 'on ds-sel' : ''}`} disabled={!open} data-perk={`${t}-${o}`} onClick={() => op('masteryPerk', [fam, t, o], `${p.name} chosen`)}>
                <span className="font-mono text-[10px] text-faint">RANK {t * PERK_EVERY}{open ? '' : ' · LOCKED'}</span>
                <b className="block ds-h3">{chosen === o ? '✓ ' : ''}{p.name}</b>
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
      +{g.xp.toLocaleString()} {(FAMILY_NAME[g.family as WeaponFamily] ?? g.family).toUpperCase()} MASTERY
    </div>
  );
}
