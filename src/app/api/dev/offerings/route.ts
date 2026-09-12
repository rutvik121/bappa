import { NextResponse, type NextRequest } from 'next/server';
import { setOfferings } from '@/server/collective/state';

/**
 * Standing the collective at a chosen tally, so any point in the ten days
 * can be looked at without waiting for it or faking a crowd.
 *
 * Refused outright in production. The tally is the one number that
 * decides how much of Bappa exists, so a route that sets it is a route
 * that rewrites him -- it exists for the development panel and nothing
 * else, and it must not be reachable on a deploy even by accident.
 */

export const dynamic = 'force-dynamic';

function enabled() {
  return process.env.NODE_ENV !== 'production' || process.env.BAPPA_DEV === '1';
}

export async function POST(req: NextRequest) {
  if (!enabled()) return NextResponse.json({ ok: false }, { status: 404 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // Handled as an invalid count below.
  }

  const count = Number((body as { count?: unknown } | null)?.count);
  if (!Number.isFinite(count) || count < 0) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  return NextResponse.json(
    { ok: true, snapshot: await setOfferings(Math.floor(count)) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
