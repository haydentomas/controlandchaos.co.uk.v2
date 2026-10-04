# V2 Flat Template Handoff

## Current Stage

The user requested a separate `v2` folder containing a flat version of the current site's templates in the latest Tailwind, preserving the current appearance before building the production application properly.

- `main` has not been edited by this V2 capture/scaffold task. Its earlier uncommitted hardening work remains separate.
- V2 uses Vite 8.3.2 and Tailwind 4.3.3.
- There are 32 flat HTML template states. `templates.json` is the page inventory.
- Styles are centralized in `src/templates.css` and `src/portal.css`; templates contain no inline style attributes or inline event handlers.
- Tailwind utilities use `tw:` to avoid collisions with legacy design-selector names.
- Pages contain rendered sample/public-safe fixture data, not live backend logic.
- Layout hierarchy remains a visual reference, not the final production component architecture. Generated `ui-*` hashes and unused IDs have been removed; direct Tailwind utilities, shared rich-text rules, and readable component styles replace them.
- Retain IDs only for working preview controls, anchors, native labels, or accessibility references. Do not reintroduce opaque capture hashes or per-paragraph styling classes.
- Preview actions do not authenticate, publish, process payments, or modify the original site.
- The editor sidebar is non-sticky on narrow screens so it cannot cover post controls during scrolling. Initial layout remains matched to the reference.
- Profile navigation tabs wrap into visible touch-friendly rows below 700px, including article and white-label pages. They do not require horizontal scrolling and retain a stronger active state than gallery-category filters.
- No Supabase work, deployment, Git repository creation, or push occurred in this task.

## Validation

- 36 structural/page-shell tests pass, including hashed-class removal, plain article paragraphs, early dark canvas, and native fades.
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

The visual audit starts its own temporary server. Reports/screenshots are under ignored `test-results/visual`.

## Preview

```powershell
npm run dev -- --port 4180 --strictPort
```

Start at `http://127.0.0.1:4180/`. Individual templates use flat URLs such as `/directory.html`, `/directory-editor.html`, `/profile-gallery.html`, and `/profile-post-white-label.html`.

## Source Refresh Warning

`npm run capture` reads the existing `../main` templates, renders them offline, copies public referenced assets, and regenerates V2 HTML and `src/portal.css`. It overwrites captured files. Do not run it over subsequent manual template work without preserving those changes.

`public/reference` contains original-CSS visual snapshots for validation. They are not the templates to develop into production and should be excluded from any future public deployment.

The initial Windows output cleanup failed for a generated `dist/images` directory on the workspace drive. Production-style V2 output now uses ignored `build`, with automatic deletion disabled. The old ignored `dist` directory is not source content. Unused generated files under `src/assets` are also not imported or shipped.

## Next Work, After Visual Review

1. Confirm the required template inventory and review the visual baseline with the user.
2. Replace the mechanically captured markup/classes with deliberate shared layouts and semantic Tailwind components while maintaining screenshots.
3. Use a consistent Markdown library and sanitized rich-text styling, not the former regex/string renderers.
4. Design Supabase ownership, verified Second Life identity linking, subscriptions, posts, domains, and media policies before wiring backend features.
5. Add real sessions, transactional saves, pagination, protected media, backups/import/rollback, and negative authorization tests.
6. Add shared authenticated likes only after the data/auth model works.

Keep C&C canonicals and custom-domain branded mirrors. Preserve normal versus white-label navigation/footer differences and the shared creator hero/tab layout.

V2 is outside the existing `main` Git repository. Choose its repository/deployment arrangement explicitly before publishing. Do not silently add it to the current live site's deployment or undo pending `main` changes.