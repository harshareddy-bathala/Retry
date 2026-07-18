import type { ZodType } from 'zod';
import { clientMessageSchema, serverMessageSchema } from './events.js';
import type { ClientMessage, ServerMessage } from './events.js';

// An unparseable message must be dropped with a logged warning, never crash
// the connection — so these helpers never throw. Callers check `ok`, log
// `error` on failure, and drop the frame.

export type ParseResult<T> = { ok: true; message: T } | { ok: false; error: string };

export type RawMessage = string | ArrayBuffer | Uint8Array;

function decode(raw: RawMessage): string {
  if (typeof raw === 'string') return raw;
  return new TextDecoder().decode(raw);
}

function parseWith<T>(schema: ZodType<T>, raw: RawMessage): ParseResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(decode(raw));
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => i.message).join('; ') };
  }
  return { ok: true, message: result.data };
}

/** Server-side: validate an inbound frame from a client. */
export function parseClientMessage(raw: RawMessage): ParseResult<ClientMessage> {
  return parseWith(clientMessageSchema, raw);
}

/** Client-side: validate an inbound frame from the server. */
export function parseServerMessage(raw: RawMessage): ParseResult<ServerMessage> {
  return parseWith(serverMessageSchema, raw);
}
