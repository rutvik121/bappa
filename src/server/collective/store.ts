/**
 * Where the collective lives.
 *
 * Server only. Everything under src/server is reached from route handlers
 * and nowhere else -- it reads credentials and it is the thing a browser
 * is not allowed to be.
 *
 * Two implementations behind one interface. Redis (Vercel KV or Upstash,
 * spoken to over their REST protocol with plain `fetch`, exactly as the
 * tally already was) is the real one: serverless instances share nothing
 * but this, so it is what makes the state canonical rather than
 * per-instance.
 *
 * The in-memory one is not a stub. `next dev` is a single process, so two
 * browser windows genuinely share it -- which is what lets the collective
 * experience be developed and tested end to end with no Redis at all. It
 * is refused in production, where there would be one of it per instance
 * and "collective" would quietly mean "collective among whoever landed on
 * the same lambda".
 */

export interface StoredEvent {
  seq: number;
  /** Semantic, never pixels. See events.ts for the shapes. */
  body: string;
}

export interface CollectiveStore {
  /** Whether this is genuinely shared between everyone, or dev-local. */
  readonly shared: boolean;
  readonly kind: 'redis' | 'memory';

  offerings(): Promise<number>;
  addOffering(): Promise<number>;
  setOfferings(n: number): Promise<number>;

  /**
   * Takes a builder rather than a string: the sequence number is part of
   * what is being written, so it has to exist before the body does.
   */
  append(build: (seq: number) => string): Promise<number>;
  since(seq: number, limit: number): Promise<StoredEvent[]>;
  head(): Promise<number>;

  /**
   * First caller with a given key wins and gets null; every later caller
   * gets whatever the winner stored. This is the whole of the duplicate
   * defence -- see `state.ts`.
   */
  claim(key: string, value: string, ttlSeconds: number): Promise<string | null>;

  /** Overwrites a key the caller has already claimed. */
  put(key: string, value: string, ttlSeconds: number): Promise<void>;

  /** Returns how many hits this bucket has used within the window. */
  bump(bucket: string, windowSeconds: number): Promise<number>;
}

/* ------------------------------------------------------------------ */
/* Redis                                                              */
/* ------------------------------------------------------------------ */

const KEY_COUNT = 'bappa:offerings';
const KEY_SEQ = 'bappa:seq';
const KEY_LOG = 'bappa:log';

/**
 * How much history is kept for reconnecting clients. A client that has
 * been away longer than this is told to take a fresh snapshot instead,
 * which is cheaper than replaying and is the correct answer anyway: the
 * state it needs is the current one, not the path taken to it.
 */
const LOG_LENGTH = 256;

interface Redis {
  url: string;
  token: string;
}

function redisConfig(): Redis | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

async function command(r: Redis, ...parts: (string | number)[]): Promise<unknown> {
  // The path form keeps this dependency-free. Values go in the body so a
  // stored event is never length-capped or mangled by URL encoding.
  const [head, ...rest] = parts.map(String);
  const res = await fetch(`${r.url}/${[head, ...rest].map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${r.token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const body = (await res.json()) as { result?: unknown };
  return body.result;
}

const num = (v: unknown) => Number(v ?? 0) || 0;

function redisStore(r: Redis): CollectiveStore {
  return {
    shared: true,
    kind: 'redis',

    offerings: async () => num(await command(r, 'get', KEY_COUNT)),
    addOffering: async () => num(await command(r, 'incr', KEY_COUNT)),
    setOfferings: async (n) => {
      await command(r, 'set', KEY_COUNT, String(Math.max(0, Math.floor(n))));
      return Math.max(0, Math.floor(n));
    },

    append: async (build) => {
      // Sequence first, so an event can never claim a number twice even if
      // the write below fails: a gap is recoverable, a collision is not.
      const seq = num(await command(r, 'incr', KEY_SEQ));
      await command(r, 'lpush', KEY_LOG, JSON.stringify({ seq, body: build(seq) }));
      await command(r, 'ltrim', KEY_LOG, 0, LOG_LENGTH - 1);
      return seq;
    },

    since: async (seq, limit) => {
      const raw = (await command(r, 'lrange', KEY_LOG, 0, LOG_LENGTH - 1)) as string[] | null;
      if (!Array.isArray(raw)) return [];
      const out: StoredEvent[] = [];
      // Stored newest-first; walk back to oldest and keep what is new.
      for (let i = raw.length - 1; i >= 0; i--) {
        try {
          const e = JSON.parse(raw[i]) as StoredEvent;
          if (e.seq > seq) out.push(e);
        } catch {
          // A malformed entry is skipped rather than breaking the stream.
        }
      }
      return out.slice(0, limit);
    },

    head: async () => num(await command(r, 'get', KEY_SEQ)),

    claim: async (key, value, ttlSeconds) => {
      const ok = await command(r, 'set', key, value, 'nx', 'ex', String(ttlSeconds));
      // Upstash answers OK on a win and null when the key already existed.
      if (ok) return null;
      const existing = await command(r, 'get', key);
      return typeof existing === 'string' ? existing : '';
    },

    put: async (key, value, ttlSeconds) => {
      await command(r, 'set', key, value, 'ex', String(ttlSeconds));
    },

    bump: async (bucket, windowSeconds) => {
      const used = num(await command(r, 'incr', bucket));
      // Expiry set on first use only, so the window slides from the first
      // hit rather than being pushed out by every one after it.
      if (used === 1) await command(r, 'expire', bucket, String(windowSeconds));
      return used;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Memory                                                             */
/* ------------------------------------------------------------------ */

interface Memory {
  count: number;
  seq: number;
  log: StoredEvent[];
  claims: Map<string, { value: string; expires: number }>;
  buckets: Map<string, { used: number; expires: number }>;
}

/**
 * Survives the module reloads that `next dev` does on every edit, so the
 * collective does not reset under you while you are working on it.
 */
const globalMemory = globalThis as typeof globalThis & { __bappa?: Memory };

function memory(): Memory {
  globalMemory.__bappa ??= {
    count: 0,
    seq: 0,
    log: [],
    claims: new Map(),
    buckets: new Map(),
  };
  return globalMemory.__bappa;
}

function memoryStore(): CollectiveStore {
  return {
    shared: false,
    kind: 'memory',

    offerings: async () => memory().count,
    addOffering: async () => ++memory().count,
    setOfferings: async (n) => (memory().count = Math.max(0, Math.floor(n))),

    append: async (build) => {
      const m = memory();
      const seq = ++m.seq;
      m.log.push({ seq, body: build(seq) });
      if (m.log.length > LOG_LENGTH) m.log.splice(0, m.log.length - LOG_LENGTH);
      return seq;
    },

    since: async (seq, limit) => memory().log.filter((e) => e.seq > seq).slice(0, limit),

    head: async () => memory().seq,

    claim: async (key, value, ttlSeconds) => {
      const m = memory();
      const now = Date.now();
      const hit = m.claims.get(key);
      if (hit && hit.expires > now) return hit.value;
      m.claims.set(key, { value, expires: now + ttlSeconds * 1000 });
      return null;
    },

    put: async (key, value, ttlSeconds) => {
      memory().claims.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    },

    bump: async (bucket, windowSeconds) => {
      const m = memory();
      const now = Date.now();
      const hit = m.buckets.get(bucket);
      if (!hit || hit.expires <= now) {
        m.buckets.set(bucket, { used: 1, expires: now + windowSeconds * 1000 });
        return 1;
      }
      hit.used += 1;
      return hit.used;
    },
  };
}

/* ------------------------------------------------------------------ */

let warned = false;

export function getStore(): CollectiveStore {
  const r = redisConfig();
  if (r) return redisStore(r);

  if (process.env.NODE_ENV === 'production' && !warned) {
    warned = true;
    // Loud, because the failure is silent otherwise: the piece would look
    // like it worked and quietly give every instance its own Bappa.
    console.warn(
      '[bappa] No KV/Upstash credentials. Falling back to per-instance memory: ' +
        'the collective state is NOT shared. Set KV_REST_API_URL/KV_REST_API_TOKEN.'
    );
  }

  return memoryStore();
}
