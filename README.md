# V2 Shared Site Templates

This is the isolated V2 frontend of the existing Control & Chaos site. Shared layouts are implemented; its content and interactions still use safe preview fixtures. Decap, authentication, payments and Supabase are not connected.

## Stack

- Vite 8 and Tailwind CSS 4.3.3, installed from the current npm releases.
- Pinned Nunjucks renders complete HTML at build time. Normal and white-label layouts share one head/footer, with explicit navigation/footer differences.
- Shared navigation and hero modules, with gallery, editor, profile and preview-action modules loaded only where needed. Markdown dependencies are editor-only.
- Shared typography, colours, and spacing match the existing site. Tailwind utilities use the `tw:` prefix to avoid collisions with existing design-selector names.
- No inline style attributes, inline event handlers, authentication tokens, live publishing, payment processing, or Netlify API calls are shipped.
- The Vite page shell adds a tiny critical dark-canvas rule and an early stylesheet link to prevent white first-paint flashes. Supported browsers use native cross-document fades; reduced-motion preferences disable them. Navigation is not intercepted or artificially delayed.

The page bodies originate from the approved flat visual templates. Their appearance is preserved while header/footer/head markup and creator hero/tabs now have a single source. Page-specific content, cards and editor markup have not all been decomposed or connected to live data. Existing readable presentation classes remain; this is not a completed semantic CSS/BEM rewrite.

## Edit Sources

- `templates/layouts`: normal site and compact white-label layouts.
- `templates/partials`: head/SEO, header, footer, creator hero and profile tabs.
- `templates/pages`: page-specific Nunjucks content. Captured static HTML is wrapped in `raw` blocks; remove or split those blocks when introducing deliberate template fields.
- `content/site.json`: shared brand, navigation, fonts and footer settings, ready for a later Decap schema.
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

Navigation, mobile drawer, gallery filters/lightbox and editor section switching are preview interactions only. Save/payment/admin controls do not publish or authenticate. Restricted-content fixtures are public-safe teasers, not imported private records.

## Visual Baseline

`scripts/fixtures/visual-reference.json.gz` contains the lossless original-CSS snapshots for all 32 pages. The visual audit works without V1 or the ignored `public/reference` folder. The fixture is outside public assets and excluded from the deployment.

`npm run capture` is a legacy extraction tool requiring local `../main` sources. It is not part of dev, build, tests or deployment. Do not run it over this shared-template implementation: it overwrites generated HTML/styles and does not update the authoritative Nunjucks/content sources.

## Next Phase

See `HANDOFF.md` for the verified stage, preview URLs, validation commands, and the boundary between these flat references and the future production rewrite.

Next define Decap's staff content schemas and extract the corresponding editable page fields. Then add Supabase authentication/database/private storage with tested permissions and migration/rollback procedures. Do not copy the former browser authentication, string-based dynamic renderers or payment logic into production V2.

V1 remains untouched. V2 has its own GitHub repository (`haydentomas/controlandchaos.co.uk.v2`) and staging site (`https://controlandchaosv2.netlify.app/`). This shared-template work is local and has not been committed, pushed or deployed.