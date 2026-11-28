// Touch overlay: floating move stick (left), drag-to-look (right), a thumb cluster of actions, a top row of
// menus and context buttons. Every control feeds the shared Input (virtual keys / mouse buttons / look / stick),
// so the game logic is the same for keyboard, mouse and touch.
import { useHurtHaptics } from './haptics';
import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { knobOffset, lookDelta, stickVector, TOUCH } from '@riftwarden/game/core/touch';
import type { Input } from '@riftwarden/game/core/Input';
import type { Flow } from '../core/Flow';
import { useHud } from '../ui/useHud';
import { pauseWorld, touchStore } from './touchMode';
import './touch.css';

/** What a button presses: a key code the game listens for, or a mouse button. */
type Bind = { key: string } | { mouse: number };

function press(input: Input, bind: Bind, down: boolean): void {
  if ('key' in bind) input.simulateKey(bind.key, down);
  else input.simulateMouse(bind.mouse, down);
}

interface BtnProps {
  id: string;
  label: ReactNode;
  input: Input;
  bind?: Bind;
  /** Instead of (or after) the bind: an action on press. */
  onPress?: () => void;
  /** Dragging the button also turns the camera (fire). */
  look?: () => number;
  className?: string;
  sub?: ReactNode;
  disabled?: boolean;
  style?: CSSProperties;
}

function Btn({ id, label, input, bind, onPress, look, className = '', sub, disabled, style }: BtnProps) {
  const last = useRef<{ id: number; x: number; y: number } | null>(null);
  // Unmounted while held (a panel opened mid-press): release the key / button so it does not stay down.
  const held = useRef({ input, bind });
  held.current = { input, bind };
  useEffect(
    () => () => {
      if (last.current && held.current.bind) press(held.current.input, held.current.bind, false);
      last.current = null;
    },
    [],
  );
  const release = (e: RPointerEvent<HTMLButtonElement>) => {
    if (last.current?.id !== e.pointerId) return;
    last.current = null;
    e.currentTarget.classList.remove('held');
    if (bind) press(input, bind, false);
  };
  return (
    <button
      type="button"
      className={`tc-btn tc-${id} ${className}`}
      data-testid={`tc-${id}`}
      aria-label={typeof label === 'string' ? label : id}
      aria-disabled={disabled || undefined}
      style={style}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (disabled || last.current) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        last.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        e.currentTarget.classList.add('held');
        if (bind) press(input, bind, true);
        onPress?.();
      }}
      onPointerMove={(e) => {
        const l = last.current;
        if (!look || !l || l.id !== e.pointerId) return;
        const k = look();
        input.look(lookDelta(e.clientX - l.x, k), lookDelta(e.clientY - l.y, k));
        l.x = e.clientX;
        l.y = e.clientY;
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="tc-label">{label}</span>
      {sub != null && <small className="tc-sub">{sub}</small>}
    </button>
  );
}

/** Left half: floating stick wherever the thumb lands. Right half: drag to look. */
function useSurface(flow: Flow) {
  const ptrs = useRef(new Map<number, { kind: 'stick' | 'look'; ox: number; oy: number; x: number; y: number }>());
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const sens = () => flow.settings.touchLook * flow.settings.sensitivity;
  const showStick = (ox: number, oy: number, dx: number, dy: number) => {
    const b = base.current;
    const k = knob.current;
    if (!b || !k) return;
    b.style.transform = `translate(${ox}px, ${oy}px)`;
    b.classList.add('on');
    const [kx, ky] = knobOffset(dx, dy);
    k.style.transform = `translate(${kx}px, ${ky}px)`;
  };
  const hideStick = () => {
    base.current?.classList.remove('on', 'sprint');
    if (knob.current) knob.current.style.transform = '';
  };
  const handlers = {
    onPointerDown(e: RPointerEvent<HTMLDivElement>) {
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const left = e.clientX < window.innerWidth * TOUCH.stickZone;
      const busy = [...ptrs.current.values()].some((p) => p.kind === 'stick');
      const kind = left && !busy ? 'stick' : 'look';
      ptrs.current.set(e.pointerId, { kind, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY });
      if (kind === 'stick') showStick(e.clientX, e.clientY, 0, 0);
    },
    onPointerMove(e: RPointerEvent<HTMLDivElement>) {
      const p = ptrs.current.get(e.pointerId);
      if (!p) return;
      if (p.kind === 'look') {
        const k = sens();
        flow.input.look(lookDelta(e.clientX - p.x, k), lookDelta(e.clientY - p.y, k));
      } else {
        const dx = e.clientX - p.ox;
        const dy = e.clientY - p.oy;
        const v = stickVector(dx, dy);
        flow.input.setStick(v.x, v.z, v.sprint);
        showStick(p.ox, p.oy, dx, dy);
        base.current?.classList.toggle('sprint', v.sprint);
      }
      p.x = e.clientX;
      p.y = e.clientY;
    },
    onPointerUp(e: RPointerEvent<HTMLDivElement>) {
      const p = ptrs.current.get(e.pointerId);
      if (!p) return;
      ptrs.current.delete(e.pointerId);
      if (p.kind === 'stick') {
        flow.input.setStick(0, 0, false);
        hideStick();
      }
    },
  };
  return { reset() { ptrs.current.clear(); flow.input.setStick(0, 0, false); hideStick(); }, handlers: { ...handlers, onPointerCancel: handlers.onPointerUp }, base, knob };
}

const PARTS = [['KeyC', 'WPN'], ['KeyV', 'CORE'], ['KeyN', 'MOD'], ['KeyM', 'BASE']] as const;

function ArenaControls({ flow, look }: { flow: Flow; look: () => number }) {
  const input = flow.input;
  const game = flow.arena;
  // Whole snapshot (a stable reference per publish): an object built in the selector would never compare equal.
  const s = useHud((x) => x);
  const h = {
    build: s.buildMode,
    phase: s.phase,
    loot: !!s.lootTarget,
    station: !!s.node?.prompt,
    noTowers: !!s.node?.noTowers,
    survival: s.mode === 'survival',
    inspect: s.inspect ? { hp: !!s.inspect.hp, recycle: s.inspect.recycle } : null,
    abilities: s.abilities.map((a) => ({ slot: a.slot, name: a.name, ready: a.ready, cd: a.cd, active: a.active })),
    swap: !!s.holster,
    dash: s.dashCharges,
    tactical: s.tacticalActive,
    alive: s.respawnIn <= 0,
  };
  if (!game) return null;
  const ab = (slot: string) => h.abilities.find((a) => a.slot === slot);
  const a1 = ab('ability');
  const a2 = ab('ability2');
  const ult = ab('ultimate');
  const towers = !h.survival && !h.noTowers;
  const prep = h.phase !== 'combat';
  const cd = (a?: { ready: boolean; cd: number }) => (a && !a.ready && a.cd >= 1 ? Math.ceil(a.cd) : undefined);
  return (
    <>
      <div className="tc-top">
        {prep && <Btn id="wave" label="WAVE" input={input} bind={{ key: 'KeyG' }} />}
        {towers && <Btn id="build" label={h.build ? 'EXIT BUILD' : 'BUILD'} input={input} bind={{ key: 'KeyB' }} className={h.build ? 'on' : ''} />}
        {towers && prep && game.towerPanelAllowed && <Btn id="towers" label="TOWERS" input={input} bind={{ key: 'KeyT' }} />}
        <Btn id="tactical" label="SLOW" input={input} bind={{ key: 'KeyQ' }} className={h.tactical ? 'on' : ''} />
        {game.canReturnHome && <Btn id="map" label="MAP" input={input} bind={{ key: 'KeyH' }} className="hot" />}
        <Btn id="inv" label="CARGO" input={input} bind={{ key: 'Tab' }} />
        <Btn id="pause" label="❚❚" input={input} onPress={() => pauseWorld(flow)} />
      </div>
      <div className="tc-ctx">
        {(h.loot || h.station) && <Btn id="use" label={h.loot ? 'PICK UP' : 'USE'} input={input} bind={{ key: 'KeyE' }} className="hot" />}
        {h.inspect && !h.build && (
          <>
            <Btn id="level" label="LEVEL" input={input} bind={{ key: 'KeyR' }} />
            {h.inspect.hp && <Btn id="repair" label="REPAIR" input={input} bind={{ key: 'KeyF' }} />}
            <Btn id="recycle" label="RECYCLE" sub="hold" input={input} bind={{ key: 'KeyX' }} style={{ '--fill': `${Math.round(h.inspect.recycle * 100)}%` } as CSSProperties} />
          </>
        )}
        {h.build && PARTS.map(([key, l]) => <Btn key={key} id={`part-${l.toLowerCase()}`} label={l} input={input} bind={{ key }} />)}
      </div>
      <div className="tc-cluster">
        <Btn id="fire" label={h.build ? 'PLACE' : 'FIRE'} input={input} bind={{ mouse: 0 }} look={look} className={h.build ? 'place' : ''} />
        <Btn id="jump" label="JUMP" input={input} bind={{ key: 'Space' }} />
        <Btn id="dash" label="DASH" sub={h.dash} input={input} bind={{ key: 'ShiftLeft' }} disabled={!h.alive} />
        <Btn id="slide" label="SLIDE" input={input} bind={{ key: 'ControlLeft' }} />
        <Btn id="grapple" label="HOOK" input={input} bind={{ mouse: 1 }} />
        {h.swap && <Btn id="swap" label="SWAP" input={input} bind={{ key: 'KeyZ' }} />}
        {h.build ? (
          <Btn id="ab1" label="CANCEL" input={input} bind={{ mouse: 2 }} />
        ) : (
          a1 && <Btn id="ab1" label={a1.name.split(' ')[0].toUpperCase()} sub={cd(a1)} input={input} bind={{ mouse: 2 }} className={a1.ready ? 'ready' : 'cool'} />
        )}
        {a2 && !h.build && <Btn id="ab2" label={a2.name.split(' ')[0].toUpperCase()} sub={cd(a2)} input={input} bind={{ key: 'KeyF' }} className={a2.ready ? 'ready' : 'cool'} />}
        {ult && !prep && <Btn id="ult" label="ULT" sub={ult.ready ? 'READY' : `${Math.floor(ult.cd * 100)}%`} input={input} bind={{ key: 'KeyT' }} className={ult.ready ? 'ready glow' : 'cool'} />}
      </div>
    </>
  );
}

function HomeControls({ flow }: { flow: Flow }) {
  const input = flow.input;
  const prompt = useHud((s) => s.prompt);
  return (
    <>
      <div className="tc-top home">
        <Btn id="pause" label="❚❚" input={input} onPress={() => pauseWorld(flow)} />
      </div>
      <div className="tc-ctx">{prompt && <Btn id="use" label={prompt.action ? prompt.action.toUpperCase() : 'USE'} input={input} bind={{ key: 'KeyE' }} className="hot" />}</div>
      <div className="tc-cluster home">
        <Btn id="jump" label="JUMP" input={input} bind={{ key: 'Space' }} />
        <Btn id="dash" label="DASH" input={input} bind={{ key: 'ShiftLeft' }} />
      </div>
    </>
  );
}

/** Mounted by App; renders only while touch mode is on and a world is controllable. */
export function TouchControls({ flow }: { flow: Flow }) {
  const on = useSyncExternalStore(touchStore.subscribe, touchStore.get);
  const screen = useHud((s) => s.screen);
  const location = useHud((s) => s.location);
  const surface = useSurface(flow);
  const arena = location === 'arena' && screen === 'playing' && !!flow.arena;
  const home = location === 'home' && screen === 'home' && !!flow.home;
  const shown = on && (arena || home);
  useHurtHaptics(shown && arena && flow.settings.haptics);
  // Hidden with a thumb on the stick (a panel opened, the screen changed): centre the stick and forget the fingers.
  useEffect(() => {
    if (!shown) surface.reset();
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  const look = () => flow.settings.touchLook * flow.settings.sensitivity;
  return (
    <div className="touch-layer" data-testid="touch-layer" style={{ '--tc-alpha': flow.settings.touchOpacity } as CSSProperties} {...surface.handlers}>
      <div className="tc-stick" ref={surface.base} aria-hidden="true">
        <div className="tc-knob" ref={surface.knob} />
      </div>
      {arena ? <ArenaControls flow={flow} look={look} /> : <HomeControls flow={flow} />}
    </div>
  );
}
