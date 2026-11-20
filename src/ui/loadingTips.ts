/** Loading-screen tips: short, actionable, grouped by where they apply. Pure data + a seeded picker. */
export const TIPS = {
  arena: [
    'Towers block ground enemies. Wall off a lane and they re-route, or breach the cheapest tower in the way.',
    'Wrecked towers stop firing and stop blocking. Inspect one and press F to rebuild it between waves.',
    'Forward rifts open inside the sector: watch the radar for orange rings near your defenses.',
    'Rush drones, jammers and artillery fly over towers. Mazes only slow the ground crews.',
    'Call a wave early with G: every skipped second pays 2 cores.',
    'Dash, jump and boost chain: carried momentum keeps you near 30 m/s.',
    'Kills refund dash charge. Chain kills within 2.5 s for RAMPAGE and OVERDRIVE.',
    'Tactical time slows hostiles only, and lets you refit and repair towers mid-wave.',
    'Unsecured loot is lost on defeat. Checkpoints every 5 waves bank everything you carry.',
    'Platforms make tower plateaus out of reach of breaching walkers.',
    'Bosses smash straight through towers in their path. Build to the side of their lane.',
    'Intact towers mend a quarter of their structure after every cleared wave.',
  ],
  hq: [
    'The Neural Lattice spends Warden levels on a skill tree unique to your profile.',
    'Hover an item to compare it with your loadout before you equip it.',
    'Locked items can never be sold or dismantled by accident.',
    'The Command Console lists every station; click one to light its floor ring.',
    'Fabricator grades above Standard need higher threat tiers unlocked.',
    'Research tower blueprints in the workshop: Tower Tech carries over to every run.',
  ],
} as const;

export function pickTip(kind: keyof typeof TIPS, n: number): string {
  const list = TIPS[kind];
  return list[((n % list.length) + list.length) % list.length];
}
