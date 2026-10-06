# Creator Blog Checkpoint

Updated: 2026-10-06
Branch: `feature/creator-blog-pass-through-20261006`
Base commit: `b68d7fe` (`feat: collapse toys and wishlist sections`)

## Current State

Rollout update: the user approved pushing the feature branch for a Netlify branch deploy, leaving main and the v4.1 in-world terminal unchanged. Commit `1778816` is pushed. Branch-deploy settings are enabled for this branch per the user's screenshot; build/preview availability is not yet confirmed. A further approved documentation commit/push will trigger the newly enabled branch build. Preview auth callback configuration remains pending.

Latest local milestone: mixed-media posts with up to 10 ordered image/audio/video attachments, owner previews, and account-password recovery/settings are implemented and approved for a local-only commit on this branch. No push, merge or deployment is authorized; do not infer hosted availability. The user reported applying migration 15 at 20:40 and the final verification result `4, true, true`; earlier RPC existence/privilege result sets have not been separately confirmed. Do not reapply the migration. The user confirmed mixed-media draft save/reload persistence at 20:42.

The V2 creator blog and finance-alt pass-through are committed and pushed as `cad00d9` on this feature branch; no merge into `main` or feature deployment is confirmed. The user applied migration 14 to the sole, production-bound V2 Supabase project and confirmed the initial table/private-bucket checks. After explicit approval and verification of the owner/avatar mapping, the user applied the V1 import. Their SQL result confirms Alek Zane's profile `fc88de3a-315d-44db-b3b4-cb04ef1c0409` remains unpublished with 4 imported posts, 1 subscriber post and L$1,500/month. No Netlify secrets or trusted kiosk identity have been changed by the assistant, and no finance-terminal replacement or debit grant has been reported.

The local implementation includes:

- Creator Studio for a unified public/live/subscriber post feed, benefits, and one flat monthly L$ price.
- Public profile Blog tab. Locked posts show their teaser only; full text and media are returned only when the server recognizes an active entitlement. Subscriber media uses short-lived signed URLs.
- Trusted kiosk-only offer and payment actions. The shared finance-alt terminal forwards the exact monthly amount to the selected creator; access begins only after `transaction_result` confirms payout.
- Linkset Data receipts and conservative recovery. An uncertain Linden transfer blocks sales for manual reconciliation; it is never automatically retried.
- V1 importer that combines `posts` and `blog_posts`, preserves text and lock state, carries over the monthly price/benefits, and excludes old locked-media URLs.

The approved V1 import carried over Alek Zane's 3 feed posts, 1 public blog post, L$1,500/month offer and benefits. One locked media file must be re-uploaded to V2 private storage; its old URL was excluded. The user ran the import twice, and the SQL check confirms 4 imported posts, not duplicates. Do not rerun after editing posts/uploading media: the importer updates existing legacy records.

## Validation

- Local milestone committed as `1778816`, then pushed with explicit preview-only approval. Pre-existing trailing Git commands were excluded and remain unstaged. Main deployment remains at `b68d7fe` per the user's Netlify screenshot.
- At 21:17 a live owner-authorized 10-second signed link for a saved unpublished draft video returned HTTP 206 immediately and HTTP 400 / `InvalidJWT` on a new unauthenticated no-store request after 20 seconds. No media URL/token/body was returned to chat, and no metadata/files were changed. Expired-link new-request denial is verified; cached/downloaded content revocation and real paid-subscriber playback are not.

- Real database checks reported by the user: anonymous access to the unpublished profile returned zero feed posts and zero Storage rows. At 20:56 an explicitly approved rollback-only publication test returned 5 visible posts, 3 public posts, 2 locked posts and 0 subscriber body/media/attachment metadata leaks. The profile and test draft were published only inside that transaction, ending with rollback.
- At 21:00 the approved rollback-only published-profile Storage check returned 2 actual subscriber files tested and 0 anonymously visible subscriber files. Anonymous Storage row denial for those files is now verified. No persistent publication was requested.
- At 21:03 the user confirmed the requested owner preview/playback check was all good in the local Blog Studio after reload. Owner media access is user-confirmed for the tested draft; this does not establish coverage of every media format, signed-link expiry or paid-subscriber playback. The user then approved reviewing and committing the local milestone only, without push/deployment/publication.

- Local owner media previews were added after the user verified draft save/reload and private upload persistence. Saved media uses five-minute signed URLs; selected files have a local preview before saving. Reopen the post to renew an expired private preview. Images and audio/video controls are shown without publishing the profile or changing Storage policies.
- The editor now preserves real rich-text instances across attachment edits; a real-widget browser workflow passed. The initial general rapid load/destroy TOAST UI `removeChild` issue is not claimed resolved by this change.

- Fresh pre-commit `npm test`: 166 tests passed.
- `npm run test:blog:browser`: 3 workflows passed; `npm run test:auth:browser`: 1 workflow passed.
- `npm run build`: succeeded. Vite reports the existing 500 kB chunk-size warning.
- Edited-file diagnostics and `git diff --check`: clean.
- The LSL script has static contract tests; it has not been compiled or tested in-world.

## Continue At Home

1. Fetch and check out `feature/creator-blog-pass-through-20261006` from `origin`.
2. Read this guide and `NEXT_STEPS.md`; confirm `git status` is clean before resuming.
3. Review migration `supabase/migrations/202610060014_creator_blog_subscriptions.sql`, especially the owner/verified-avatar checks, private media policies, payment state transitions, service-role importer grant, and global finance-terminal setting.
4. Run `npm test` and `npm run build` after any edits.
5. Migrations 14/15 are already applied to the sole V2 project; do not rerun them. Treat this database as production-bound regardless of its `-dev` name.
6. The approved import and owner save/reload/playback checks are complete. Next test signed-link expiry while the profile remains unpublished; real subscriber/payment testing requires separate approval and finance-terminal readiness. The conventional Netlify branch URL returned 404; a preview is not confirmed. Keep any privileged environment values and signed URLs private, never chat or source.
7. For in-world payment testing, first coordinate the finance alt as terminal owner, keep the object non-group-deeded, set the exact trusted owner/object IDs in Netlify, and verify its private notecard setup. Grant `PERMISSION_DEBIT` only by an explicit in-world action from the finance-alt owner. Do not use real customer funds for the first test.
8. Compile and test the complete LSL script in-world. Exercise successful creator payout, definite payout failure/refund, and ambiguous transfer/manual-reconciliation behavior before enabling sales.

No GitHub `main` update or production deployment is part of this checkpoint. A branch push may create a preview depending on Netlify branch settings.
