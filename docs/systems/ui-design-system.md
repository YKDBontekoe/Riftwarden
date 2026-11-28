# UI design system (final design 2026-11, canvas "Riftwarden UI · Final design")

> Moved verbatim from the old root `CLAUDE.md` (2026-11). Quoted section names (e.g. "Loot depth", "Run map") refer to other files in this folder (index: [README.md](README.md)). Test counts are the numbers recorded when the work landed, not current totals.

- **Tokens and parts** live in `apps/client/src/ui/ds.css` (every class prefixed `ds-`, so the older component rules in `style.css` never collide) and `ui/ds.tsx` (Crumb, Cur, Hint, Seg, Bar, RiskTag, Gem/ElementGem, Backdrop, rarity classes + pips). Fonts are bundled (`@fontsource` Barlow Condensed / Inter / JetBrains Mono, latin subsets, imported in `app.css`; versions in the pnpm catalog): no network font loads, the PWA works offline.
- **Colour roles** (one colour, one meaning): ink `#f4f1e8` = text and primary buttons; **ember `#ff8a3d` = what is yours** (selection, focus, your path, active tab), never a button fill; risk yellow + hatch (`ds-risk-tag`) = unsecured / at risk; gain/loss = verdicts (`--ds-up/--ds-down`, swapped to blue/orange by `html[data-cvd]` from the colour-vision setting); threat red = enemies; liberated teal = reactor / war. The old `--cyan` tokens in `style.css` are remapped to ember-soft / ink, so unported panels follow the palette.
- **Frames**: menus are 1280x720 compositions (`.ds-scr`, zoomed down on small viewports in `ds.css`): breadcrumb + currencies top, content, hints + primary action bottom. `ui/FrontEnd.tsx` (main menu with arrow-key rows, pause with "if you leave now"), `ui/RunScreens.tsx` (checkpoint, defeat, run summary), `LoadingScreen` (sector briefing over the biome render), `Roguelite.UpgradePanel` (three cards), `RunMap.StationScreen` (goods as tiles, services list). Every HQ terminal goes through `shell.tsx` `Shell` (full-screen glass work area, crumb `HQ / station / title`, the station's spent currencies from `ShellResources`, purpose + back at the bottom); panels that render `.terminal-screen` themselves (run build, tower panel, cargo) get the same glass frame.
- **Combat HUD** (`ui/hud/Combat.tsx`, `combatHud.css`): frameless corners: objective top left (wave, hostiles, reactor or HUNTED, at-risk loot, node chips), compass top centre (reactor + boss/elite markers, `Compass` reads `game.player.yaw` per frame), phase + cores top right, ability squares + hull/shield bottom left, weapon + heat bottom right. The radar is optional (Settings > Accessibility > Arena minimap, `hud/minimap.ts`, per device). Test hooks kept: `.ab-slot`, `.mv-chip`, `[data-testid=cond-row]`, `.weapon-card .el-tag`, `[data-testid=survival-banner]`, `.bottom-left/.bottom-right`.
- **Every artboard is built** (second pass): inventory tiles + compare (`screens.css`, `inventory/*`), loadout tabs, drone stats, workshop tabs, tower tech board, mastery track, command console tabs, construction, run build (`RunBuild.tsx`), tower panel (`TowerPanel.tsx`), breakthrough (`Breakthrough.tsx`), sector map frame, settings page (`SettingsScreen`, tabs graphics/audio/controls/interface/accessibility/account), co-op lobby slots, account page + offline banner (`SystemStates.tsx`), mobile prompts. `App.tsx` is routing only. Layout rules for these screens live in `ui/screens.css` (imported after `ds.css`). The window debug API moved to `core/debugApi.ts` (Flow.ts stays under the line limit).
- **Firing range** (`packages/game/src/arena/Range.ts`, narrow host; `ui/FiringRange.tsx`): deploy terminal tab FIRING RANGE -> `Flow.enterRange()` builds the classic arena with `ArenaConfig.range` and a dev `RunLedger` that is never journalled (no start/end entry; leaving via pause goes home without a record). Game: hostile time is 0 (`hdt`), the director still ticks statuses with real time, `waves.hold`, `dropChanceMult = 0`. Dummies (walker / bulwark / enforcer / skimmer, bare / armored / barrier, single or pack of 3, 15/25/40 m, any faction via `Director.setFaction`) are x40 hull and refilled before they can die (full refill after 3 s idle). Keys J/K/L/P/O, Backspace resets. `DpsMeter` (`rules/combat/dpsMeter.ts` [pure]) samples `director.dealt.player` per frame (DoT included) and counts weapon hits/crits from the bus: last 5 s, best 3 s burst, sustained, crit rate; the panel also shows the gear-only sheet DPS (`Game.firepower()`). Tests: `tests/dps-meter.test.ts`, `node scripts/e2e-range.cjs` (12).
- **Open-squad browser** (protocol v14): lobby frame `{t:'listed'}` (host only, squads are private by default), `LobbyState.listed`; sim workers send `RoomListing`s (listed, in lobby, not full) with every `SimLoad`; the gateway keeps them per worker (`Directory.listed`, dropped when a worker is lost) and serves `GET /rooms` (`crates/gateway/src/rooms.rs`, rate limited, fullest first, 40 rows; Vite proxies `/rooms`). `ui/SquadBrowser.tsx` polls `${apiBase()}/rooms` every 5 s (rows above your RL are LOCKED) inside the online co-op panel; the lobby has a LIST SQUAD toggle. Protocol suite section L.
- **Trading** (protocol v14, unlock `trading` at Warden 15 + account 7 days old, checked by the gateway): `rules/economy/trade.ts` [pure] (gate, `tradeLock`: Ascended, `ItemInstance.bound` = pinnacle drops (set by `generateItem` for drop source `pinnacle`), starter uids; `offerProblem`; `tradeEntries`; `applyTrade` validate-then-apply incl. storage room and uid collisions; 10% credit tax). The sim worker's `TradeDesk` (`apps/worker/src/sim/trade.ts`) runs the window between two lobby members (open / offer / lock / unlock / confirm / cancel, 3 min timeout, any offer change unlocks both, dry-run of both sides before committing) and sends `SimTrade`; `sync::apply_trade` locks both profiles in uuid order, replays one trusted `{trade}` entry per side on log device `trade:<id>` (a repeat applies nothing), commits both or neither, then notifies devices + the worker (`SimTradeResult`). `sync.replay` refuses `trade` entries that are not trusted, so devices can never send one. UI: TRADE button per teammate in the lobby -> `ui/Trade.tsx`. Tests: `tests/trade.test.ts` (6), protocol suite section T (9). Not done: listings/async market (trades are live, lobby-only), trade history, a dedicated HQ trading-post station.
- **Mockup QA pass** (every artboard compared side by side with the canvas at 1280x720): terminals are frameless (title in the crumb, sub + offline chip in the top bar); the main action of a terminal is docked bottom right (`.term-primary`, `data-key` chip, `data-enter` = Shell's Enter clicks it; `ConfirmButton` keeps its confirm row docked); HUD: prep countdown centred (`PrepClock`), survival objective (`HuntObjective`: machines hunting you, nearest, threat arrows), boss bar at the top centre (phase · name · encounter, phase ticks, attack + interrupt progress from `BossHud.interrupt`) with the objective moved below it; HQ roam station list; settings with key table + alternates, DEL resets a tab, invert-Y (`settings.invertY`); cargo = tile grids + compare (`.cargo-ds`); hub stations (anomaly/forge/vault) as cards; run map = sector header (badges, threat/clear time/liberation) + side drawer (R) + X extract; squad lobby full screen (`.lobby-screen`); construction top bar = crumb + resources + light/module counts; storage opens the drone bay on its Storage tab. **Deploy terminal, map runs** (`DeployMapPanel`, `dw-*`): planet (`GlobeView`: a lit procedural planet, 768x384 albedo + emissive canvases painted per war update: fbm rock, biome tint, territory wash + border by status, city lights / front fires, foundry lava, rift scar, polar caps; diamond pins + HTML labels projected per frame (`Globe labels`); texel directions follow Babylon's sphere UVs) + region tabs or sector map (M / `dw-view-sector`) on the left; region panel right: kicker, name, liberation, `LiveEvents` (distress / convoy / defense with timers + next corruption step; a row selects its sector), war order, mode, Rift Level picker + loot + pinnacle (`aside` from `DeployTerminal`), sector card, war report/records/codex in details; the classic deploy grid stays for non-map runs. QA tooling lives outside the repo (render mocks, capture, side-by-side pairs).
- Restyled by tokens only (no new layout): seasons, lattice internals, touch overlay.

## Settings and convenience features

- **Settings fields** (`core/settings.ts`, optional + sanitized, no version bump): `sensitivityY` (vertical look speed
  0.5..2× of horizontal, applied in `Player` to mouse and touch look), `muted`, `muteInBackground` (default on),
  `showFps`, `autoSprint` (sprint whenever moving forward; the dash key still dashes). Old saves load with the
  defaults.
- **Settings page**: a slider with a default restores it on double-click (value turns ember while changed); the page
  reopens on the last tab (`riftwarden.settingsTab`, this device); Reset all settings in the footer is two clicks (arms
  for 4 s) and resets to the desktop or mobile defaults; DEL per tab now also resets adaptive quality, mute, vertical
  look and the FPS readout. Key table: changed bindings carry an ember dot (tooltip names the default), reserved keys
  (`RESERVED_KEYS`: Esc, Tab, F3, F4, F10, F11, F12) are refused with a note, a click elsewhere cancels listening.
  `keyLabel` names every key (R-CTRL, L-ALT, arrows as ↑←↓→, NUM 7, punctuation) instead of printing raw codes.
- **Window** (`core/windowState.ts`): the tab title follows the run (`Paused · Wave 7 · RL 3 · Riftwarden`, checkpoint,
  preparing, reactor lost; plain outside a run). Audio fades out while the tab is hidden or the window loses focus
  (`Sfx.setBackground`) and Mute silences the master bus (`Sfx.setMuted`) without touching the mix. Only a real blur
  counts as unfocused, so headless suites keep their audio state.
- **FPS readout** (`ui/FpsReadout.tsx`): Settings > Interface > Frame rate shows a small top-left counter (2 Hz,
  coloured by 55/30 fps); F3 is still the full overlay.
- **Inventory** (`inventory/InventoryView.tsx`): the sort order persists (`riftwarden.invSort`); `/` focuses search,
  Esc in the box clears it then leaves it, Enter/↓ hand the keys back to the list; PageUp/PageDown jump 8 rows,
  Home/End go to the ends (`navIndex`).
- **Pause menu**: "If you leave now" shows the time deployed and kills. `fmtTime` prints h:mm:ss from an hour and 0:00
  for bad input.
- **Reticle and HUD readability**: reticle colour (`RETICLE_COLORS`, CSS `--reticle-color`) and opacity
  (`--reticle-opacity`); HUD backing (`data-hud-backing`, glass behind the corner readouts); Reduce flashing
  (`data-flash='reduced'`, Accessibility tab) stops the blinking warnings and hides the hit and kill full-screen
  flashes (selector list in `combatHud.css`, extend it when adding a blinking warning). The prep countdown turns ember
  and pulses in its last five seconds (`.hud-prep.urgent`).
- **Choices that open mid-fight** (upgrade cards, checkpoint): number row or numpad (`pickIndex`); input in the first
  400 ms after they appear is ignored (a click or a `1` weapon-draw already on its way), except under automation
  (`forceCapture`).
- **Wording**: `plural()` (`format.ts`) for counts ("1 kill", "2 bosses"); currencies and kill/damage counts use
  thousands separators; cost chips say how much is left after a purchase or how far short you are (`spendNote`). An
  armed confirm button disarms after 10 s. The loot feed merges a repeat of its newest row into one row with ×N
  (`pushFeed`).
- **Terminals** (`shell.tsx`): Q / R cycle any terminal's tab bar (hint in the footer; a bar marked
  `data-tabkeys="own"` keeps its own handling: Command, Loadout); arrow keys move through a terminal's item grid
  (`gridStep`: ←/→ one tile, ↑/↓ a row measured from the layout), except lists with their own keys
  (`data-listkeys="own"`, the inventory view) and multi-select lists; Esc in a text box leaves the box before closing
  the terminal.
- **Remembered views** (`remembered.ts`, `useRemembered`): Command, Workshop and the merchants reopen on the tab used
  last this session (memory only; a value that is no longer valid, such as a locked tab, falls back; off under
  `?test`).
- **Bound keys in text**: loading tips use `{action}` tokens (`fillKeys`), and the Loadout weapon note, cargo
  hint and run-map station prompt show the player's own keys instead of fixed letters.
- **Menus** (`menuKey`): ↑/↓ or W/S (no key repeat, so a held movement key does not scroll), Home/End; on the main
  menu the digits run the numbered item.
- **First start** (`withOsPreferences`, `boot.tsx`): the OS reduced-motion preference turns on Reduce motion with no
  camera shake, and "more contrast" turns on the HUD backing; saved settings always win.
- **Low-hull tone** (`hud/hullCue.ts`): one alarm tone on entering the critical band (< 25%), re-armed above 40%.
- **Co-op join box**: a pasted invite link becomes its room code (`codeFromPaste`); Enter joins.
- **HQ station list**: each station shows a screen-relative arrow (`bearingArrow`) beside its distance.
- **Tests**: `tests/settings-options.test.ts`, `key-bindings.test.ts`, `window-state.test.ts`, `ui-format.test.ts`,
  `inventory-nav.test.ts`, `loot-feed.test.ts`, `upgrade-pick.test.ts`,
  `terminal-keys.test.ts`, `hq-bearing.test.ts`, `remembered.test.ts`, `loading-tips.test.ts`,
  `menu-keys.test.ts`, `hull-cue.test.ts`, `coop-code.test.ts`, `haptics.test.ts`.
