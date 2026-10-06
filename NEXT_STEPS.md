# V2 Resume Handoff

Updated: 2026-10-06. This file is the authoritative resume point; older historical statements in [HANDOFF.md](HANDOFF.md) do not override it.

## Resume Here

**The user has tested the hosted TOAST UI editor and has now requested the next deployment so they can test profile parity with an Alt. Local profile polish includes V1-ordered Gallery/My Toys/Boundaries/Booking Hours/How to Book/Wishlist cards, owner-managed toy/wishlist repeaters, selected sidebar-gallery photos, gold list-style boundaries, and a roomier booking form. Nothing is committed, pushed, or deployed. Public profile/gallery reads fall back to legacy columns until migration 11 is applied, so existing profiles remain visible. Migration 11 adds gallery, toy/wishlist and private booking-contact schema and is still unapplied. First apply it in the V2 development Supabase project and verify the grants below; then commit/push the requested Alt-test build. No live writes or emails were sent.**

Validation passed: full suite 150/150 after repeater implementation and legacy-schema fallbacks, production build and edited-module diagnostics. Shared-browser checks verified populated toy/wishlist cards, restored existing testpress profile rendering and responsive layout with no horizontal overflow. The separate headless rich-text browser suite could not launch because Playwright Chromium is not installed. No real booking was sent.

The live V2 gallery test was completed on 2026-10-05 as **testpress**:

- Confirmed the deployed site has the gallery editor, then saved one published and one unpublished photo.
- Owner save/reload retained both photos and their publish states.
- The signed-out public profile showed only the published photo. Category filtering, lightbox open/close, and previous/next navigation with a second published photo worked.
- Removed all three temporary test photos and saved; the public profile is back to having no gallery photos.
- Existing rate cards and booking hours remained visible. testpress has no avatar/banner image configured, so image rendering with configured profile images was not exercised.

No terminal change, new secret, SQL rerun, or deployment is needed for the completed test. Gallery file uploads/storage buckets are not implemented.

The user chose the richer V1-style listing/profile as the implementation direction and acknowledges it must be built iteratively. Commit `b7b9d49b34c334d559efb187876560d77f56b8f2` is pushed and includes the V1-inspired hero, accessible Rate Card & Bio / Gallery tabs, and responsive section navigation/card styling in Profile Studio. Deployed hero and tab markup are confirmed.

Commit `9486134` adds a sidebar preview of up to four published gallery photos, a full-gallery button, and published-photo counts. It reuses the gallery tile renderer/lightbox rather than duplicating media logic. 61 focused directory/template/creator tests and the production build passed. Local mocked desktop/mobile browser checks covered populated and empty galleries, explicit load errors, draft exclusion, real image loading, sidebar lightbox navigation and focus return, full-gallery filtering and keyboard tabs. These mocks did not change live account data.

Commit `70a154c` connects **Hard Limits & Boundaries** and **How to Book** end-to-end: studio navigation/textareas, owner reads/validation, atomic profile/gallery RPC saves, database constraints/permissions, and public sidebar cards. Each field allows up to 4,000 characters; empty/whitespace-only cards are hidden and line breaks are retained. Deployed editor/public markup was confirmed, and the user subsequently confirmed the feature works. This does not implement reservations, requests or payments.

The user applied [202610050010_directory_profile_protocol.sql](supabase/migrations/202610050010_directory_profile_protocol.sql) and confirmed [verify-directory-profile-protocol.sql](supabase/verify-directory-profile-protocol.sql). Their screenshot confirmed both non-null columns and empty defaults; they reported the expected privilege check verified (`false, true, true, false, true`). The migration preserves existing content and migration 9's gallery/save authorization and atomicity. Schema was applied before frontend deployment. The assistant did not run SQL remotely.

65 focused directory/template/creator tests, production build and edited-module diagnostics passed. Tests cover exact field limits/types, clearing, owner and anonymous reads, stranger/expired denial, transactional rollback, preserved rates/hours/gallery and older-client saves that omit the new fields. Local mocked browser checks verified editor save/reload and public literal-text rendering on desktop/mobile without horizontal overflow. These mocks did not write live data. After migration and an approved push, verify a real owner save/reload and signed-out public read, including clearing each card. The V1 fixture's VIP feed, blog, toys, socials, booking requests and other unconnected controls remain references; do not fake them as live. Do not commit, push, or deploy further work without fresh approval.

### Standard editor replacement approved for delivery

The user likes the simpler design but wants real paragraphs/lists and an editor toolbar. They explicitly approved visual editing plus Markdown source for **all connected long-form text**: tagline, About, Boundaries, How to Book, booking notes, rate category/service descriptions and photo descriptions. Names, headlines, prices, tags, availability labels and URLs remain plain text.

- Commit `db58520` deployed the first custom Tiptap Visual / Markdown / Preview toolbar. The user reported its links not applying and requested a familiar, standard editor instead. They accepted TOAST UI Editor as the replacement and explicitly approved pushing it on 2026-10-06; this commit includes the replacement.
- [rich-text-editor.js](src/modules/rich-text-editor.js) now adapts standard TOAST UI Editor with native formatting buttons, link popup and WYSIWYG / Markdown switch. Markdown has native Write / Preview tabs. The package loads automatically when the field is enabled, without stealing focus. WYSIWYG is initial for supported source. No custom gold pill toolbar remains.
- [profile-rich-text.js](src/modules/profile-rich-text.js) builds public DOM from an allowlisted Markdown token tree, never from arbitrary HTML. Paragraphs, line breaks, lists, emphasis, quotes, code, headings, tables and safe links render semantically; raw HTML is literal text, and Markdown images are alt text only. Directory cards use plain-text tagline summaries. Gallery lightbox descriptions also use the shared renderer.
- Existing plain text needs no data rewrite. Markdown syntax in existing text now deliberately gains formatting; source character limits still include syntax. Empty fields still hide the relevant cards.
- Tables, task lists, images, raw HTML and headings deeper than level 3 stay source-only rather than silently losing content in WYSIWYG mode. Native mode switching is guarded to retain exact stored source until an actual edit. Loading/saving recreates editor instances so undo cannot restore a previous profile. Synchronous flushing before saves and dynamic-model reads prevents pending editor events from dropping edits.
- Tiptap dependencies were removed and replaced with pinned `@toast-ui/editor` 3.2.2. Its older DOMPurify dependency is overridden to the repository's current DOMPurify version, exercised in preview tests. `npm audit --omit=dev` reports zero vulnerabilities; two existing low-severity development advisories remain. Usage statistics are disabled, images/uploads are blocked, and all editor assets are local bundles. No schema, RLS, terminal or live data changes.
- [standard-editor.css](src/standard-editor.css) contains narrowly scoped native-editor layout overrides outside Tailwind layers, since the vendor CSS is unlayered. Existing Studio grids now use zero-minimum tracks so long editor content cannot force mobile overflow. Native responsive toolbar overflow menus are retained.
- `npm run test:rich-text` runs semantic-rendering tests and an isolated real-browser studio/public workflow using mocked clients only. It specifically applies native links in About, How to Book and booking notes, rejects unsafe links, inserts links in Markdown mode, saves/reloads and verifies public hrefs. It also covers real mouse text selection, keyboard undo/redo, unchanged mode switches, exact limits, unsupported-source preservation, nested disabled booking fields, dynamic rate/gallery edits, native preview, mobile link dialogs/overflow, sign-out and explicit loading-failure fallback. No live writes; editor telemetry and image requests are checked absent.
- Validation: 70 combined directory/profile/template/rich-text tests and production build passed for the replacement; edited-module diagnostics are clear. The build warns that the lazy vendor editor chunk exceeds 500 kB; public pages do not import the visual editor. The user has since confirmed testing the hosted replacement; specific hosted test results were not stated.

No new SQL or terminal setup is needed. Choose the next feature with the user before implementation; further feature pushes require fresh approval.

### Next Work After Booking Test

Have the user compare populated V2 rate categories and booking requests against V1 after the migration and approved deployment. Then continue the V1 inventory with public creator blogs and VIP subscriber posts. Define private-post entitlement and access rules before wiring paid content; do not invent prices or tier restrictions. Socials, toys, wishlist/reviews and uploads/storage remain separate work; current galleries use image URLs.

## Product Direction

- The full V1 profile and studio remain the target, not the smaller foundation editor. The user explicitly wants incremental progress toward the richer V1 experience and layout.
- Subscription activation, ownership assignment, expiry and renewal must be automated, not staff-assigned day-to-day.
- Four plans: Basic Monthly, Basic Lifetime, VIP Monthly, VIP Lifetime. Final prices are undecided; do not invent prices or Basic/VIP feature restrictions.
- Monthly access currently means 30 days. Renewal extends remaining active time, or starts from now after expiry. Lifetime access does not expire.
- All sales are final: **no automatic refunds and no debit-permission requests**. Unexpected payments are retained for reconciliation.
- The user wants complete ready-to-paste LSL files with filename/setup comments, not instructions to replace individual segments. Keep secrets in the private notecard so code updates do not require retyping them.

## Confirmed Live

- V2 is separate from V1: HTML/Nunjucks, Tailwind, Vite, modular JavaScript; no Astro. Staff content is Git/Decap; directory/account data is Supabase.
- Signup/sign-in, avatar linking and the combined terminal work with real accounts. Real email/password recovery has not been verified; its tests use mocked responses.
- Avatar verification code replay and expiry rejection were tested in-world. Cross-account avatar conflict and lifetime purchases have database coverage but are not confirmed by a real in-world test.
- A paid alt automatically receives profile ownership after verification; users can pay before linking their account.
- **My Account** issues a short-lived single-use link and automatically signs in a linked, confirmed account. The user confirmed this live. Unlinked avatars receive the normal signup path; first-time onboarding still needs confirmation and linking.
- Real profile edits survived logout and terminal re-login. Public publishing was confirmed by a signed-out directory/profile read.
- Temporarily expiring testpress hid its public listing and removed editor access. Real terminal renewal restored active status, the same listing and preserved content.
- The three-day warning reminder arrived nearby and then in a **different region**. Offline receipt and the actual expired-notice IM have not been confirmed live.
- Rate-card categories/services save live. Booking hours were reported working live after their deployment. These are schedule information only, not reservations or booking requests.
- The private configuration notecard loaded in-world, and account login worked after returning to the trusted original prim. No secret values were stored in source or collected through chat.

## External Setup

| Item | Current state |
| --- | --- |
| V2 repository | `https://github.com/haydentomas/controlandchaos.co.uk.v2.git`, branch `main` |
| Site | `https://controlandchaosv2.netlify.app/` |
| Supabase | London development project: `https://fqzcaragavsutdkswsnm.supabase.co` |
| Gallery code milestone | `726b05d` (followed by this handoff update) |
| Terminal script | [CC_V2_Directory_Terminal.lsl](scripts/CC_V2_Directory_Terminal.lsl), `directory-v4.1` |
| Trusted combined prim UUID | `d24ad9db-0613-ce6b-b3ad-00bf94bf0120` |
| Prim owner / alek.zane UUID | `b3d25fb5-a5d9-4734-8d86-5e1f70ba8bec` |
| Test alt | `testpress`, UUID `06fc7dea-e8f9-4d79-896d-264ef8b7b8c7` |
| Test profile slug | `avatar-06fc7dea-e8f9-4d79-896d-264ef8b7b8c7` |
| Restored testpress expiry | `2026-11-04 11:55:29.334415+00`; user confirmed restoration after reminder tests |

**Temporary pricing warning:** Basic Monthly was enabled at **L$1** for development payment/renewal tests. The other plans were left disabled with no prices. No later disabling of L$1 was reported. Keep the test terminal private; do not treat L$1 as launch pricing or silently change it.

An alternate new prim (`2cafaa5a-4307-74fb-540d-9288dafe8e91`) caused HTTP 403 because it was not trusted. The user returned to the original prim rather than changing Netlify settings. The old standalone verifier UUID (`18190500-5d59-7853-5c5a-7c86906d900b`) is historical, not the current combined-terminal target. Moving the original prim within the same region preserves its UUID; taking/re-rezzing or replacing it may not. Never discard a prim with unresolved receipts or clear its linkset data casually.

## Secrets And Auth

- Frontend build configuration: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` only.
- Server configuration: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (`sb_secret_...`), both `CC_PAYMENT_KIOSK_*` and `CC_VERIFICATION_KIOSK_*` secret/owner/object sets. Both object settings point to the combined prim.
- The in-world private notecard is named **CC_V2_Terminal_Config**, with one JSON line for `CC_PAYMENT_KIOSK_SECRET` and one for `CC_VERIFICATION_KIOSK_SECRET`. Values must be distinct, 32-128 printable non-space ASCII characters. Do not paste its contents into chat, read it via model-visible tools, commit it, or deliver it to customers.
- Leave the repository's `KIOSK_SECRET` and `VERIFICATION_SECRET` variables blank. The script reads them on startup; inventory changes reload it. Missing/invalid configuration disables authenticated services.
- Payment secret is marked secret and set only for Netlify **Production** context. Fine-grained Functions-only scope was upgrade-gated, so available build/functions/runtime scopes remain. Non-`VITE_` names are not automatically bundled, but build scripts can still access them. Other older server secrets may retain broader contexts; review before allowing untrusted preview builds.
- Secret scanning remains enabled. `netlify.toml` omits only the documented public project URL/verification UUID keys, never actual secret keys.
- Avatar verification challenges: 10-minute expiry, one-minute cooldown, 10 per rolling day. **Terminal login links are different:** two-minute expiry, 10-second cooldown, 100 per rolling 24 hours per avatar, single-use, stored hashed. These limits do not limit profile edits or existing browser sessions.
- Never enter another person's verification code or share a terminal login link. Second Life headers alone are spoofable; trusted secrets and exact object/owner checks are required.
- Do not disable email confirmation to bypass signup issues. Production SMTP setup and real password recovery still need verification.

## Applied Migrations

All ten were applied manually by the user to the V2 development project. Migration 10 and its verified privileges are described above; the table below records migrations 1-9. **Do not apply them again.**

| Migration | Purpose / confirmed check |
| --- | --- |
| 1 | Directory foundation, ownership and RLS; original demo/public read check passed |
| 2 | Avatar verification; permission check `false, true, false, true, false` |
| 3 | Subscription/payment foundation; registration privileges `false, false, true`; plans initially disabled/unpriced |
| 4 | Single-use terminal login; permission check `false, false, true, false, true` |
| 5 | Relax terminal-login limits to 10 seconds / 100 per rolling day |
| 6 | Reminder claims/authorization/acknowledgement; permissions `false, false, true, false, true, false, true` |
| 7 | Validated rate-card JSON; edit/approval check `false, true, false` |
| 8 | Booking hours and availability note; check `false, true, true, false` |
| 9 | Draft-private gallery table and atomic media-save RPC; check `false, true, false, false` |

Migration 3 made paid validity part of public-read policies, so the original unpaid demo listings are not expected to remain visible. Expiry hides access without deleting content or unlinking avatar identity. Gallery drafts are protected by row policies, not merely by frontend filtering; an external image URL itself is not made private by a draft flag.

## Validation And Limits

Latest gallery validation: **118 tests passed; production build passed; relevant editor diagnostics clear.** PGlite tests emulate Supabase roles/Auth helpers; endpoint tests use fake secrets/clients. Mocked Edge/Playwright checks covered desktop/mobile save/reload, ordering/removal, draft exclusion, real image pixels, category filters, keyboard lightbox, broken images and expired-access denial. The assistant did not perform live privileged database writes; user actions applied SQL and performed the real payment tests.

The reminder queue is polled by the running terminal approximately every five minutes, with catch-up after startup. Expiry enforcement is database-driven and does not depend on reminder delivery. Claims use five-minute leases, and notices are revalidated before IM submission. Lifetime, suspended and stale renewal notices are skipped. Persistent journals avoid resending submitted IMs while acknowledging; a reset in the ambiguous submission window pauses reminders for reconciliation. `delivered_at` records acknowledged **submission**, not recipient delivery/read proof.

Outstanding: actual expired reminder and offline receipt; fresh-account conflict/lifetime-payment staging checks; finish the full V1-style studio/profile; real booking requests; Storage uploads/signed private media; voice/video; boundaries, socials, creator blogs/feed, SEO/custom domains and agreed VIP capabilities. The retained legacy templates are visual references, not evidence these features are connected. The authoritative live editor partial is [creator-editor.njk](templates/partials/creator-editor.njk).

## Restart Locally

Run from `J:/FinalGame/v2`. A preview was left running on port 4182 during this session; check before starting another. Local Vite does not host Netlify Functions. Real terminal links always use the deployed staging endpoint; local login/browser checks were mocked.

```powershell
npm run dev -- --host 127.0.0.1 --port 4182 --strictPort
```

Optional staff CMS, separate terminal:

```powershell
npm run cms:local
```

Preview: `http://127.0.0.1:4182/`; account: `/auth.html`; editor: `/directory-editor.html`; live public reader: `/directory-profile.html?slug=...`; staff CMS: `/admin/`.

```powershell
npm test
npm run test:creator
npm run test:terminal-login
npm run test:reminders
npm run build
git -c safe.directory=J:/FinalGame/v2 -C J:/FinalGame/v2 status --short --branch
```

Do not run `npm run capture`: it extracts V1 fixtures and can overwrite authoritative V2 sources. The legacy visual audit does not prove pixel parity for the now-live editor/reader. Native view-transition aborts were observed in earlier browser checks; the final mocked gallery workflow passed with no page errors.

## Guardrails And Next Work

- V1's separate repository, live domain, payments, credentials, Blobs and existing hardening work must remain untouched.
- The hero/tabs/studio milestone push was approved and completed as `b7b9d49`. Obtain fresh approval for later commits/pushes/deployments or remote changes.
- Do not request/print secrets, scan private environment files, force avatar verification, bypass paid-access rules, or disable RLS.
- Do not automatically run quota-limited remote security scans.
- Continue the locally validated public-profile layout slice, then agree follow-on profile/editor fields before implementing new features. Uploads, voice/video and boundaries/socials remain candidates, not pre-approved implementation.

Suggested resume request:

"Read v2/NEXT_STEPS.md and continue the public-profile layout work. The V2 gallery was tested live and temporary photos were removed. Migrations 1-9 are already applied and checked. Keep V1 untouched, keep secrets in-world/server-only, and do not commit/push or change production settings without approval."