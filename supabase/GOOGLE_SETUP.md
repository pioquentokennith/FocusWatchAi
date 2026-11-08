# Google sign-in + admin approval

This setup uses Supabase Free and Google OAuth. No SMTP, email OTP provider, paid
Google APIs, or custom domain is needed for the local desktop/browser demo.

The app code is ready, but you must configure Google and Supabase in your dashboards.
The publishable key cannot change those settings or run database migrations.

## 1. Install the NEW database migration

Your existing `001_team_sessions.sql` setup and admin account remain in place.
Do **not** run migration 001 again.

1. Open `supabase/migrations/002_google_registration.sql` in VS Code.
2. Copy the entire file, including `begin;` and `commit;`.
3. Open [Supabase SQL Editor](https://supabase.com/dashboard/project/rwzkqmcsukzzpridnpoj/sql/new).
4. Paste it into a new query and click **Run** once.
5. Expect **Success. No rows returned.**

For a brand-new project, run 001 first, then 002, and provision the single admin
according to `SETUP.md`. Staff do not need manual provisioning for Google registration.

## 2. Create the Google OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create/select
   a project named **FocusWatchAI**. You do not need to enable billable services.
2. Open **Google Auth Platform** (or **APIs & Services → OAuth consent screen**).
3. Set the app name to **FocusWatchAI**, choose your support/contact email, and
   configure the audience as **External** for personal Gmail accounts.
4. While the app is in **Testing**, add the Gmail addresses of all participating
   staff under **Audience → Test users**. Add your own Gmail too if testing Google
   login. Google test users are separate from Supabase organization members; staff
   do not need access to your Supabase dashboard.
5. Under **Data Access**, use only `openid`, `.../auth/userinfo.email`, and
   `.../auth/userinfo.profile`. The app does not request access to Gmail messages.
6. Under **Clients**, create an OAuth client with type **Web application**. This is
   also the correct type for Electron here because Supabase handles Google's callback.
7. Add these **Authorized JavaScript origins** for local web development:

   ```text
   http://localhost:5173
   http://127.0.0.1:5173
   ```

8. Add this exact **Authorized redirect URI**:

   ```text
   https://rwzkqmcsukzzpridnpoj.supabase.co/auth/v1/callback
   ```

9. Create the client. Keep the **Client ID** and **Client secret** for the next step.

The Google redirect URI above is different from the desktop return URL in step 4.
Do not put `focuswatch://app/` or the local desktop callback in Google's redirect URI.

## 3. Enable Google in Supabase

1. Open **Authentication → Sign In / Providers → Google**.
2. Enable Google and paste the Google **Client ID** and **Client secret**.
3. Keep nonce checking enabled and keep **Allow users without an email** disabled,
   if those options are shown. Save the provider settings.
4. Under the general sign-in settings, turn **Allow new users to sign up ON**.
   This reverses the earlier manual-accounts-only setup: Google must be allowed to
   create a Supabase Auth user before the app can submit a registration request.
5. Keep Email/password sign-in enabled for your existing admin account.

The Google client secret belongs only in Supabase's provider settings. Do not add it
to `.env.local`, a `VITE_` variable, source code, screenshots, or a chat message.
The app still uses only the existing project URL and publishable key.

## 4. Allow the app's return URLs in Supabase

Open **Authentication → URL Configuration → Redirect URLs** and add:

```text
http://127.0.0.1:43821/auth/callback/**
http://localhost:5173/
http://127.0.0.1:5173/
```

For local development, the **Site URL** can be `http://localhost:5173/`.
For a hosted browser dashboard, set the Site URL to the actual HTTPS app URL and
also add that exact app return URL to the redirect list. Add its origin to Google
if using the browser app. If Vite chooses another port, add its exact URL too.

The desktop starts a temporary server bound only to `127.0.0.1:43821` during sign-in.
Each attempt has a random callback path; the `/**` allows only those paths on that
loopback address. No router port forwarding or LAN/public HTTP server is needed.
The system browser returns a short-lived code; the desktop exchanges it with the
original PKCE verifier. Tokens are never placed in the browser callback page.

## 5. Restart the updated app and try registration

Close the old desktop window and run:

```sh
npm run desktop
```

1. On a staff device, click **Continue with Google** and choose a test-user Gmail.
2. On desktop, complete Google sign-in in the default browser. Return to FocusWatchAI
   when the browser says the sign-in response was received.
3. The app shows **Pending admin approval**, the verified email, and the Google name.
   Camera monitoring is unavailable until approved.
4. Sign in as your existing admin, on another device/browser or after the staff signs
   out on the shared device. Open **Registration requests**.
5. Click **Approve** or **Reject**. Approved requests create only a `staff` profile.
6. Staff can click **Check approval status**, wait up to 30 seconds, or sign in again.
   Approved users enter the monitoring workspace; rejected users see the decision.

You do not need to create staff passwords or send confirmation emails. Existing
assigned email/password accounts continue to work, including the admin account.

## Access and capacity rules

- Google must provide a verified `@gmail.com` identity matching the Supabase user's
  confirmed email. Editable user metadata cannot spoof eligibility.
- Pending/rejected users can read only their own request. They cannot access team
  profiles, sessions, events, camera workspace, or the admin review functions.
- Pending/rejected requests have no row in `profiles` and occupy **zero staff slots**.
- Approval runs in one database transaction using the same advisory lock as the
  ten-staff limit. A full team leaves the request pending instead of partially approving it.
- Disabled staff still occupy a slot and retain their records. Disabling is not removal.
- Repeated sign-ins do not reset a rejection. Rejected requests are terminal in this
  UI; the project owner can deliberately reset a mistaken rejection to pending in SQL
  Editor if needed. Approving/rejecting again with the same decision is idempotent.
- There remains only one admin. Google registration cannot create or promote an admin.
- Enabling Auth signup alone does not grant app access; database policies require an
  approved profile for all monitoring data. Non-Gmail Google accounts cannot request access.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Google provider is disabled / unsupported provider | Enable Google and save its ID/secret in Supabase. |
| New users are not allowed | Turn on **Allow new users to sign up**. |
| Google says access blocked or app is in testing | Add that Gmail to Google **Audience → Test users**. |
| `redirect_uri_mismatch` | Google's redirect URI must be the exact Supabase `/auth/v1/callback` URL. |
| Browser returns to localhost:5173 instead of desktop | Add the exact loopback wildcard above to Supabase Redirect URLs. |
| Missing `request_staff_access` / `registration_requests` | Run migration 002 once. |
| Port 43821 is in use | Finish/cancel sign-in in the other app window, or close it, then retry. |
| Sign-in timed out or code exchange failed | Start a fresh sign-in from the same app. Keep it open; codes/verifiers cannot be reused. |
| Browser was closed before sign-in finished | Use **Cancel Google sign-in**, then try again. |
| All 10 staff slots occupied | The request stays pending. Disabled staff count toward the ten slots. |

## Verification

Automated tests use mocked Google/Supabase responses, a real loopback HTTP callback,
real PKCE generation/exchange wiring, and local PostgreSQL policy/RPC checks. They
do not verify your actual Google Cloud/Supabase provider configuration.

After setup, test one real Gmail applicant through approval and session recording,
plus one rejected applicant. Confirm the existing admin password login still works.

References: [Supabase Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google),
[PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow),
[redirect allowlist](https://supabase.com/docs/guides/auth/redirect-urls).
