# Creator Blog Checkpoint

Updated: 2026-10-06
Branch: `feature/creator-blog-pass-through-20261006`
Base commit: `b68d7fe` (`feat: collapse toys and wishlist sections`)

## Current State

The V2 creator blog and finance-alt pass-through are implemented locally on this feature branch. The work is not deployed, and migration 14 has not been applied to Supabase. No import has been applied, no Netlify secrets or trusted kiosk identity have been changed, and no in-world terminal or debit permission has been changed.

The local implementation includes:

- Creator Studio for a unified public/live/subscriber post feed, benefits, and one flat monthly L$ price.
- Public profile Blog tab. Locked posts show their teaser only; full text and media are returned only when the server recognizes an active entitlement. Subscriber media uses short-lived signed URLs.
- Trusted kiosk-only offer and payment actions. The shared finance-alt terminal forwards the exact monthly amount to the selected creator; access begins only after `transaction_result` confirms payout.
- Linkset Data receipts and conservative recovery. An uncertain Linden transfer blocks sales for manual reconciliation; it is never automatically retried.
- V1 importer that combines `posts` and `blog_posts`, preserves text and lock state, carries over the monthly price/benefits, and excludes old locked-media URLs.

The V1 importer dry-run currently sees Alek Zane: 3 feed posts, 1 public blog post, L$1,500/month, and 1 locked media file that must be re-uploaded to V2 private storage. Dry-run made no network request.

## Validation

- `npm test`: 157 tests passed.
- `npm run build`: succeeded. Vite reports the existing 500 kB chunk-size warning.
- Edited-file diagnostics and `git diff --check`: clean.
- The LSL script has static contract tests; it has not been compiled or tested in-world.

## Continue At Home

1. Fetch and check out `feature/creator-blog-pass-through-20261006` from `origin`.
2. Read this guide and `NEXT_STEPS.md`; confirm `git status` is clean before resuming.
3. Review migration `supabase/migrations/202610060014_creator_blog_subscriptions.sql`, especially the owner/verified-avatar checks, private media policies, payment state transitions, service-role importer grant, and global finance-terminal setting.
4. Run `npm test` and `npm run build` after any edits.
5. Before any remote action, explicitly decide whether to apply migration 14 to the development project. Do not apply it to production or assume it has already run.
6. Review the importer dry-run first. Only use `--apply` after the migration is installed, the V1-to-V2 owner/avatar mapping is verified, and the import is explicitly approved. Its privileged environment values belong only in the local terminal: `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
7. For in-world payment testing, first coordinate the finance alt as terminal owner, keep the object non-group-deeded, set the exact trusted owner/object IDs in Netlify, and verify its private notecard setup. Grant `PERMISSION_DEBIT` only by an explicit in-world action from the finance-alt owner. Do not use real customer funds for the first test.
8. Compile and test the complete LSL script in-world. Exercise successful creator payout, definite payout failure/refund, and ambiguous transfer/manual-reconciliation behavior before enabling sales.

No GitHub `main` update or production deployment is part of this checkpoint. A branch push may create a preview depending on Netlify branch settings.
