# Desktop client (Tauri 2, signed updates)

> Summary written from the code when the docs were reorganised (2026-11-27); extend it when you work on the desktop shell.

- **Shell**: `apps/client/src-tauri/` wraps the production client build (`frontendDist: ../../../dist`; dev uses
  `pnpm dev` on :5173). Version comes from the root `package.json`. Bundles: NSIS (Windows, offline WebView installer),
  DMG/app (macOS). CSP in `tauri.conf.json` allows only the app, the local proxy, the production API and GitHub release
  downloads.
- **Local API proxy** (`src-tauri/src/main.rs`): at start the app binds an axum server on `127.0.0.1:<random port>`
  under a random path secret. `/{secret}/session` bridges the WebSocket and `/{secret}/*` proxies HTTP to the production
  API, attaching the session cookie, which is kept in the OS keyring (`dev.ykdbonte.riftwarden` / `session`), never in the
  webview. Credentialed CORS preflights reflect the requested method and headers; wildcard methods or headers cause
  `tower-http` to abort during startup.
- **Sign-in** (passkeys cannot run in the webview): commands `desktop_sign_in` (returns a browser URL for a short-lived,
  proof-bound approval, `crates/gateway/src/auth/desktop.rs`), `desktop_poll_sign_in` (the client polls every 2 s for up
  to 5 min, `apps/client/src/desktop/account.ts`), `desktop_forget_session`. Account management opens the website.
- **Updates**: `@tauri-apps/plugin-updater` checks `latest.json` on the GitHub release; artifacts are signed with the
  updater key (`plugins.updater.pubkey`); `apps/client/src/desktop/update.ts` + `DesktopUpdate.tsx` show the download /
  relaunch flow. `isDesktop()` = `'__TAURI_INTERNALS__' in window`.
- **CI**: `.github/workflows/desktop-check.yml` (build check) and `desktop-release.yml` (signed release; needs the updater
  signing key secret; macOS may be ad-hoc signed).
- **Tests**: `src-tauri/src/cors.rs` (credentialed proxy preflight), `tests/desktop-update.test.ts`,
  `crates/gateway/tests/auth.rs` (desktop approval flow).
- **Not done yet**: nothing recorded yet.
