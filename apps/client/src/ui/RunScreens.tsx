// Run result screens (final UI design): checkpoint (what just became safe, push or extract), defeat (kept vs lost,
// one lesson) and the run summary (waves, route, stats, progress, upgrades for the build).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Flow } from '../core/Flow';
import type { Game } from '@riftwarden/game/core/Game';
import { ClientGame } from '@riftwarden/game/net/ClientGame';
import type { ItemBrief, RunResult } from '@riftwarden/rules/progression/run';
import { getTier, nextCheckpoint } from '@riftwarden/rules/progression/tiers';
import { levelInfo, XP } from '@riftwarden/rules/progression/level';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { FAMILY_NAME, MASTERY_FAMILIES, addMastery } from '@riftwarden/rules/progression/mastery';
import { powerGain } from '@riftwarden/rules/loot/feedback';
import type { CurrencyKey } from '@riftwarden/rules/economy/currencies';
import { useHud } from './useHud';
import { fmtTime, RunSummary, useSave } from './App';
import { GearUpgrades } from './GearUpgrades';
import { savePower } from './RiftLevel';
import { ItemGlyph } from './inventory/glyphs';
import { BoundKey } from './hud/widgets';
import { Backdrop, Bar, Crumb, Hint, Mark, pips, rarityCls, RiskTag } from './ds';
import type { Category, ItemInstance } from '@riftwarden/rules/loot/types';

/** Item tile + name + rarity pips (checkpoint finds, summary). */
export function BriefTile({ item, note }: { item: ItemBrief; note?: ReactNode }) {
  const r = rarity(item.rarity);
  return (
    <div className={`ds-row ${rarityCls(item.rarity)}`} style={{ gap: 12, minWidth: 0 }}>
      <div className={`ds-tile ${rarityCls(item.rarity)}`} style={{ width: 110, height: 64, flexShrink: 0, cursor: 'default' }}>
        <span className="ds-tile-art"><ItemGlyph item={{ defId: '', rarity: item.rarity as ItemInstance['rarity'], category: item.category as Category }} size={44} /></span>
      </div>
      <span className="ds-col" style={{ minWidth: 0 }}>
        <span className="ds-h3" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
        <span className="ds-meta"><span className="ds-pips">{pips(item.rarity)}</span> {r.label} · lv {item.level}</span>
        {note}
      </span>
    </div>
  );
}

function Gain({ k, value, label }: { k: CurrencyKey; value: number; label: string }) {
  return (
    <div className="ds-col" style={{ padding: '14px 0', alignItems: 'center' }}>
      <span className="ds-num" style={{ fontSize: 38 }}>+{Math.round(value).toLocaleString()}</span>
      <span className="ds-row ds-lbl" style={{ gap: 6 }}><Mark k={k} />{label}</span>
    </div>
  );
}

function CoopVote({ game }: { game: ClientGame }) {
  const c = useHud((s) => s.coop);
  if (!c) return null;
  return (
    <div className="coop-vote ds-glass ds-cut-tr ds-col" data-testid="coop-vote" style={{ padding: '10px 14px', gap: 4 }}>
      <span className="ds-lbl">Team vote · {c.voteOpen ? `${c.voteLeft} s left` : 'closed'}</span>
      {c.team.map((m) => (
        <div key={m.id} className="cv-row ds-row" style={{ gap: 8 }}>
          <span className="ds-dot" style={{ background: m.color }} />
          <span className="ds-grow">{m.self ? `${m.name} (you)` : m.name}</span>
          <b className={`ds-d ${m.vote === 1 ? 'ds-warn' : m.vote === 0 ? 'ds-up' : ''}`}>{!m.connected ? 'OFFLINE' : m.vote === 1 ? 'RETURN' : m.vote === 0 ? 'CONTINUE' : '…'}</b>
        </div>
      ))}
      {game.myVote !== null && <span className="ds-meta">Your vote: {game.myVote ? 'return to HQ' : 'continue'}</span>}
    </div>
  );
}

export function CheckpointPanel({ flow, game }: { flow: Flow; game: Game }) {
  const coop = game instanceof ClientGame ? game : null;
  const run = useHud((s) => s.run);
  const node = useHud((s) => s.node);
  const save = useSave(flow);
  const [busy, setBusy] = useState(false);
  const home = () => {
    if (coop) return coop.vote(true);
    setBusy(true);
    void flow.returnHome().finally(() => setBusy(false));
  };
  const cont = () => (coop ? coop.vote(false) : void game.continueRun());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Digit1') { e.preventDefault(); cont(); }
      else if (e.code === 'Digit2') { e.preventDefault(); home(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!run) return null;
  const tier = getTier(run.tier);
  const wave = run.lastBankedWave;
  const items = game.cfg.run.secured.items;
  const finds = [...game.lastCache, ...items.filter((i) => !game.lastCache.includes(i))].slice(0, 3);
  const info = levelInfo(save.progress.xp);
  const shards = game.cfg.run.secured.shards ?? 0;
  return (
    <div className="screen dim checkpoint ds-scr">
      <Backdrop scrim="none" />
      <div className="ds-top">
        <Crumb parts={['Run', node?.name ?? `RL ${tier.id}`, 'Checkpoint']} />
        <span className="ds-grow" />
        <span className="ds-mono">{coop ? 'CO-OP · TEAM VOTE' : 'WORLD PAUSED'}</span>
      </div>
      <div className="ds-abs ds-col" style={{ left: 0, right: 0, top: 58, alignItems: 'center', gap: 6, textAlign: 'center' }}>
        {game.lastBankSaved
          ? <span className="ds-row ds-ov ds-up" style={{ gap: 10 }}>✓ Checkpoint secured · saved to your profile</span>
          : <span className="ds-row ds-ov ds-warn" style={{ gap: 10 }}>The save could not be written · rewards are held until the next save</span>}
        <span className="cp-title" style={{ font: "800 116px/0.85 var(--ds-d)" }}>WAVE {wave}</span>
        <span className="ds-meta">Rift Level {tier.id} {tier.name} · {fmtTime(run.duration)} · {run.kills.toLocaleString()} kills</span>
      </div>
      <div className="ds-abs" style={{ left: 140, right: 140, top: 268, display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', borderTop: '1px solid rgba(255,255,255,0.16)', borderBottom: '1px solid rgba(255,255,255,0.16)' }}>
        <Gain k="credits" value={run.creditsSecured} label="Credits" />
        <Gain k="salvage" value={run.salvageSecured} label="Salvage" />
        <Gain k="components" value={run.componentsSecured} label="Components" />
        <Gain k="shards" value={shards} label="Shards" />
        <Gain k="xp" value={run.xpSecured ?? 0} label="XP" />
      </div>
      {finds.length > 0 && (
        <div className="ds-abs" style={{ left: 140, right: 140, top: 376, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
          {finds.map((it) => <BriefTile key={it.uid} item={{ uid: it.uid, name: it.name, rarity: it.rarity, level: it.level, category: it.category }} note={<span className="ds-lbl ds-up">Secured{game.lastCache.includes(it) ? ' · checkpoint cache' : ''}</span>} />)}
          {items.length > 3 && <span className="ds-meta" style={{ gridColumn: '1 / -1' }}>+{items.length - 3} more items secured this run</span>}
        </div>
      )}
      <div className="ds-abs" style={{ left: 140, right: 140, top: finds.length ? 476 : 390, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
        <button className="ds-sel ds-col" disabled={busy || (coop ? coop.myVote === false : false)} data-testid="cp-continue" onClick={cont}
          style={{ gap: 8, padding: '18px 22px 18px 26px', border: 0, margin: 0, color: 'var(--ds-ink)', font: '400 14px Inter, sans-serif', letterSpacing: 0, textAlign: 'left', cursor: 'pointer' }}>
          <span className="ds-row"><span className="ds-grow" style={{ font: '700 36px/1 var(--ds-d)', letterSpacing: '0.08em' }}>{coop ? 'VOTE: CONTINUE' : game.node ? 'CHOOSE NEXT NODE' : 'CONTINUE'}</span><span className="ds-k">1</span></span>
          <span className="ds-meta" style={{ color: '#e8ddd4' }}>Five more waves; next bank at wave {nextCheckpoint(wave + 1)}.</span>
          <RiskTag>New loot is at risk until then</RiskTag>
        </button>
        <button className="ds-col" disabled={busy} data-testid="cp-home" onClick={home}
          style={{ gap: 8, padding: '18px 22px', border: 0, margin: 0, color: 'var(--ds-ink)', font: '400 14px Inter, sans-serif', letterSpacing: 0, textAlign: 'left', cursor: 'pointer', background: 'rgba(10,14,18,0.6)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2)', clipPath: 'var(--ds-cut)' }}>
          <span className="ds-row"><span className="ds-grow" style={{ font: '700 36px/1 var(--ds-d)', letterSpacing: '0.08em' }}>{coop ? 'VOTE: RETURN TO HQ' : 'EXTRACT TO HQ'}</span><span className="ds-k">2</span></span>
          <span className="ds-meta">{coop ? 'The team returns only if every connected warden votes to return.' : 'End the run and keep everything above.'}</span>
        </button>
      </div>
      <div className="ds-bot">
        <span className="ds-col" style={{ gap: 6, width: 420 }}>
          <span className="ds-row"><span className="ds-h3">WARDEN {info.level}</span><span className="ds-meta">+{(run.xpSecured ?? 0).toLocaleString()} XP banked · {(info.need - info.into).toLocaleString()} to level {info.level + 1}</span></span>
          <Bar value={info.frac} color="#d4b2ff" />
        </span>
        {coop && <CoopVote game={coop} />}
        <span className="ds-grow" />
        <Hint keys="1">{coop ? 'Continue' : 'Next'}</Hint>
        <Hint keys="2">Extract</Hint>
        {coop ? <button className="ds-btn" onClick={() => void game.continueRun()}>BACK TO THE ARENA</button> : <span className="ds-hint"><BoundKey action="checkpoint" />Reopen later</span>}
      </div>
      <div className="ds-grain" />
    </div>
  );
}

function routeOf(result: RunResult): string[] {
  return result.map?.path ?? [];
}

const NODE_NAME: Record<string, string> = { C: 'Combat', E: 'Elite', B: 'Boss', M: 'Merchant', F: 'Forge', R: 'Rest', A: 'Anomaly', V: 'Vault' };

export function SummaryScreen({ flow }: { flow: Flow }) {
  const result = useHud((s) => s.lastRun);
  const save = useSave(flow);
  const secured = useMemo(() => (result?.securedItems ?? []).map((i) => i.uid), [result]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); void flow.home?.takeControl(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flow]);
  if (!result) return null;
  const extracted = result.outcome === 'returned';
  const tier = getTier(result.tier);
  const route = routeOf(result);
  const mastery = addMastery(result.masterySecured, result.masteryKept);
  const fams = MASTERY_FAMILIES.filter((f) => (mastery[f] ?? 0) > 0);
  const gain = result.powerAtStart ? powerGain(result.powerAtStart, savePower(save)) : 0;
  const sv = result.survival;
  const stats: [string, string][] = [
    ['Kills', result.kills.toLocaleString()], ['Time', fmtTime(result.duration)],
    ...(sv ? ([['Elites', String(sv.elitesKilled)], ['Bosses', String(sv.bossesKilled)], ['Deaths', String(sv.deaths)]] as [string, string][]) : []),
    ['Items kept', String(result.itemsSecured)],
    ...(Math.abs(gain) >= 0.005 ? ([['Loadout power', `${gain > 0 ? '+' : ''}${Math.round(gain * 1000) / 10}%`]] as [string, string][]) : []),
  ];
  return (
    <div className="screen dim summary-screen ds-scr">
      <Backdrop />
      <div className="ds-top">
        <Crumb parts={['HQ', 'Operation report']} />
        <span className="ds-grow" />
        <span className="ds-mono">SAVED</span>
      </div>
      <section className="ds-abs ds-col" style={{ left: 44, top: 76, width: 'min(700px, calc(100% - 560px))', minWidth: 520, bottom: 90, gap: 18, overflowY: 'auto' }}>
        <div className="ds-col" style={{ gap: 6 }}>
          <span className={`ds-ov ${extracted ? 'ds-up' : 'ds-warn'}`}>{extracted ? 'Extracted · nothing lost' : 'Operation abandoned · unsecured cargo lost'}</span>
          <div className="ds-row" style={{ gap: 18, alignItems: 'flex-end' }}>
            <span style={{ font: '800 110px/0.8 var(--ds-d)' }}>{result.wavesCleared}</span>
            <span className="ds-col" style={{ gap: 8 }}>
              <span className="ds-h2">WAVES · RIFT LEVEL {tier.id}{result.map ? ` · ACT ${result.map.act}` : ''}</span>
              <span className="ds-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {!sv?.dev && (result.records?.length ?? 0) > 0 && <span className="ds-chip solid">New personal best</span>}
                {sv?.dev && <span className="ds-chip risk">Development session · nothing banked</span>}
                {result.mode === 'survival' && <span className="ds-chip">Survival</span>}
              </span>
            </span>
          </div>
        </div>
        {route.length > 0 && (
          <div className="ds-col" style={{ gap: 8 }}>
            <span className="ds-lbl">Route</span>
            <div className="ds-row" style={{ gap: 0, flexWrap: 'wrap' }}>
              {route.map((r, i) => (
                <span key={i} className="ds-col" style={{ alignItems: 'center', gap: 4, minWidth: 64 }}>
                  <span className="ds-dia" style={{ width: 12, height: 12, background: i === route.length - 1 ? 'var(--ds-ember)' : 'var(--ds-ink)' }} />
                  <span className="ds-lbl" style={{ fontSize: 11 }}>{r.replace(/^\d+/, '').split('').map((c) => NODE_NAME[c] ?? c).join(' ')}</span>
                </span>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
          {stats.map(([k, v]) => <div key={k} className="ds-col"><span className="ds-num">{v}</span><span className="ds-lbl">{k}</span></div>)}
        </div>
        <div className="ds-row" style={{ gap: 24, alignItems: 'flex-start' }}>
          {fams.slice(0, 1).map((f) => (
            <div key={f} className="ds-col ds-grow" style={{ gap: 6 }}><span className="ds-h3">{FAMILY_NAME[f]} mastery +{mastery[f]}</span></div>
          ))}
          {!sv?.dev && <div className="ds-col ds-grow" style={{ gap: 6 }}>
            <span className="ds-row"><span className="ds-h3 ds-grow">WARDEN {levelInfo(save.progress.xp).level}</span><span className="ds-meta ds-warn">+{((result.xpSecured ?? 0) + (result.xpKept ?? 0)).toLocaleString()} XP</span></span>
            <Bar value={levelInfo(save.progress.xp).frac} color="#d4b2ff" />
          </div>}
        </div>
        <details className="field-notes"><summary className="ds-lbl" style={{ cursor: 'pointer' }}>Full breakdown</summary><RunSummary result={result} powerAfter={savePower(save)} /></details>
      </section>
      <aside className="ds-abs ds-glass ds-cut ds-col" style={{ right: 44, top: 76, width: 460, maxHeight: 'calc(100% - 170px)', padding: '22px 24px', gap: 12, overflowY: 'auto' }}>
        <span className="ds-ov">From this run</span>
        {(result.securedItems ?? []).length > 0 ? (
          <>
            {(result.securedItems ?? []).slice(0, 3).map((it, i) => <BriefTile key={it.uid} item={it} note={<span className="ds-lbl ds-up">{i === 0 ? 'Best find' : 'Secured'}</span>} />)}
            <GearUpgrades flow={flow} save={save} uids={secured} />
          </>
        ) : <span className="ds-meta">No new equipment this time. Secure loot at checkpoints to keep it.</span>}
        {(result.lostItems ?? []).length > 0 && <RiskTag>{result.lostItems!.length} item{result.lostItems!.length > 1 ? 's' : ''} lost · not secured</RiskTag>}
      </aside>
      <div className="ds-bot">
        <span className="ds-meta">+{(result.creditsSecured ?? 0).toLocaleString()} credits · +{result.salvageSecured.toLocaleString()} salvage · +{(result.componentsSecured ?? 0).toLocaleString()} components · +{(result.shardsSecured ?? 0).toLocaleString()} shards · {result.itemsSecured} items kept</span>
        <span className="ds-grow" />
        <button className="primary ds-btn-p" onClick={() => void flow.home?.takeControl()}><span className="ds-kd">ENTER</span>CONTINUE</button>
      </div>
      <div className="ds-grain" />
    </div>
  );
}

function ListRow({ label, value }: { label: string; value: ReactNode }) {
  return <div className="ds-list-row"><span className="ds-grow">{label}</span><b className="ds-d" style={{ fontSize: 18 }}>{value}</b></div>;
}

export function DefeatScreen({ flow }: { flow: Flow }) {
  const result = useHud((s) => s.lastRun);
  const node = useHud((s) => s.node);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1800);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLButtonElement) return;
      if (e.code === 'Enter') { e.preventDefault(); void flow.leaveArena(); }
      else if (e.code === 'KeyR') { e.preventDefault(); void flow.redeploy(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flow, ready]);
  if (!ready || !result) return null;
  const tier = getTier(result.tier);
  const survival = result.mode === 'survival';
  const lostNames = (result.lostItems ?? []).slice(0, 3).map((i) => i.name).join(' · ');
  const best = (result.records?.length ?? 0) > 0;
  return (
    <div className="screen dim defeat ds-scr">
      <Backdrop />
      <div className="ds-abs" style={{ inset: 0, background: 'radial-gradient(ellipse at 30% 40%, rgba(255,90,74,0.16), transparent 60%)' }} />
      <div className="ds-top">
        <Crumb parts={['Run', node?.name ?? `RL ${tier.id}`, 'Operation failed']} />
        <span className="ds-grow" />
        <span className="ds-mono">SAVED</span>
      </div>
      <div className="ds-abs ds-col" style={{ left: 44, top: 84, gap: 8, width: 760 }}>
        <span className="ds-ov" style={{ color: '#ff8a7a' }}>{survival ? 'Drone destroyed' : 'Reactor destroyed'} · wave {result.finalWave}</span>
        <span className="defeat-title" style={{ font: '800 104px/0.86 var(--ds-d)', color: 'var(--ds-ink)', textShadow: '0 0 40px rgba(255,90,74,0.45)', letterSpacing: '0.02em' }}>{survival ? 'DRONE LOST' : 'REACTOR LOST'}</span>
        <span className="defeat-sub ds-meta">Containment failed on wave {result.finalWave}. Your banked cargo and starting equipment are safe.</span>
      </div>
      <div className="ds-abs" style={{ left: 44, top: 290, width: 'min(880px, calc(100% - 88px))', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 40 }}>
        <div className="ds-col">
          <span className="ds-lbl ds-up">Kept · banked{result.finalWave > 0 ? ' before the fall' : ''}</span>
          <ListRow label="Credits · salvage · components" value={`${(result.creditsSecured ?? 0).toLocaleString()} · ${result.salvageSecured.toLocaleString()} · ${(result.componentsSecured ?? 0).toLocaleString()}`} />
          <ListRow label="Items secured earlier" value={result.itemsSecured} />
          {!result.survival?.dev && <ListRow label={`XP · ${Math.round(XP.keepOnLoss * 100)}% of unbanked kept`} value={`+${((result.xpSecured ?? 0) + (result.xpKept ?? 0)).toLocaleString()}`} />}
        </div>
        <div className="ds-col">
          <span className="ds-lbl ds-bad">Lost · was at risk</span>
          <ListRow label="Salvage" value={result.salvageLost.toLocaleString()} />
          <ListRow label={lostNames || 'Items'} value={`${result.itemsLost} item${result.itemsLost === 1 ? '' : 's'}`} />
          <ListRow label="XP not banked" value={(result.xpLost ?? 0).toLocaleString()} />
        </div>
      </div>
      <div className="ds-abs ds-glass ds-cut-tr ds-row" style={{ left: 44, top: 470, width: 'min(880px, calc(100% - 88px))', padding: '14px 18px', gap: 16 }}>
        <span className="ds-col ds-grow"><b>Next time</b><span className="ds-meta">
          {result.itemsLost > 0 ? `Extracting at the last checkpoint would have kept ${result.itemsLost} item${result.itemsLost === 1 ? '' : 's'}. ` : ''}
          Check the sector briefing for the faction's weak elements before you drop.
        </span></span>
      </div>
      <details className="ds-abs field-notes" style={{ left: 44, top: 556, width: 'min(880px, calc(100% - 88px))', maxHeight: 'calc(100% - 650px)', overflowY: 'auto' }}>
        <summary className="ds-lbl" style={{ cursor: 'pointer' }}>Full breakdown</summary>
        <RunSummary result={result} extra={null} />
      </details>
      <div className="ds-bot">
        <span className="ds-meta">{best ? `Records: ${result.records!.join(' · ')}` : `Rift Level ${tier.id} · reached wave ${result.finalWave}`}</span>
        <span className="ds-grow" />
        <Hint keys="R" onClick={() => void flow.redeploy()}>Deploy again · RL {tier.id}</Hint>
        <button className="primary ds-btn-p" onClick={() => void flow.leaveArena()}><span className="ds-kd">ENTER</span>BACK TO HQ</button>
      </div>
      <div className="ds-grain" />
    </div>
  );
}
