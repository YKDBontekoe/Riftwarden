// The shared war inside a sim worker: the gateway pushes its current state; operations read it (live
// modifiers, reachable sectors) and report secured sectors upstream as trusted reports. The result shown in
// the run is computed on the local copy (the gateway's war is authoritative).
import type { SecureResult, WarState } from '@riftwarden/rules/war/state';
import { reportWar } from '@riftwarden/rules/war/service';

export interface SimWar {
  readonly state: WarState;
  report(rep: { node: string; mode: 'defense' | 'survival'; players: number }, who: string, trusted?: boolean): SecureResult;
}

export class RemoteWar implements SimWar {
  state: WarState;
  constructor(state: WarState, private upstream: (rep: { node: string; mode: 'defense' | 'survival'; players: number }) => void) {
    this.state = state;
  }

  report(rep: { node: string; mode: 'defense' | 'survival'; players: number }): SecureResult {
    this.upstream(rep);
    return reportWar({ war: this.state, samples: [], lastSample: Date.now() }, { ...rep, trusted: true }, Date.now(), this.state.avgOnline);
  }
}
