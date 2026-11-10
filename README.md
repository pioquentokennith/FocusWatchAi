# FocusWatchAI

A React + MediaPipe + Electron staff monitoring app with on-device face landmarks, eye/head-direction estimates, and repeating alarms. Supabase provides assigned Staff/Admin accounts, session history, event timelines, and team insights for **one admin and up to ten staff**. The desktop edition monitors while you Alt+Tab or minimize the window.

## Set up Supabase first

Follow **[supabase/SETUP.md](supabase/SETUP.md)** to run the database migration and create your assigned accounts. Copy `.env.example` to `.env.local` and configure your project URL and publishable key. This machine already has those two values configured locally.

For **Google sign-in + admin approval**, follow **[supabase/GOOGLE_SETUP.md](supabase/GOOGLE_SETUP.md)**. Run the new `002_google_registration.sql` migration after 001, configure Google OAuth in Supabase, and enable new-user signup. Staff use **Continue with Google**; verified Gmail applicants wait for approval in the admin's **Registration requests** tab. Pending requests do not occupy any of the ten staff slots. Existing admin email/password login remains available. This flow does not require SMTP.

**Database updates:** apply migrations 001–004 in order. Migration 003 adds conflict-checked staff edits and final session end times; `004_daily_workflow.sql` adds personal alert timings, breaks, and aggregate reports. See [database updates](supabase/SETUP.md#update-existing-databases).

Staff see only their own records. The admin sees team history, filters sessions by staff/date, and can edit staff display names or disable accounts. Database policies and restricted RPCs enforce these permissions. The app queues unsynced session metadata locally and retries on reconnection. Camera frames and landmarks are never uploaded.

## Secrets and repository security

- Keep machine-specific values in `.env.local`; `.gitignore` excludes environment files, local credentials, private keys, logs, and generated builds. Commit only placeholder values in `.env.example`.
- Every `VITE_` value is embedded in the browser/desktop build and can be read by users. Use only the Supabase project URL and **publishable** key there. Keep service-role/secret keys, database passwords, and Google OAuth client secrets in server-side configuration or the Supabase dashboard.
- Supabase publishable keys are public by design. Apply migrations 001–004 to enforce row-level security (RLS) and restricted database functions, then validate account isolation using [SETUP.md](supabase/SETUP.md#4-validate-with-two-staff-accounts-and-the-admin).
- `.gitignore` does not remove previously committed secrets or erase Git history. If a real secret is committed, revoke/rotate it with its provider and remove it from history before sharing the repository.
- Run `npm audit` and `npm test` when updating dependencies or database access rules.

## Run the desktop demo (recommended for Alt+Tab)

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run desktop
```

This builds the React app and opens its Electron window. The header should say **Desktop · Background ready**. Electron's runtime downloads on first use, so initial startup can take longer. Keep the laptop awake; monitoring does not run while the computer is asleep or the app is closed.

To create a standalone Windows demo folder:

```sh
npm run desktop:package
```

Run `release/FocusWatchAI-win32-x64/FocusWatchAI.exe` on an x64 build machine. Keep the entire generated folder together when sharing it; the executable depends on the accompanying runtime and assets. Node.js, npm, and a development server are not needed on the machine running the package. This is an unpacked application, not an installer. The packaged app retains its existing Windows user-data folder so sign-in and unsynced sessions survive the branding update.

## Run the browser demo

```sh
npm run dev
```

Open the localhost URL printed by Vite. Camera access requires localhost or HTTPS; a plain HTTP LAN address will generally not work. The website also uses repeating alarms, but browsers can throttle or freeze hidden pages. Use the Electron app for reliable background monitoring.

`npm run dev` and `npm run build` automatically copy the installed MediaPipe WASM runtime and download Google's version-1 Face Landmarker model if it is missing. The first setup needs internet access. Subsequent runs use local assets. To prepare assets explicitly, run `npm run prepare:ai`.

## Use the AI demo

1. Sign in with your staff account. Choose **Alert settings** to save your personal timings (1–60 whole seconds per condition; defaults are three seconds). Return to **Monitor**, choose your camera, accept the camera/AI notice, select **Start camera**, and allow access if prompted.
2. Wait for the model to load. A face mesh with highlighted eyes appears when a face is found.
3. Look at the middle of your laptop screen with eyes naturally open. Hold your head and gaze steady for about five seconds to calibrate; slower devices may take longer.
4. **No-face alerts work even before calibration.** Each condition triggers an alarm after its configured duration. Saved settings apply to the next new session; an existing session keeps its original timings, including after breaks.
5. The pulse pattern **repeats until your face is visible, your eyes are open, and your gaze stays near calibration for one full second**. Face detection alone is not enough. Uncertain readings, missing video frames, and brief glances back do not clear an existing alarm.
6. **Recalibrate** after moving the camera or changing position. Recalibrating does not dismiss an active alarm; finish calibration and recover to stop it automatically.
7. Use **Alert volume** (default 90%), **Test sound**, and the sound-reminder switch. **Silence** dismisses sound for the current episode. Mute stops it until unmuted; an active alarm resumes when unmuted. Test sound is a finite preview unless a non-dismissed automatic alarm is already active.
8. **Pause session** records a break reason and optional note, switching off camera and alarm. **Resume session** continues the same session with fresh calibration. A denied or cancelled resume keeps the break open. **End session** finishes a paused session.
9. **Stop camera** releases the camera and model and silences the alarm. Open **My insights** for daily summaries, coverage, events, break history, and **Export daily CSV**. Wait for **All sessions synced** before clearing local app data.

One participating person should be in view. Iris position and face orientation estimate looking away, not exact screen gaze or mental focus. Switching applications alone does not trigger an alarm; the camera observations still determine the result. The app cannot override your laptop's speaker volume or a muted browser tab.

## Working features

- Explicit camera notice and browser permission request; microphone is never requested.
- Live mirrored/unmirrored webcam preview and fullscreen control where supported.
- Start, Stop, and cancellation while permission is pending.
- Session duration and camera resolution.
- Real MediaPipe Face Landmarker inference, targeting up to 10 fresh frames per second.
- Face mesh, eye contours, and iris overlays aligned with the mirrored/unmirrored preview.
- Stable open-eye calibration with retry and recalibration.
- Screen-facing, eyes-closed, looking-away, no-face, and uncertain states.
- Eye closure uses calibrated eye-aspect ratios. Looking away combines relative head rotation with iris position measured in each eye's local coordinates. Both eyes must agree on sustained gaze deviation; missing or inconsistent iris observations become uncertain when the head is neutral.
- Personal cloud-saved eye-closure, eye/head-deviation, and no-face timings; initial no-face detection works during calibration.
- Pause/resume with break reasons and notes, separate camera/break totals, and fresh calibration on resume.
- Daily reports and spreadsheet-safe CSV for all matching sessions, independent of history pagination.
- Admin team overview refreshes every 15 seconds, with monitoring, break, stopped, disabled, and connection-unknown states.
- Guided setup and per-account device-local camera, mirror, overlay, volume, and mute preferences.
- Continuous pulsed audio until one-second stable recovery. Event counts increment once per condition per episode, rather than once per repeated sound. Muting does not suppress visual reminders or event counts.
- A 0–100% volume slider, audible test, and immediate Silence control.
- Unknown observations and gaps longer than 750 ms break new-event and recovery timing, but keep an already-active alarm latched. A short CPU stall can preserve valid calibration samples without counting as observed recovery.
- Electron disables background throttling and Windows occlusion throttling. Inference uses a fresh-frame timer rather than requestAnimationFrame; audio uses a native looping AudioBufferSource independent of UI timers.
- Model loading/failure messages, retry, inference FPS, and session reminder counts.
- Permission, missing-camera, disconnected-camera, and browser support messages.
- Camera cleanup on Stop and component teardown, including late permission responses.
- Responsive dashboard, keyboard-accessible controls, and quick guide.

Supabase stores accounts, session times, observation-duration totals, and detection-event metadata. A per-user local outbox retains pending records for offline sync. Google Fonts are requested for typography; webcam frames and landmarks are not transmitted or recorded. The desktop app serves bundled assets through a secure local `focuswatch://app/` protocol, with an isolated renderer and camera-only permissions for that origin. CPU/WASM inference uses the bundled model and version-matched WASM files.

## Checks

```sh
npm test
npm run build
npm run preview
```

Unit tests cover camera lifecycle, calibration, gaze, blinks, initial no-face alarms, latched alarms, stable recovery, observation gaps, native audio looping, muting, manual silence, cancellation, session recording, and offline retries. Local PostgreSQL tests also verify RLS isolation, restricted role management, account limits, atomic snapshots, and idempotent sync.

Real-browser checks:

Browser and desktop checks use test-only Supabase network fixtures; they do not
create remote accounts or records. Desktop checks use a disposable user profile.
Validate your live project using the account-isolation checklist in `supabase/SETUP.md`.

```sh
npx playwright install chromium
npm run test:browser
```

Browser tests use the real model/WASM runtime and a synthetic video stream to check inference, missing faces, model failures, and camera cleanup. A real Web Audio analyser checks that the alarm produces a stronger waveform, responds to volume, and silences on mute. This checks the audio signal, not physical speaker loudness. Set the `AI_FACE_FIXTURE` environment variable to the path of a local front-facing portrait to also run real landmark/calibration validation. That optional test routes the reference image locally; it does not upload it.

Desktop background tests:

```sh
npm run test:desktop
```

These launch Electron with a native fake webcam, minimize the actual desktop window, and verify ongoing model inference and repeated audio. With `AI_FACE_FIXTURE` set, they also verify recovery and rearming while another window has focus. To test the generated executable, set `AI_DESKTOP_EXE` to its absolute path before running `npx playwright test --config=playwright.desktop.config.js`. Tests analyse audio while muting the desktop output to avoid playing alarms on your speakers.

A real webcam still needs manual validation for your lighting, glasses, and camera angle:

1. Camera remains off until consent and Start.
2. Allow permission: preview appears, timer advances, mirror works.
3. Stop: browser camera indicator switches off and timer stops.
4. Deny permission: actionable error appears; permission can be changed and retried.
5. Cancel while the permission dialog is open, then allow: the late stream is released.
6. Unplug the camera: disconnected message appears.
7. Test fullscreen and a narrow/mobile viewport.
8. Start with no face in view: verify a repeating alarm after three seconds of inference, then calibrate and recover to silence it. Blink normally and verify no blink alarm.
9. Recover for a second, then look to the side using just your eyes for about three seconds. Try looking down and then a head turn. Check the live reason, timer, reminder counter, and sound.
10. In the desktop app, Alt+Tab and minimize while monitoring. Leave the frame: the no-face alarm should repeat until you return and recover. Check that uncertainty and a brief glance back do not silence it.
11. Test sound at different volumes, mute/unmute, Silence, recalibration, and Stop while loading the model. Try a second episode shortly after recovery to verify that it rearms.

## Report semantics

Reports use the viewer’s local timezone and group each entire session by its start date. An overnight session belongs entirely to the day it started. Camera time includes calibration and uncertain coverage, excludes breaks, and is not a productivity score. Active sessions include only their last synced duration. CSV contains every matching daily/staff row, even when history or summaries have multiple pages. Staff see their own records; admin sees the team and the alert timings used for each session.

The existing DOCX remains the reference plan. Detection is intended as an estimate of visible face/eye cues.

## Model assets

- Runtime: `@mediapipe/tasks-vision` pinned to `0.10.32`.
- Model: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- Setup script: `scripts/prepare-ai.mjs`; generated assets live in `public/models/` and `public/wasm/` and are included in production builds.
