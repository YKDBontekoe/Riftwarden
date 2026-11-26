// Big spikes in the HQ (docs/progression-design.md §7): the codex with teasers, breakthrough titles, Rift War victory
// caches to claim, and the pinnacle card on the deploy terminal (keys, summon, craft a key).
import { useState, useSyncExternalStore } from 'react';
import type { Flow } from '../core/Flow';
import { CODEX, type CodexKind, PINNACLE, pinnacleBlocker, titleOf, warCacheShards } from '@riftwarden/rules/progression/spikes';
import { regionState } from '@riftwarden/rules/war/state';
import { regionLayout } from '@riftwarden/rules/war/regions';
import type { SaveData } from '@riftwarden/rules/progression/save';
import { sfx } from '@riftwarden/game/audio/Sfx';
import { BIOMES, BIOME_IDS, type BiomeId } from '@riftwarden/rules/world/biomes';
import { FactionIntel } from './FactionIntel';

const KIND: Record<CodexKind, string> = { family: 'WEAPON FAMILIES', rarity: 'RARITIES', unique: 'UNIQUES' };

/** Codex: every chase entry, found ones lit, the rest as teasers with where they come from. */
export function CodexPanel({ save }: { save: SaveData }) {
  const [record, setRecord] = useState<BiomeId>('cryo');
  const found = new Set(save.codex ?? []);
  const title = titleOf(save.breakthroughs ?? []);
  return (
    <div className="grid gap-[8px]" data-testid="codex">
      <div className="flex items-baseline justify-between">
        <div className="col-label m-0">CODEX · {found.size}/{CODEX.length}</div>
        {title && <span className="font-mono text-[11px] tracking-[0.12em] text-orange" data-testid="warden-title">{title.toUpperCase()}</span>}
      </div>
      <span className="text-[12px] text-faint">First finds pay a one-time rift shard bonus when banked.</span>
      <div className="faction-records" role="group" aria-label="Faction records">
        {BIOME_IDS.map((biome) => (
          <button key={biome} type="button" className="ds-chip" aria-pressed={record === biome} onClick={() => setRecord(biome)}>
            {BIOMES[biome].faction.name}
          </button>
        ))}
      </div>
      <FactionIntel biome={record} recovered />
      {(['family', 'rarity', 'unique'] as CodexKind[]).map((k) => (
        <details key={k} className="field-notes" open={k !== 'unique'}>
          <summary>
            {KIND[k]} · {CODEX.filter((c) => c.kind === k && found.has(c.id)).length}/{CODEX.filter((c) => c.kind === k).length}
          </summary>
          <div className="grid grid-cols-2 gap-[4px] mt-[6px]">
            {CODEX.filter((c) => c.kind === k).map((c) => {
              const on = found.has(c.id);
              return (
                <div key={c.id} className={`border-l-2 pl-[8px] py-[3px] ${on ? 'border-ok/70' : 'border-line opacity-60'}`} data-codex={c.id} data-found={on ? '1' : '0'} title={c.hint}>
                  <b className="block text-[12.5px]">{on ? `✓ ${c.name}` : c.kind === 'unique' ? `▒▒ ${c.name}` : c.name}</b>
                  <span className="block text-[11px] text-faint">{on ? 'Found' : c.hint}{!on && c.shards ? ` · +${c.shards} shard${c.shards === 1 ? '' : 's'}` : ''}</span>
                </div>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}

/** Rift War victory caches: liberated regions this warden fought in can be claimed once. */
export function WarCaches({ flow, save }: { flow: Flow; save: SaveData }) {
  const wv = useSyncExternalStore(flow.war.store.subscribe, flow.war.store.get);
  const [msg, setMsg] = useState<string | null>(null);
  const war = wv.war;
  const fought = save.war?.fought ?? [];
  if (!fought.length) return null;
  const rows = fought.map((k) => ({ k, name: war ? regionLayout(war.seed, k).name : `Region ${k + 1}`, liberated: !!war && regionState(war, k)?.status === 'liberated', claimed: save.war?.claimed.includes(k) ?? false }));
  return (
    <div className="grid gap-[5px]" data-testid="war-caches">
      <div className="col-label">RIFT WAR VICTORIES</div>
      {rows.map((r) => (
        <div key={r.k} className="flex items-center justify-between gap-[8px] text-[13px]">
          <span>{r.name} <span className="font-mono text-[10.5px] text-faint">{r.claimed ? 'CACHE CLAIMED' : r.liberated ? 'LIBERATED' : 'FIGHTING'}</span></span>
          {r.liberated && !r.claimed && (
            <button className="mini m-0 w-auto" data-testid={`claim-${r.k}`} onClick={() => {
              const res = flow.profile.op('claimWarCache', [r.k]);
              sfx.play(res.ok ? 'bank' : 'buildDeny');
              setMsg(res.ok ? `Victory cache: ${(res as { item?: { name: string } }).item?.name ?? 'item'} + ${warCacheShards(r.k)} rift shards in storage` : (res as { reason?: string }).reason ?? 'Refused');
            }}>CLAIM CACHE</button>
          )}
        </div>
      ))}
      {msg && <div className="term-msg">{msg}</div>}
    </div>
  );
}

/** Deploy terminal: pinnacle keys, summon a pinnacle boss (classic arena), craft a key. */
export function PinnacleCard({ flow, save, rl, busy, onDeploy }: { flow: Flow; save: SaveData; rl: number; busy: boolean; onDeploy: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  if (save.threat.unlocked < PINNACLE.minRl) return null;
  const keys = save.pinnacle?.keys ?? 0;
  const why = pinnacleBlocker(keys, rl);
  return (
    <div className="grid gap-[6px] border border-orange/40 bg-[rgb(255_150_90/0.06)] p-[10px]" data-testid="pinnacle">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] tracking-[0.14em] text-orange">PINNACLE BOSS</span>
        <b className="font-mono text-[12px]" data-testid="pinnacle-keys">{keys} KEY{keys === 1 ? '' : 'S'}</b>
      </div>
      <p className="m-0 text-[12.5px] text-muted">Spend a key to start a run whose first wave is a pinnacle boss (machines +50% hull, +30% luck). It drops an extra legendary-floor cache.</p>
      <div className="flex gap-[6px]">
        <button className="m-0 w-auto flex-1 primary whitespace-nowrap px-[12px] py-[10px] text-[13px]" disabled={busy || !!why} title={why ?? undefined} data-testid="pinnacle-go" onClick={onDeploy}>SUMMON · RL {rl}</button>
        <button className="m-0 w-auto whitespace-nowrap px-[12px] py-[10px] text-[12px]" disabled={busy || save.resources.shards < PINNACLE.craftShards} data-testid="pinnacle-craft" onClick={() => {
          const r = flow.profile.op('craftKey', []);
          sfx.play(r.ok ? 'fabricate' : 'buildDeny');
          setMsg(r.ok ? 'Pinnacle key crafted' : (r as { reason?: string }).reason ?? 'Refused');
        }}>CRAFT KEY · {PINNACLE.craftShards} SHARDS</button>
      </div>
      {why && rl < PINNACLE.minRl && <span className="text-[11.5px] text-faint">{why}</span>}
      {msg && <div className="term-msg">{msg}</div>}
    </div>
  );
}
