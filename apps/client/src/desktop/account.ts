import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';

export async function desktopSignIn(): Promise<void> {
  const url = await invoke<string>('desktop_sign_in');
  await openUrl(url);
  for (let attempt = 0; attempt < 150; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (await invoke<boolean>('desktop_poll_sign_in')) return;
  }
  throw new Error('Sign-in timed out. Try again.');
}

export async function desktopSignOut(): Promise<void> {
  await invoke('desktop_forget_session');
}

export async function manageAccount(): Promise<void> {
  await openUrl('https://riftwarden.ykdbonte.dev/#/account');
}
