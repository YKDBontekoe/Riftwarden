import { RunLedger, type Rewards } from '../progression/run';

/** Run ledger shared by the team: every collected resource is mirrored to each player's own ledger. */
export class TeamLedger extends RunLedger {
  members: () => RunLedger[] = () => [];
  override collect(r: Partial<Rewards>): boolean {
    const res = super.collect({ salvage: r.salvage, credits: r.credits, components: r.components, shards: r.shards });
    for (const m of this.members()) m.collect({ salvage: r.salvage, credits: r.credits, components: r.components, shards: r.shards });
    return res;
  }
  override tick(dt: number): void {
    super.tick(dt);
    for (const m of this.members()) m.tick(dt);
  }
  override addKill(): void {
    super.addKill();
    for (const m of this.members()) m.addKill();
  }
  override waveReached(n: number): void {
    super.waveReached(n);
    for (const m of this.members()) m.waveReached(n);
  }
  override waveCleared(n: number): void {
    super.waveCleared(n);
    for (const m of this.members()) m.waveCleared(n);
  }
}
