import { getStore, PendingError, type OfferingRecord } from './store';
import { hashAddress } from './supabase';
import { festivalNow, FESTIVAL_DAYS, TARGET_OFFERINGS } from './config';
import {
  formationFrom,
  isOfferingType,
  type BappaSnapshot,
  type CollectiveEvent,
  type OfferingEvent,
  type OfferingType,
} from '@/shared/collective';

/**
 * The one canonical Bappa.
 *
 * Everything a client is allowed to believe about him is computed here:
 * how far he has formed, what day it is, whether he is still accepting
 * anything. A browser may say what it wants -- it cannot say how built he
 * is, and it cannot say the festival is over.
 */

/** Offerings one address may leave per window. */
const RATE_LIMIT = 20;
const RATE_WINDOW_SECONDS = 3600;

/**
 * Addresses are hashed before they are used as a bucket, so limiting
 * abuse does not require keeping a record of who was here.
 */
function rateBucket(ip: string): string {
  return `bappa:rate:${hashAddress(ip)}`;
}

/** Most events a reconnecting client is given before it is told to resync. */
export const MAX_CATCHUP = 64;

export async function getSnapshot(): Promise<BappaSnapshot> {
  const store = getStore();
  const when = festivalNow();

  const [offeringsCount, seq] = await Promise.all([store.offerings(), store.head()]);

  return {
    lifecycle: when.lifecycle,
    festivalDay: when.day,
    offeringsCount,
    formationProgress: progressFor(when.day, when.lifecycle, offeringsCount),
    accepting: when.accepting,
    seq,
    now: when.now,
    startsAt: when.startsAt,
    endsAt: when.endsAt,
    shared: store.shared,
    offeringTarget: TARGET_OFFERINGS,
    festivalDays: FESTIVAL_DAYS,
  };
}

/**
 * Before he arrives he is as he will be on the first morning; once the
 * window closes he is whole, and the visarjan takes him from there.
 */
function progressFor(day: number, lifecycle: string, offerings: number): number {
  if (lifecycle === 'PRE_LAUNCH') return formationFrom(1, 0, TARGET_OFFERINGS, FESTIVAL_DAYS);
  if (lifecycle === 'VISARJAN' || lifecycle === 'COMPLETED') return 1;
  return formationFrom(day, offerings, TARGET_OFFERINGS, FESTIVAL_DAYS);
}

export type SubmitResult =
  | { ok: true; offering: OfferingEvent; snapshot: BappaSnapshot; duplicate: boolean }
  | { ok: false; reason: 'closed' | 'throttled' | 'invalid' | 'duplicate'; snapshot: BappaSnapshot };

export interface SubmitInput {
  /** Client-generated, stable across retries of the same submission. */
  submissionId: unknown;
  type: unknown;
  intensity: unknown;
  seed: unknown;
}

/**
 * Leave something with him.
 *
 * The order matters. Validity, then the window, then the duplicate check,
 * and only then the rate limit -- so a retry of an accepted offering
 * returns the original answer instead of burning another slot against the
 * limit and then being refused.
 */
export async function submitOffering(input: SubmitInput, ip: string): Promise<SubmitResult> {
  const store = getStore();
  const when = festivalNow();

  const submissionId = cleanId(input.submissionId);
  const type = input.type;
  if (!submissionId || !isOfferingType(type)) {
    return { ok: false, reason: 'invalid', snapshot: await getSnapshot() };
  }

  // Nothing further may be left with him once he has started to go: it
  // could never become part of him.
  if (!when.accepting) {
    return { ok: false, reason: 'closed', snapshot: await getSnapshot() };
  }

  const used = await store.bump(rateBucket(ip), RATE_WINDOW_SECONDS);
  if (used > RATE_LIMIT) {
    return { ok: false, reason: 'throttled', snapshot: await getSnapshot() };
  }

  const intensity = clamp01(asNumber(input.intensity, 0.5));
  const seed = Math.floor(asNumber(input.seed, Math.random() * 2 ** 31)) >>> 0;

  // Counted, recorded and deduplicated in one call. A retry of an id
  // already here comes back as the original, and the tally does not move.
  let accepted;
  try {
    accepted = await store.leaveOffering({ id: submissionId, type, intensity, seed });
  } catch (e) {
    // The first attempt at this id is still being written. Its answer is
    // the one that counts, so this is said plainly rather than as a
    // refusal the client should react to.
    if (e instanceof PendingError) {
      return { ok: false, reason: 'duplicate', snapshot: await getSnapshot() };
    }
    throw e;
  }

  return {
    ok: true,
    offering: toEvent(accepted.record, when.day, when.lifecycle),
    snapshot: await getSnapshot(),
    duplicate: accepted.duplicate,
  };
}

/** Development only: stand the collective at a given tally. */
export async function setOfferings(n: number): Promise<BappaSnapshot> {
  await getStore().setOfferings(n);
  return getSnapshot();
}

export async function eventsSince(
  seq: number
): Promise<{ events: CollectiveEvent[]; seq: number; gap: boolean }> {
  const store = getStore();
  const when = festivalNow();
  const head = await store.head();

  // Further behind than the log goes: there is nothing useful to replay,
  // and the right answer is the current state, not the path to it.
  if (head - seq > MAX_CATCHUP) return { events: [], seq: head, gap: true };

  const records = await store.since(seq, MAX_CATCHUP);

  const events: CollectiveEvent[] = records.map((r) => ({
    kind: 'OFFERING_RECEIVED',
    offering: toEvent(r, when.day, when.lifecycle),
    offeringsCount: r.offeringsCount,
    formationProgress: progressFor(when.day, when.lifecycle, r.offeringsCount),
  }));

  return { events, seq: records.length ? records[records.length - 1].seq : head, gap: false };
}

/* ------------------------------------------------------------------ */

/**
 * A stored offering as everyone else learns about it.
 *
 * Formation is resolved at read time rather than stored on the row: it is
 * a function of the tally and the day, and the day moves without any
 * offering being made. Computing it here keeps one definition of the
 * curve -- the shared one -- and means a row written on day three still
 * reads correctly on day nine.
 */
function toEvent(r: OfferingRecord, day: number, lifecycle: string): OfferingEvent {
  return {
    id: r.id,
    seq: r.seq,
    type: r.type as OfferingType,
    createdAt: r.createdAt,
    intensity: r.intensity,
    seed: r.seed,
    formationTarget: progressFor(day, lifecycle, r.offeringsCount),
  };
}

function cleanId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // Opaque to us, but it becomes a storage key, so it is kept to a shape
  // that cannot escape into one.
  const trimmed = v.trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(trimmed) ? trimmed : null;
}

function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}
