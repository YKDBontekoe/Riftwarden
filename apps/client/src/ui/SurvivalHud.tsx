import { useEffect, useState } from 'react';
import { uiEvents } from '@riftwarden/game/ui/store';
import { useHud } from './useHud';
import { bossArtwork } from '@riftwarden/game/visuals/fieldArtwork';
import { FieldArt } from './FieldArt';
import { FieldIcon, type FieldIconName } from './FieldIcon';

const EVENT_ICON: Partial<Record<string, FieldIconName>> = { swarm: 'enemy', eliteAssault: 'elite', instability: 'tactical', hvt: 'courier' };

/**
 * M6 HUD: boss health bar (phase ticks, state, telegraphed attack), concise alert feed (max 3, de-duplicated),
 * event / high-value-target chips and the prep-phase "incoming" notice. Kept compact so combat stays readable.
 */
export function SurvivalHud() {
  return (
    <>
      <BossBar />
      <EventChips />
      <AlertFeed />
    </>
  );
}

function BossBar() {
  const b = useHud((s) => s.m6?.boss ?? null);
  if (!b) return null;
  const f = Math.max(0, b.hp / b.max);
  const phases = b.ticks.length + 1;
  const it = b.interrupt;
  return (
    <div className={`boss-bar phase${b.phase} ${b.immune ? 'immune' : ''}`} data-testid="boss-bar">
      <div className="boss-head">
        <span className="boss-phase">Boss · phase {b.phase} of {phases}</span>
        <span className="boss-name">
          <FieldArt name={bossArtwork(b.name)} className="boss-portrait" />
          {b.name}
        </span>
        <span className="boss-enc">{b.encounter > 1 ? `Encounter ${b.encounter} · stronger` : 'First encounter'}</span>
      </div>
      <div className="boss-track">
        <i style={{ transform: `scaleX(${f})` }} />
        {b.ticks.map((t) => (
          <b key={t} style={{ left: `${t * 100}%` }} />
        ))}
      </div>
      <div className="boss-foot">
        {b.attack ? (
          <>
            <span className="boss-attack">{b.attack}</span>
            {it && (
              <>
                <span className="boss-need">Interrupt: {it.need} before it fires</span>
                <span className="boss-int" aria-hidden="true"><i style={{ width: `${Math.round(it.progress * 100)}%` }} /></span>
                <span className="boss-left">{it.left.toFixed(1)} S</span>
              </>
            )}
          </>
        ) : (
          <span className={`boss-state ${b.immune ? 'imm' : /EXPOSED|OPEN|STAGGER/.test(b.state) ? 'vuln' : ''}`}>{b.state}</span>
        )}
      </div>
    </div>
  );
}

function EventChips() {
  const ev = useHud((s) => s.m6?.event ?? null);
  const hvt = useHud((s) => s.m6?.hvt ?? null);
  const upcoming = useHud((s) => (s.phase === 'prep' ? (s.m6?.upcoming ?? '') : ''));
  const boss = useHud((s) => !!s.m6?.boss);
  if (boss && !hvt) return null;
  return (
    <div className="surv-chips fixed top-[112px] left-[50%] [transform:translateX(-50%)] flex gap-[8px] pointer-events-none">
      {upcoming && (
        <div className="event-chip incoming" data-testid="incoming">
          <span><FieldIcon name="corrupt" /> INCOMING</span>
          <b>{upcoming}</b>
        </div>
      )}
      {ev && (
        <div className={`event-chip ev-${ev.id}`} data-testid="event-chip" title={ev.blurb}>
          <span><FieldIcon name={EVENT_ICON[ev.id] ?? 'anomaly'} /> EVENT</span>
          <b>{ev.name.toUpperCase()}</b>
        </div>
      )}
      {hvt && (
        <div className="event-chip hvt" data-testid="hvt-chip">
          <span><FieldIcon name="courier" /> VAULT COURIER</span>
          <b>{Math.ceil(hvt.escapeIn)}s</b>
          <i>
            <u style={{ transform: `scaleX(${hvt.hp})` }} />
          </i>
        </div>
      )}
    </div>
  );
}

interface Alert {
  id: number;
  text: string;
  tone: string;
}

function AlertFeed() {
  const [list, setList] = useState<Alert[]>([]);
  useEffect(() => {
    let id = 0;
    const recent = new Map<string, number>();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const show = (a: { text: string; tone: Alert['tone'] }) => {
      const now = performance.now();
      if (now - (recent.get(a.text) ?? -1e9) < 2500) return;
      recent.set(a.text, now);
      const item = { id: ++id, text: a.text, tone: a.tone };
      setList((l) => [...l.slice(-2), item]);
      const t = setTimeout(() => {
        timers.delete(t);
        setList((l) => l.filter((x) => x.id !== item.id));
      }, 3800);
      timers.add(t);
    };
    const off = uiEvents.on('alert', show);
    const offNotice = uiEvents.on('notice', show);
    return () => {
      off();
      offNotice();
      for (const t of timers) clearTimeout(t);
    };
  }, []);
  if (!list.length) return null;
  return (
    <div className="alert-feed" data-testid="alert-feed">
      {list.map((a) => (
        <div key={a.id} className={`alert-line ${a.tone}`}>
          {a.text}
        </div>
      ))}
    </div>
  );
}
