import { type ReactNode, useCallback, useRef, useState } from 'react';
import { sfx } from '@riftwarden/game/audio/Sfx';
import type { Flow } from '../core/Flow';
import { type Cost, RESOURCE_KEYS, RESOURCE_LABEL, type ResourceKey } from '@riftwarden/rules/economy/config';
import { newUid } from '@riftwarden/rules/progression/items';
import { CURRENCIES, amountText, currencyTooltip } from '@riftwarden/rules/economy/currencies';
import type { SaveData } from '@riftwarden/rules/progression/save';
import { uiEvents } from '@riftwarden/game/ui/store';
import { CurrencyIcon } from './inventory/thumbs';

export const RES_CLASS: Record<ResourceKey, string> = { credits: CURRENCIES.credits.cls, salvage: CURRENCIES.salvage.cls, components: CURRENCIES.components.cls, shards: CURRENCIES.shards.cls };

/** Balances strip; with `cost`, each balance shows what it would be after paying. */
export function ResourceBar({ save, cost, compact }: { save: SaveData; cost?: Cost; compact?: boolean }) {
  return (
    <div className={`res-bar ${compact ? 'compact' : ''}`}>
      {RESOURCE_KEYS.map((k) => {
        const have = save.resources[k];
        const need = cost?.[k] ?? 0;
        return (
          <div key={k} className={`res-chip ${RES_CLASS[k]} ${need > have ? 'short' : ''}`} title={currencyTooltip(k)} tabIndex={0} data-testid={`res-${k}`}>
            <i><CurrencyIcon k={k} /></i>
            <b>{have.toLocaleString()}</b>
            <span>{RESOURCE_LABEL[k].toUpperCase()}</span>
            {need > 0 && <em>−{need.toLocaleString()}</em>}
          </div>
        );
      })}
    </div>
  );
}

/** Inline cost readout; resources the player lacks are marked. */
export function CostLine({ cost, save, label }: { cost: Cost; save?: SaveData; label?: string }) {
  const parts = RESOURCE_KEYS.filter((k) => (cost[k] ?? 0) > 0);
  return (
    <span className="cost-line">
      {label && <span className="cl-label">{label}</span>}
      {parts.length === 0 && <span className="cl-free">FREE</span>}
      {parts.map((k) => {
        const need = cost[k] ?? 0;
        const short = !!save && save.resources[k] < need;
        return (
          <span key={k} className={`cl ${RES_CLASS[k]} ${short ? 'short' : ''}`} title={short ? `${CURRENCIES[k].name}: have ${save!.resources[k].toLocaleString()}, need ${need.toLocaleString()}` : CURRENCIES[k].name}>
            <i><CurrencyIcon k={k} /></i>
            {short ? `${save!.resources[k].toLocaleString()}/${need.toLocaleString()}` : need.toLocaleString()}
          </span>
        );
      })}
    </span>
  );
}

export type Msg = { text: string; ok: boolean } | null;


/**
 * Runs economy transactions from the UI: one at a time (re-entrant clicks are ignored),
 * each with a fresh transaction id, committed through Profile.transact (rolled back if
 * the write fails). On success it emits station feedback with the resource deltas.
 */
export function useTx(flow: Flow, station: string) {
  const [msg, setMsg] = useState<Msg>(null);
  const busy = useRef(false);
  const run = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (kind: string, op: string, args: unknown[], okText: (r: any) => string): any => {
      if (busy.current) return null;
      busy.current = true;
      try {
        const before = { ...flow.profile.save.resources };
        const txId = newUid('tx');
        const res = flow.profile.op(op, args, txId) as { ok: boolean; reason?: string };
        if (!res.ok) {
          setMsg({ text: res.reason ?? 'failed', ok: false });
          sfx.play('buildDeny');
          return null;
        }
        const after = flow.profile.save.resources;
        const delta: Partial<Record<ResourceKey, number>> = {};
        for (const k of RESOURCE_KEYS) if (after[k] !== before[k]) delta[k] = after[k] - before[k];
        uiEvents.emit('econ', { station, kind, delta });
        setMsg({ text: okText(res), ok: true });
        return res;
      } finally {
        // Release on the next frame: a double click inside the same frame is dropped.
        requestAnimationFrame(() => (busy.current = false));
      }
    },
    [flow, station],
  );
  return { msg, setMsg, run };
}

export function TxMessage({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <div className={`term-msg ${msg.ok ? '' : 'bad'}`}>{msg.text}</div>;
}

/** Two-step button for destructive or expensive actions. */
export function ConfirmButton({ label, confirm, onConfirm, disabled, className = '', needConfirm = true, testId }: { label: ReactNode; confirm: ReactNode; onConfirm: () => void; disabled?: boolean; className?: string; needConfirm?: boolean; testId?: string }) {
  const [armed, setArmed] = useState(false);
  if (armed)
    return (
      <div className="confirm-row">
        <span>{confirm}</span>
        <button
          className="danger"
          data-testid={testId ? `${testId}-confirm` : undefined}
          onClick={() => {
            setArmed(false);
            onConfirm();
          }}
        >
          CONFIRM
        </button>
        <button onClick={() => setArmed(false)}>CANCEL</button>
      </div>
    );
  return (
    <button className={className} data-testid={testId} disabled={disabled} onClick={() => (needConfirm ? setArmed(true) : onConfirm())}>
      {label}
    </button>
  );
}

/** Format a cost or delta as text (messages). */
export function costText(c: Partial<Record<ResourceKey, number>>, sign = ''): string {
  return amountText(c, sign);
}
