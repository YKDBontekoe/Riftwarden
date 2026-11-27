# apps/client: browser shell, Flow and React UI

`src/main.tsx` (tiny shell: styles, splash, PWA) -> `src/boot.tsx` (engine, Havok, `core/Flow.ts`, React root). `Flow`
owns the only render loop, the single `Input`, the `Profile` and either the HQ or a `Game`, and swaps scenes through
`transition()`. UI: React 19 + TanStack Router (hash history) + Tailwind v4. Desktop shell: `src-tauri/` (Tauri 2, signed
updates; `src/desktop/`).

## Rules

- **Design system first.** Tokens and parts in `src/ui/ds.css` / `src/ui/ds.tsx` (prefix `ds-`); screen layout in
  `src/ui/screens.css`; HQ terminals go through `shell.tsx` `Shell`. Colour roles are fixed: ember = what is yours, risk
  yellow + hatch = unsecured, threat red = enemies, teal = reactor/war, gain/loss tokens for verdicts (colour-vision
  setting swaps them). See [`docs/systems/ui-design-system.md`](../../docs/systems/ui-design-system.md).
- New UI uses Tailwind utilities with the tokens in `src/ui/app.css`; `style.css` is the components layer.
- Values that change every tick use `LiveText` / `LiveBar` / `useLiveStyle` (signals), not `useHud`. A `useHud` selector
  must not build a new object (it loops `useSyncExternalStore`).
- Keep the test hooks the suites use (`data-testid`, `.ab-slot`, `.weapon-card .el-tag`, ...); `?test` exposes
  `window.__rift` (`core/debugApi.ts`).
- Touch input never calls game methods: it feeds the shared `Input` (`simulateKey`, `look`, `setStick`).
- Fonts and assets are bundled (the PWA must work offline); no network font loads. The service worker waits for
  `skip-waiting` before updating.
- Style refactors: `node scripts/ui-shots.cjs <dir>` before and after, then `node scripts/ui-diff.cjs <before> <after>`.
- Every profile change from the UI is a named op (`profile.op(...)`) or a transaction (`useTx`), never a direct mutation.

Docs: UI [`ui-design-system.md`](../../docs/systems/ui-design-system.md), mobile/PWA
[`mobile-pwa.md`](../../docs/systems/mobile-pwa.md), desktop [`desktop.md`](../../docs/systems/desktop.md).
