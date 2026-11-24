import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Flow } from '../core/Flow';
import type { Game } from '@riftwarden/game/core/Game';
import { BLESSINGS, CURSES, isCombatKind, NODE_KINDS, type NodeKind } from '@riftwarden/rules/runmap/defs';
import type { MapNode, SegmentEffect } from '@riftwarden/rules/runmap/map';
import { findNode, liveNode, nodePlayable } from '@riftwarden/rules/war/world';
import { regionLayout } from '@riftwarden/rules/war/regions';
import { nodeLiberation, regionState } from '@riftwarden/rules/war/state';
import { Globe, OrderBanner, RegionMap, RegionStrip, RegionTabs, regionOfNode, WarHeader, WarReport } from './WarMap';
import { type Lookahead, lookahead, type NodeIntel, nodeIntel } from '@riftwarden/rules/runmap/intel';
import { getTier } from '@riftwarden/rules/progression/tiers';
import { levelLoot } from '@riftwarden/rules/progression/riftLevel';
import { RarityName } from './RiftLevel';
import { type NodeBrief, nodeBrief } from '@riftwarden/rules/runmap/brief';
import type { RunMapView, StationPanel } from '@riftwarden/rules/runmap/view';
import { AffinityRow } from './LoadingScreen';
import { ItemDetail, ItemGlyph, RarityTag } from './items';
import { useHud } from './useHud';
import { BIOMES } from '@riftwarden/rules/world/biomes';
import { NamedDrops } from './NamedDrops';
import { bossArtwork } from '@riftwarden/game/visuals/fieldArtwork';
import { FieldArt } from './FieldArt';
import { FieldIcon, NODE_ICON, serviceIcon } from './FieldIcon';

/** Node colours per kind (map badges, chips). */
export const KIND_COLOR: Record<NodeKind, string> = {
  combat: '#ff9268',
  elite: '#ffd06a',
  boss: '#ff5a4e',
  merchant: '#f3c76a',
  forge: '#ff8a4a',
  event: '#c59cff',
  vault: '#7fc8ff',
  rest: '#74f2a6',
};

function Risk({ n }: { n: number }) {
  return <span className="rm-risk" aria-label={`risk ${n} of 4`}>{[0, 1, 2, 3].map((i) => <i key={i} className={i < n ? 'on' : ''} />)}</span>;
}

/** Map card for one node (selection in the map screen, loading briefing). */
export function NodeCard({ b }: { b: NodeBrief }) {
  return (
    <div className="rm-card" data-testid="rm-card" style={{ ['--kc' as string]: KIND_COLOR[b.kind] }}>
      <div className="rm-card-head">
        <span className="rm-card-glyph"><FieldIcon name={NODE_ICON[b.kind]} /></span>
        <div>
          <div className="rm-card-kicker">{b.region.toUpperCase()} · {b.actBoss ? 'CAPITAL' : `SECTOR ${b.col + 1}`}</div>
          <div className="rm-card-name">{b.name}</div>
        </div>
        <Risk n={b.risk} />
      </div>
      <div className="rm-card-blurb">{b.blurb}</div>
      <div className="rm-card-line"><span>SECTOR</span><b>{b.sector}</b></div>
      <div className="rm-card-line"><span>FACTION</span><b>{b.faction}</b></div>
      <div className="rm-card-line"><span>{b.waves ? 'WAVES' : 'VISIT'}</span><b>{b.waves ? `${b.waves[0]} – ${b.waves[1]}` : 'No waves · stations'}</b></div>
      <div className="rm-card-line"><span>REWARD</span><b>{b.reward}</b></div>
      {b.mods.length > 0 && (
        <div className="rm-mods">
          {b.mods.map((m) => (
            <div key={m.id} className={`rm-modchip t-${m.tone}`}><b>{m.name}</b><span>{m.text}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActEffects({ curses, blessings }: { curses: readonly string[]; blessings: readonly string[] }) {
  if (!curses.length && !blessings.length) return <div className="rm-none">No curses or blessings this act.</div>;
  return (
    <div className="rm-effects">
      {curses.map((c) => <div key={c} className="rm-eff curse"><b>{CURSES[c as keyof typeof CURSES]?.name ?? c}</b><span>{CURSES[c as keyof typeof CURSES]?.text}</span></div>)}
      {blessings.map((c) => <div key={c} className="rm-eff bless"><b>{BLESSINGS[c as keyof typeof BLESSINGS]?.name ?? c}</b><span>{BLESSINGS[c as keyof typeof BLESSINGS]?.text}</span></div>)}
    </div>
  );
}

/** In-run war map: the region of the current sector on the Rift War, travel to a linked sector or extract. */
export function RunMapScreen({ flow, game }: { flow: Flow; game: Game }) {
  const view = useHud((s) => s.runMap) as RunMapView | null | undefined;
  const wv = useSyncExternalStore(flow.war.store.subscribe, flow.war.store.get);
  const coop = view?.coop;
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [regionPick, setRegionPick] = useState<number | null>(null);
  const reach = view?.reachable ?? [];
  const selected = sel && reach.includes(sel) ? sel : reach[0] ?? null;
  const war = wv.war;
  const seed = view?.seed ?? 1;
  const k = regionPick ?? regionOfNode(seed, view?.current ?? selected, 0);
  const inspect = hover ?? selected;
  const node = inspect && view ? liveNode(seed, war, inspect) : null;
  const look = useMemo(() => (node && view ? lookahead(seed, node, (id) => nodePlayable(war, id)) : null), [node, view, seed, war]);
  // Refresh the war when the map opens; what was new is "seen" when it closes.
  useEffect(() => {
    void flow.war.refresh();
    return () => flow.war.markSeen();
  }, [flow]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (e.defaultPrevented || target?.closest('input, select, textarea')) return;
      const n = Number(e.key);
      if (n >= 1 && n <= reach.length) {
        setHover(null);
        setSel(reach[n - 1]);
      }
      if (e.key === 'Enter' && selected && !target?.closest('button, [role="button"], a, summary')) go(selected);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const onRegion = useCallback((r: number) => { setHover(null); setRegionPick(r); }, []);
  if (!view || !war) return null;
  const votes: Record<string, string[]> = {};
  for (const v of view.votes ?? []) if (v.vote) (votes[v.vote] ??= []).push(v.name);
  const go = (id: string, surge = false) => {
    if (busy) return;
    if (coop) return void flow.mapVote(id);
    setBusy(true);
    void flow.travel(id, surge).finally(() => setBusy(false));
  };
  const selNode = selected ? findNode(seed, selected) : null;
  const canSurgeHere = !coop && !!view?.surgeReady && !!selNode && (selNode.kind === 'combat' || selNode.kind === 'elite');
  const extract = () => {
    if (busy) return;
    if (coop) return void flow.mapVote('home');
    setBusy(true);
    void flow.returnHome().finally(() => setBusy(false));
  };
  const survival = view.mode === 'survival';
  const def = node ? regionLayout(seed, node.act - 1) : null;
  const nodeLib = node && def ? nodeLiberation(war, node.id, def) : 0;
  return (
    <div className="screen dim runmap" data-testid="runmap">
      <div className="rm-wrap panel-frame">
        <div className="rm-side">
          <Globe war={war} selected={k} onSelect={onRegion} size={200} />
          <div className="cp-kicker">Rift War · sector secured{survival ? ' · Survival' : ''}</div>
          <div className="rm-stats">
            <div><b>{view.cleared}</b><span>NODES</span></div>
            <div><b>{view.lastWave}</b><span>WAVES</span></div>
            <div><b>{view.actsCleared}</b><span>CAPITALS</span></div>
            <div><b>{view.cores}</b><span>CORES</span></div>
          </div>
          <div className="rm-note" data-testid="rm-level">Rift Level <b className="plain">RL {view.tier}</b>{(view.surge ?? 0) > 0 ? ` · deployed at RL ${view.deployTier}, ${view.surge} surge${view.surge === 1 ? '' : 's'}` : ''}</div>
          {view.dps > 0 && <div className="rm-note">Your firepower: <b className="plain">{Math.round(view.dps)} DPS</b> (gear, before run upgrades)</div>}
          {survival && <div className="rm-note warn">Survival: no towers, every machine hunts you, one life.</div>}
          {!survival && view.refund > 0 && <div className="rm-note">Towers stay behind: <b>+{view.refund} cores</b> refunded on travel.</div>}
          {view.leftBehind > 0 && <div className="rm-note warn" data-testid="rm-left">{view.leftBehind} uncollected drop{view.leftBehind === 1 ? '' : 's'} will be left behind. Go back to collect them first.</div>}
          <div className="cp-label">RUN EFFECTS</div>
          <ActEffects curses={view.curses} blessings={view.blessings} />
          <WarReport war={war} seenAt={wv.seenAt} max={6} />
          {view.votes && (
            <div className="rm-votelist" data-testid="rm-votes">
              <div className="cp-label">TEAM VOTE · {Math.ceil(view.voteLeft ?? 0)} s</div>
              {view.votes.map((v) => <div key={v.name}><b>{v.name}{v.host ? ' (host)' : ''}</b><span>{v.vote === 'home' ? 'Extract' : v.vote ? NODE_KINDS[findNode(seed, v.vote)?.kind ?? 'combat'].name : '…'}</span></div>)}
            </div>
          )}
        </div>
        <div className="rm-main">
          <WarHeader war={war} source={wv.source} online={wv.online} />
          <OrderBanner war={war} />
          <RegionTabs war={war} k={k} onPick={onRegion} />
          <RegionStrip war={war} k={k} />
          <RegionMap war={war} k={k} current={view.current} path={view.path} reachable={reach} selected={selected} onSelect={setSel} onHover={setHover} votes={votes} ahead={look?.reach} seenAt={wv.seenAt} />
          <div className="rm-hint">Hover or focus a sector for intel · select a lit sector or press <kbd>1</kbd>–<kbd>{Math.max(1, reach.length)}</kbd> · links at the edge lead to other regions</div>
        </div>
        <div className="rm-detail">
          <div className="rm-detail-body">
            {node && <NodeCard b={nodeBrief(node, view.lastWave, view.mode)} />}
            {node && def && regionState(war, def.k) && isCombatKind(node.kind) && (
              <div className="rm-liberation" data-testid="rm-liberation">
                <span>SECTOR LIBERATION</span>
                <i className="war-bar"><i style={{ width: `${nodeLib}%` }} /></i>
                <b>{Math.round(nodeLib)}%</b>
              </div>
            )}
            {node && <NodeTabs node={node} view={view} look={look} />}
            {node && inspect !== selected && <div className="rm-note">Inspecting · travel goes to the selected lit sector</div>}
          </div>
          {canSurgeHere && <SurgeOffer level={view.tier} busy={busy} onSurge={() => selected && go(selected, true)} />}
          <button className="primary" data-testid="rm-travel" disabled={!selected || busy} onClick={() => selected && go(selected)}>
            {coop ? 'VOTE: TRAVEL HERE' : canSurgeHere ? `TRAVEL · STAY ON RL ${view.tier}` : 'TRAVEL'}
          </button>
          <button className="home-btn" data-testid="rm-extract" disabled={busy} onClick={extract}>
            {coop ? 'VOTE: EXTRACT' : 'EXTRACT TO HQ'}
          </button>
          <button className="mini" data-testid="rm-stay" onClick={() => void game.continueRun()}>BACK TO THE ARENA (MAP: H)</button>
        </div>
      </div>
    </div>
  );
}

/** Rift Surge offer: travel to the selected sector one Rift Level higher, for the rest of the run. */
function SurgeOffer({ level, busy, onSurge }: { level: number; busy: boolean; onSurge: () => void }) {
  const next = getTier(level + 1);
  const loot = levelLoot(level + 1);
  return (
    <div className="grid gap-[6px] border border-[rgb(255_110_90/0.45)] bg-[rgb(255_80_60/0.08)] p-[10px]" data-testid="rm-surge">
      <div className="font-mono text-[11px] tracking-[0.16em] text-bad">RIFT SURGE AVAILABLE</div>
      <p className="m-0 text-[13px] leading-[1.45]">
        Push the rest of this run to <b>RL {next.id}</b>: machine hull ×{(next.hpMult / getTier(level).hpMult).toFixed(2)}, drops from item level <b>{loot.levels[0]}</b>, best drop <RarityName id={loot.ceiling} />. Checkpoints then count toward unlocking RL {next.id + 1}.
      </p>
      <button className="primary [background:#c8503c] [border-color:#c8503c]" disabled={busy} data-testid="rm-surge-go" onClick={onSurge}>
        TRAVEL + SURGE TO RL {next.id}
      </button>
    </div>
  );
}

type Tab = 'intel' | 'rewards' | 'route';

/** Intel / rewards / route tabs of the inspected node. */
function NodeTabs({ node, view, look }: { node: MapNode; view: RunMapView; look: Lookahead | null }) {
  const [tab, setTab] = useState<Tab>('intel');
  const intel = useMemo(
    () => nodeIntel(node, { plannerSeed: view.plannerSeed, tier: getTier(view.tier), mode: view.mode, lastWave: view.lastWave, act: { curses: view.curses, blessings: view.blessings }, dps: view.dps }),
    [node, view.plannerSeed, view.tier, view.mode, view.lastWave, view.curses, view.blessings, view.dps],
  );
  return (
    <div className="rm-tabs" data-testid="rm-tabs">
      <div className="rm-tabbar" role="tablist">
        {(['intel', 'rewards', 'route'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} data-testid={`rm-tab-${t}`} onClick={() => setTab(t)}>{t.toUpperCase()}</button>
        ))}
      </div>
      {tab === 'intel' && <IntelPanel node={node} intel={intel} />}
      {tab === 'rewards' && <div data-testid="rm-rewards"><div className="rm-lines">{intel.rewards.map((r) => <div key={r.label} className={r.bonus ? 'bonus' : ''}><span>{r.label}</span><b>{r.value}</b></div>)}</div><NamedDrops node={node} drops={intel.namedDrops} /></div>}
      {tab === 'route' && look && <RoutePanel look={look} />}
    </div>
  );
}

const THREAT = ['', 'LIGHT', 'MODERATE', 'HEAVY', 'SEVERE', 'BRUTAL'];
const fmtK = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
const EFFECT_LABELS: [keyof SegmentEffect, string][] = [['hp', 'Hostile HP'], ['damage', 'Hostile damage'], ['speed', 'Hostile speed'], ['elite', 'Elite chance'], ['budget', 'Encounter size']];

function IntelPanel({ node, intel }: { node: MapNode; intel: NodeIntel }) {
  const changed = EFFECT_LABELS.filter(([k]) => Math.abs((intel.effect[k] as number) - 1) > 0.005);
  if (!isCombatKind(node.kind))
    return (
      <div className="rm-intel" data-testid="rm-intel">
        <div className="rm-none">{node.kind === 'vault' ? 'Hub visit. Cracking the vault wakes a guardian wave that hunts the reactor (or you, in survival).' : node.kind === 'event' ? 'Hub visit. Some anomaly choices summon guardians.' : 'Hub visit: no hostiles.'}</div>
        <AffinityRow faction={BIOMES[node.biome].faction.id} />
      </div>
    );
  return (
    <div className="rm-intel" data-testid="rm-intel">
      {intel.boss && <FieldArt name={bossArtwork(intel.boss)} className="intel-boss-art" />}
      <div className="rm-threat">
        <span>THREAT</span>
        <span className="rm-risk">{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= intel.threat ? 'on' : ''} />)}</span>
        <b>{THREAT[intel.threat]}</b>
      </div>
      <div className="rm-lines">
        <div><span>Hostiles</span><b>≈ {intel.hostiles}{intel.elites ? ` · ${intel.elites} elite` : ''}</b></div>
        {intel.boss && <div className="bonus"><span>Boss</span><b>{intel.boss}</b></div>}
        {intel.events.length > 0 && <div><span>Event</span><b>{intel.events.join(' · ')}</b></div>}
        <div><span>Total hit points</span><b>≈ {fmtK(intel.totalHp)}</b></div>
        {intel.fireSeconds !== null && <div><span>Sustained fire to clear</span><b>≈ {Math.round(intel.fireSeconds)} s</b></div>}
        <div><span>Faction</span><b>{intel.faction}</b></div>
      </div>
      <div className="rm-roster">
        {intel.roster.slice(0, 7).map((r) => (
          <div key={r.kind} className={r.signature ? 'sig' : ''} title={r.signature ? 'Faction signature archetype' : ''}>
            <span>{r.name}{r.signature ? ' ◆' : ''}</span>
            <b>×{r.count}{r.elites ? <em> · {r.elites}★</em> : null}</b>
          </div>
        ))}
      </div>
      {changed.length > 0 && <div className="rm-effchips">{changed.map(([k, l]) => <span key={k} className={(intel.effect[k] as number) > 1 ? 'up' : 'down'}>{l} {(intel.effect[k] as number) > 1 ? '+' : ''}{Math.round(((intel.effect[k] as number) - 1) * 100)}%</span>)}</div>}
      <AffinityRow faction={BIOMES[node.biome].faction.id} />
    </div>
  );
}

function RoutePanel({ look }: { look: Lookahead }) {
  const kinds = (Object.keys(look.kinds) as NodeKind[]).sort((a, b) => (look.kinds[b] ?? 0) - (look.kinds[a] ?? 0));
  return (
    <div className="rm-route" data-testid="rm-route">
      <div className="rm-lines">
        <div><span>Links to the region capital</span><b>{look.hopsToCapital}</b></div>
        <div className={look.canShop ? 'bonus' : ''}><span>Merchant / forge within 2 links</span><b>{look.canShop ? 'Yes' : 'No'}</b></div>
        <div className={look.canRest ? 'bonus' : ''}><span>Safe harbour within 2 links</span><b>{look.canRest ? 'Yes' : 'No'}</b></div>
      </div>
      <div className="rm-kinds">
        {kinds.map((k) => <span key={k} style={{ color: KIND_COLOR[k] }} title={NODE_KINDS[k].name}><FieldIcon name={NODE_ICON[k]} /> {look.kinds[k]}</span>)}
      </div>
      <div className="rm-none">Highlighted on the map: every sector within two links.</div>
    </div>
  );
}

/** Station panel (merchant / forge / rest / anomaly / vault). */
export function StationScreen({ game }: { game: Game }) {
  const [, tick] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'e' || e.key === 'E') void game.continueRun();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);
  const p: StationPanel | null = game.node?.panel() ?? null;
  if (!p) return null;
  const item = p.options.find((o) => o.id === hover && o.item)?.item;
  return (
    <div className="screen dim station" data-testid="station">
      <div className={`st-wrap panel-frame st-${p.station}`}>
        <div className="st-head">
          <FieldArt name={`hub-${p.station}`} className="station-art" />
          <div className="cp-kicker"><FieldIcon name={NODE_ICON[p.station]} /> Map node station · {p.cores} cores</div>
          <h2 className="cp-title">{p.title}</h2>
          <div className="cp-sub">{p.lore}</div>
        </div>
        <div className="st-body">
          <div className="st-options">
            {p.options.map((o) => (
              <button
                key={o.id}
                className="st-opt"
                data-testid={`st-${o.id}`}
                disabled={!!o.disabled}
                onMouseEnter={() => setHover(o.id)}
                onClick={() => {
                  const r = game.node?.act(o.id) ?? 'Unavailable';
                  setWhy(r ?? '');
                  tick((x) => x + 1);
                }}
              >
                <span className="st-label">
                  {o.item ? <ItemGlyph item={o.item} size={26} /> : <span className="st-ico"><FieldIcon name={serviceIcon(p.station, o.id)} /></span>}
                  {o.item && <RarityTag id={o.item.rarity} />}{o.label}
                </span>
                <span className="st-text">{o.text}</span>
                <span className="st-price">{o.disabled ?? (o.price !== null ? `${o.price} cores` : 'Free')}</span>
              </button>
            ))}
          </div>
          {item && <div className="st-item"><ItemDetail item={item} /></div>}
        </div>
        {(p.note || why) && <div className={`st-note${why ? ' bad' : ''}`} data-testid="st-note">{why || p.note}</div>}
        <button className="mini" onClick={() => void game.continueRun()}>CLOSE (E / ESC)</button>
      </div>
    </div>
  );
}

/** HUD chip: current node, its waves and modifiers; the station prompt. */
export function NodeChip() {
  const n = useHud((s) => s.node);
  if (!n) return null;
  return (
    <>
      <div className="node-chip" data-testid="node-chip" style={{ ['--kc' as string]: KIND_COLOR[n.kind] }}>
        <span className="nc-glyph"><FieldIcon name={NODE_ICON[n.kind]} /></span>
        <div>
          <b>ACT {n.act} · {n.name.toUpperCase()}</b>
          <span>{n.waves ? `Waves ${n.waves[0]}–${n.waves[1]}` : 'Hub visit'}{n.complete ? ' · secured' : ''}{n.guardians !== null ? ` · ${n.guardians} guardians` : ''}</span>
          {(n.mods.length > 0 || n.curses.length > 0) && <em>{[...n.mods.map((m) => m.replace('_', ' ')), ...n.curses.map((c) => `☠ ${CURSES[c].name}`)].join(' · ')}</em>}
        </div>
      </div>
      {n.prompt && (
        <div className="node-prompt" data-testid="node-prompt">
          <kbd>E</kbd>
          <div><b>{n.prompt.title}</b><span>{n.prompt.used ? 'Used' : n.prompt.sub}</span></div>
        </div>
      )}
    </>
  );
}

