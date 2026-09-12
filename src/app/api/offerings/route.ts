import { NextResponse, type NextRequest } from 'next/server';
import { getSnapshot, submitOffering } from '@/server/collective/state';

/**
 * Leaving something with him, and asking how he is.
 *
 * GET is the snapshot a client starts from and resynchronises to. POST is
 * the only way an offering enters the collective, and it is the server
 * that decides whether it did -- a browser cannot announce that the tally
 * moved, it can only ask.
 *
 * What crosses this boundary is a type, an intensity and a seed. Never the
 * words: they are sampled into particles in the browser and wiped in the
 * same breath, and nothing here has ever been able to read them.
 */

export const dynamic = 'force-dynamic';

const noStore = { headers: { 'Cache-Control': 'no-store' } };

export async function GET() {
  return NextResponse.json(await getSnapshot(), noStore);
}

export async function POST(req: NextRequest) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // An empty or malformed body is simply an invalid offering.
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  const result = await submitOffering(
    {
      submissionId: input.submissionId,
      type: input.type,
      intensity: input.intensity,
      seed: input.seed,
    },
    ip
  );

  if (!result.ok) {
    // The snapshot rides along even on a refusal: a throttled or late
    // visitor should still see Bappa exactly as everyone else does.
    const status =
      result.reason === 'invalid'
        ? 400
        : result.reason === 'closed'
          ? 409
          : // A duplicate still in flight is not an error the caller did:
            // its first attempt is working, and it should simply wait.
            result.reason === 'duplicate'
            ? 202
            : 429;
    return NextResponse.json(
      { ok: false, reason: result.reason, snapshot: result.snapshot },
      { ...noStore, status }
    );
  }

  return NextResponse.json(
    { ok: true, offering: result.offering, snapshot: result.snapshot, duplicate: result.duplicate },
    noStore
  );
}
