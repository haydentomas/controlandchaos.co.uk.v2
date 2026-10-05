# Tomorrow: V2 Directory Integration

Updated: 2026-10-05. Work paused at the user's request. No more implementation, account creation, migration, commit, push or deployment tonight.

## Resume Here

**Real end-to-end avatar verification succeeded. Replay and expiry protections are both confirmed. The only remaining Following Step 7 sub-test is the cross-avatar/another-account conflict case (optional — requires a second account).**

- Verifier object UUID: `18190500-5d59-7853-5c5a-7c86906d900b`
- Owner avatar UUID: `b3d25fb5-a5d9-4734-8d86-5e1f70ba8bec`
- Script is now `scripts/CC_V2_Avatar_Verifier.lsl` v3 (pushed as `eaa02e9`). The v1/v2 busy-lock logic had a real bug: `clearDialog()` never reset `requestId`, so a dropped/failed HTTP response could permanently wedge the object until a full script reset. v3 fixes this via a single `resetSession()` and adds touch/version diagnostics (`Verifier ready (v3)...`, `Touch #N from <name>`).
- Real flow confirmed working: signed in at `/auth.html` as `hello@pixaful.com`, pressed Get Verification Code, touched the verifier, pasted the code, object replied "Avatar linked...", pressed Refresh verification, and the account page now shows **"Verified avatar: alek.zane"**.
- Replay test confirmed: re-submitting the same already-consumed code correctly failed (server rejects reuse); submitting a fresh code first correctly succeeded.
- Expiry test confirmed: requested a code, waited past its ~10-minute window, submitted it, and got the expected `Verification failed (status 409)` rejection.

Do not repeat Steps 1-6 (commit/push, Netlify site env, Netlify Functions env, in-world kiosk secret, deploy, real verification). Migration 2 is already applied; do not run it again.

## What Is Working

- V2 is separate from V1. No Astro: HTML/Nunjucks, Tailwind, Vite and modular JavaScript.
- Shared head, header/footer, normal/white-label layouts, creator hero and tabs.
- Decap staff collections: events, site Blog & News, Product Guides & Manuals, and global branding/navigation/footer. Dark editor and styled live previews; local file editing uses `npm run cms:local` without GitHub credentials.
- Staff content stays in Git/Decap. Creator/live directory data belongs in Supabase, not Decap.
- Public directory reads real Supabase records with search, role/tag filters, pagination and loading/error/empty states. Basic profile links open the live public reader, not the old fixture profile.
- Creator account page implements signup, sign-in/out, confirmation callback handling and password recovery. User successfully signed in with a real account.
- Avatar challenge database, account controls, server verifier and dedicated LSL script are deployed and **real avatar linking is confirmed working end-to-end** in staging. Linking does NOT yet provision a creator profile or enable its editor.

## Confirmed External Setup

| Item | State |
| --- | --- |
| GitHub repository | `https://github.com/haydentomas/controlandchaos.co.uk.v2.git` |
| Last pushed milestone | `eaa02e9` (Supabase directory, creator auth, avatar verification v3 script; tests and build passed before the main milestone push) |
| Netlify staging site | `https://controlandchaosv2.netlify.app/` |
| Netlify site env | `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` configured; deployed and confirmed showing both live demo profiles |
| Netlify Functions env | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `CC_VERIFICATION_KIOSK_SECRET`, `CC_VERIFICATION_KIOSK_OWNER`, `CC_VERIFICATION_KIOSK_OBJECT` all configured; secrets-scan false positives resolved via `SECRETS_SCAN_OMIT_KEYS` for the non-secret identifiers |
| Real avatar verification | Confirmed end-to-end: signed in as `hello@pixaful.com`, requested code, touched verifier, entered code, object confirmed link, account page shows "Verified avatar: alek.zane" |
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

All database/directory/Auth/avatar-verification changes up to `eaa02e9` are **committed and pushed** to `origin/main`, and the Netlify site/Functions environments are fully configured and deployed. Real in-world avatar linking has been confirmed against the live staging endpoint.

Do not touch V1's separate Git repository, live domain, payments, kiosk credentials, Blobs data or earlier uncommitted hardening work. V2 is the only implementation target.

## Following Steps

Steps 1-6 are complete (commit/push, Netlify site env, Netlify Functions env, in-world kiosk secret, deployed function, real verification confirmed). Step 7's replay and expiry sub-tests are confirmed; the cross-avatar/another-account conflict sub-test is optional and not yet run (requires a second account).

7. (Optional remaining sub-test) Touch the verifier with a code issued to a *different* account while trying to claim an avatar already linked elsewhere; confirm it is denied as `avatar_already_linked`. Stop on unexpected results; do not manually force verification or disable RLS.
8. Only after replay/expiry/failure behave correctly, design profile provisioning/ownership assignment and connect the real creator editor. Keep approval/featured status and verified identity server-controlled.

**Never enter a code supplied by another person.** The code links the avatar completing it to the account that requested it. Second Life headers alone are spoofable; the trusted private kiosk secret and protected script are part of the authentication boundary.

## Verification Boundaries

- Challenges expire after ten minutes, have a one-minute issuance cooldown and a ten-per-day account cap.
- Anonymous clients cannot issue codes. Account clients cannot consume codes or list all challenge records. Consumption is server-only and atomic.
- Expired/used challenges, avatars linked to another account and revoked links are denied.
- Signing out discards stale challenge responses.
- Successful avatar linking currently does not assign `profile_owners`, approve a profile or activate payments/subscriptions.
- Default Supabase mail delivery is restricted to project-team addresses and rate-limited. Configure production SMTP later; do not disable confirmation to bypass email problems.

Latest validation: **78 tests passed; production build passed; relevant editor diagnostics clear.** Real Postgres policy tests use PGlite with Supabase roles/Auth helpers emulated. Endpoint tests use fake secrets/clients; no live privileged writes were made. The deployed endpoint, LSL compilation, real in-world avatar linking, replay rejection and expiry rejection are now all confirmed working. Only the cross-avatar/another-account conflict case is still unverified.

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