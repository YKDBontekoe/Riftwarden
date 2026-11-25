// Trade window (co-op lobby): both wardens put items and credits on the table, lock in, then confirm.
// The sim worker validates every offer; the gateway applies both sides in one transaction.
import { useEffect, useMemo, useState } from 'react';
import type { Flow } from '../core/Flow';
import type { TradeSideView, TradeView } from '@riftwarden/protocol/protocol';
import type { ItemInstance } from '@riftwarden/rules/loot/types';
import { creditsAfterTax, offerProblem, TRADE, tradeLock } from '@riftwarden/rules/economy/trade';
import { storedItems } from '@riftwarden/rules/progression/save';
import { ItemCard } from './inventory/entry';
import { Cur, Hint } from './ds';
import { useSave } from './useSave';

const taxPct = Math.round(TRADE.tax * 100);

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, Math.ceil((until - now) / 1000));
  return <span className="ds-mono">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}

function SideItems({ side, onRemove }: { side: TradeSideView; onRemove?: (uid: string) => void }) {
  const items = side.items as ItemInstance[];
  return (
    <div className="trade-items">
      {items.map((it) => (
        <ItemCard key={it.uid} e={{ item: it, status: 'stored', equippedIn: null }} selected={false} onSelect={() => onRemove?.(it.uid)} />
      ))}
      {!items.length && <div className="trade-empty">No items</div>}
    </div>
  );
}

export function TradeWindow({ flow, trade, me }: { flow: Flow; trade: TradeView; me: string }) {
  const save = useSave(flow);
  const mine = trade.a.id === me ? trade.a : trade.b;
  const theirs = mine === trade.a ? trade.b : trade.a;
  const [credits, setCredits] = useState(String(mine.credits || ''));
  const [picking, setPicking] = useState(false);
  const send = (op: 'offer' | 'lock' | 'unlock' | 'confirm' | 'cancel', extra: { items?: string[]; credits?: number } = {}) => flow.net?.send({ t: 'trade', op, ...extra });
  const offered = (mine.items as ItemInstance[]).map((i) => i.uid);
  const offer = (items: string[], cr = Math.floor(Number(credits) || 0)) => send('offer', { items, credits: cr });
  const tradeable = useMemo(() => storedItems(save).filter((i) => !offered.includes(i.uid)), [save, offered]);
  const open = trade.status === 'open';
  const local = offerProblem(save, { items: offered, credits: mine.credits });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && open) {
        e.preventDefault();
        send('cancel');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const both = mine.locked && theirs.locked;
  return (
    <div className="trade-modal" role="dialog" aria-label="Trade" data-testid="trade-window">
      <div className="trade-frame ds-glass">
        <header className="trade-head">
          <span className="ds-crumb">HQ / CO-OP / <b>TRADE</b></span>
          <Cur k="credits" value={save.resources.credits} />
        </header>
        <div className="trade-body">
          <section className={`trade-side mine ${mine.locked ? 'locked' : ''}`}>
            <div className="trade-side-head">
              <span className="ds-lbl">You offer</span>
              <span className={`trade-state ${mine.locked ? 'on' : ''}`} data-testid="trade-my-state">{mine.confirmed ? 'CONFIRMED' : mine.locked ? 'LOCKED IN' : 'EDITING'}</span>
            </div>
            <SideItems side={mine} onRemove={open ? (uid) => offer(offered.filter((u) => u !== uid)) : undefined} />
            {open && offered.length < TRADE.maxItems && (
              <button className="ds-btn trade-add" data-testid="trade-add" onClick={() => setPicking((p) => !p)}>
                {picking ? 'CLOSE STORAGE' : '+ ADD ITEM'}
              </button>
            )}
            {picking && open && (
              <ul className="trade-pick" data-testid="trade-pick">
                {tradeable.map((it) => {
                  const lock = tradeLock(it) ?? (it.locked ? 'Locked at the reclamation press' : null);
                  return (
                    <li key={it.uid}>
                      <button className="trade-pick-row" disabled={!!lock} title={lock ?? undefined} data-testid={`trade-pick-${it.uid}`} onClick={() => offer([...offered, it.uid])}>
                        <span>{it.name}</span>
                        <em>{lock ? 'TRADE-LOCKED' : `LV ${it.level} · ${it.rarity.toUpperCase()}`}</em>
                      </button>
                    </li>
                  );
                })}
                {!tradeable.length && <li className="trade-empty">Nothing in storage (equipped items must be unequipped first)</li>}
              </ul>
            )}
            <label className="trade-credits">
              <span className="ds-lbl">Credits</span>
              <input
                inputMode="numeric"
                data-testid="trade-credits"
                disabled={!open}
                value={credits}
                onChange={(e) => setCredits(e.target.value.replace(/\D/g, '').slice(0, 9))}
                onBlur={() => Number(credits || 0) !== mine.credits && offer(offered)}
                onKeyDown={(e) => e.key === 'Enter' && offer(offered)}
              />
            </label>
            {local && open && <div className="trade-warn">{local}</div>}
          </section>
          <div className="trade-mid" aria-hidden="true">
            <span className="trade-swap">⇄</span>
            {open && <Countdown until={trade.expiresAt} />}
          </div>
          <section className={`trade-side theirs ${theirs.locked ? 'locked' : ''}`}>
            <div className="trade-side-head">
              <span className="ds-lbl">{theirs.name} offers</span>
              <span className={`trade-state ${theirs.locked ? 'on' : ''}`} data-testid="trade-their-state">{theirs.confirmed ? 'CONFIRMED' : theirs.locked ? 'LOCKED IN' : 'STILL EDITING'}</span>
            </div>
            <SideItems side={theirs} />
            <div className="trade-receive">
              <span className="ds-lbl">Credits</span>
              <b>{theirs.credits.toLocaleString()}</b>
              <em data-testid="trade-receive">you receive {creditsAfterTax(theirs.credits).toLocaleString()} after {taxPct}% tax</em>
            </div>
          </section>
        </div>
        <div className="trade-notes">
          <span>If anything changes after you lock in, both sides unlock again.</span>
          <span>Ascended and pinnacle items stay with the warden who earned them. Trading opens at Warden 15 and 7 days after account creation.</span>
        </div>
        {trade.reason && <div className={`trade-status ${trade.status}`} data-testid="trade-status">{trade.reason}</div>}
        {trade.status === 'committing' && <div className="trade-status" data-testid="trade-status">Applying the trade…</div>}
        {trade.status === 'done' && <div className="trade-status done" data-testid="trade-status">Trade complete. The items are in storage.</div>}
        <footer className="trade-foot">
          {open ? <Hint keys="Esc" onClick={() => send('cancel')} testId="trade-cancel">Cancel trade</Hint> : <Hint keys="Esc" onClick={() => flow.net?.store.set({ trade: null })} testId="trade-close">Close</Hint>}
          {open && !mine.locked && (
            <button className="ds-btn-p" data-testid="trade-lock" disabled={!!local} onClick={() => send('lock')}>
              LOCK IN
            </button>
          )}
          {open && mine.locked && !mine.confirmed && (
            <>
              <button className="ds-btn" data-testid="trade-unlock" onClick={() => send('unlock')}>UNLOCK</button>
              <button className="ds-btn-p" data-testid="trade-confirm" disabled={!both} onClick={() => send('confirm')}>
                {both ? 'CONFIRM TRADE' : 'WAITING FOR THEM'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
