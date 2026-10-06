# Directory Database Setup

## First Milestone

Keep staff events, site news and manuals in Decap. Supabase will own live directory profiles, accounts and creator content. Start with a database-backed public directory and authorized profile editing; payments, subscriber unlocks, production imports and private-media migration are later milestones.

Development project: London, `https://fqzcaragavsutdkswsnm.supabase.co`. Migration and demo seed succeeded; hosted RLS hides the unpublished control. Public browsing and the creator account page are implemented locally. Real signup/email delivery is the next manual test; creator editing, avatar verification and private features remain unconnected.

## Step 1: Create The Development Project

1. Sign in at https://supabase.com/dashboard.
2. Create a new project in a Free-plan organization for development. Do not upgrade a plan for this step.
3. Suggested project name: `control-and-chaos-v2-dev`.
4. Generate a strong database password and store it in your password manager. Never send it through chat.
5. Choose a region near the intended audience. For a mainly UK audience, choose London if available; otherwise a suitable nearby European region. Consider any residency requirements before choosing.
6. Create the project and wait until it is ready.
7. Stop there: do not create public tables/buckets, disable security policies or import production Blobs data yet.

Tell the assistant that the project is ready, its region and its public project URL. The URL is not a secret. Do not share database passwords, secret keys, service-role keys or access tokens.

## Step 2: Apply The Directory Foundation

1. Open this development project's SQL Editor: https://supabase.com/dashboard/project/fqzcaragavsutdkswsnm/sql/new.
2. Open `supabase/migrations/202610040001_directory_foundation.sql` in this V2 workspace.
3. Paste the complete SQL into a new query and run it once, in the London development project only.
4. The migration creates public `directory_profiles` and private `cc_private.verified_avatar_links` / `cc_private.profile_owners`, with permissions in the same transaction. It does not import data or modify existing V1 storage.
5. Run `supabase/verify-directory.sql` in a separate query. Expect three tables with `rls_enabled = true`, three profile policies, and privilege results `true, false, false, true, false` in the displayed column order.
6. Tell the assistant whether both queries succeeded. If an error appears, share the error text only, not credentials or account data. Do not bypass it by disabling RLS or adding broad grants.

The migration deliberately fails if these tables already exist rather than overwriting them. If you accidentally run it twice, stop and report the duplicate-object error; do not drop tables to make it pass. The verification query can be rerun safely.

Do not manually assign your production avatar or publish real profiles yet. Verified identity/ownership rows are privileged, and the verification flow is not implemented. A UUID alone is not proof of ownership.

## Step 3: Configure Public Client Values

After the project is ready, use its Connect dialog or Settings > API Keys to find its URL and publishable key. Use the current `sb_publishable_...` key, not a secret key.

Enter the values directly into ignored `.env.local` in the V2 root, using the names in `.env.example`:

```dotenv
VITE_SUPABASE_URL=https://fqzcaragavsutdkswsnm.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

The publishable key is designed for browser use but does not grant ownership or bypass database permissions. Never put `sb_secret_...`, a legacy service-role key or a database password in a `VITE_` variable. Keep privileged credentials server-only if a later backend task requires them.

We will configure matching Netlify staging variables and Auth redirect URLs when the database/client implementation is ready. Do not configure the live V1 site.

Do not add `cc_private` to exposed API schemas. It contains account-to-avatar/owner mappings. It has no client table grants; the owner policy calls only a narrow identity-bound helper function.

## Migration Scope And Local Validation

- The public table contains only public directory/profile fields, not emails, tokens, payment references, private posts or subscription records.
- Signed-out visitors see approved published rows. A verified owner can additionally read their own draft and edit only granted content/publication columns.
- Clients cannot create/delete profiles or change slug, Second Life username, approval, featured status, timestamps or ownership. Initial provisioning and verified ownership assignment remain server/dashboard-only until their workflows are implemented.
- Revoking an avatar link removes owner-edit access. It does not automatically unpublish an already-approved public listing; moderation/account deletion workflows remain later work.
- No avatar challenge flow, frontend Auth/client, paid entitlement policies, private media or import tooling is implemented by this migration.
- `npm run test:db` executes the actual migration in PGlite's local Postgres engine. Six permission scenarios pass, plus the parent test. Supabase roles and `auth.uid()` are emulated locally; hosted Auth/API configuration must still be verified on the development project.

The public reader uses the official pinned client without session persistence. It explicitly requests approved/published records, a public column allowlist and pages of 12 with stable ordering. Cards use textContent and safe image URLs; they link to the public reader at `/directory-profile.html?slug=...`, not the old fixture profile. Search/role/tag filters, loading/empty/error/retry and pagination are wired.

Vite rejects non-publishable keys before bundling. When changing `.env.local`, restart the dev server if it has not automatically restarted. The filename must include the leading dot; the user's initial `env.local` was corrected without reading its values.

## Step 4: Add Safe Development Listings

1. In the London development project's SQL Editor, run `supabase/seed-directory-demo.sql`.
2. It creates two clearly labelled visible demos and one unpublished control, with no account/verified-avatar/owner mappings. It can be rerun without duplicates and does not overwrite existing records.
3. Refresh `http://127.0.0.1:4182/directory.html`. Expect Demo Dominant and Demo Submissive, never Unpublished Demo Control.
4. Test name search, role/tag filters and each profile link. A filtered list may legitimately be empty.
5. Hosted seed verification is now complete: a direct anonymous query without client visibility filters returns exactly the two visible demos; a direct request for `demo-unpublished-control` returns no rows. Public detail lookup succeeds. No remote records were changed during these checks.

These are development samples, not real or avatar-verified listings. Before live launch, remove them in SQL Editor with a query restricted to their three exact demo slugs. Do not import production profiles yet.

No sample rows have been inserted remotely by the assistant. The SQL seed is tested in local Postgres only. Owner editing stays gated until the avatar-verification flow is ready.

## Netlify Staging, Later In This Step

After local demo reads are verified, enter `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` directly into the V2 Netlify project's build environment and trigger a rebuild. The publishable value is intended for public browser use; never use secret credentials. These local code changes are not pushed/deployed yet. The original creator/profile templates remain preview-only until their live replacements are implemented.

## Public Reader Validation

- Real hosted public empty read and a quoted search/combined-role/tag request succeed without logging keys or data.
- Local browser verifies the real empty state. Intercepted mobile API responses exercise paging, filtering, error/retry and basic profile navigation, without database writes.
- `npm run test:directory` covers configuration, column/visibility filters, query grammar, pagination, error redaction, profile lookup and DOM escaping.
- Current full suite: 74 passing tests including creator Auth helpers, SDK-generated PKCE verifier compatibility, session separation, migration policies and hidden-control denial. Build passes.
- Hosted creator sessions, owner writes, subscriber access, paid status and SSR/custom-domain profile metadata remain future work.

## Step 5: Configure Creator Authentication

1. Open Authentication > URL Configuration in this Supabase development project.
2. Set Site URL to `https://controlandchaosv2.netlify.app`.
3. Add exact redirect URLs:
	- `http://127.0.0.1:4182/auth.html`
	- `http://localhost:4182/auth.html`
	- `https://controlandchaosv2.netlify.app/auth.html`
4. Save. Do not add broad wildcard redirects or the V1 live domain.
5. Under Authentication > Sign In / Providers (label may vary), ensure Email authentication is enabled and Confirm email remains enabled. Leave anonymous sign-in disabled; do not weaken database policies.
6. The user confirmed these settings are saved. The local account/callback page is now implemented at `http://127.0.0.1:4182/auth.html`; it is not pushed/deployed yet.

Email/password registration, confirmation, sign-in/out and password recovery are implemented. A separate creator client uses PKCE and its own session storage; the public directory client stays anonymous. Callbacks are exchanged explicitly, URL codes/error fragments are stripped, and account pages send no referrers. Session display verifies the user with Supabase. No account action creates profile ownership or modifies directory records.

Supabase's default development mailer only delivers to project-team email addresses and is currently limited to two messages per hour. Production requires custom SMTP and anti-abuse configuration. Never disable email confirmation to bypass a mail-delivery problem.

## Step 6: Test A Real Development Account

1. Open `http://127.0.0.1:4182/auth.html` and select Create account.
2. Use your Supabase project-team email address for the default mailer. Enter a unique password of at least 12 characters directly into the form; never share it through chat.
3. Submit once, check inbox/spam and open the confirmation link in the same browser/profile that submitted signup. Keep the dev server running and use the same origin (127.0.0.1 versus localhost matters for PKCE storage).
4. Expect Signed in, your own email and a message that avatar/profile access is not linked. Sign out and sign back in to test the password flow.
5. Report success or the on-screen error only. Never send passwords, email link URLs, codes, session tokens or local storage contents.
6. Recovery can be tested separately after accounting for the mailer's rate limit: Reset password sends an email; its same-browser link opens the new-password form. Successful update signs this browser out and returns to sign-in.

If a confirmation link is rejected, first open the plain `/auth.html` address and try Sign in using the password chosen at signup. Email verification may already have succeeded even if the callback session failed. If sign-in reports email not confirmed, report that screen message before repeatedly creating the same account or requesting more emails. Never share the link/code and never disable confirmation/RLS to bypass the issue.

Callback compatibility: the installed SDK can append `sb_flow_id` when its opt-in flow-ID redirect feature is enabled. The handler captures it before URL cleanup and passes it explicitly to `exchangeCodeForSession`. A regression uses real SDK signup-generated verifier slots with two concurrent flows. This does not prove the cause of a specific expired/used-link response. Safe error categories provide recovery guidance without displaying provider descriptions or tokens.

Verification: desktop/mobile browser tests used intercepted Auth responses and fake users/tokens, covering validation, signup confirmation, generic recovery messages, server-verified sign-in display, sign-out, PKCE recovery/password update and URL cleanup. No real accounts or emails were created by the assistant. Hosted registration/email/recovery remain unverified until your manual test.

Creator accounts need independently verified Second Life ownership before profile writes. Unlike Decap's local filesystem proxy, creator authentication is genuine even on localhost. The old creator editor remains a preview and is not connected by this account-page step.

Official references: https://supabase.com/docs/guides/auth/redirect-urls and https://supabase.com/docs/guides/auth/passwords

## Work Split

### Current gate: Boundaries and How to Book (migration 10)

The authoritative current status is [NEXT_STEPS.md](NEXT_STEPS.md); earlier setup steps below are historical. Migrations 1-9 are already applied in V2. Do not rerun them.

Status on 2026-10-05: the user also applied migration 10, shared the correct column/default results and confirmed the expected privilege results. The frontend was pushed/deployed as `70a154c`, and the user confirmed the feature works. Steps 1-3 below are completed; do not rerun migration 10.

The subsequent local visual/Markdown editor stores Markdown in the same bounded text columns/JSON description fields. It needs no new migration or grants. Public formatting does not enable arbitrary HTML, bookings or payments.

Before deploying the new protocol editor/public-reader code:

1. Run only [202610050010_directory_profile_protocol.sql](supabase/migrations/202610050010_directory_profile_protocol.sql) in the **V2 development** project's SQL Editor.
2. Run [verify-directory-profile-protocol.sql](supabase/verify-directory-profile-protocol.sql). The privilege row must be `false, true, true, false, true`; both columns must show `is_nullable = NO` and empty-string defaults.
3. Report success or error text only. Do not share credentials. Approve the frontend commit/push only after the database check passes.
4. After deployment, test an authenticated owner save/reload and an anonymous public read of both fields, then clear them and verify their cards disappear. Check existing rates, booking hours and gallery remain intact.

The two fields are optional plain text, at most 4,000 characters each, with no rich HTML. Existing profiles gain empty values. Paid-owner rules and anonymous publication/expiry rules remain unchanged; the atomic gallery RPC retains omitted fields for older clients. This is informational protocol only, not a booking/payment system. Migration 10 has local database coverage but has not been applied remotely by the assistant.

### Booking recipient resolver (migration 11; local code only)

Migration [202610060011_directory_booking_recipient.sql](supabase/migrations/202610060011_directory_booking_recipient.sql) adds `show_in_sidebar` (existing photos default to included), validated public toy/wishlist collections, and private booking-contact storage. The user reports it applied on 2026-10-06; do not rerun migrations 1-10 or 11.

Run [verify-directory-booking-recipient.sql](supabase/verify-directory-booking-recipient.sql) to verify permissions. The shared screenshot confirms toy/wishlist column grants are false for anon and true for authenticated (RLS still limits rows to the verified owner); the first RPC permission row should also be confirmed before live booking submissions. Do not paste credentials into chat.

V2 Studio can store an owner-managed booking contact email in a private RLS-protected table; leaving it blank falls back to the confirmed V2 Auth email. The address is never present in public profile data or the browser form. The form submits through Netlify Forms, and the submission function sends through Resend using server-side `RESEND_API_KEY` and optional `RESEND_FROM_EMAIL`. The recipient is resolved only by the service-role RPC, not from a form field. The assistant did not apply SQL, change Netlify settings, or send a real email.

User: create the development project, retain credentials privately, enter requested settings directly, and run reviewed migrations through the authenticated dashboard when instructed.

Assistant: prepare versioned SQL migrations and permission tests, public-directory queries and pagination, safe frontend configuration, real creator sessions and verified avatar ownership. Give one dashboard/setup step at a time.

### Gallery photo uploads (migration 12; local code only)

For an approved upload test, run [202610060012_directory_gallery_storage.sql](supabase/migrations/202610060012_directory_gallery_storage.sql) after migration 11, then run [verify-directory-gallery-storage.sql](supabase/verify-directory-gallery-storage.sql). The migration creates a private `directory-gallery` bucket capped at 2 MB per WebP, adds a 20-photo-per-profile cap, and adds owner/published-photo Storage policies. The browser accepts JPEG, PNG or WebP up to 10 MB, resizes to a 2048 px long edge, re-encodes to WebP under 2 MB, and uploads directly to Supabase Storage; Netlify does not receive image bytes. Drafts use authenticated owner access; public display uses short-lived signed URLs for published photos only. Originals are not stored.

Migration 12 is not applied remotely. Free-plan limits are adequate for development and a small Alt test; check Storage/egress usage and spend caps before opening uploads to the wider public.

## Gates Before Real Directory Editing

- Design private account/ownership data separately from the public directory projection.
- Enable row-level security and least-privilege grants before exposing data.
- Verify anonymous users see only approved public records, and users cannot edit another creator's data or grant themselves verified ownership.
- A supplied Second Life UUID is not proof of avatar ownership. Define and test a challenge/verification flow before enabling creator writes.
- Stage safe sample data first; then prepare a dry-run Blobs import with stable identifiers, backups and rollback.
- Do not change production payments, kiosk credentials, custom domains or live storage during this development milestone.

Provider documentation: https://supabase.com/docs/guides/api/api-keys

## Step 7: Add Avatar Verification Database Rules

1. In the development project's SQL Editor, run `supabase/migrations/202610040002_avatar_verification.sql` once. Migration 1 must already be applied.
2. Run `supabase/verify-avatar-verification.sql` separately. The challenge table must have RLS enabled. Expected function/table privilege results: `false, true, false, true, false`.
3. Report success or error text only. Do not create ownership rows manually or weaken grants.

This creates private ten-minute challenges, one-minute issuance cooldown and a ten-per-day account cap. Codes are atomically single-use. Anonymous clients cannot request codes; account clients cannot consume them, list all codes or assign avatar identity. Reused/expired codes, another account's existing avatar and revoked links are denied.

## Verification Deployment, After Step 7

The new code is local and not pushed. Before an in-world test, approve the V2 commit/push and configure the following directly in the V2 Netlify project's Functions environment:

- `SUPABASE_URL`: the development project URL.
- `SUPABASE_SECRET_KEY`: an `sb_secret_...` server-only key from Supabase Settings > API Keys. Never use a `VITE_` prefix or put it in an LSL script/browser.
- `CC_VERIFICATION_KIOSK_SECRET`: a fresh random ASCII secret of at least 32 characters, generated/stored privately. Do not reuse V1's published credential.
- `CC_VERIFICATION_KIOSK_OWNER`: the trusted kiosk owner's avatar UUID.
- `CC_VERIFICATION_KIOSK_OBJECT`: the verifier object's UUID printed to its owner by the new script. Reconfigure if rerezzing changes it.

The dedicated `scripts/CC_V2_Avatar_Verifier.lsl` goes into a separate test object, not the old payment kiosk. Set its blank `KIOSK_SECRET` directly in Second Life to match the Netlify kiosk secret. Keep script contents private and do not distribute the configured script or object; protect inventory/group permissions and rotate the secret if exposed.

The endpoint validates the secret and registered object/owner headers before a privileged RPC. Second Life headers alone can be spoofed; secrecy and a trusted, unmodified kiosk are the authentication boundary. It obtains the avatar from the LSL touch/listen event, not browser-submitted identity. Never enter a challenge someone else supplied: a code links the avatar to the account that requested it.

After deployment/configuration: sign in locally, request a code, complete it at the verifier as your own avatar, then press Refresh verification. This links the avatar only; profile ownership/provisioning and the real editor are subsequent steps. Never send codes or secrets through chat.

Validation: 78 tests and build pass. Real Postgres tests cover grants, expiry, replay, cross-account claims and revoked links; server tests cover secret/object/payload denial; browser state tests cover stale responses after sign-out. LSL compilation and deployed/in-world integration are not verified in this workspace. The assistant has not applied migration 2 or deployed/configured the verifier remotely.