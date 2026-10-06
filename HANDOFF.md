# V2 Shared Template Handoff

Latest handover (2026-10-06): read [NEXT_STEPS.md](NEXT_STEPS.md) first. Commit `ccc0f6a` is pushed and Netlify serves the Alt-test profile UI. Migration 11 is applied. Local migration 12 implements direct private Storage photo uploads, optimized in-browser to WebP with per-file and per-profile caps; it is not applied or deployed. No live uploads or booking emails were made. Apply and verify migration 12 only after approved deployment preparation. The resume file supersedes every older deployment/setup statement below.

## October 6 Booking Enquiry Progress

### Gallery uploads (local; migration 12 pending)

- Studio accepts JPEG/PNG/WebP up to 10 MB; it resizes the long edge to 2048 px and iteratively converts to WebP <=2 MB. Netlify never handles image bytes.
- A private `directory-gallery` bucket enforces WebP/2 MB. Owner Storage RLS checks the verified paid profile and 20-photo cap, including pending files; replacing a photo at capacity remains allowed. Public read policy requires a published photo on an approved, published, active profile. Draft images are signed only for the owner; published images use one-hour signed URLs.
- Gallery metadata stores only profile/photo-scoped Storage paths. Profile/gallery save remains atomic; staged uploads are cleaned up when profile save fails, and replaced/removed objects are cleaned after success.
- Migration 12 is **not applied**. Apply after an approved push/deploy and run [verify-directory-gallery-storage.sql](supabase/verify-directory-gallery-storage.sql). No remote bucket, schema, or setting was changed and no upload has been performed.

- V2 rate selection now shows the V1-style quote CTA when booking hours are enabled. The live public form collects client name/contact, requested date/time and notes; selected service IDs are verified and repriced server-side before the request is emailed.
- Schedule choices follow the creator's saved timezone, available days, interval and overnight windows. Profiles without regular booking days can receive flexible requests. Local preview submissions are blocked.
- Selecting services fills the enquiry notes with a greeting, service/category breakdown, estimate and preferences prompt; deselecting clears the generated text. The selected IDs are sent separately and repriced server-side.
- Gallery Library has an owner-controlled sidebar-preview checkbox. Existing photos default on; only selected, published photos appear in the up-to-four-photo preview, while the Gallery tab retains all published photos. The preference saves atomically with profile/gallery data.
- Sidebar order is Gallery, My Toys, Hard Limits & Boundaries, Booking Hours, How to Book, Wishlist & Tributes. Toys have an owner-managed repeater for name, description, icon and status badge. Wishlist links have title, HTTPS URL and note. Both cards hide when empty; values render as text and safe links. Booking Hours is a compact clock-led range, timezone, day list and interval. Sidebar gaps are 16px and rate-to-enquiry gap is 24px. Boundaries use gold/charcoal list rows; the enquiry form has more breathing room.
- V2 Studio has an owner-only private booking contact email; blank uses the confirmed V2 Auth email. Netlify `submission-created.mjs` uses Resend and resolves the recipient through [directory_booking_recipient](supabase/migrations/202610060011_directory_booking_recipient.sql). The RPC returns the selected recipient and booking details only to `service_role`, and only for a verified owner with an active paid, approved, published profile and booking hours. Client-supplied recipient/price data is ignored; email HTML is escaped.
- Migration 11 adds private booking contacts, `show_in_sidebar`, and validated hardware/wishlist profile fields. The user reports applying it; their screenshot confirms anon/authenticated column grants are false/true. See [verify-directory-booking-recipient.sql](supabase/verify-directory-booking-recipient.sql). The first RPC permission row still needs confirmation before real bookings. V2 Netlify expects server-side `RESEND_API_KEY` and optional `RESEND_FROM_EMAIL`; no values were read or changed.
- Validation: full suite 150/150, production build and clean edited-file diagnostics. Shared-browser checks verified populated toy/wishlist cards, restored testpress profile rendering, sidebar order and mobile overflow. Headless Chromium is not installed, so the Playwright browser suite remains blocked.
- Next: user fills toy/wishlist and gallery choices in hosted Studio, saves/publishes the Alt profile and compares it with V1. Before any live booking, confirm RPC privileges `false, false, true, false, true, false, true`; direct gallery flag updates `false, false`. No real booking/email has been sent.

## October 6 Editor Handover

- Standard TOAST UI toolbar, native link dialog, WYSIWYG / Markdown and Markdown Write / Preview now cover all connected long-form profile fields. Short labels, names, prices and URLs stay plain text. The user likes the simpler V2 design; continue incremental V1 functionality without assuming a full visual redesign.
- Mocked real-browser tests verify native links, keyboard application without accidental form submission, save/reload, public rendering, mobile overflow, unsupported-source preservation, exact limits, disabled fields and explicit load-error fallback. These tests did not write live profiles.
- The editor is bundled locally and loaded only for enabled Studio fields. Telemetry is disabled; embedded images/uploads are blocked. The lazy vendor bundle triggers Vite's 500 kB warning but the build succeeds; do not suppress the warning by arbitrarily raising its threshold.
- Live gallery testing completed and temporary photos were removed. Boundaries / How to Book (`70a154c`) is deployed and user-confirmed working. Migration 10 was applied by the user and its expected privileges confirmed.
- The user has tested the hosted replacement editor; specific test results were not stated. Next: choose the next V1-parity feature with the user. Do not imply VIP feeds, toys, socials, booking requests or uploads are connected. Further feature pushes require fresh approval.

## October 5 Outcome

- The operating model is automated subscription access, not staff-assigned provisioning: Basic/VIP, monthly/lifetime, immediate access after paid ownership linking, expiry hides listings/locks paid editing, renewal preserves content. Final prices and detailed tier capabilities are undecided; Basic Monthly remains a private L$1 development test plan.
- One combined [directory terminal](scripts/CC_V2_Directory_Terminal.lsl), `directory-v4.1`, handles subscription, verification, account login and reminders. Secrets load from the private in-world `CC_V2_Terminal_Config` notecard; repository variables remain blank. Replacing script code no longer requires typing keys again.
- Real auto-login, editing/publishing, expiry/renewal and cross-region warning IM tests succeeded. Testpress's temporary expiry was restored to `2026-11-04 11:55:29.334415+00`. Offline IM receipt and the expired-notice IM remain unverified.
- The account and editor now read live Supabase data with paid-owner gates. Rate cards and recurring booking hours are implemented and were reported working live. The booking-request flow is currently local only; see the October 6 Booking Enquiry Progress section above.
- Gallery milestone `726b05d` adds draft-private photo rows, atomic profile/media saving, URL previews, metadata/publication/order controls, public filtering, banner rendering and accessible keyboard lightbox/error handling. Migration 9 is already applied; real hosted gallery testing is the next action after Netlify publishes code containing that commit. Uploads/Storage and private signed media are not implemented.
- The complete V1 studio/profile and its richer design remain the intended destination. Smaller working sections are incremental foundation work, not a replacement product specification. Do not confuse old fixture pages with connected live features.

## Historical Architecture Notes

The sections below preserve earlier architecture/setup history. Their present-tense deployment, migration and test-count statements are historical; use [NEXT_STEPS.md](NEXT_STEPS.md) for current facts and resume instructions.

## Current Stage

The user requested a separate `v2` folder containing a flat version of the current site's templates in the latest Tailwind, preserving the current appearance before building the production application properly.

Updated 2026-10-04: no Astro; use HTML/Tailwind/modular JavaScript with build-time Nunjucks. Shared templates were pushed as `c34fde0`. The user now approved the completed CMS milestone commit/push and requested step-by-step directory database setup. Tests/build pass; verify Netlify deployment after the push. Hosted CMS OAuth and Supabase remain unconfigured.

Supabase development project: London, `https://fqzcaragavsutdkswsnm.supabase.co`. Migration/demo seed succeeded and hosted RLS was checked without frontend filters. User confirmed Auth redirect/provider settings. Account page is now implemented locally at `/auth.html`, not pushed; next action is one manual development signup per Step 6 in `SUPABASE_SETUP.md`. Avatar verification/owner editor remain unimplemented. Never display key values or read credential files through model-visible tools.

Public directory remains anonymous. Creator Auth uses `auth-api.js` / `auth.js`, separate persistent PKCE storage, explicit safe callbacks, no-referrer policy and server-verified user display. Signup/signin/signout/recovery are implemented with generic errors and no directory writes. Real Auth forms are excluded from preview-action handlers. Full suite: 72 tests passing; build passes. Browser Auth tests use intercepted fake accounts, including mobile recovery; real hosted email delivery/signup is not yet verified. Default mailer is team-only and rate-limited; do not disable confirmation to bypass it.

## Initial CMS Slice

Avatar verification work is prepared locally, unpushed: migration `202610040002_avatar_verification.sql`, its read-only check, `avatar-verification.js` account controls, a privileged Netlify verifier, and a dedicated blank-secret V2 LSL script. Next user step is applying migration 2/check per Step 7 in `SUPABASE_SETUP.md`. No remote migration/configuration/deployment has been performed. 78 tests/build pass. LSL still needs SL compilation/runtime checks.

Boundary: authenticated users request rate-limited ten-minute codes; only the configured secret/object-bound server consumes them. Secret belongs in Netlify Functions and private kiosk script, not browser code. Headers alone are spoofable. Replays/expired codes, conflicting account links and revoked avatars are denied. Avatar linking does not yet provision profiles or assign editor ownership. User has confirmed real sign-in; real verification remains untested.

Auth callback follow-up: user reported an invalid/expired email link. Handler now captures optional `sb_flow_id` before cleanup and passes it to SDK exchange; actual SDK multi-flow storage is tested with the opt-in flag enabled only in that regression. Default client configuration is unchanged. Rejected links suggest password sign-in; safe messages distinguish unconfirmed email/rate limits. Await user's real sign-in result: the specific link failure cause and successful real confirmation remain unverified. Full suite/build: 74 tests pass. No real emails/accounts were created during this validation.

- `public/admin`: pinned Decap 3.16.3 and GitHub backend targeting the V2 repository only.
- Collections: events, site Blog & News, Product Guides & Manuals and global branding/navigation/footer; no creator/private collections.
- `content/events` and `templates/partials/event-card.njk`: original four event cards now generated from editable JSON.
- `scripts/cms-content.mjs`: Ajv validation for shared settings/events, unsafe URL rejection, published-state filtering, ordering, duplicate IDs, filename/ID agreement and timezone-aware calendar links.
- `src/modules/events.js`: real event filtering and selected/count states; loaded only on the events page.
- `CMS_SETUP.md`: verified current Netlify/GitHub OAuth instructions and required authenticated publishing checks. The callback URL is `https://api.netlify.com/auth/done`. Never collect client secrets through chat.
- Vite's `/admin/` homepage fallback was fixed with `adminRoutePlugin` and a real-server regression. Local Login now uses pinned `decap-server` 3.11.3 via `npm run cms:local`, bound to 127.0.0.1:8081 and rooted only in V2. Local collections open without GitHub credentials; an HTTPS non-local host still shows GitHub login and makes no proxy requests. Hosted OAuth/publishing remains untested and requires the user's Netlify setup.
- The local proxy inherits a low-severity @hapi/joi advisory (two affected packages reported, no upstream fix). It is dev-only; do not expose it to LAN/public hosts. Details are in `CMS_SETUP.md`.
- Dark admin styling and custom settings/events previews reuse precompiled header/footer/event-card partials and compiled site CSS. Source generation is in `scripts/cms-previews.mjs`; draft text is escaped and unsafe links blocked. Refresh CMS after changing registration scripts/styles.
- Preview navigation wraps with explicit CSS layer overrides and auto-height header. Browser checks cover no footer overlap/overflow, live draft updates and bounded logo size.
- Site posts live in `content/blog`. Shared feed/card/article templates and build inventory generate new published IDs automatically; Marked/sanitize-html replace the legacy renderer. Unpublished/deleted IDs are removed from generated source/build pages with restricted filename cleanup. Superseded per-post templates and metadata captures were removed.
- Blog search/category/empty-state/Load More and styled Decap previews are wired. Four public posts were imported once from V1; dev/build/tests are independent of V1 thereafter.
- Manuals live in `content/guides`; five originals were imported with existing directory images/text. Shared `product-manual.njk`, guide-card and guide-sections partials replace per-guide captures. New published guides generate automatically; unpublishing/deletion cleans only restricted generated guide filenames. `guide-template.html` remains a reserved design sample.
- Guide section Markdown, features, commands and specifications are editable and validated. Unique anchors are generated when blank, with stable explicit anchors recommended. Guide editor/draft preview and desktop/mobile anchors/overflow are browser-verified. Preview styling checks must await the site stylesheet; transitions are disabled in the preview pane.
- Product catalogue, XP/rules and selected page copy stay code-managed. XP/rules is recommended as a future fixed-page content collection, but the user is undecided and it has not been implemented. Prefer validated content fields over raw layout editing.

- `main` has not been edited by this V2 capture/scaffold task. Its earlier uncommitted hardening work remains separate.
- V2 uses Vite 8.3.2 and Tailwind 4.3.3.
- There are 32 flat HTML template states. `templates.json` is the page inventory.
- Styles are centralized in `src/templates.css` and `src/portal.css`; templates contain no inline style attributes or inline event handlers.
- Tailwind utilities use `tw:` to avoid collisions with legacy design-selector names.
- Pages contain rendered sample/public-safe fixture data, not live backend logic.
- Shared-shell architecture is implemented; page-specific fixture bodies and presentation classes remain the approved visual reference. Generated `ui-*` hashes and unused IDs remain removed.
- Retain IDs only for working preview controls, anchors, native labels, or accessibility references. Do not reintroduce opaque capture hashes or per-paragraph styling classes.
- Preview actions do not authenticate, publish, process payments, or modify the original site.
- The editor sidebar is non-sticky on narrow screens so it cannot cover post controls during scrolling. Initial layout remains matched to the reference.
- Profile navigation tabs wrap into visible touch-friendly rows below 700px, including article and white-label pages. They do not require horizontal scrolling and retain a stronger active state than gallery-category filters.
- Initial flat baseline was committed/pushed as `11bbab4` to the separate V2 repository. The user connected `https://controlandchaosv2.netlify.app/`. No Supabase work or deployment of the current shared-template changes has occurred.

## Shared Sources

- `templates/layouts/site.njk` and `white-label.njk`: normal versus compact creator layouts.
- `templates/partials`: one head/SEO, header, footer, creator hero and profile-tab implementation.
- `templates/pages`: authoritative page-specific content; root HTML is generated, still tracked for this transition.
- `content/site.json`: shared navigation, branding and footer values. This is not yet a Decap-managed file.
- `content/pages`: per-page metadata/internal presentation settings. Do not expose internal classes/attribute maps through CMS fields.
- `content/creator-preview.json`: shared hero fixture, not live creator data.
- `scripts/render-templates.mjs`: escaped, strict Nunjucks rendering; missing sources fail rather than silently serving an old page. Dev watches content/templates; tests/build render automatically.
- `src/modules`: shared navigation/hero and conditionally loaded profile/gallery/editor/preview actions. Editor Markdown dependencies are not loaded on ordinary pages.
- `netlify.toml`: build/publish/Node settings and staging noindex headers. Noindex is not access protection.

## Validation

- Latest count: 53 passing tests, including guide inventory/metadata/anchors/cleanup, post publication/sanitization and shared layouts. Browser comparisons allow editable manual vertical flow and CMS article height changes while checking navigation/horizontal geometry. Native-transition detection and reference loading each failed once and passed unchanged on rerun; retain those timing/network caveats.
- Production build passes.
- 64 desktop/mobile browser comparisons pass: all 32 pages at 1440x1000 and 390x844.
- Desktop key layout bounds, body font and background match the original-CSS reference. Mobile profile-tab wrapping is an intentional improvement: the audit checks every tab fits and allows only its corresponding height/flow changes. There are no runtime errors or new page overflow relative to the reference.
- Screenshots were captured and representative screenshots reviewed. This is not a claim of exhaustive pixel equality for every element or live-user content.
- The shared Vite page shell sets the dark page canvas before stylesheet loading, adds a blocking stylesheet link, and enables native page fades with reduced-motion support. It does not intercept navigation or add a fixed delay. `scripts/page-shell.mjs` owns the development/build injection.

```powershell
cd j:\FinalGame\v2
npm test
npm run build
npm run test:visual
```

The visual audit starts its own temporary server and serves its original-CSS reference from `scripts/fixtures/visual-reference.json.gz`. It no longer depends on V1 or ignored local snapshots. Reports/screenshots are under ignored `test-results/visual`. Install Chromium once with `npx playwright install chromium`.

## Preview

```powershell
npm run dev -- --port 4180 --strictPort
```

Start at `http://127.0.0.1:4180/`. Individual templates use flat URLs such as `/directory.html`, `/directory-editor.html`, `/profile-gallery.html`, and `/profile-post-white-label.html`.

The current implementation preview was started at `http://127.0.0.1:4182/` to avoid existing servers.

## Source Refresh Warning

`npm run capture` reads the existing `../main` templates, renders them offline, copies public referenced assets, and regenerates V2 HTML and `src/portal.css`. It overwrites captured files. Do not run it over subsequent manual template work without preserving those changes.

`public/reference` is now only a legacy local capture artifact. Production builds explicitly omit it; the portable compressed test fixture is outside public assets.

The initial Windows output cleanup failed for a generated `dist/images` directory on the workspace drive. Production-style V2 output now uses ignored `build`, with automatic deletion disabled. The old ignored `dist` directory is not source content. Unused generated files under `src/assets` are also not imported or shipped.

## Next Work, After Visual Review

1. The CMS milestone push is approved. Verify its deployment, then guide the user through creating a separate Supabase development project per `SUPABASE_SETUP.md`. Hosted staff OAuth can be configured separately; authenticated CMS publishing remains unverified.
2. Extend Decap staff schemas beyond global settings/events and extract editable content fields from remaining page bodies. Keep layouts/classes in code and creator data out of Git-backed CMS collections.
3. Continue suitable page-specific component/semantic styling extraction without unrelated redesign. Markdown already uses Marked/DOMPurify in the editor-only module.
4. Design Supabase ownership, verified Second Life identity linking, subscriptions, posts, domains, and media policies before wiring backend features.
5. Add real sessions, transactional saves, pagination, protected media, backups/import/rollback, and negative authorization tests.
6. Add shared authenticated likes only after the data/auth model works.

Keep C&C canonicals and custom-domain branded mirrors. Preserve normal versus white-label navigation/footer differences and the shared creator hero/tab layout.

V2 is a separate Git repository with an established staging deployment. Do not silently alter V1's deployment, move the live domain or undo pending `main` changes.