import { useEffect, useState } from 'react';
import { ROMAN } from '@riftwarden/rules/survival/records';
import { uiEvents } from '@riftwarden/game/ui/store';
import { useHud } from './useHud';

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
  return (
    <div className={`boss-bar phase${b.phase} ${b.immune ? 'immune' : ''}`} data-testid="boss-bar">
      <div className="boss-head">
        <span className="boss-name">
          {b.name}
          {b.encounter > 1 && <em> {ROMAN[Math.min(9, b.encounter - 1)]}</em>}
        </span>
        <span className="boss-phase">PHASE {b.phase}</span>
      </div>
      <div className="boss-track">
        <i style={{ transform: `scaleX(${f})` }} />
        {b.ticks.map((t) => (
          <b key={t} style={{ left: `${t * 100}%` }} />
        ))}
      </div>
      <div className="boss-foot">
        <span className={`boss-state ${b.immune ? 'imm' : /EXPOSED|OPEN|STAGGER/.test(b.state) ? 'vuln' : ''}`}>{b.state}</span>
        {b.attack && <span className="boss-attack">▲ {b.attack}</span>}
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
    <div className="fixed top-[112px] left-[50%] [transform:translateX(-50%)] flex gap-[8px] pointer-events-none">
      {upcoming && (
        <div className="event-chip incoming" data-testid="incoming">
          <span>INCOMING</span>
          <b>{upcoming}</b>
        </div>
      )}
      {ev && (
        <div className={`event-chip ev-${ev.id}`} data-testid="event-chip" title={ev.blurb}>
          <span>EVENT</span>
          <b>{ev.name.toUpperCase()}</b>
        </div>
      )}
      {hvt && (
        <div className="event-chip hvt" data-testid="hvt-chip">
          <span>VAULT COURIER</span>
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
