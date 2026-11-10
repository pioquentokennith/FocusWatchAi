# FocusWatchAI: one admin, up to ten staff

**Google registration + admin approval:** follow [GOOGLE_SETUP.md](GOOGLE_SETUP.md)
after initial database/admin setup. It adds migration 002 and replaces manual staff
creation with verified Google registration. Existing accounts remain valid.

## 1. Create the database

Open your Supabase project → **SQL Editor → New query**. Paste the entire contents of
`supabase/migrations/001_team_sessions.sql` and click **Run**. Run this initial migration
once. It creates the tables, access policies, validated sync functions, and team limits.

The app cannot install this schema using its publishable key.

### Update existing databases

After migrations 001 and 002, run
`supabase/migrations/003_session_integrity_and_staff_updates.sql` once in SQL Editor.
New installations also need this migration before using the current app. It repairs
final sessions missing an end time using their last confirmed device timestamp,
enforces final end times, and adds conflict-checked staff updates. Older clients'
three-argument staff-update RPC remains available during the rollout.

Then run `supabase/migrations/004_daily_workflow.sql` once. It creates staff-owned
alert settings, break records, fixed session threshold snapshots, and the RLS-protected
`session_report` aggregation. Existing sessions and older clients retain three-second
threshold defaults and zero break time. Apply the entire file as one transaction.

## 2. Create assigned accounts

For manual accounts only, keep Email/password enabled and disable **Allow new users
to sign up** under **Authentication → Sign In / Providers**. For Google registration,
that switch must instead be **ON**; follow `GOOGLE_SETUP.md`.

In **Authentication → Users → Add user → Create new user**, create your admin and
each staff account with an email and a unique temporary password. Enable **Auto Confirm
User** for these manually assigned accounts. Distribute passwords privately. Users
can change their password from the app's **Account** tab.

After creating each account, run the corresponding SQL in SQL Editor, replacing the
example email and display name:

```sql
select public.provision_team_member('admin@example.com', 'Team Admin', 'admin');
select public.provision_team_member('staff01@example.com', 'Staff One', 'staff');
-- Repeat the staff call with each of your staff emails (up to ten).
```

There is no automatic first-user admin or client-side role editing.
Exactly one admin role and at most ten staff profiles are allowed. Disabled staff
still occupy their team slot and keep their historical records. The admin can edit
staff names and enable/disable access in the Team tab. Account creation and password
recovery are handled in the Supabase dashboard for this small team. To reset a lost
password, use the dashboard user controls; there is no in-app email reset flow yet.

## 3. Connect and run

The current machine's `.env.local` already contains your project URL and publishable
key. On another machine copy `.env.example` to `.env.local` and fill those values in.
Never put a secret/service-role key or database password in a `VITE_` variable.

```sh
npm install
npm run desktop
# Or for the admin web dashboard:
npm run dev
```

Vite embeds the public configuration at build time. Rebuild/repackage the desktop app
after changing it. Staff sign in to the desktop app; the admin can sign in to either
the browser or desktop app. Host the built `dist` on an HTTPS static host for an
admin dashboard accessible from other machines. Email/password login works on the
desktop custom origin without OAuth redirects.

## 4. Validate with two staff accounts and the admin

1. Sign in as staff one, accept the camera notice, start monitoring, and leave the
   frame for at least three seconds. Stop the camera and wait for “All sessions synced”.
2. Open My insights. Inspect the session summary and no-face timeline entry.
3. Sign in as staff two. Staff one's sessions must not appear.
4. Sign in as admin. Both staff profiles and staff one's session should be visible.
5. Disconnect the staff device from the network during monitoring. Stop, reconnect,
   and verify queued records sync without duplicate sessions/events.
6. Disable staff two from Team. New writes must be rejected; their open app checks
   access every 30 seconds. Re-enable when finished testing.

## Recording and sync semantics

- Sessions start when camera access actually succeeds, not when permission is requested.
- Every condition sustained for its session-configured threshold is counted once per alarm episode and type.
  Repeating sound pulses and short uncertain gaps do not create extra events.
- Event timelines show the episode window and the **observed condition duration**
  within it. Unknown time is not attributed to eye closure or looking away.
- Coverage totals include brief observations below the alert threshold. They are
  separate from sustained-event counts. Long inference gaps are marked uncertain.
- Pause records a reason/note and switches off camera and alarm. Resume runs fresh
  calibration within the same session. Coverage plus break time equals session duration.
- Staff save their own timings through `update_my_alert_settings`; only their next
  new session uses changes. The current session retains its thresholds across breaks.
- The app checkpoints to a per-user local outbox every five seconds and syncs roughly
  every fifteen seconds, plus start/stop and reconnection. No webcam images, video,
  or landmark coordinates are sent to Supabase.
- Invalid snapshots rejected by the database stay in the local queue with an error
  message while other valid sessions continue syncing. **Sync now** retries these
  records after their underlying issue has been resolved. Connection and access
  failures continue retrying automatically; local records are not discarded.
- On browsers with Web Locks (including Chromium/Electron), only one window per
  account can own the local recording queue. Close the other window if monitoring
  is waiting for local storage access.
- Stop ends the session. Sign-out ends monitoring and tries to sync; pending records
  stay on that device and retry when the same staff member next signs in. Do not clear
  site/app data before they sync. A hard crash may lose up to the latest checkpoint.
- Closing the app saves an interrupted session locally. If a device crashes or never
   reconnects, the dashboard labels its last active session **Connection unknown** after
  60 seconds; it does not invent an end time or count offline time as monitoring.
- Session history is paginated, filtered by local dates, and refreshed every 30 seconds.
  No Realtime publication is required. This keeps the initial free-tier setup simple.
- Team overview refreshes every 15 seconds. Reports and CSV aggregate all matching
  sessions, independent of pagination, by local session-start date. Overnight sessions
  belong entirely to their starting date. Staff RLS applies to reports and break details.
- These are client-reported camera estimates, not tamper-proof attendance or proof
  of productivity. There is no automatic productivity score.

## Checks

`npm test` includes recorder/outbox tests and actual PostgreSQL RLS/RPC checks using
PGlite, with a local auth shim. `npm run test:browser` uses mocked Supabase API responses
and real local MediaPipe inference. These checks do not create remote users or data.
The checklist above still needs to be run against your configured Supabase project.
