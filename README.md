# V2 Flat Design Templates

This is an isolated visual prototype of the existing Control & Chaos site. It is not a production backend or a Supabase migration.

## Stack

- Vite 8 and Tailwind CSS 4.3.3, installed from the current npm releases.
- Static HTML pages at the project root, local public assets, and one small preview-interaction module.
- Shared typography, colours, and spacing match the existing site. Tailwind utilities use the `tw:` prefix to avoid collisions with existing design-selector names.
- No inline style attributes, inline event handlers, authentication tokens, live publishing, payment processing, or Netlify API calls are shipped.
- The Vite page shell adds a tiny critical dark-canvas rule and an early stylesheet link to prevent white first-paint flashes. Supported browsers use native cross-document fades; reduced-motion preferences disable them. Navigation is not intercepted or artificially delayed.

The initial pages are mechanically captured from the existing rendered templates using offline public fixtures. Their layout hierarchy is preserved as a visual blueprint. Opaque `ui-*` style hashes and unused IDs are removed. Simple presentation uses explicit `tw:` utilities; rich-text paragraphs share container-scoped typography; conflicting shorthands use readable component styles compiled through Tailwind `@apply`. IDs remain only where needed by preview controls, anchors, labels, or accessibility references. Complex CSS, animations, and theme variables remain in the shared stylesheet. This is a reference stage, not a claim that the old application's architecture has been rebuilt.

## Run

```powershell
cd j:\FinalGame\v2
npm install
npm run dev -- --port 4180
```

Open `http://127.0.0.1:4180/`. All page links are flat HTML URLs. `templates.json` lists their original source and fixture state.

```powershell
npm test
npm run build
```

For screenshot/layout comparison, run `npm run build`, then `npm run test:visual`. The audit starts and closes its own temporary static server. Reports and screenshots are written under the ignored `test-results/visual` folder. An optional `TEMPLATE_BASE_URL` can point it at an existing preview server.

Production-style preview output is written to `build`. Automatic output cleanup is disabled because the workspace drive reported a generated-directory lock during testing. A failed earlier `dist` folder is ignored and is not source content.

## Coverage

- Home, store, XP/rules, guides, blog, events, contact, directory.
- Individual guide and site-blog templates.
- Directory signup, checkout, management, and creator editor.
- Creator rate card, public blog, subscriber preview, gallery, and individual post.
- White-label creator pages and post/tab states.

Navigation, mobile drawer, gallery filters/lightbox and editor section switching are preview interactions only. Save/payment/admin controls do not publish or authenticate. Restricted-content fixtures are public-safe teasers, not imported private records.

## Visual Baseline

`public/reference` contains safe original-CSS snapshots for comparison with the Tailwind versions. They have no application scripts. This directory is only a design reference and can be removed before any future deployment.

`npm run capture` regenerates pages and styles from the current local `../main` sources. Treat it as a deliberate refresh operation: it overwrites captured HTML and `src/portal.css`. Do not run it after hand-editing templates without preserving those changes.

## Next Phase

See `HANDOFF.md` for the verified stage, preview URLs, validation commands, and the boundary between these flat references and the future production rewrite.

Review these templates first. Then extract shared page layouts/components and semantic Tailwind styles, replace fixture state with a deliberate data model, and add Supabase authentication/database/private storage with tested permissions. Do not copy the former browser authentication, string-based dynamic renderers, or payment logic into production V2.

`main` was not changed by this scaffold. V2 is a sibling of the existing `main` Git repository and is not included in its Netlify deployment. No new repository or deployment has been provisioned.