/** Header carrying the write key for mutating routes. */
export const ORCHARD_KEY_HEADER = "x-orchard-key";

/** Shared demo write-key (override per backend via the ORCHARD_KEY env var). */
export const ORCHARD_KEY = "let-me-in-please";

/** One fixed port per target, so all six can run side by side. */
export const PORTS = {
  elysia: 3001,
  h3: 3002,
  hono: 3003,
  "nitro-h3": 3004,
  "nitro-hono": 3005,
  "nitro-elysia": 3006,
} as const;

export type Target = keyof typeof PORTS;
