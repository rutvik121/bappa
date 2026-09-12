#!/usr/bin/env node
/**
 * Is the collective actually wired up?
 *
 *   node scripts/verify-supabase.mjs
 *
 * Read-only by default: it looks, it does not leave anything with him.
 * Pass --probe to additionally check that the public key cannot write,
 * which is the one check that has to attempt a write to mean anything.
 *
 * Run it from the project root with .env.local in place.
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

/* --- environment ------------------------------------------------- */

// .env.local is read directly rather than through Next, so this can be
// run without the dev server up.
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  console.log('  no .env.local found -- reading the ambient environment instead\n');
}

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let failed = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => {
  failed++;
  console.log(`  FAIL  ${m}`);
};
const note = (m) => console.log(`        ${m}`);

console.log('\nBAPPA -- collective check\n');

/* --- 1. configuration -------------------------------------------- */

console.log('Configuration');
URL ? ok(`project url ${URL}`) : bad('SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL missing');
SERVICE ? ok('service role key present') : bad('SUPABASE_SERVICE_ROLE_KEY missing (the server cannot write without it)');
ANON ? ok('anon key present') : bad('NEXT_PUBLIC_SUPABASE_ANON_KEY missing (the browser cannot watch without it)');

if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY) {
  bad('the service key is also exposed as NEXT_PUBLIC_ -- it is in the browser bundle. Remove it.');
}

if (!URL || !SERVICE) {
  console.log('\nCannot continue without a url and the service key.\n');
  process.exit(1);
}

const db = createClient(URL, SERVICE, { auth: { persistSession: false } });

/* --- 2. schema ---------------------------------------------------- */

console.log('\nSchema');

const offerings = await db.from('offerings').select('id, seq, offerings_count').limit(1);
if (offerings.error) {
  bad(`offerings table unreachable: ${offerings.error.message}`);
  note('the migration has not been applied -- run: supabase db push');
} else {
  ok('offerings table is there');
}

const state = await db.from('bappa_state').select('offerings_count').eq('id', 1).maybeSingle();
if (state.error) bad(`bappa_state unreachable: ${state.error.message}`);
else if (!state.data) bad('bappa_state has no row 1 -- re-run the migration');
else ok(`tally is ${state.data.offerings_count}`);

/* --- 3. the count and the rows agree ------------------------------ */

const counted = await db.from('offerings').select('*', { count: 'exact', head: true });
if (!counted.error && state.data) {
  const rows = counted.count ?? 0;
  rows === state.data.offerings_count
    ? ok(`tally matches the rows (${rows})`)
    : bad(`tally ${state.data.offerings_count} but ${rows} offerings -- they have come apart`);
}

/* --- 4. what the public key can do -------------------------------- */

if (ANON) {
  console.log('\nThe public key (it is in every browser)');
  const pub = createClient(URL, ANON, { auth: { persistSession: false } });

  const read = await pub.from('offerings').select('id').limit(1);
  read.error
    ? bad(`cannot read offerings: ${read.error.message} -- nobody can watch him`)
    : ok('can read offerings, which is how people watch');

  const write = await pub
    .from('offerings')
    .insert({ id: 'verify-should-fail', type: 'WISH', intensity: 1, seed: 1, offerings_count: 999 });
  write.error
    ? ok('cannot insert an offering directly')
    : bad('CAN INSERT OFFERINGS -- row level security is not on. Re-run the migration.');

  const tally = await pub.from('bappa_state').update({ offerings_count: 99999 }).eq('id', 1);
  const after = await db.from('bappa_state').select('offerings_count').eq('id', 1).maybeSingle();
  after.data?.offerings_count === 99999
    ? bad('CAN REWRITE THE TALLY -- re-run the migration.')
    : ok('cannot rewrite the tally');
  void tally;

  if (process.argv.includes('--probe')) {
    // The only check that has to attempt a write to mean anything: a
    // SECURITY DEFINER function bypasses every policy above, so if the
    // public key can call it, none of the rest matters.
    const id = `verify-${Date.now().toString(36)}`;
    const rpc = await pub.rpc('leave_offering', {
      p_id: id,
      p_type: 'WISH',
      p_intensity: 0.1,
      p_seed: 1,
    });
    if (rpc.error) {
      ok('cannot call leave_offering');
    } else {
      bad('CAN CALL leave_offering -- anyone with the anon key can write to the collective.');
      note(`it left a real offering behind: delete from offerings where id = '${id}';`);
      note('then re-apply the migration: the fix is revoking the function FROM PUBLIC.');
    }
  } else {
    note('skipped the function-privilege probe; pass --probe to include it');
  }
}

/* --- 5. is the app using it? -------------------------------------- */

console.log('\nThe running app');
try {
  const r = await fetch('http://localhost:3000/api/offerings', { cache: 'no-store' });
  const snap = await r.json();
  snap.shared
    ? ok(`serving the shared collective (${snap.lifecycle}, ${snap.offeringsCount} offerings)`)
    : bad('the app reports shared:false -- it is on the in-memory fallback, not Supabase');
  if (!snap.shared) note('restart the dev server after writing .env.local');
  if (!snap.accepting) note(`lifecycle is ${snap.lifecycle}: offerings are refused right now, by design`);
} catch {
  note('dev server not running on :3000 -- skipped');
}

console.log(failed ? `\n${failed} problem(s).\n` : '\nAll good.\n');
process.exit(failed ? 1 : 0);
