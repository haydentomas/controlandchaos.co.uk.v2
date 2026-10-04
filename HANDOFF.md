# V2 Shared Template Handoff

## Current Stage

The user requested a separate `v2` folder containing a flat version of the current site's templates in the latest Tailwind, preserving the current appearance before building the production application properly.

Updated 2026-10-04: the user rejected Astro and approved plain HTML/Tailwind/modular JavaScript with build-time Nunjucks. All 32 pages now use shared layouts/head/header/footer; all 10 creator states use shared hero/tabs. Decap and Supabase remain unconnected. This implementation is local, uncommitted and unpushed.

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

- 41 structural/page-shell tests pass, including shared-setting propagation, creator escaping, compact white-label output, hashed-class removal, early dark canvas and native fades.
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

1. Review the local shared-template changes and explicitly approve a commit/push when ready. Do not assume earlier baseline push authorization covers this new implementation.
2. Define Decap staff schemas and extract editable content fields from page bodies. Keep layouts/classes in code and creator data out of Git-backed CMS collections.
3. Continue suitable page-specific component/semantic styling extraction without unrelated redesign. Markdown already uses Marked/DOMPurify in the editor-only module.
4. Design Supabase ownership, verified Second Life identity linking, subscriptions, posts, domains, and media policies before wiring backend features.
5. Add real sessions, transactional saves, pagination, protected media, backups/import/rollback, and negative authorization tests.
6. Add shared authenticated likes only after the data/auth model works.

Keep C&C canonicals and custom-domain branded mirrors. Preserve normal versus white-label navigation/footer differences and the shared creator hero/tab layout.

V2 is a separate Git repository with an established staging deployment. Do not silently alter V1's deployment, move the live domain or undo pending `main` changes.