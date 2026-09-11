# BAPPA 2026 — The Internet's Ganpati

A full-screen WebGL installation built around the supplied `ganpati.glb`.
The 3D scene is the product; the interface appears only when it must.

```bash
npm install
npm run dev      # http://localhost:3000
```

## The asset

`public/models/ganpati.glb` is the file you provided, copied verbatim from
`UP2ZNtEwny.glb`. It is never regenerated or procedurally rebuilt.

A single Tripo mesh: 22,282 vertices / 19,242 triangles, one baked JPEG
base-colour map, `metalness 0`, `roughness 0.9`. At ~1 MB it is already
mobile-appropriate, so it ships uncompressed rather than paying the
runtime cost of a Draco/Meshopt decoder for a file this small.

At load the mesh is cloned, normalised to 2.3 world units tall, centred on
X/Z, rested at `y=0`, and yawed −90° (the asset is authored facing +X; a
quarter turn the other way presents the back of the mukut, which reads as
plausible until you notice there is no trunk). Its
material is rebuilt as fired clay and its vertex positions double as the
source for the Visarjan fragments.

## Architecture

Each system is independent, reads the scene state, and talks to the others
through narrow imperative handles rather than React state — so nothing
re-renders during the ritual.

| Module | Responsibility |
| --- | --- |
| `state/sceneState.ts` | The six-state machine, and the only place the contribution text ever lives |
| `systems/perf.ts` | Device tiering → DPR caps, particle budgets, feature flags |
| `systems/ParticleSystem.ts` | Framework-free SoA particle pool (offerings + fragments) |
| `components/GanpatiModel` | Loads, normalises and re-materials the GLB; hosts the dissolve shader |
| `components/LightingSystem` | Key / rim / fill / ambient |
| `components/CameraController` | One camera position per state, critically damped |
| `components/ParticleField` | GPU-facing wrapper + point-sprite shader |
| `components/SmokeSystem` | Instanced incense billboards |
| `components/DustField` | Ambient motes, animated entirely in the vertex shader |
| `components/ContributionController` | The ritual clock; turns a submission into matter |
| `components/DissolveController` | The Visarjan timeline |
| `state/collective.ts` | The offering tally |
| `state/formation.ts` | How completely Bappa has formed, from day + offerings |
| `systems/SurfaceSampler.ts` | Bakes the formation weight every system reads |
| `systems/FormationCloud.ts` | The material he is made of — GPU-animated points |
| `state/festival.ts` | The ten-day window and the countdown |
| `dev/*` | Development panel and frame stats — excluded from production |
| `app/api/offerings` | The shared tally: one number, read and incremented |
| `systems/TextSampler.ts` | Renders the text offscreen and samples its glyphs to points |
| `components/AbsorptionLight` | Warm light driven by the rate of absorption |
| `audio/events.ts` | The experience event bus — the only thing that triggers sound |
| `audio/AudioManager` | One listener; decides what every event sounds like |
| `ui/Overlay` | The entire interface |

## Privacy

The contributed text is held in memory only. On submission it is hashed to
a single float, which biases the emission shape, and the string is wiped in
the same call. It is never rendered back, persisted, or transmitted, and
nothing downstream can recover a word of it.

## Particles

One pool, one draw call, no per-particle objects and no allocation after
construction. The simulation runs on the CPU because the behaviours are
stateful and narrative — a vighna fragment has to *decide* to break apart,
which a stateless GPGPU pass models badly. Cost is bounded by the tier
budget.

Each particle carries position, velocity, size, opacity, lifetime, noise
phase, attraction, type and intensity. Behaviour by type:

- **Gratitude** — already warm; drifts inward and gathers.
- **Wish** — buoyant; rises, and attraction takes over as it climbs.
- **Vighna** — dark, heavy, erratic; resists, then breaks apart on a timer
  and warms as it is drawn in. Transmuted, not destroyed.
- **Promise** — expands outward on a slow envelope before committing
  inward, like something taking root.

Once a particle is close and warm enough it is absorbed into the
**collective**: a shared slow orbit where every offering looks alike. That
is where individual identity is lost. The collective is seeded at boot, so
a visitor arriving at IDLE is already looking at what others left.

## The contribution becoming matter

Submitting is the one moment the interface and the scene share a frame, so
the handoff is built to be literal rather than symbolic.

1. **Sampled.** `TextSampler` draws the text once to an offscreen canvas
   and reads back the glyph coverage. It renders far larger than the
   on-screen size -- coverage scales with the square of the font size, and
   at display size a short phrase yields only a couple of hundred samples,
   nowhere near enough to read as letters. Points are normalised to the
   ink's own bounding box.
2. **Placed.** The sampled points are cast through the camera onto a plane
   2.3 units out, using the input's real `getBoundingClientRect()`. Going
   through the camera rather than fixed world coordinates means the
   particles register with the fading DOM text at any viewport or focal
   length. That registration is the whole illusion.
3. **Assembled.** Particles spawn scattered and converge onto their glyph
   point, so the words condense out of the dark instead of being stamped
   there. Meanwhile the DOM text fades out faster than a normal layer, so
   the two cross-fade.
4. **Held**, about two seconds -- long enough to recognise what was just
   written.
5. **Released.** The shape breathes apart and each particle takes on its
   offering type's behaviour. This is the moment the text stops being text.
6. **Absorbed.** Particles are taken in within a tight radius of the
   sculpture, so the offering is seen to reach Bappa rather than fade in
   the air near him. Each arrival feeds `absorbGlow`, which drives
   `AbsorptionLight` -- a warm light inside the body that swells with the
   rate of arrivals and settles as they thin.

Grain size is deliberate: `pointSize = size * (viewportHeight * 0.03) / depth`
lands around 2-4px, just under the average spacing of the sampled points.
Coarser and the letterforms merge into a smear; at the 1px floor they
vanish. Both failure modes were hit while building this.

The text is still read exactly once and wiped in the same call. What is
briefly legible is legible only to its author, on their own screen, for
about two seconds.

## The first five seconds

The wordmark alone never answered "what is this?" — it named the thing
without saying what it does. The landing now states the mechanism, in a
strict editorial hierarchy and with no cards, panels or navigation.

```
BAPPA 2026

A Ganpati built by everyone
on the Internet.

Leave a wish, gratitude, an obstacle or a promise.
It becomes part of him.

        [ Leave something with Bappa ]
        1,204 offerings have become part of him.

09 DAYS
11 HOURS
59 MINUTES
9 days left to build him
```

The primary statement is the only copy given real presence, and it is
set in sentence case rather than the letterspaced caps used for the
brand, so it reads as a sentence and not as a label. *The Internet's
Ganpati* is gone from the first screen; it was a descriptor standing
where an explanation needed to be.

**It steps back once it has been read.** After 5.5 seconds of inactivity
the secondary line and the countdown dim and the primary statement drops
to a quieter weight — enough that Bappa is what is left, never so much
that a returning eye cannot read it. Any pointer movement brings it back.

**The countdown** is cornered and quiet: no boxes, no colons, no seconds
ticking. It carries the stakes — there is a limited time in which anyone
can still add to him — without reading as a promotional timer. The label
under it is contextual, and on the final day stops counting altogether:

| | |
| --- | --- |
| day 1 | 9 days left to build him |
| day 5 | 5 days left to build him |
| day 9 | 1 day left to build him |
| day 10 | today, we let him go |

### One clock

`state/festival.ts` owns `FESTIVAL_START`, `FESTIVAL_END`, `VISARJAN_TIME`,
`getFestivalStatus()` and `getCountdown()`. Nothing else computes a date.
The countdown, the day-to-formation mapping and the automatic Visarjan
all read the same shifted clock, so the development day controls move the
copy, the countdown and the sculpture together rather than letting them
disagree.

On mobile the statement keeps the top and stays readable, and the
countdown gives up its corner to become one horizontal line above the
call to action — a stacked clock in a corner competes with the sculpture
at that width, and at 13vh it landed directly on top of the CTA.

## Ten days, and a collective

Bappa is not delivered whole and he is not faded in. He is **made of the
particles**: each one carries a piece of his surface, and the sculpture
appears exactly where enough material has arrived to carry it.

```
day 1     a body of clay dust in his shape; first solid clay at the base
day 3     the dust thickens into material; hands and pedestal go solid
day 5     torso, arms and base are clay; the crown is still suspension
day 8     nearly whole; only the last details still hanging
day 10    fired clay, no dust — a handcrafted murti
```

**One number decides everything.** `SurfaceSampler` bakes a *formation
weight* onto every vertex and every sampled point — 0 exists from the
first moment, 1 is the last thing to appear. The material and the clay
read the same value, so a grain vanishes at the instant the surface it
was carrying arrives underneath it. Nothing crossfades and no second
model is swapped in.

**Material occupies the volume from the first morning.** A grain is
visible while its piece of surface is *not yet* clay, not once it has
been earned — so day one is a Ganpati-shaped body of suspended clay dust
with a little solid clay at the base, rather than an empty stage. Far
from its moment a grain is a faint dark suspension; near it, it gathers,
warms toward terracotta, and is replaced by the sculpture. Spread is tiny
(a few hundredths of a unit in the mesh's local space) because anything
wider stops holding the silhouette and becomes a cloud around him.

There is no contour, wireframe or outline pass. An early version drew
one and it read as a technical scan of a model rather than as something
being made — the dust body carries the silhouette instead.

That also removed the noise from the fragment shader entirely: the carve
is now `if (vFormWeight > uFormation) discard`, an attribute read instead
of an fbm, which is both exact and markedly cheaper on a phone.

**Formation runs in reverse for free.** Visarjan is the same axis walked
backwards — `if (vFormWeight > 1.0 - uDissolve) discard` — so the last
things to form are the first to let go. One material system, both
directions.

**Weights are mostly noise, lightly height-biased.** A pure height order
would show a visitor on day one a pair of feet; mostly-noise scatters
material across the whole form so the silhouette reads as a Ganpati from
the first morning, while the height term keeps the crown and ear tips as
the last things to finish.

**Sampling is area-weighted, not per-vertex.** The asset is densely
tessellated around the face and ornaments and sparse across the broad
forms; sampling vertices would pile material onto the detail and leave
the body bare.

**Cost.** The cloud is animated entirely in the vertex shader from two
uniforms — target positions are static in the buffer — so 34,000 points
are one draw call and zero per-frame CPU work. Budgets are 7k / 16k / 34k
by tier.

### How formation is computed

`state/formation.ts`:

- the **calendar** guarantees he is whole by the tenth day
- the **offerings** get him there sooner, and fuller in the meantime

```
formation = max( byDay, 0.35·byDay + 0.75·byOfferings )   // floored at 0.08
```

`max` rather than a sum, deliberately: the calendar is a floor the crowd
can beat, not a quota they have to meet. On any day but the last, what
the crowd has left is the difference between a sketch and a sculpture —
so offerings are never decorative — but nobody arriving on day ten finds
him unfinished because turnout was low.

`byOfferings` uses the same front-loaded `pow(count/target, 0.6)` curve as
the tally, so the first hundred people watch him visibly take shape.

### An offering joins the sculpture

An arriving offering does not join a field *around* Bappa. It picks a
point on his actual surface, sinks into it, warms to the colour of the
clay, and is gone. The ambient orbiting shell that used to represent past
offerings has been removed — how many there have been is now expressed by
how much of him exists, which is the truer answer and one fewer thing on
screen.

### The shared tally

`/api/offerings` holds one number for everyone: `GET` reads it, `POST`
adds one. It speaks Upstash's REST protocol with plain `fetch`, so it
works with a Vercel KV store or a standalone Upstash one and pulls in no
dependency for it.

Only the *number* ever crosses that boundary. No text, no type, no
identity -- which is exactly what makes a shared counter safe to run.

**Configure it** by provisioning a KV / Upstash Redis store and connecting
it to the project. The integration sets either `KV_REST_API_URL` +
`KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`;
either pair works.

**Without a store the app still runs.** The route answers `shared: false`,
and the client falls back to counting in `localStorage` -- each visitor
builds their own Bappa. That is an explicit signal rather than an error,
because the alternative is a deploy that silently reports zero offerings
forever.

**Rate limited** to 20 offerings per address per hour. Bappa is built by a
crowd; without a limit one person with a loop could finish him in a minute
and take that from everyone else. A throttled visitor still gets the true
count back, so they see Bappa exactly as everyone else does.

### The clock

`state/festival.ts` derives everything from one configured instant, so every
visitor on every device sees the same countdown. When the ten days close,
visarjan begins on its own -- polled on a slow interval rather than per
frame, so it still fires in a tab that is getting no frames. It waits for
anyone mid-offering to finish rather than dissolving Bappa out from under
them.

The status line under the wordmark carries the only two facts a visitor
needs: how many people have given him form, and how long he is here.

Configure both in `.env.local` -- see `.env.example`. **Lower
`NEXT_PUBLIC_BAPPA_TARGET` to a handful while developing**, or each
submission moves the sculpture by a fraction of a percent.

## The four offerings

Four different motion models, not one model with four colours. What a
person feels they did is carried almost entirely by how the material
behaves on the way in, so each type differs in acceleration, timing,
where on him it lands, and whether it has a turn in it.

| | motion | lands |
| --- | --- | --- |
| **Gratitude** | calm, low velocity. Velocity perpendicular to the line of travel is bled away each frame, so the grains fall in behind one another and arrive as a single soft stream rather than a crowd | his centre |
| **Wish** | rises before it goes anywhere. Attraction stays weak while buoyancy is strong, so the path is a climb that bends rather than a line that sags | the crown |
| **Vighna** | the only one with a turn in it: heavy and reluctant, drawn to *its own knot* rather than to Bappa, then a short outward crack, then the fastest travel of the four. What was heavy becomes the thing that moves most freely | his centre |
| **Promise** | grows in discrete steps, changing direction at each one, so the path branches instead of curving. Slowest of the four, and it starts small and thickens | the base |

### The arrival

An offering reaching him is the payoff, so it is not a disappearance.
Each arrival records where it entered, in world space, into a six-slot
ring the material reads. The clay lights **at that point on its own
surface** — a small warm bloom that rises fast, lets go slowly, and
spreads slightly as it fades, the way heat moves into a body rather than
sitting on it. It is the sculpture that brightens; there is no orb and no
lamp. Roughly a second, then gone.

## Visarjan

Not a separate effect, and deliberately not a second particle system.
It is the formation system run backwards: the same weight that decided
when a piece of him arrived decides when it lets go, so the last thing to
form is the first to leave.

```
0–3s    stillness — he is whole and nothing moves at all
3–10    first release: crown, ear tips, the edges of the cloth
10–24   material breakdown; solidity leaves the body
24–33   particle Bappa — the silhouette is his, the substance is material again
33–40   HELD. seven seconds where he barely changes
40–50   release; the material stops holding the shape and drifts
50–58   light, then nothing (the last light is gone at ~57.2; sound is cut there)
58–60   darkness and silence
60.5+   the closing words
```

**The hold is the point.** The curve almost stops between 33 and 40
seconds because a Bappa made entirely of the material that built him is
the image the whole piece has been arguing toward, and running through it
at the same rate as everything else threw it away.

**He does not move during the stillness.** The environmental breathing is
switched off the moment Visarjan begins, not faded with the dissolve —
letting it run through the hold made it read as a pause in an animation
rather than as the room going quiet to look at him.

**The last grains go out one at a time.** Each carries its own release
duration rather than a shared one, so the tail is ragged instead of the
whole system switching off together. The spread is capped at 0.34: the
final grain lets go at dissolve 1.0 and the curve ends at 1.34, so
anything longer leaves something faintly alight after the darkness has
started — which is the one thing this sequence may not do.

**Nothing is left running.** Once every system is at zero the render loop
is stopped outright (`frameloop: 'never'`); the closing words are plain
DOM and need no canvas. Kept running when the development panel is
enabled, or scrubbing back would find a frozen frame.

### Arriving late

Nothing is permanent is the promise the piece makes, so a visitor who
arrives after the window has closed does not get to watch it happen —
that would make the ending a recording. On the first read of the clock,
if the festival is already over, the experience opens at the darkness
with only the closing words. He is gone, and what is here is what was
said afterwards. There is no archive and no replay.

**Nothing of his outlives him.** Every Bappa-related system is driven to
zero: formation material, offerings still in flight, the absorption glow,
the incense and the dust. Two details that make that a guarantee rather
than a tendency:

- Dissolve runs past 1, to **1.34**. At 1 the last clay is gone, but
  material that just came away still needs time to drift out and fade.
  Stopping at 1 is exactly what used to leave particles hanging in the
  air after he had gone.
- Atmosphere extinction is computed **directly from elapsed**, not eased
  toward a target. An easing only reaches zero if enough frames happen to
  be drawn, and "nothing remains" has to be a guarantee.

## Sound

A Ganeshotsav, heard. The audience is Indian, so every sound is one a
visitor already knows from a pandal or a puja: tanpura and bansuri in the
hall, the pandal outside at night, marigold petals and akshata on a thali,
a ghanti, a temple ghanta, dhol and tasha, a coconut broken as an
offering, a shankh. Nothing is decoration — each sound is tied to
something the material is doing.

### Seven layers, never all at once

```
SPACE           bhakti music (tanpura, bansuri, Raag Hansadhwani) + the pandal at night
OFFERING        a puja sound for each offering, from its gathering to its contact
TRANSFORMATION  the moment a thing stops being what it was (the coconut, the bansuri)
BAPPA           the temple ghanta, heard only when something becomes part of him
VISARJAN        a dhol-tasha procession that carries him, then recedes as he dissolves
SILENCE         a state: every bus cut, every source stopped, context released
```

### Sound follows the simulation

Nothing is on a timer. `SoundDirector` reads the state machine, the
particle system's **telemetry** and the dissolve value every frame and
emits experience events. `AudioManager` is the only thing that makes
sound. Every level and curve is in `audio/score.ts`.

```
SPACE_SHIFT                 the camera moved through the room
OFFERING_STARTED            submitted; nothing has moved yet
OFFERING_GATHERING          material condensing into the words
OFFERING_TRANSFORMED        the words begin to let go
OFFERING_TRAVELLING         every grain is on its way
OFFERING_MOTION             every frame: gather, speed, proximity, density,
                            rise, arrival rate, crack rate, growth, pan
OFFERING_BREAK              vighna's knot cracks (first visible cracks)
OFFERING_CONTACT            first grain enters the clay   ← the important one
OFFERING_ABSORBED           he has taken it in
VISARJAN_STARTED / _MATERIAL_RELEASE / _DISSOLVE / _PARTICLE_RELEASE
VISARJAN_COMPLETE           the last light is gone
FINAL_MESSAGE               the closing words begin
```

The mappings are deliberately unshowy: grain density *is* the rate the
words are condensing; the carrier opens with speed; a wish's pitch climbs
with the particles' vertical velocity and settles as they slow; Bappa's
body resonates sympathetically as an offering nears him (proximity²); a
vighna's friction loses weight in exact proportion to the share of
fragments that have cracked; absorption grains follow the arrival rate.

`OFFERING_CONTACT` fires **on the frame the simulation moved the first
grain into him** — the same frame its light is lit on the clay. The
bridge is mounted after the particle field and the dissolve controller
so it reads this frame, not the last.

### Each offering, as a puja

```
START → GATHER → TRANSFORM → TRAVEL → CONTACT → ABSORPTION → RESONANCE → room
```

| | as the words gather | as they let go / travel | contact |
| --- | --- | --- | --- |
| Gratitude | marigold petals on a thali | — (the music steps back) | a small brass ghanti |
| Wish | ghungroo shimmer | a bansuri phrase rising with the particles | a high temple bell |
| Vighna | heavy dhol knocks | a low dhol roll that lightens as fragments crack; a coconut broken at the crack | a dhol boom |
| Promise | a diya being lit | a tabla heartbeat that fades as it stops growing | a short shankh |

As grains enter him, **akshata falls on the thali** at exactly the rate
they arrive. All four resolve into **the same temple ghanta** — one still
ringing is let go, never stacked, and it rings a little fuller and further
as he is built. The bhakti music ducks for every offering and returns
after the ghanta.

### The assets

22 files in `public/audio` (~2.8 MB, the two music pieces are most of it),
**generated with Magnific** (ElevenLabs music and sound effects). The raw
downloads live in `scripts/sound/source`; `npm run sound:prepare`
(`scripts/sound/prepare-assets.mjs`, needs ffmpeg) turns them into
instruments — onsets moved to sample zero so a contact is never behind
the picture, loops made seamless with long crossfades (five seconds for
the music, so the seam is a phrase dissolving into another), levels
normalised, lower storage rates for sounds with no top end — and writes
`audio/assets.ts`, the manifest the engine reads.

To replace a sound, drop a new file into `scripts/sound/source` under the
same name and run the script again. The sources are excluded from deploys.

The hall's reverb is generated at runtime rather than downloaded: a
diffuse impulse whose highs die first, shorter on low-power devices.

**Any asset can be missing.** A failed fetch or decode makes that one
sound silent and changes nothing else.

### The mix

Measured from offline renders: the bhakti music sits around **-32 dBFS**
RMS and steps back 7 dB for every offering. Gathering sounds peak around
**-16 to -19**, contacts around **-12 to -13**, the ghanta around **-14**;
vighna, the heaviest, reaches **-10.5**. The procession peaks around
**-11**, the final shankh around **-15**. After each offering the ghanta
rings out and the music returns, so the rhythm is still event → resonance
→ room. A limiter sits on the master as a safety.

### Autoplay, mobile, mute

Bytes are fetched 1.5 s after load; no `AudioContext` exists until the
**first meaningful gesture anywhere** (pointer up, touch end, key, click),
where it is created, resumed, and a silent sample is played — which is
what releases the output on iOS. The room then arrives from silence: the
pandal outside first, the tanpura and bansuri a moment later, and then one
distant temple ghanta. One control, `SOUND ON` / `SOUND OFF`, in the
corner; it goes when Visarjan begins. A hidden tab suspends. Everything
visual works with sound off.

### Visarjan

A procession, and then its absence. Every Visarjan level is a curve over
dissolve, not time, so the dhol-tasha moves exactly as he does:

```
stillness        the bhakti music stops; only the pandal, very low
first release    the dhol-tasha pathak arrives and builds
breakdown        full procession; clay crumbling away from the murti
particle Bappa   the procession carries him
release          gulal thrown as he lets go; the dhol-tasha recedes —
                 quieter, darker, more distant — as the particles drift off
nothing          at the last light: every bus and the reverb tail cut in
                 milliseconds, every source stopped. Digital silence.
```

Silence holds through the darkness and the first four lines. One shankh,
far away across the water, sounds as GANPATI BAPPA MORYA appears, and when
it has rung out the context is suspended. Its timing is read from
`ui/farewell.ts`, the same schedule that sets each line's fade, so
retiming a line moves both.

A visitor who arrives after the ending hears nothing, even if they tap:
the manager tracks that he is gone before any context exists.

### Auditioning

`/dev/sound` (development only) renders the real simulation, director and
mix offline — entry, each offering, four offerings in a row, and the whole
Visarjan — for listening with the picture off.
`?auto=all&sink=http://127.0.0.1:4599` posts the WAVs and an event log to
a local sink for measurement.

## Pacing

The motion principle is stillness → event → stillness, and the one place
it was missing was the most important: submitting used to spawn material
on the same frame as the click, which read as a UI response. There is now
a deliberate beat of nothing first, and the whole choreography runs 5.4
seconds before anything travels.

During an offering the room stands back — dust drops to a quarter, the
audio ducks — so the contribution is the only thing moving in the frame.

During Visarjan the interface is **unmounted**, not faded. The layers hide
themselves with a delayed `visibility` transition, and a transition that
stalls leaves the wordmark sitting over the darkness. From the moment he
begins to leave, this is a film, so it has to be a certainty rather than
an animation.

## Performance

Tier is decided once at boot from core count, device memory, pointer type
and a WebGL renderer probe that catches software rasterisers.

| | low | mid | high |
| --- | --- | --- | --- |
| DPR cap | 1.25 | 1.75 | 2 |
| Offering particles | 1,400 | 3,200 | 6,000 |
| Dust | 350 | 700 | 1,400 |
| Fragments | 3,000 | 7,000 | 14,000 |
| Shadows / post | off | on | on |

A runtime watchdog drops a tier after four sustained seconds below ~22 fps.
Only atmosphere thins — Bappa's material, lighting and silhouette are never
downgraded. Three.js and the GLB are lazy-loaded behind a dynamic import,
so the first load is 89 kB and the black ground paints immediately.

## Tuning

The values most worth pushing on:

- `GanpatiModel.tsx` — `TARGET_HEIGHT`, material colour/roughness
- `LightingSystem.tsx` — light positions, colours, intensities
- `CameraController.tsx` — the `SHOTS` table: one entry per state
- `DissolveController.tsx` — `CURVE`, the Visarjan keyframes
- `Experience.tsx` — `toneMappingExposure`

One thing learned the hard way and worth preserving: the key light is warm
*white*, not orange. A warm light multiplied against a warm terracotta
albedo compounds, crushes green and blue, and turns the clay flat red. Let
the material carry the colour.
