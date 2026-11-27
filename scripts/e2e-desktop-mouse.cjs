// Exercise the native-capture integration through the real HQ UI with a simulated native mouse backend.
// The AppKit event monitor itself requires a macOS device.
const H = require('./lib/harness.cjs');
const { check, waitFor, ev, stats } = H;

(async () => {
  const { b, p } = await H.launch();
  try {
    await ev(p, () => {
      const input = window.__rift.flow.input;
      input.forceCapture = false;
      window.__nativeTest = { moves: null, lost: null, stops: 0 };
      input.nativeMouse = {
        start: async (move, lost) => { window.__nativeTest.moves = move; window.__nativeTest.lost = lost; return true; },
        stop: () => { window.__nativeTest.stops++; },
      };
    });
    await p.locator('button.deploy').click();
    await waitFor(p, () => window.__rift.state().screen === 'home' && window.__rift.flow.input.captured);
    const result = await ev(p, () => {
      const R = window.__rift;
      const yaw = R.home.player.yaw;
      const start = R.home.player.position.clone();
      window.__nativeTest.moves(80, 0);
      R.flow.input.simulateKey('KeyW', true);
      R.advance(1);
      R.flow.input.simulateKey('KeyW', false);
      return { turned: R.home.player.yaw !== yaw, walked: R.home.player.position.subtract(start).length() > 0.1 };
    });
    check('native capture enables HQ mouse look', result.turned);
    check('native capture enables HQ movement', result.walked);
    await p.keyboard.press('Escape');
    await waitFor(p, () => window.__rift.state().screen === 'paused');
    check('Escape releases native capture', await ev(p, () => !window.__rift.flow.input.captured && window.__nativeTest.stops === 1));
    await p.getByTestId('pause-resume').click();
    await waitFor(p, () => window.__rift.state().screen === 'home' && window.__rift.flow.input.captured);
    await ev(p, () => window.__nativeTest.lost());
    await waitFor(p, () => window.__rift.state().screen === 'paused');
    check('losing native capture pauses the game', await ev(p, () => !window.__rift.flow.input.captured));
  } finally {
    await b.close();
  }
  if (stats.failures) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
