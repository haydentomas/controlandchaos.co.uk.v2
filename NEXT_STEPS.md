# Tomorrow: V2 Directory Integration

Updated: 2026-10-05. Work paused at the user's request. No more implementation, account creation, migration, commit, push or deployment tonight.

## Resume Here

**Step 8 is complete. The test verifier prim compiled and behaved correctly. Migration 2 is already applied and its permission check succeeded. Do not run it again.**

- Verifier object UUID: `18190500-5d59-7853-5c5a-7c86906d900b`
- Owner avatar UUID: `b3d25fb5-a5d9-4734-8d86-5e1f70ba8bec`
- Compile succeeded; owner chat reported the UUID and the "not configured" warning; touch correctly said "Verification is not configured yet."

**The next user action is Following Step 1: review current V2 changes and get explicit approval to commit/push the database/Auth/verifier milestone before any Netlify environment configuration.**

LSL compilation and runtime behavior are now verified for the unconfigured state only. The configured (real secret) HTTP round-trip to the Netlify function is still unverified.

## What Is Working

- V2 is separate from V1. No Astro: HTML/Nunjucks, Tailwind, Vite and modular JavaScript.
- Shared head, header/footer, normal/white-label layouts, creator hero and tabs.
- Decap staff collections: events, site Blog & News, Product Guides & Manuals, and global branding/navigation/footer. Dark editor and styled live previews; local file editing uses `npm run cms:local` without GitHub credentials.
- Staff content stays in Git/Decap. Creator/live directory data belongs in Supabase, not Decap.
- Public directory reads real Supabase records with search, role/tag filters, pagination and loading/error/empty states. Basic profile links open the live public reader, not the old fixture profile.
- Creator account page implements signup, sign-in/out, confirmation callback handling and password recovery. User successfully signed in with a real account.
- Avatar challenge database, account controls, server verifier and dedicated LSL script are prepared locally. Linking does NOT yet provision a creator profile or enable its editor.

## Confirmed External Setup

| Item | State |
| --- | --- |
| GitHub repository | `https://github.com/haydentomas/controlandchaos.co.uk.v2.git` |
| Last pushed milestone | `59fb337` (completed CMS plus initial Supabase setup guide) |
| Netlify staging site | `https://controlandchaosv2.netlify.app/` |
| Supabase development region | London |
| Supabase project URL | `https://fqzcaragavsutdkswsnm.supabase.co` |
| Directory migration 1 | User applied and verified |
| Demo seed | Two visible demo profiles plus one unpublished control |
| Hosted RLS check | Anonymous query without frontend filters returns only the two demos; hidden control denied |
| Auth settings | User configured local/staging redirect URLs and Email with confirmation enabled |
| Real account sign-in | User confirmed successful sign-in |
| Avatar migration 2 | User applied and verified: `false, true, false, true, false` |
| Local environment | Ignored `.env.local` exists and public client configuration works |
| Test verifier prim | Created; compiled cleanly; reported UUID `18190500-5d59-7853-5c5a-7c86906d900b`; correctly refuses verification while unconfigured |

The original confirmation-link error was not fully diagnosed. Optional SDK `sb_flow_id` is now preserved through URL cleanup, and rejection messages suggest password sign-in. Actual sign-in succeeded afterward. Do not claim real email/password recovery was tested; it was tested with mocked responses only.

## Local Versus Deployed

All database/directory/Auth/avatar-verification changes after `59fb337` remain **uncommitted and unpushed**. There are modified and new files in V2; retain them. No privileged verifier keys or kiosk credentials have been configured by the assistant.

The staging deployment must not be assumed to contain these new features. It needs an explicitly approved commit/push plus matching Netlify environment settings before the kiosk endpoint can work.

Do not touch V1's separate Git repository, live domain, payments, kiosk credentials, Blobs data or earlier uncommitted hardening work. V2 is the only implementation target.

## Following Steps

After the prim compiles and its identifiers are known:

1. Review current V2 changes and get explicit approval to commit/push the database/Auth/verifier milestone. Recheck tests and build if implementation changed.
2. Configure the V2 Netlify build environment directly with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; trigger a new build so the hosted frontend reads the development project.
3. Configure the following server-only values directly in the V2 Netlify Functions environment. Never paste their secret values into chat or source control.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Development project URL |
| `SUPABASE_SECRET_KEY` | Server-only `sb_secret_...` key; never a `VITE_` variable |
| `CC_VERIFICATION_KIOSK_SECRET` | New private random ASCII secret, at least 32 characters |
| `CC_VERIFICATION_KIOSK_OWNER` | Trusted prim owner's avatar UUID |
| `CC_VERIFICATION_KIOSK_OBJECT` | Exact verifier object UUID |

4. Set the matching kiosk secret **directly in the in-world script**, not the repository copy. Keep the configured object/script private and do not distribute it. Rotate the secret if exposed. Rerezzing may change the object UUID and require updating the server setting.
5. Confirm the Netlify function is deployed. The plain Vite dev server does not host this server endpoint; the kiosk uses the deployed staging endpoint.
6. Sign in on the account page and request a verification code. As your own avatar, touch the verifier and enter that code. Return to the account page and press Refresh verification.
7. Test replay/expiry/failure behavior in staging. Stop on unexpected results; do not manually force verification or disable RLS.
8. Only after real avatar verification works, design profile provisioning/ownership assignment and connect the real creator editor. Keep approval/featured status and verified identity server-controlled.

**Never enter a code supplied by another person.** The code links the avatar completing it to the account that requested it. Second Life headers alone are spoofable; the trusted private kiosk secret and protected script are part of the authentication boundary.

## Verification Boundaries

- Challenges expire after ten minutes, have a one-minute issuance cooldown and a ten-per-day account cap.
- Anonymous clients cannot issue codes. Account clients cannot consume codes or list all challenge records. Consumption is server-only and atomic.
- Expired/used challenges, avatars linked to another account and revoked links are denied.
- Signing out discards stale challenge responses.
- Successful avatar linking currently does not assign `profile_owners`, approve a profile or activate payments/subscriptions.
- Default Supabase mail delivery is restricted to project-team addresses and rate-limited. Configure production SMTP later; do not disable confirmation to bypass email problems.

Latest validation: **78 tests passed; production build passed; relevant editor diagnostics clear.** Real Postgres policy tests use PGlite with Supabase roles/Auth helpers emulated. Endpoint tests use fake secrets/clients; no live privileged writes were made. Deployed endpoint, LSL compilation and in-world linking remain unverified.

## Restart Locally

Run from `J:/FinalGame/v2` in separate terminals:

```powershell
npm run dev -- --port 4182 --strictPort
```

```powershell
npm run cms:local
```

Preview: `http://127.0.0.1:4182/`; account: `/auth.html`; staff editor: `/admin/`.

```powershell
npm test
npm run test:verification
npm run build
```

Git on the J: filesystem may require a per-command trust exception, without changing global settings:

```powershell
git -c safe.directory=J:/FinalGame/v2 -C J:/FinalGame/v2 status --short --branch
```

Do not run `npm run capture`: it is the legacy V1 extraction tool and does not maintain the authoritative new template/content sources. Existing visual audit has native-transition/reference-network timing caveats; the live directory no longer matches its old one-profile fixture.

## Important Files

- [SUPABASE_SETUP.md](SUPABASE_SETUP.md): detailed provider, migration and verification setup.
- [HANDOFF.md](HANDOFF.md): broader architecture/history; this next-steps file overrides stale pause-point statements.
- [Migration 2](supabase/migrations/202610040002_avatar_verification.sql#L1): already applied by the user.
- [Migration check](supabase/verify-avatar-verification.sql#L1): already passed; safe to rerun for inspection.
- [Server verifier](netlify/functions/verify-avatar.mjs#L1): server-only secret/object checks and consume RPC.
- [Account verification controls](src/modules/avatar-verification.js#L1): client challenge/status flow.

Suggested resume request:

"Read v2/NEXT_STEPS.md and continue from Step 8. Keep V1 untouched, do not request or print secrets, and guide me through one external setup step at a time. Do not repeat the already-applied migrations or commit/push without approval."