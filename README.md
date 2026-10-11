# PacePath

A running-route library for one metro area, built by its runners. Browse and filter loops,
see a real difficulty score and time estimates for your level, then race the course
against everyone who has run it.

Expo (React Native + TypeScript) app, with Supabase (Postgres) as the shared backend.

## How it works

| Rule | Value | Where |
| --- | --- | --- |
| A free run is saved as a new route if it is at least | **3 mi** | `src/core/rules.ts`, `src/run/sync.ts` |
| A route becomes visible to everyone at | **10 mi, or 5 completions** | `rules.ts` + SQL trigger `attempts_after_insert` |
| To start a course attempt you must be within | **20 ft of the start** | `CourseTracker.begin` |
| Going this far off course pauses the attempt | **0.2 mi** | `CourseTracker.update` |
| To resume, get back within | **20 ft of the course** (near where you left it) | `CourseTracker.update` |

- **Routes.** Every free run is stored on the phone (SQLite, one row per GPS fix). When it ends,
  if it's 3+ miles it's uploaded as a private route, with that run counted as its first completion.
  Each valid completion after that counts too. At 5 completions, or immediately if it's 10+ miles,
  the route becomes public.
- **Times.** Each route shows the average time, your best, and the course record with the
  holder's name. When someone beats the record, the new time shows for everyone.
- **Staying on course.** Progress along a course counts only in order, and only by about the
  distance you actually ran, so cutting across a loop doesn't count. Once you've covered 0.2 mi
  off course, the attempt pauses and you get a notification. It resumes when you're back within
  20 ft of the course near where you left it. **The clock keeps running while paused**, so a
  detour never makes you faster. If you stop while paused or before the finish, the attempt
  doesn't count for that course. The GPS track is still saved on the phone.
- **After the run.** You see your time first, then a "🏆 New course record!" or "🔥 Personal
  best!" badge if you earned one. Grading takes at most two taps: tap a star, then tap
  Easier / About right / Harder. "Done" is always one tap away.

### Verified results

The phone checks the rules live so it can warn you in the moment, but **the server decides what
counts.** Every course run and every new route uploads its raw GPS track to the `runs` edge
function. That function replays the track through the same `src/core` code the app uses and
computes the time, distance and difficulty itself. Before that, it rejects tracks that don't look
like running:

| Check | Rejects |
| --- | --- |
| Teleports | More than 200 m (or 2% of the run) covered by jumps faster than 12.5 m/s |
| Sustained speed | Any 60-second stretch averaging over 8 m/s (≈ 3:21 /mi): bikes and cars |
| Mock location | Any GPS fix flagged as coming from a location-spoofing app (Android) |
| Timestamps | Missing, out of order, or in the future |

Clients can't write attempts or routes directly; the database only accepts them from the
verifier. Each attempt keeps a simplified copy of its track for audits and disputes.

### Watches & other apps

Watch GPS is usually more accurate than a phone's, so runs from watches can count too:

| Source | How | Covers |
| --- | --- | --- |
| **Apple Health** (iOS) | Pick a recent run in the app | Apple Watch, plus Garmin, COROS, Polar, Suunto and others that sync workouts with routes to Health |
| **Strava** | Automatic (webhook) when you upload a run, or pick one in the app | Any device that syncs to Strava, including Garmin on Android |
| **GPX file** | Import a file | Anything that exports GPX (Garmin Connect, COROS, ...) |

An imported run isn't started at a course start, so the server looks for every point where the
track passes within 20 ft of a course's start. It interpolates between GPS fixes there, since
watches often record a fix only every few seconds. From each of those points it replays the course
rules. Warm-ups before the start are fine, and each lap of a loop counts. If an imported run
doesn't match any course and it's 3+ miles, it becomes a new route, the same rule as a free run in
the app.

If the same run arrives twice, for example tracked by the phone for the live off-course warnings
and also by the watch, it's counted once, and the watch's track replaces the phone's.

**Garmin directly:** Garmin's Activity API is only available to companies approved for the
Garmin Connect Developer Program, and it delivers data by webhook to a business backend. Until
PacePath is approved, Garmin runs come in through Apple Health or Strava sync, which Garmin
Connect supports natively. Once approved, a direct integration would be another webhook source
for the same `importTrack` pipeline. Only the code that fetches and parses Garmin's data would be
new.

### Difficulty score

Each route's difficulty comes from its **flat-equivalent distance**, the flat distance that
takes the same effort:

1. Take elevation from a terrain model (Open-Meteo's Copernicus 90 m DEM, sampled every 25 m
   along the route) when the route is created. This way a route's climb doesn't depend on whose
   phone recorded it. If the lookup fails, it falls back to GPS altitude. Smooth the elevation (60 m moving window, with a 2 m threshold before a climb or descent
   counts) so altitude noise doesn't add fake climbing.
2. Weight each segment by the energy cost of running at its grade, from Minetti et al. (2002):
   `C(i) = 155.4i⁵ − 30.4i⁴ − 43.3i³ + 46.3i² + 19.5i + 3.6`, normalised to flat (3.6 J/kg/m).
   The downhill benefit is capped at 12%, because runners can't turn all of the energy saved on a
   descent into speed.
3. Map flat-equivalent miles onto a log curve from 1 to 10: a flat 5K ≈ 3.5, a flat 10 mi ≈ 6.8,
   a flat marathon = 10. Labels run Easy, Moderate, Hard, Very hard, Extreme.

### Time estimates

`time = 5K time × (flat-equivalent miles / 3.107)^k` (Riegel). The skill tiers are:

| Tier | Flat 5K pace | k |
| --- | --- | --- |
| Beginner | 12:00 /mi | 1.08 |
| Intermediate | 9:30 /mi | 1.06 |
| Advanced | 7:30 /mi | 1.05 |

With **Strava** connected, the app uses your last 120 days of runs instead. Each run is
converted to a flat-equivalent 5K pace, and the estimate is the median of your faster half of
runs. Easy days don't drag it down, and impossible paces (GPS glitches) are dropped.

## Project layout

```
src/
  core/          Pure TypeScript domain logic, unit-tested (no React Native imports)
    geo.ts           distances, projection onto a course, simplification
    difficulty.ts    grade-adjusted effort and the 1–10 score
    estimates.ts     tier and personal (Strava) time estimates
    courseTracker.ts the start / off-course / rejoin / finish rules
    records.ts       average, personal best, course record
    filters.ts       Browse filters and sorting
    rules.ts         every threshold in one place
    validation.ts    GPS plausibility checks (teleports, bike/car speed, mock location)
    verify.ts        server-side replay of attempts and route building
    importMatch.ts   finding course attempts inside watch/Strava/GPX tracks
    elevation.ts     terrain elevation lookup
    gpx.ts           GPX parsing
  data/          SQLite (on-device GPS storage), Supabase client, API
  integrations/  Apple Health, GPX file import
  run/           background GPS task, live run session, upload/sync with retry
  app/           screens (Expo Router)
    (tabs)/          Routes (browse) · Run (free run) · You (profile, Strava)
    route/[id].tsx   map, difficulty, estimates, times, leaderboard, start gate
    run/active.tsx   live run: timer, distance, course progress, off-course banner
    run/finish.tsx   result and quick grading
    import.tsx       pick a run from Apple Health or Strava
supabase/
  migrations/    schema, visibility/record triggers, row-level security
  functions/
    runs/            verified uploads: course attempts, new routes, imported tracks
    strava/          OAuth, pace history, importing Strava runs
    strava-webhook/  automatic import when a runner uploads to Strava
    _shared/         run service, Strava helpers, and a copy of src/core (`npm run sync:core`)
scripts/
  import-gpx.ts      load curated library routes from GPX files
  sync-shared-core.ts
```

## Setup

1. **Install:** `npm install`
2. **Supabase:** create a project, then `supabase link` and `supabase db push`. This applies
   `supabase/migrations`. Enable Email sign-in (OTP code) under Auth.
3. **Edge functions:** `supabase functions deploy runs`. This one is required, because all results
   go through it. Optionally set `ELEVATION_API_URL` if you run your own Open-Meteo instance; the
   public API is for non-commercial use.
4. **Strava (optional):** create an app at <https://www.strava.com/settings/api> and set its
   Authorization Callback Domain to `localhost`. Then:
   ```sh
   supabase secrets set STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... STRAVA_WEBHOOK_VERIFY_TOKEN=<random string>
   supabase functions deploy strava
   supabase functions deploy strava-webhook --no-verify-jwt
   # register the webhook once:
   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
     -F client_id=$STRAVA_CLIENT_ID -F client_secret=$STRAVA_CLIENT_SECRET \
     -F callback_url=https://<project>.supabase.co/functions/v1/strava-webhook \
     -F verify_token=$STRAVA_WEBHOOK_VERIFY_TOKEN
   ```
5. **Curated routes:** seed the library from GPX files (drawn in a route planner or exported from
   a run). Curated routes are public immediately:
   ```sh
   npm run import:gpx -- --dry-run loops/*.gpx   # check distance, climb and difficulty
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run import:gpx -- loops/*.gpx
   ```
6. **Env:** `cp .env.example .env` and fill in your Supabase URL and anon key, your Strava
   client ID, and the metro area's name, center and radius.
   For Android maps, also set `GOOGLE_MAPS_ANDROID_API_KEY`.
7. **Run:** the app uses background location, maps and HealthKit, so it needs a development build rather
   than Expo Go: `npx expo run:ios` / `npx expo run:android`, or
   `npx eas-cli@latest build --profile development`.

## Development

```sh
npm test           # unit tests for src/core (also fails if the edge-function copy is stale)
npm run typecheck
npx eslint .
npm run sync:core  # after changing src/core
```

## Known gaps / next steps

- **Live tracking still uses the phone.** Watch runs are imported after the fact, so the live
  start gate and off-course warnings need the phone running PacePath. A watchOS / Garmin Connect IQ
  companion app could bring the warnings to the wrist.
- **Garmin direct API** needs Garmin Connect Developer Program approval (see above).
- **Android Health Connect** isn't integrated yet. On Android, watch runs come in through Strava or
  GPX.
- **Anti-cheat stops casual cheating, not determined cheating.** A hand-crafted, realistic GPS file
  would pass. Before any prizes, add review of suspicious records, for example new records far
  ahead of second place.
- **One metro area**, configured through env vars, as specified. Supporting several cities would
  mean a `metros` table.
