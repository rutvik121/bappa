import { supabaseConfig, supabaseStore } from './supabase';

/**
 * Where the collective lives.
 *
 * Server only. Everything under src/server is reached from route handlers
 * and nowhere else -- it reads credentials and it is the thing a browser
 * is not allowed to be.
 *
 * Three implementations behind one interface.
 *
 * Supabase is the real one. Postgres can count an offering and record it
 * in a single statement and deduplicate it on a primary key, which is one
 * indivisible operation where every other backend here needs three
 * carefully sequenced ones. Its realtime is also what lets a browser
 * watch Bappa without anything being polled on its behalf.
 *
 * Redis remains for a deploy that already had it, and speaks the same
 * REST protocol the tally always did.
 *
 * Memory is not a stub. `next dev` is a single process, so two browser
 * windows genuinely share it -- which is what lets the collective be
 * developed and tested end to end with no account anywhere. It is refused
 * in production, where there would be one of it per instance and
 * "collective" would quietly mean "among whoever hit the same lambda".
 */

/** One offering, as any store hands it back. */
export interface OfferingRecord {
  id: string;
  /** The order everyone presents them in. */
  seq: number;
  type: string;
  intensity: number;
  seed: number;
  /** The tally this offering produced. */
  offeringsCount: number;
  createdAt: number;
}

export interface CollectiveStore {
  /** Whether this is genuinely shared between everyone, or dev-local. */
  readonly shared: boolean;
  readonly kind: 'supabase' | 'redis' | 'memory';

  /**
   * Count, record and deduplicate, indivisibly.
   *
   * An id already recorded comes back untouched with `duplicate` set: the
   * caller gets the answer it got the first time and the tally does not
   * move. Everything about retries, double clicks and refreshes mid-send
   * reduces to this one call.
   */
  leaveOffering(o: {
    id: string;
    type: string;
    intensity: number;
    seed: number;
  }): Promise<{ record: OfferingRecord; duplicate: boolean }>;

  offerings(): Promise<number>;
  setOfferings(n: number): Promise<number>;

  /** Offerings after `seq`, oldest first. */
  since(seq: number, limit: number): Promise<OfferingRecord[]>;
  /** The latest sequence number, or 0. */
  head(): Promise<number>;

  /** Hits this bucket has used inside its window. */
  bump(bucket: string, windowSeconds: number): Promise<number>;

  /**
   * Let go of everything but the number.
   *
   * Called once he is gone. What survives is how many people left
   * something with him -- the aggregate the piece is actually about,
   * which identifies nobody. What goes is every individual offering and
   * every rate-limit bucket. Idempotent, so it can be reached from a
   * request path without being scheduled.
   */
  dissolve(): Promise<void>;
}

/**
 * How much history is kept for a reconnecting client. Further behind than
 * this and the right answer is a fresh snapshot, not a replay: what it
 * needs is where he is, not the path taken to get there.
 */
export const LOG_LENGTH = 256;

/* ------------------------------------------------------------------ */
/* Redis                                                              */
/* ------------------------------------------------------------------ */

const KEY_COUNT = 'bappa:offerings';
const KEY_SEQ = 'bappa:seq';
const KEY_LOG = 'bappa:log';

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
  const res = await fetch(`${r.url}/${parts.map(String).map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${r.token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const body = (await res.json()) as { result?: unknown };
  return body.result;
}

const num = (v: unknown) => Number(v ?? 0) || 0;

function redisStore(r: Redis): CollectiveStore {
  const IDEMPOTENCY_TTL = 900;

  return {
    shared: true,
    kind: 'redis',

    leaveOffering: async (o) => {
      const key = `bappa:submit:${o.id}`;

      // Redis cannot do this in one step, so it is done in the only order
      // that is safe: claim the id first, and only count an offering that
      // won its claim. A loser reads back the winner's record.
      const won = await command(r, 'set', key, 'pending', 'nx', 'ex', String(IDEMPOTENCY_TTL));

      if (!won) {
        const existing = await command(r, 'get', key);
        const parsed = typeof existing === 'string' ? safeParse<OfferingRecord>(existing) : null;
        if (parsed) return { record: parsed, duplicate: true };
        // The winner is still in flight. Its record is what should come
        // back, so this is reported as a duplicate with nothing to show.
        throw new PendingError();
      }

      const offeringsCount = num(await command(r, 'incr', KEY_COUNT));
      const seq = num(await command(r, 'incr', KEY_SEQ));

      const record: OfferingRecord = {
        id: o.id,
        seq,
        type: o.type,
        intensity: o.intensity,
        seed: o.seed,
        offeringsCount,
        createdAt: Date.now(),
      };

      await command(r, 'lpush', KEY_LOG, JSON.stringify(record));
      await command(r, 'ltrim', KEY_LOG, 0, LOG_LENGTH - 1);
      // Plain set, not another claim: claiming again would find our own
      // 'pending' marker and leave it, and no retry could ever replay.
      await command(r, 'set', key, JSON.stringify(record), 'ex', String(IDEMPOTENCY_TTL));

      return { record, duplicate: false };
    },

    offerings: async () => num(await command(r, 'get', KEY_COUNT)),

    setOfferings: async (n) => {
      const count = Math.max(0, Math.floor(n));
      await command(r, 'set', KEY_COUNT, String(count));
      return count;
    },

    since: async (seq, limit) => {
      const raw = (await command(r, 'lrange', KEY_LOG, 0, LOG_LENGTH - 1)) as string[] | null;
      if (!Array.isArray(raw)) return [];
      const out: OfferingRecord[] = [];
      // Stored newest-first; walk back so the result is oldest-first.
      for (let i = raw.length - 1; i >= 0; i--) {
        const rec = safeParse<OfferingRecord>(raw[i]);
        if (rec && rec.seq > seq) out.push(rec);
      }
      return out.slice(0, limit);
    },

    head: async () => num(await command(r, 'get', KEY_SEQ)),

    bump: async (bucket, windowSeconds) => {
      const used = num(await command(r, 'incr', bucket));
      // Expiry on first use only, so the window slides from the first hit
      // rather than being pushed out by every one after it.
      if (used === 1) await command(r, 'expire', bucket, String(windowSeconds));
      return used;
    },

    dissolve: async () => {
      // The log and the idempotency keys go; the tally stays. Rate-limit
      // buckets expire on their own within the hour.
      await command(r, 'del', KEY_LOG);
      await command(r, 'del', KEY_SEQ);
    },
  };
}

/** A retry that arrived while the first attempt was still being written. */
export class PendingError extends Error {
  constructor() {
    super('offering in flight');
  }
}

/* ------------------------------------------------------------------ */
/* Memory                                                             */
/* ------------------------------------------------------------------ */

interface Memory {
  count: number;
  seq: number;
  log: OfferingRecord[];
  byId: Map<string, OfferingRecord>;
  buckets: Map<string, { used: number; expires: number }>;
}

/** Survives the module reloads `next dev` does on every edit. */
const globalMemory = globalThis as typeof globalThis & { __bappa?: Memory };

function memory(): Memory {
  globalMemory.__bappa ??= {
    count: 0,
    seq: 0,
    log: [],
    byId: new Map(),
    buckets: new Map(),
  };
  return globalMemory.__bappa;
}

function memoryStore(): CollectiveStore {
  return {
    shared: false,
    kind: 'memory',

    leaveOffering: async (o) => {
      const m = memory();

      const prior = m.byId.get(o.id);
      if (prior) return { record: prior, duplicate: true };

      // Single-threaded, so this genuinely is atomic here.
      const record: OfferingRecord = {
        id: o.id,
        seq: ++m.seq,
        type: o.type,
        intensity: o.intensity,
        seed: o.seed,
        offeringsCount: ++m.count,
        createdAt: Date.now(),
      };

      m.byId.set(o.id, record);
      m.log.push(record);
      if (m.log.length > LOG_LENGTH) m.log.splice(0, m.log.length - LOG_LENGTH);

      return { record, duplicate: false };
    },

    offerings: async () => memory().count,
    setOfferings: async (n) => (memory().count = Math.max(0, Math.floor(n))),

    since: async (seq, limit) => memory().log.filter((e) => e.seq > seq).slice(0, limit),
    head: async () => memory().seq,

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

    dissolve: async () => {
      const m = memory();
      m.log.length = 0;
      m.byId.clear();
      m.buckets.clear();
      // m.count is deliberately kept: he was made by this many people,
      // and that stays true after he has gone.
    },
  };
}

/* ------------------------------------------------------------------ */

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

let warned = false;

/**
 * Supabase where it is configured, Redis for a deploy that already had
 * it, memory for development.
 */
export function getStore(): CollectiveStore {
  const s = supabaseConfig();
  if (s) return supabaseStore(s);

  const r = redisConfig();
  if (r) return redisStore(r);

  if (process.env.NODE_ENV === 'production' && !warned) {
    warned = true;
    // Loud, because the failure is silent otherwise: the piece would look
    // like it worked and quietly give every instance its own Bappa.
    console.warn(
      '[bappa] No Supabase or KV credentials. Falling back to per-instance memory: ' +
        'the collective state is NOT shared. Set SUPABASE_URL + ' +
        'SUPABASE_SERVICE_ROLE_KEY (see supabase/schema.sql).'
    );
  }

  return memoryStore();
}
