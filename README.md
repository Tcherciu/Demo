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

### Difficulty score

Each route's difficulty comes from its **flat-equivalent distance**, the flat distance that
takes the same effort:

1. Smooth the GPS elevation (60 m moving window, with a 2 m threshold before a climb or descent
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
  data/          SQLite (on-device GPS storage), Supabase client, API
  run/           background GPS task, live run session, upload/sync with retry
  app/           screens (Expo Router)
    (tabs)/          Routes (browse) · Run (free run) · You (profile, Strava)
    route/[id].tsx   map, difficulty, estimates, times, leaderboard, start gate
    run/active.tsx   live run: timer, distance, course progress, off-course banner
    run/finish.tsx   result and quick grading
supabase/
  migrations/    schema, visibility/record triggers, row-level security
  functions/strava/  OAuth code exchange and activity fetch (keeps the client secret server-side)
```

## Setup

1. **Install:** `npm install`
2. **Supabase:** create a project, then `supabase link` and `supabase db push`. This applies
   `supabase/migrations`. Enable Email sign-in (OTP code) under Auth.
3. **Strava (optional):** create an app at <https://www.strava.com/settings/api> and set its
   Authorization Callback Domain to `localhost`. Then:
   ```sh
   supabase secrets set STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=...
   supabase functions deploy strava
   ```
4. **Env:** `cp .env.example .env` and fill in your Supabase URL and anon key, your Strava
   client ID, and the metro area's name, center and radius.
   For Android maps, also set `GOOGLE_MAPS_ANDROID_API_KEY`.
5. **Run:** the app uses background location and maps, so it needs a development build rather
   than Expo Go: `npx expo run:ios` / `npx expo run:android`, or
   `npx eas-cli@latest build --profile development`.

## Development

```sh
npm test           # unit tests for src/core
npm run typecheck
npx eslint .
```

## Known gaps / next steps

- **Anti-cheat is basic.** The server rejects times faster than 3:30 /mi and makes sure the
  route is visible to the runner. It trusts the phone's on-course judgment. Before real
  competition, upload the GPS track with each attempt and re-run `CourseTracker` server-side.
- **Elevation comes from GPS altitude.** It's smoothed, but a DEM lookup when a route is created
  (for example an elevation API called from an edge function) would make scores more reliable.
- The metro area is set by env vars (center and radius). Supporting several cities would mean a
  `metros` table.
- There is no seed data. The library fills up as people run.
