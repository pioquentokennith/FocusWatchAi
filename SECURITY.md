# Security review

## Repository checks

- A pattern-based scan of the current Git candidate files and reachable Git history,
  including XML inside the tracked DOCX, found no private credentials. Local
  environment values were also checked against those files without printing them.
- `.env.local` is ignored and untracked. It contains only the Supabase URL and a
  publishable key. `.env.example` contains placeholders.
- Project-specific Supabase URLs in the Google setup guide were replaced with
  placeholders. The old public project URL remains in Git history; it is not a secret.
- `.gitignore` also excludes common credential files, private keys, signing
  certificates, logs, and generated builds. This only prevents new files from being
  added normally; it cannot protect secrets hardcoded into tracked source files.
- `npm audit` reported zero known dependency vulnerabilities at review time.
- All 94 automated tests passed, including local PostgreSQL access-control checks;
  the production build passed.

## Access-control review

The migrations enable row-level security on application tables and restrict writes
to validated functions. Privileged functions use an explicit search path and check
the signed-in user's role/ownership. Reports run with the caller's permissions.
Electron enables sandboxing and context isolation, disables renderer Node.js access,
blocks new windows, and restricts permissions to the app's camera use. OAuth uses
PKCE and a random loopback callback path. CSV exports escape formula-like cells.

## Remaining items

- **Content Security Policy:** `index.html` has no CSP, and the desktop asset handler
  does not add one. A tested production CSP would provide additional protection
  against script injection. It must accommodate MediaPipe WASM, Supabase connections,
  and the app's font/style loading. This review did not establish an exploitable XSS.
- **Live backend:** the review covers migration source and local database tests,
  not the deployed Supabase configuration. Apply migrations 001–004 and perform the
  account-isolation checks in [supabase/SETUP.md](supabase/SETUP.md).
- **Client configuration:** all `VITE_` values are public in built apps. Never use
  service-role/secret keys, OAuth client secrets, or database passwords there.
- **Local sessions:** sign-in tokens and pending session metadata persist on the
  device. Anyone with access to its browser/Electron profile may access that data.

This is a source/dependency review, not a penetration test. Pattern matching cannot
detect every secret. If a private credential is ever committed, revoke/rotate it
with its provider and remove it from Git history; adding it to `.gitignore` alone
does not resolve the exposure.
