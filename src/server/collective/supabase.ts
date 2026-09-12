import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import type { CollectiveStore, OfferingRecord } from './store';

/**
 * The collective, in Postgres.
 *
 * Server only, and with the service key: it is the one thing allowed to
 * write. Row-level security leaves the public key able to read offerings
 * and nothing else, which is what stops a browser announcing that the
 * tally moved.
 *
 * Two things here were bugs in the Redis version and are constraints in
 * this one. Counting and recording an offering are a single statement
 * rather than three, so they cannot come apart; and the order every
 * client presents offerings in is a database sequence rather than a
 * counter this process increments and then hopes to write alongside.
 *
 * See supabase/schema.sql -- the interesting half lives there.
 */

/** Named, so a schema change cannot silently widen what is read. */
const COLUMNS = 'id, seq, type, intensity, seed, offerings_count, created_at';

interface Row {
  id: string;
  seq: number | string;
  type: string;
  intensity: number;
  seed: number | string;
  offerings_count: number;
  created_at: string;
}

export function supabaseConfig() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

/**
 * A salt keeps a rate-limit bucket from being a lookup table for "was
 * this address here". Unsalted, the hash would still hide the address
 * from anyone reading the row, which is the main thing; salted, it does
 * not survive being compared against a list of guesses either.
 */
const IP_SALT = process.env.BAPPA_IP_SALT ?? 'bappa-2026';

export function hashAddress(ip: string): string {
  return createHash('sha256').update(`${IP_SALT}:${ip}`).digest('hex').slice(0, 32);
}

function toRecord(row: Row): OfferingRecord {
  return {
    id: row.id,
    seq: Number(row.seq),
    type: row.type,
    intensity: Number(row.intensity),
    seed: Number(row.seed),
    offeringsCount: row.offerings_count,
    createdAt: new Date(row.created_at).getTime(),
  };
}

export function supabaseStore(config: { url: string; key: string }): CollectiveStore {
  const db: SupabaseClient = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    shared: true,
    kind: 'supabase',

    leaveOffering: async (o) => {
      // Asked first so `duplicate` is honest. The function would answer
      // the same either way -- an id it has seen returns its original row
      // and does not move the tally -- but the caller wants to know.
      const prior = await db.from('offerings').select(COLUMNS).eq('id', o.id).maybeSingle();
      if (prior.data) return { record: toRecord(prior.data as Row), duplicate: true };

      const { data, error } = await db.rpc('leave_offering', {
        p_id: o.id,
        p_type: o.type,
        p_intensity: o.intensity,
        p_seed: o.seed,
      });

      if (error || !data) throw new Error(`leave_offering: ${error?.message ?? 'no row'}`);

      const row = (Array.isArray(data) ? data[0] : data) as Row;
      return { record: toRecord(row), duplicate: false };
    },

    offerings: async () => {
      const { data } = await db
        .from('bappa_state')
        .select('offerings_count')
        .eq('id', 1)
        .maybeSingle();
      return data?.offerings_count ?? 0;
    },

    setOfferings: async (n) => {
      const count = Math.max(0, Math.floor(n));
      await db.from('bappa_state').update({ offerings_count: count }).eq('id', 1);
      return count;
    },

    /**
     * The offerings table is its own log. There is no second place events
     * are written, so there is nothing that can disagree with it.
     */
    since: async (seq, limit) => {
      const { data } = await db
        .from('offerings')
        .select(COLUMNS)
        .gt('seq', seq)
        .order('seq', { ascending: true })
        .limit(limit);
      return ((data ?? []) as Row[]).map(toRecord);
    },

    head: async () => {
      const { data } = await db
        .from('offerings')
        .select('seq')
        .order('seq', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ? Number(data.seq) : 0;
    },

    dissolve: async () => {
      // Idempotent in the database: it stamps the moment on the first
      // call and does nothing on every call after, so this can be reached
      // from a request path without being scheduled or coordinated.
      const { error } = await db.rpc('dissolve_offerings');
      if (error) throw new Error(`dissolve_offerings: ${error.message}`);
    },

    bump: async (bucket, windowSeconds) => {
      const { data, error } = await db.rpc('bump_rate', {
        p_bucket: bucket,
        p_seconds: windowSeconds,
      });
      // Failing open is the right way round here: a database hiccup
      // should not be what refuses someone's offering.
      if (error) return 1;
      return Number(data) || 1;
    },
  };
}
