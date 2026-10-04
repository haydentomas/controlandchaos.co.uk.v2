# Directory Database Setup

## First Milestone

Keep staff events, site news and manuals in Decap. Supabase will own live directory profiles, accounts and creator content. Start with a database-backed public directory and authorized profile editing; payments, subscriber unlocks, production imports and private-media migration are later milestones.

No Supabase project is connected, no SQL has been applied, and the current directory/editor still use preview fixtures. Adding environment variables alone will not connect them.

## Step 1: Create The Development Project

1. Sign in at https://supabase.com/dashboard.
2. Create a new project in a Free-plan organization for development. Do not upgrade a plan for this step.
3. Suggested project name: `control-and-chaos-v2-dev`.
4. Generate a strong database password and store it in your password manager. Never send it through chat.
5. Choose a region near the intended audience. For a mainly UK audience, choose London if available; otherwise a suitable nearby European region. Consider any residency requirements before choosing.
6. Create the project and wait until it is ready.
7. Stop there: do not create public tables/buckets, disable security policies or import production Blobs data yet.

Tell the assistant that the project is ready, its region and its public project URL. The URL is not a secret. Do not share database passwords, secret keys, service-role keys or access tokens.

## Step 2: Configure Public Client Values

After the project is ready, use its Connect dialog or Settings > API Keys to find its URL and publishable key. Use the current `sb_publishable_...` key, not a secret key.

Enter the values directly into ignored `.env.local` in the V2 root, using the names in `.env.example`:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

The publishable key is designed for browser use but does not grant ownership or bypass database permissions. Never put `sb_secret_...`, a legacy service-role key or a database password in a `VITE_` variable. Keep privileged credentials server-only if a later backend task requires them.

We will configure matching Netlify staging variables and Auth redirect URLs when the database/client implementation is ready. Do not configure the live V1 site.

## Work Split

User: create the development project, retain credentials privately, enter requested settings directly, and run reviewed migrations through the authenticated dashboard when instructed.

Assistant: prepare versioned SQL migrations and permission tests, public-directory queries and pagination, safe frontend configuration, real creator sessions and verified avatar ownership. Give one dashboard/setup step at a time.

## Gates Before Real Directory Editing

- Design private account/ownership data separately from the public directory projection.
- Enable row-level security and least-privilege grants before exposing data.
- Verify anonymous users see only approved public records, and users cannot edit another creator's data or grant themselves verified ownership.
- A supplied Second Life UUID is not proof of avatar ownership. Define and test a challenge/verification flow before enabling creator writes.
- Stage safe sample data first; then prepare a dry-run Blobs import with stable identifiers, backups and rollback.
- Do not change production payments, kiosk credentials, custom domains or live storage during this development milestone.

Provider documentation: https://supabase.com/docs/guides/api/api-keys