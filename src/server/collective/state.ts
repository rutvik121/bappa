import { getStore } from './store';
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

/** How long a submission key is remembered. Comfortably past any retry. */
const IDEMPOTENCY_TTL_SECONDS = 900;

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

  // A retry, a double click, a refresh mid-submission: all of them arrive
  // with the same key, and all of them get the first answer back rather
  // than a second offering.
  const claimKey = `bappa:submit:${submissionId}`;
  const existing = await store.claim(claimKey, 'pending', IDEMPOTENCY_TTL_SECONDS);
  if (existing !== null) {
    const replayed = safeParse<OfferingEvent>(existing);
    const snapshot = await getSnapshot();
    // A finished one replays exactly. 'pending' means the first attempt is
    // still in flight and there is no answer yet to give -- said plainly,
    // so the client knows this is its own offering arriving twice and not
    // a refusal it should react to.
    return replayed
      ? { ok: true, offering: replayed, snapshot, duplicate: true }
      : { ok: false, reason: 'duplicate', snapshot };
  }

  const used = await store.bump(`bappa:rate:${ip}`, RATE_WINDOW_SECONDS);
  if (used > RATE_LIMIT) {
    return { ok: false, reason: 'throttled', snapshot: await getSnapshot() };
  }

  const count = await store.addOffering();

  const offering: OfferingEvent = {
    id: submissionId,
    seq: 0,
    type: type as OfferingType,
    createdAt: when.now,
    intensity: clamp01(asNumber(input.intensity, 0.5)),
    seed: Math.floor(asNumber(input.seed, Math.random() * 2 ** 31)) >>> 0,
    formationTarget: progressFor(when.day, when.lifecycle, count),
  };

  const formationProgress = offering.formationTarget;

  // The sequence is part of the event, so it is stamped onto the offering
  // before the body is written rather than after -- serialising first left
  // every broadcast offering claiming seq 0.
  offering.seq = await store.append((seq) => {
    offering.seq = seq;
    return JSON.stringify({
      kind: 'OFFERING_RECEIVED',
      offering,
      offeringsCount: count,
      formationProgress,
    } satisfies CollectiveEvent);
  });

  // Remember the whole answer, so a retry replays it exactly rather than
  // being refused or -- far worse -- counted again. `put`, not `claim`:
  // claiming again would find our own 'pending' marker and leave it.
  await store.put(claimKey, JSON.stringify(offering), IDEMPOTENCY_TTL_SECONDS);

  return { ok: true, offering, snapshot: await getSnapshot(), duplicate: false };
}

/** Development only: stand the collective at a given tally. */
export async function setOfferings(n: number): Promise<BappaSnapshot> {
  await getStore().setOfferings(n);
  return getSnapshot();
}

export async function eventsSince(seq: number): Promise<{ events: CollectiveEvent[]; seq: number; gap: boolean }> {
  const store = getStore();
  const head = await store.head();

  // Further behind than the log goes: there is nothing useful to replay,
  // and the right answer is the current state, not the path to it.
  if (head - seq > MAX_CATCHUP) return { events: [], seq: head, gap: true };

  const stored = await store.since(seq, MAX_CATCHUP);
  const events: CollectiveEvent[] = [];
  for (const e of stored) {
    const parsed = safeParse<CollectiveEvent>(e.body);
    if (parsed) events.push(parsed);
  }

  return { events, seq: stored.length ? stored[stored.length - 1].seq : head, gap: false };
}

/* ------------------------------------------------------------------ */

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

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
