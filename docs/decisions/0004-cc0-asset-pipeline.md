# 0004. CC0 asset pipeline

- Status: Accepted
- Date: 2026-11-27
- Deciders: owner / session

## Context

The owner asked for a much richer look and for music, using existing asset packs. The design direction allows
external assets only if they are CC0 (Poly Haven, ambientCG, Kenney). The repository had no asset tooling, adding
dependencies needs owner approval, and the game is a PWA whose service worker precaches the build.

## Options

1. Add `@gltf-transform/cli` and `sharp` as dev dependencies: standard tools, but new dependencies and native builds.
2. A self-contained Node script (curl + ffmpeg) with its own glTF -> GLB packer: no npm changes, enough for Poly
   Haven's single-buffer glTF files.
3. Commit hand-downloaded files with no script: no provenance, no reproducibility.

## Decision

Option 2: `scripts/fetch-cc0.mjs` reads `assets-src/cc0.sources.json`, refuses anything not CC0, converts textures to
WebP (models embed them through `EXT_texture_webp`, glass transmission stripped), loudness-normalises music to MP3, and
writes `packages/game/src/assets/cc0/manifest.json` plus `docs/assets/credits.md`. `tests/asset-manifest.test.ts`
checks every shipped file against the manifest (licence, hash, size) and a 32 MB repository budget.

## Consequences

- New assets are one line in the sources file plus a re-run; provenance is always recorded.
- Props (.glb) and loops (.mp3) are lazy and not precached by the service worker (they fail soft); surface sets are
  precached because scene readiness waits on them.
- The packer handles one-buffer glTF only (true for Poly Haven); other sources need a check or option 1.
- Babylon deep imports mean every glTF extension used must be imported explicitly (`EXT_texture_webp`).
