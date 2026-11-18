import { describe, expect, it } from 'vitest';
import { GATEWAY_PORTALS, HQ_PORTALS, HQ_ROOMS, HQ_STATIONS } from '../src/home/layout';
import { buildNav, findPath, nearestNode } from '../src/home/ambientNav';

const g = buildNav(HQ_ROOMS, HQ_PORTALS, HQ_STATIONS);

describe('ambient drone navigation', () => {
  it('has a node per room, portal and station', () => {
    expect(g.nodes.filter((n) => n.kind === 'room')).toHaveLength(HQ_ROOMS.length);
    expect(g.nodes.filter((n) => n.kind === 'portal')).toHaveLength(HQ_PORTALS.length);
    expect(g.nodes.filter((n) => n.kind === 'station')).toHaveLength(HQ_STATIONS.length);
  });
  it('every portal joins two rooms and every station hangs off a room', () => {
    for (const [i, n] of g.nodes.entries()) {
      if (n.kind === 'portal') expect(g.adj[i].length).toBe(2);
      if (n.kind === 'station') expect(g.adj[i].length).toBe(1);
    }
  });
  it('every station can reach every other station', () => {
    const stations = g.nodes.map((n, i) => (n.kind === 'station' ? i : -1)).filter((i) => i >= 0);
    for (const a of stations) {
      for (const b of stations) {
        const p = findPath(g, a, b);
        expect(p.length, `${g.nodes[a].id} -> ${g.nodes[b].id}`).toBeGreaterThan(0);
        expect(p[0]).toBe(a);
        expect(p[p.length - 1]).toBe(b);
      }
    }
  });
  it('paths only step along edges and finds nearest nodes', () => {
    const p = findPath(g, nearestNode(g, 0, 15, 'station'), nearestNode(g, -26, -3.6, 'station'));
    for (let i = 1; i < p.length; i++) expect(g.adj[p[i - 1]]).toContain(p[i]);
    expect(g.nodes[nearestNode(g, 0.2, 0.1, 'room')].id).toBe('room:command');
  });
  it('gateways are not part of the graph (sealed until a wing is built)', () => {
    expect(GATEWAY_PORTALS.length).toBeGreaterThan(0);
    expect(g.nodes.some((n) => n.id.includes('gateway'))).toBe(false);
  });
});
