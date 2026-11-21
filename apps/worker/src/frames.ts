// Length-prefixed frames on a stream socket: [u32 big-endian length][payload].
export const MAX_FRAME = 16 * 1024 * 1024;

export function frame(payload: Uint8Array): Buffer {
  const out = Buffer.allocUnsafe(4 + payload.length);
  out.writeUInt32BE(payload.length, 0);
  out.set(payload, 4);
  return out;
}

/** Feeds chunks, yields complete payloads; throws on an oversized frame. */
export class FrameReader {
  private buf: Buffer = Buffer.alloc(0);
  push(chunk: Buffer): Uint8Array[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: Uint8Array[] = [];
    while (this.buf.length >= 4) {
      const n = this.buf.readUInt32BE(0);
      if (n > MAX_FRAME) throw new Error(`frame too large (${n} bytes)`);
      if (this.buf.length < 4 + n) break;
      out.push(new Uint8Array(this.buf.subarray(4, 4 + n)));
      this.buf = this.buf.subarray(4 + n);
    }
    return out;
  }
}
