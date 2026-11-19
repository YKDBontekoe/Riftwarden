import { useHud } from './store';

/** M7 co-op HUD: teammate vitals (left), floating name tags with distance, link quality. */
export function TeamHud() {
  const c = useHud((s) => s.coop);
  if (!c) return null;
  return (
    <>
      <div className="team-panel" data-testid="team-panel">
        {c.team.map((m) => {
          const hp = m.maxHp > 0 ? m.hp / m.maxHp : 0;
          const sh = m.maxShield > 0 ? m.shield / m.maxShield : 0;
          return (
            <div key={m.id} className={`tm ${m.alive ? '' : 'down'} ${m.connected ? '' : 'away'} ${m.self ? 'self' : ''}`}>
              <i className="swatch" style={{ background: m.color }} />
              <div className="tm-body">
                <div className="tm-name">
                  {m.name}
                  <span>{!m.connected ? 'RECONNECTING' : !m.alive ? `RESPAWN ${Math.ceil(m.respawnIn)}s` : m.family.toUpperCase()}</span>
                </div>
                <div className="tm-bar">
                  <b style={{ width: `${hp * 100}%` }} />
                  {m.maxShield > 0 && <em style={{ width: `${sh * 100}%` }} />}
                </div>
              </div>
            </div>
          );
        })}
        <div className="tm-link">{c.rtt} ms</div>
      </div>
    </>
  );
}

/** Labels use absolute viewport coordinates supplied by the game camera. */
export function TeamTags() {
  const c = useHud((s) => s.coop);
  if (!c) return null;
  return (
    <>
      {c.team
        .filter((m) => !m.self && m.screen && m.connected)
        .map((m) => (
          <div key={m.id} className={`team-tag ${m.alive ? '' : 'down'}`} style={{ left: m.screen!.x, top: m.screen!.y, ['--tc' as string]: m.color }}>
            <span>{m.name}</span>
            <small>{m.alive ? `${Math.round(m.dist)} m` : 'DOWN'}</small>
            <i style={{ width: `${(m.hp / Math.max(1, m.maxHp)) * 100}%` }} />
          </div>
        ))}
    </>
  );
}
