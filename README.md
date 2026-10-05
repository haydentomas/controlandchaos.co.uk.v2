# V2 Shared Site Templates

This is the isolated V2 frontend of the existing Control & Chaos site. Decap supports staff settings/events/news/manuals. Supabase powers creator accounts, verified avatar ownership, paid directory access, authenticated Profile Studio editing and anonymous public listings. Rate cards, booking hours and published gallery photos are connected; the richer V1 experience is still being built incrementally. See [NEXT_STEPS.md](NEXT_STEPS.md) for authoritative live evidence and remaining gates.

The Boundaries / How to Book slice requires migration 10 before frontend deployment; the user has applied and verified it in V2. These are optional plain-text fields, not booking requests or reservations. See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for setup history; do not rerun already-applied migrations 1-10.

## Stack

- Vite 8 and Tailwind CSS 4.3.3, installed from the current npm releases.
- Pinned Nunjucks renders complete HTML at build time. Normal and white-label layouts share one head/footer, with explicit navigation/footer differences.
- Shared navigation and hero modules, with gallery, editor, profile and preview-action modules loaded only where needed. Markdown dependencies are editor-only.
- Shared typography, colours, and spacing match the existing site. Tailwind utilities use the `tw:` prefix to avoid collisions with existing design-selector names.
- No inline style attributes, inline event handlers or embedded private credentials are shipped. Creator sessions and authorized saves happen at runtime; privileged terminal operations use server-only Netlify functions.
- The Vite page shell adds a tiny critical dark-canvas rule and an early stylesheet link to prevent white first-paint flashes. Supported browsers use native cross-document fades; reduced-motion preferences disable them. Navigation is not intercepted or artificially delayed.

The page bodies originate from the approved flat visual templates. Their appearance is preserved while header/footer/head markup and creator hero/tabs now have a single source. Page-specific content, cards and editor markup have not all been decomposed or connected to live data. Existing readable presentation classes remain; this is not a completed semantic CSS/BEM rewrite.

## Edit Sources

- `templates/layouts`: normal site and compact white-label layouts.
- `templates/partials`: head/SEO, header, footer, creator hero and profile tabs.
- `templates/pages`: page-specific Nunjucks content. Captured static HTML is wrapped in `raw` blocks; remove or split those blocks when introducing deliberate template fields.
- `content/site.json`: shared brand, navigation, fonts and footer settings, ready for a later Decap schema.
- `content/events`: editable event records rendered into shared cards; published state, order and calendar dates are validated during builds.
- `content/blog`: staff site news, separate from creator posts. One shared article template and build-derived metadata replace per-post captures.
- `content/guides`: product manuals, features, commands, specifications and directory cards. One shared manual template generates new published IDs; stable section anchors support external links.
- `src/modules/directory-api.js`: anonymous Supabase read client; ignored `.env.local` uses names from `.env.example`. `directory.js` handles public list states/filters/pagination; `directory-profile.js` renders the connected public listing, not the old fixture editor.
- `src/modules/creator-editor.js` / `creator-profile-api.js`: authenticated Profile Studio with paid-owner authorization and atomic profile/gallery saves. Protocol text, rates, informational booking hours and gallery publish states are separate from unconnected V1 fixtures.
- `src/modules/auth-api.js` / `auth.js`: separate persistent PKCE creator sessions and `/auth.html` forms. This does not assign avatar ownership or activate the old preview editor. See `SUPABASE_SETUP.md` for the real-account test and mailer limits.
- `content/pages`: per-page metadata and internal creator/tab presentation configuration. Do not expose presentation attributes as CMS fields.
- `content/creator-preview.json`: one public-safe creator hero fixture, not production creator persistence.
- `src/modules`: browser behaviors; `src/main.js` selects the modules needed by the current page.

Root HTML files are generated compatibility outputs. Do not edit them by hand. `npm run render`, `npm test`, `npm run build` and dev startup regenerate them; dev also watches template/content changes. They remain tracked during this transition.

## Run

```powershell
cd j:\FinalGame\v2
npm ci
npm run dev -- --port 4180
```

Open `http://127.0.0.1:4180/`. All page links are flat HTML URLs. `templates.json` lists their original source and fixture state.

For local staff editing, run `npm run cms:local` in a second terminal and open `/admin/`. Its local Login needs no GitHub credentials; it writes to the V2 files, not GitHub. The proxy binds to `127.0.0.1:8081` only. Hosted CMS access still requires GitHub OAuth. See `CMS_SETUP.md` for setup and dependency advisory details.

```powershell
npm test
npm run build
```

For screenshot/layout comparison, run `npm run build`, then `npm run test:visual`. Install Chromium once with `npx playwright install chromium`. The audit starts and closes its own temporary static server and serves the original reference from its compressed fixture. Reports and screenshots are written under ignored `test-results/visual`. An optional `TEMPLATE_BASE_URL` can point it at an existing preview server.

Output is written to `build`; reference pages and test fixtures are not published. Automatic full output cleanup remains disabled because the workspace drive reported a generated-directory lock. A failed earlier `dist` folder is ignored and is not source content. `netlify.toml` declares `npm run build`, publish directory `build`, Node 22 and staging noindex headers. Remove staging restrictions only as part of an approved production cutover.

## Coverage

- Home, store, XP/rules, guides, blog, events, contact, directory.
- Individual guide and site-blog templates.
- Directory signup, checkout, management, and creator editor.
- Creator rate card, public blog, subscriber preview, gallery, and individual post.
- White-label creator pages and post/tab states.

The connected directory profile and Profile Studio use real authorized reads/saves. Retained V1-style blog, feed, white-label and legacy editor fixtures are visual references only; their controls do not imply connected private-content or booking features. Restricted-content fixtures are public-safe teasers, not imported private records.

## Visual Baseline

`scripts/fixtures/visual-reference.json.gz` contains the lossless original-CSS snapshots for all 32 pages. The visual audit works without V1 or the ignored `public/reference` folder. The fixture is outside public assets and excluded from the deployment.

`npm run capture` is a legacy extraction tool requiring local `../main` sources. It is not part of dev, build, tests or deployment. Do not run it over this shared-template implementation: it overwrites generated HTML/styles and does not update the authoritative Nunjucks/content sources.

## Next Phase

See `HANDOFF.md` for the verified stage, preview URLs, validation commands, and the boundary between these flat references and the future production rewrite.

See `CMS_SETUP.md` for OAuth setup and publish/rebuild verification. Settings, events, site news and manuals are implemented. The product catalogue, XP/rules and selected page fields remain code-managed until their CMS fields are agreed. Supabase integration follows later with permissions and migration/rollback tests.

V1 remains untouched. V2 has its own GitHub repository (`haydentomas/controlandchaos.co.uk.v2`) and staging site (`https://controlandchaosv2.netlify.app/`). Shared templates were pushed as `c34fde0`; the completed CMS milestone is approved for commit/push. Confirm its Netlify deployment separately. Next create a Supabase development project using `SUPABASE_SETUP.md`; no database connection is implemented yet.