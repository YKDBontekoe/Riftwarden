/**
 * Co-op run map vote (pure). Every connected warden votes a reachable node or 'home'.
 *  - Resolves when everyone voted, or at the deadline (missing votes follow the majority).
 *  - The node with most votes wins; ties go to the host's choice when it is among them, else the earliest node.
 *  - Nobody chose a node (all 'home', or no votes at the deadline with `homeOnTimeout`): the team extracts.
 *  - Wardens who voted 'home' while the team travels extract on their own (their run ends 'returned').
 */
export interface MapVoteResult {
  /** Node the team travels to (null = everyone extracts). */
  travel: string | null;
  /** Wardens who leave for HQ while the rest travel. */
  home: string[];
}

export function resolveMapVote(votes: ReadonlyMap<string, string | null>, reachable: readonly string[], hostId: string | null, fallback = true): MapVoteResult {
  const counts = new Map<string, number>();
  const home: string[] = [];
  for (const [id, v] of votes) {
    if (v === 'home') home.push(id);
    else if (v && reachable.includes(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  if (!counts.size) {
    // Nobody picked a node: extract when somebody asked to, otherwise continue to the first node (timeout).
    if (home.length || !fallback || !reachable.length) return { travel: null, home: [] };
    return { travel: reachable[0], home: [] };
  }
  const best = Math.max(...counts.values());
  const tied = reachable.filter((id) => counts.get(id) === best);
  const hostVote = hostId ? votes.get(hostId) : null;
  const travel = hostVote && tied.includes(hostVote) ? hostVote : tied[0];
  return { travel, home };
}

/** Everyone connected has voted. */
export function voteComplete(votes: ReadonlyMap<string, string | null>, live: readonly string[]): boolean {
  return live.length > 0 && live.every((id) => !!votes.get(id));
}
