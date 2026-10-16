/** The guest engine's decoder, backed by the session client's own codec (C057): the signature check and the decrypt are the ones the client uses. */
import type { FrameCodec, SequencedFrame } from '@centcom/net';
import type { Frame } from '@centcom/protocol';
import type { DecodeResult, FrameDecoder } from './session.js';

export function codecDecoder(codec: Pick<FrameCodec, 'decode'>): FrameDecoder {
  return {
    decode(f: Frame): DecodeResult {
      const d = codec.decode(f as unknown as SequencedFrame);
      if (d.ok) return { kind: 'ok', frame: { ...f, k: d.event.kind, ...(d.event.p !== undefined ? { p: d.event.p } : {}), secret: d.event.secret ?? null } as never };
      return d.reason === 'unknown_kid' ? { kind: 'wait_key' } : { kind: 'drop', reason: d.reason };
    },
  };
}
