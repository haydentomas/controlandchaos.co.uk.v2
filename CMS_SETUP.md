# V2 Staff CMS Setup

## Implemented Locally

- Decap 3.16.3 is pinned at `/admin/`.
- GitHub backend targets only `haydentomas/controlandchaos.co.uk.v2`, branch `main`.
- Staff can edit shared branding/navigation/footer and create/edit/delete events, site-blog posts and product manuals.
- Nunjucks renders the content before deployment. JSON Schema validation rejects unsafe URLs, unknown settings, malformed events and invalid calendar ranges.
- Event filters, selected states and live counts work on desktop/mobile.
- Admin login/editor controls use a scoped dark theme. Settings preview shows the shared header/footer at a bounded logo size; events preview shows the shared event card. Both update from unsaved draft values.
- No directory listings, creator posts, account credentials or private media are exposed through Decap collections.
- Only trusted staff with GitHub push access to this repository can publish. GitHub access also permits code changes; this is not a restricted creator role.
- Local development uses Decap's filesystem proxy, bound to `127.0.0.1:8081` and rooted in V2. Local Login requires no GitHub account or password; hosted publishing still uses GitHub OAuth.

The user approved committing/pushing this CMS milestone on 2026-10-04. Confirm Netlify's deployment after the push before treating hosted behavior as verified. The earlier shared-template commit is `c34fde0`; hosted OAuth/publishing still needs setup.

## Configure Authentication

1. In GitHub, open Settings > Developer settings > OAuth Apps > New OAuth App.
2. Suggested application name: `Control & Chaos V2 Staff CMS`.
3. Homepage URL: `https://controlandchaosv2.netlify.app/`.
4. Authorization callback URL: `https://api.netlify.com/auth/done`.
5. Generate a client secret. Keep it private; never paste it into chat or commit it.
6. In the NEW V2 Netlify project, open Project configuration > Security > OAuth.
7. Under Authentication Providers, select Install Provider > GitHub. Enter the client ID and secret directly in Netlify and save.
8. After this CMS phase is deployed, open `https://controlandchaosv2.netlify.app/admin/` and sign in with your authorized GitHub staff account.

Do not enable V1's old Git Gateway/Identity setup for this configuration. The CMS's GitHub backend uses the OAuth provider above. Creator/fan authentication will be a separate Supabase integration later.

Official instructions:
- https://decapcms.org/docs/github-backend/
- https://docs.netlify.com/visitor-access/oauth-provider-tokens/

## Verify Publishing

1. Record the current footer wording.
2. Make a small footer text change in Site Settings & Global Components and publish it.
3. Verify a GitHub commit in the V2 repository and a successful Netlify build.
4. Confirm the changed footer on two different pages, then restore the wording through Decap.
5. Edit one event and verify its card, category filter and calendar link after deployment.
6. Verify an unpublished event is omitted and re-publishing restores it.

Authenticated publishing has not been tested yet. A failed content-validation build should not be treated as a successful publication: fix the invalid record and confirm a successful deployment. Decap saves source JSON; root HTML is regenerated during Netlify's build.

## Content Rules

- Manuals live in `content/guides`. Five original guides are imported; new published IDs generate `/guide-ID.html`, a directory card, metadata and related-manual links.
- Edit product details, directory card image/text, ordered Markdown sections, features, commands and technical specifications in Product Guides & Manuals. Keep layout/CSS in the shared manual template.
- Guide IDs and section anchors should stay stable once linked. Blank anchors are generated from section order; explicit unique anchors are recommended. `template`, `guide-commands` and `guide-specs` are reserved.
- Guide Markdown uses the shared sanitizer. Unpublishing/deleting removes generated guide pages and directory entries; review any manually configured links elsewhere before removing a guide.
- Site news lives in `content/blog`, separately from creator posts. The build generates feed cards, shared articles, metadata and recent-post links.
- New posts default to unpublished. Publication date controls newest-first order; display date is separate text, and same-date order breaks ties.
- Keep IDs stable. Published records automatically generate `/blog-ID.html`; unpublishing/deleting removes the feed entry and generated source/build page. Draft source remains in Git, not a private-media vault.
- Marked and sanitize-html replace the legacy string renderer. Article heights may change because empty paragraphs and extra list breaks are removed.
- Blog search, filters, empty state and Load More operate on the generated feed. Hosted changes still require a successful rebuild.
- Uploads go to `public/assets/uploads` and appear publicly under `/assets/uploads`. Never upload subscriber-only/private media through this CMS.
- Existing event IDs should not be renamed; their filenames must match their IDs.
- Event display dates are text, allowing recurring schedules.
- Optional calendar start/end must both be supplied, include a timezone and have end after start. Blank dates leave Google Calendar's timing unspecified; this does not create a recurring subscription.
- Optional calendar title/details/location fall back to the normal event values.
- Keep layout classes, internal page contexts and the safe creator preview fixture out of CMS collections.
- No Supabase setup is needed to test staff content publication.

## Remaining CMS Work

Events, site news/articles, product manuals and global settings are implemented. Product catalogue, XP/rules and selected page copy remain code-managed until editable schemas are agreed.

Recommendation for XP/rules: eventually expose its text, tables and rule entries as one fixed-page Decap file collection, not a free-form page builder. Rare updates still benefit from an editor and version history. This guide task does not implement that collection; the user has not decided yet.

Other pages can be CMS-managed without changing their layouts: extract headings, descriptions, images, links and repeatable items into validated JSON; reference those fields from the existing Nunjucks page; expose only the content through a Decap file collection. Keep component structure, CSS, scripts and internal attribute maps in code. A full HTML/page-builder editor is not required or recommended.

## Theme And Previews

- `public/admin/admin.css` styles Decap's outer interface using scoped semantic widget hooks, not generated CSS hashes. Decap upgrades require a visual check of those hooks.
- `public/admin/previews.js` registers settings/event/blog/guide previews; draft values are escaped and unsafe links blocked. Blog/guide documentation previews use Decap widgets. Wait for the iframe's site stylesheet before assessing appearance; preview transitions are disabled.
- `scripts/cms-previews.mjs` precompiles the existing Nunjucks header/footer/event-card partials into generated `public/admin/preview-templates.js`. Do not edit that generated file.
- `/admin/site-preview.css` serves the site CSS: Vite uses the source pipeline locally, and production builds copy the compiled main stylesheet there.
- `public/admin/preview.css` adapts shared components to the narrow pane. Important navigation overrides use the site's CSS layer to keep wrapped links visible and prevent footer overlap.
- Refresh the CMS after changing preview scripts/styles. Draft edits update immediately without saving or publishing.

## Local Review

The existing dev preview is at `http://127.0.0.1:4182/admin/`. Vite explicitly resolves `/admin` and `/admin/` to the public admin index instead of falling back to the homepage.

Run the dev server and proxy in separate terminals from the V2 root:

```powershell
npm run dev -- --port 4182 --strictPort
```

```powershell
npm run cms:local
```

Refresh `/admin/` and click Login. No GitHub credentials are required locally. Changes made through the local CMS save directly to V2 source files and appear through the template watcher; they do not commit, push or publish to Netlify. Review and commit them deliberately.

The proxy uses a process-scoped Git ownership exception for V2 on the J: drive, not a global Git trust change. It listens only on loopback and retains Decap's local-only CORS restriction. Never expose the proxy through port forwarding or enable production hosts in `local_backend.allowed_hosts`.

Browser checks verified local Login opens both collections and an HTTPS non-local hostname still shows GitHub login without contacting the proxy. Production OAuth and repository publishing still require the setup above.

Dependency note: the pinned development-only `decap-server` inherits a low-severity `@hapi/joi` advisory (npm reports two affected packages, no fix available). The proxy and its Node dependencies are not shipped as public assets. Reassess when a fixed upstream release is available.

```powershell
npm ci
npm test
npm run build
npm run test:visual
```

Verified: 53 tests, production build and 64 desktop/mobile comparisons with blog/event interactions. CMS article heights and manual vertical flow are content-dependent; navigation/horizontal geometry remain checked. Focused browser checks verify guide editing, unsaved preview updates, loaded styles, anchors and no desktop/mobile overflow. A reference-page network timeout passed on audit rerun; the earlier native-transition timing caveat remains. Hosted OAuth callbacks/publishing remain unverified until manual setup.