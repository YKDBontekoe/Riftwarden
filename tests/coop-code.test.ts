// Co-op join box: a pasted invite link yields its room code.
import { describe, expect, it } from 'vitest';
import { codeFromPaste } from '../apps/client/src/ui/Coop';

describe('codeFromPaste', () => {
  it('takes the code from an invite link', () => {
    expect(codeFromPaste('https://play.example/#/join/ab12cd')).toBe('AB12CD');
    expect(codeFromPaste('https://play.example/?join=XY99ZZ&x=1')).toBe('XY99ZZ');
  });
  it('normalizes a bare code', () => {
    expect(codeFromPaste(' ab-12 cd ')).toBe('AB12CD');
  });
});
