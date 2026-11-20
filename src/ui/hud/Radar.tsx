import { useEffect, useRef } from 'react';
import type { Game } from '../../core/Game';
import { useHud } from '../store';
import { rarity } from '../../loot/rarity';

const RADAR_PX = 156;

/** Metres from centre to edge: the arena plus its gate tunnels. */
const radarRange = (half: number) => half + 13;

/** North-up tactical map: static layout cached once, dynamic blips at ~20 Hz. */
export function Radar({ game }: { game: Game }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = RADAR_PX * dpr;
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d')!;
    const ARENA = game.layout;
    const k = (S / 2 - 6 * dpr) / radarRange(ARENA.half);
    const X = (x: number) => S / 2 + x * k;
    const Y = (z: number) => S / 2 - z * k;

    // Static layer
    const base = document.createElement('canvas');
    base.width = base.height = S;
    const b = base.getContext('2d')!;
    b.fillStyle = 'rgba(4,12,18,0.35)';
    b.fillRect(0, 0, S, S);
    b.strokeStyle = 'rgba(80,220,240,0.06)';
    b.lineWidth = 1;
    const step = ARENA.half > 60 ? 16 : 8;
    for (let g = -Math.ceil(ARENA.half / step) * step; g <= ARENA.half + step; g += step) {
      b.beginPath();
      b.moveTo(X(g), 0);
      b.lineTo(X(g), S);
      b.moveTo(0, Y(g));
      b.lineTo(S, Y(g));
      b.stroke();
    }
    for (const box of ARENA.boxes) {
      const [x0, , z0] = box.min;
      const [x1, , z1] = box.max;
      const fill = box.kind === 'platform' || box.kind === 'bridge' ? 'rgba(120,170,190,0.22)' : box.kind === 'wall' || box.kind === 'gate' ? 'rgba(150,200,215,0.42)' : 'rgba(120,150,165,0.32)';
      b.fillStyle = box.kind === 'relay' || box.kind === 'runwall' ? 'rgba(151,235,199,0.84)' : fill;
      b.fillRect(X(x0), Y(z1), (x1 - x0) * k, (z1 - z0) * k);
    }
    const routes = Object.values(ARENA.routes).map(({ gate, points }) => {
      const path = new Path2D();
      path.moveTo(X(points[0].x), Y(points[0].z));
      for (const p of points.slice(1)) path.lineTo(X(p.x), Y(p.z));
      return { gate, path, x: X(points[0].x), y: Y(points[0].z) };
    });
    // Forward rifts
    b.strokeStyle = 'rgba(255,140,60,0.75)';
    b.lineWidth = 1.2 * dpr;
    for (const r of ARENA.rifts ?? []) {
      b.beginPath();
      b.arc(X(r.x), Y(r.z), 3.2 * dpr, 0, Math.PI * 2);
      b.stroke();
    }
    // Reactor
    b.strokeStyle = 'rgba(159,221,194,0.9)';
    b.lineWidth = 1.5 * dpr;
    b.beginPath();
    b.arc(X(ARENA.reactor.x), Y(ARENA.reactor.z), ARENA.reactor.radius * k, 0, Math.PI * 2);
    b.stroke();
    b.fillStyle = 'rgba(159,221,194,0.35)';
    b.fill();

    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 50) return;
      last = now;
      ctx.clearRect(0, 0, S, S);
      ctx.drawImage(base, 0, 0);
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
      // Match the floor guides so the map points to the same incoming lanes.
      ctx.strokeStyle = '#ff9a42';
      ctx.fillStyle = '#ff9a42';
      ctx.lineWidth = 1.6 * dpr;
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.lineDashOffset = -((now * 0.009) % 7) * dpr;
      for (const route of routes) {
        const activity = game.gateActivity(route.gate);
        ctx.globalAlpha = 0.16 + activity * 0.68;
        ctx.stroke(route.path);
        ctx.globalAlpha = 0.27 + activity * (0.45 + pulse * 0.24);
        ctx.beginPath();
        ctx.arc(route.x, route.y, (2.4 + activity * 0.9) * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      // Turrets: cyan diamonds with range hint
      ctx.fillStyle = '#adddce';
      for (const t of game.turrets.turrets) {
        ctx.fillStyle = t.wrecked ? '#6d6d6d' : '#adddce';
        const x = X(t.pos.x);
        const y = Y(t.pos.z);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-2.6 * dpr, -2.6 * dpr, 5.2 * dpr, 5.2 * dpr);
        ctx.restore();
      }
      // Hostiles
      for (const e of game.enemies.active) {
        if (!e.alive) continue;
        const x = X(e.pos.x);
        const y = Y(e.pos.z);
        const boss = e.def.role === 'boss';
        const r = (boss ? 7 : e.def.radius > 1.1 ? 4 : e.kind === 'rusher' || e.kind === 'pylon' ? 2.2 : 3) * dpr;
        ctx.fillStyle = boss ? '#ff2a2a' : e.def.role === 'hvt' ? '#ffd25a' : e.def.role === 'support' ? (e.kind === 'pylon' ? '#b48cff' : '#5effb0') : e.elite ? '#ffffff' : e.kind === 'rusher' ? '#ffcf4a' : e.kind === 'artillery' ? '#ff3a7a' : e.kind === 'jammer' ? '#c38bff' : '#ff5a2a';
        ctx.globalAlpha = 0.25 + 0.25 * pulse;
        ctx.beginPath();
        ctx.arc(x, y, r * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // Loot: rarity-coloured squares (rare+ pulse)
      for (const p of game.loot.pickups) {
        const r = rarity(p.item.rarity);
        const x = X(p.ground.x);
        const y = Y(p.ground.z);
        const sz = (r.index >= 2 ? 3.2 : 2.2) * dpr;
        ctx.globalAlpha = r.index >= 2 ? 0.6 + 0.4 * pulse : 0.75;
        ctx.fillStyle = r.color;
        ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        ctx.globalAlpha = 1;
      }
      // Player: view cone + arrow
      const pp = game.player.position;
      const yaw = game.player.yaw;
      const px = X(pp.x);
      const py = Y(pp.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(yaw);
      const cone = ctx.createRadialGradient(0, 0, 0, 0, 0, 42 * dpr);
      cone.addColorStop(0, 'rgba(230,250,255,0.28)');
      cone.addColorStop(1, 'rgba(230,250,255,0)');
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 42 * dpr, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -6 * dpr);
      ctx.lineTo(4.2 * dpr, 4.5 * dpr);
      ctx.lineTo(0, 2.4 * dpr);
      ctx.lineTo(-4.2 * dpr, 4.5 * dpr);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [game]);
  const hostiles = useHud((s) => s.enemiesLeft);
  const phase = useHud((s) => s.phase);
  return (
    <div className="radar panel-frame">
      <div className="radar-head">
        <span>RADAR</span>
        <span className={phase === 'combat' ? 'hot' : ''}>{phase === 'combat' ? `${hostiles} CONTACTS` : 'CLEAR'}</span>
      </div>
      <div className="radar-body">
        <canvas ref={ref} style={{ width: RADAR_PX, height: RADAR_PX }} />
        <span className="north">N</span>
        <div className="sweep" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- panels
