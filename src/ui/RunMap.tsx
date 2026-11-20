import { useEffect, useMemo, useState } from 'react';
import type { Flow } from '../core/Flow';
import type { Game } from '../core/Game';
import { BLESSINGS, CURSES, NODE_KINDS, type NodeKind } from '../runmap/defs';
import { actOf, findNode, generateAct, type MapNode, ROWS } from '../runmap/map';
import { type NodeBrief, nodeBrief } from '../runmap/brief';
import type { RunMapView, StationPanel } from '../runmap/view';
import { AffinityRow } from './LoadingScreen';
import { ItemDetail, RarityTag } from './items';
import { useHud } from './store';
import { BIOMES } from '../world/biomes';

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

const W = 1000;
const ROW_H = 92;
const H = ROWS * ROW_H + 40;
const px = (n: MapNode) => 70 + n.x * (W - 140);
const py = (n: MapNode) => H - 50 - n.row * ROW_H;

/**
 * The act as a star chart (SVG): rows bottom to top, links, the path taken, the current node and the nodes
 * the run can travel to. Shared by the in-run map screen and the HQ deploy preview.
 */
export function MapChart(p: { seed: number; act: number; path: readonly string[]; current: string | null; reachable: readonly string[]; selected: string | null; onSelect?: (id: string) => void; votes?: Record<string, string[]> }) {
  const map = useMemo(() => generateAct(p.seed, p.act), [p.seed, p.act]);
  const nodes = map.rows.flat();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set(p.path);
  const pathEdges = new Set<string>();
  for (let i = 1; i < p.path.length; i++) pathEdges.add(`${p.path[i - 1]}>${p.path[i]}`);
  const reach = new Set(p.reachable);
  return (
    <svg className="rm-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Act ${p.act} map`} data-testid="rm-chart">
      <defs>
        <radialGradient id="rmGlow">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {map.rows.map((_, r) => (
        <g key={r} className="rm-rowline">
          <line x1={20} x2={W - 20} y1={H - 50 - r * ROW_H} y2={H - 50 - r * ROW_H} />
          <text x={24} y={H - 56 - r * ROW_H}>{r === ROWS - 1 ? 'BOSS' : r === ROWS - 2 ? 'CAMP' : `R${r + 1}`}</text>
        </g>
      ))}
      {nodes.flatMap((n) =>
        n.links.map((l) => {
          const m = byId.get(l)!;
          const walked = pathEdges.has(`${n.id}>${l}`);
          const open = n.id === p.current && reach.has(l);
          return <line key={`${n.id}-${l}`} className={`rm-link${walked ? ' walked' : ''}${open ? ' open' : ''}`} x1={px(n)} y1={py(n)} x2={px(m)} y2={py(m)} />;
        }),
      )}
      {nodes.map((n) => {
        const c = KIND_COLOR[n.kind];
        const isCur = n.id === p.current;
        const can = reach.has(n.id);
        const sel = n.id === p.selected;
        const r = n.actBoss ? 30 : 22;
        const vs = p.votes?.[n.id] ?? [];
        return (
          <g
            key={n.id}
            className={`rm-node${can ? ' can' : ''}${visited.has(n.id) ? ' seen' : ''}${isCur ? ' cur' : ''}${sel ? ' sel' : ''}`}
            transform={`translate(${px(n)} ${py(n)})`}
            onClick={() => can && p.onSelect?.(n.id)}
            data-testid={`rm-node-${n.id}`}
            data-kind={n.kind}
            style={{ ['--kc' as string]: c }}
          >
            {can && <circle className="rm-pulse" r={r + 10} />}
            {sel && <circle r={r + 16} fill="url(#rmGlow)" />}
            <circle className="rm-badge" r={r} />
            <text className="rm-glyph" y={n.actBoss ? 10 : 7}>{NODE_KINDS[n.kind].glyph}</text>
            {n.mods.map((m, i) => <circle key={m} className="rm-mod" cx={-r + 4 + i * 9} cy={-r + 2} r={4} />)}
            {isCur && <circle className="rm-cur" r={r + 6} />}
            {vs.length > 0 && <text className="rm-votes" y={r + 18}>{vs.join(' · ')}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function Risk({ n }: { n: number }) {
  return <span className="rm-risk" aria-label={`risk ${n} of 4`}>{[0, 1, 2, 3].map((i) => <i key={i} className={i < n ? 'on' : ''} />)}</span>;
}

/** Map card for one node (selection in the map screen, loading briefing). */
export function NodeCard({ b }: { b: NodeBrief }) {
  return (
    <div className="rm-card" data-testid="rm-card" style={{ ['--kc' as string]: KIND_COLOR[b.kind] }}>
      <div className="rm-card-head">
        <span className="rm-card-glyph">{b.glyph}</span>
        <div>
          <div className="rm-card-kicker">ACT {b.act} · {b.row === ROWS - 1 ? 'BOSS' : `ROW ${b.row + 1}`}</div>
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

/** In-run map screen: choose the next node, extract, or go back to the arena to collect loot. */
export function RunMapScreen({ flow, game }: { flow: Flow; game: Game }) {
  const view = useHud((s) => s.runMap) as RunMapView | null | undefined;
  const coop = view?.coop;
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reach = view?.reachable ?? [];
  const selected = sel && reach.includes(sel) ? sel : reach[0] ?? null;
  const showAct = reach.length ? actOf(reach[0]) : view?.act ?? 1;
  const node = selected && view ? findNode(view.seed, selected) : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = Number(e.key);
      if (k >= 1 && k <= reach.length) setSel(reach[k - 1]);
      if (e.key === 'Enter' && selected) go(selected);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!view) return null;
  const votes: Record<string, string[]> = {};
  for (const v of view.votes ?? []) if (v.vote) (votes[v.vote] ??= []).push(v.name);
  const go = (id: string) => {
    if (busy) return;
    if (coop) return void flow.mapVote(id);
    setBusy(true);
    void flow.travel(id).finally(() => setBusy(false));
  };
  const extract = () => {
    if (busy) return;
    if (coop) return void flow.mapVote('home');
    setBusy(true);
    void flow.returnHome().finally(() => setBusy(false));
  };
  const actChange = showAct !== view.act;
  return (
    <div className="screen dim runmap" data-testid="runmap">
      <div className="rm-wrap panel-frame">
        <div className="rm-side">
          <div className="cp-kicker">Run map · Act {showAct}{actChange ? ' (new act)' : ''}</div>
          <h2 className="cp-title">{actChange ? `Act ${view.act} cleared` : 'Node secured'}</h2>
          <div className="rm-stats">
            <div><b>{view.cleared}</b><span>NODES</span></div>
            <div><b>{view.lastWave}</b><span>WAVES</span></div>
            <div><b>{view.actsCleared}</b><span>ACTS</span></div>
            <div><b>{view.cores}</b><span>CORES</span></div>
          </div>
          {view.refund > 0 && <div className="rm-note">Towers stay behind: <b>+{view.refund} cores</b> refunded on travel.</div>}
          {view.leftBehind > 0 && <div className="rm-note warn" data-testid="rm-left">{view.leftBehind} uncollected drop{view.leftBehind === 1 ? '' : 's'} will be left behind. Go back to collect them first.</div>}
          <div className="cp-label">ACT EFFECTS</div>
          <ActEffects curses={view.curses} blessings={view.blessings} />
          <div className="cp-label">PATH</div>
          <div className="rm-path">{view.path.map((id) => findNode(view.seed, id)).filter((n): n is MapNode => !!n).map((n, i) => <span key={i} style={{ color: KIND_COLOR[n.kind] }} title={NODE_KINDS[n.kind].name}>{NODE_KINDS[n.kind].glyph}</span>)}</div>
          {view.votes && (
            <div className="rm-votelist" data-testid="rm-votes">
              <div className="cp-label">TEAM VOTE · {Math.ceil(view.voteLeft ?? 0)} s</div>
              {view.votes.map((v) => <div key={v.name}><b>{v.name}{v.host ? ' (host)' : ''}</b><span>{v.vote === 'home' ? 'Extract' : v.vote ? NODE_KINDS[findNode(view.seed, v.vote)?.kind ?? 'combat'].name : '…'}</span></div>)}
            </div>
          )}
        </div>
        <div className="rm-main">
          <MapChart seed={view.seed} act={showAct} path={view.path} current={actChange ? null : view.current} reachable={reach} selected={selected} onSelect={setSel} votes={votes} />
          <div className="rm-hint">Click a lit node or press <kbd>1</kbd>–<kbd>{Math.max(1, reach.length)}</kbd> · <kbd>ENTER</kbd> travels</div>
        </div>
        <div className="rm-detail">
          {node && <NodeCard b={nodeBrief(node, view.lastWave)} />}
          {node && <AffinityRow faction={BIOMES[node.biome].faction.id} />}
          <button className="primary" data-testid="rm-travel" disabled={!selected || busy} onClick={() => selected && go(selected)}>
            {coop ? 'VOTE: TRAVEL HERE' : 'TRAVEL'}
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
          <div className="cp-kicker">Map node station · {p.cores} cores</div>
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
                <span className="st-label">{o.item && <RarityTag id={o.item.rarity} />}{o.label}</span>
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
        <span className="nc-glyph">{n.glyph}</span>
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

/** HQ deploy preview: the first act of the next run and the entry sectors to choose from. */
export function DeployMapPreview({ seed, entry, onEntry, lastWave = 0 }: { seed: number; entry: string | null; onEntry: (id: string) => void; lastWave?: number }) {
  const act = generateAct(seed, 1);
  const entries = act.rows[0].map((n) => n.id);
  const sel = entry && entries.includes(entry) ? entry : entries[0];
  const node = findNode(seed, sel)!;
  return (
    <div className="rm-preview" data-testid="rm-preview">
      <MapChart seed={seed} act={1} path={[]} current={null} reachable={entries} selected={sel} onSelect={onEntry} />
      <NodeCard b={nodeBrief(node, lastWave)} />
    </div>
  );
}
