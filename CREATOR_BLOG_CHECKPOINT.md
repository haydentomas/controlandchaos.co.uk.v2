# Creator Blog Checkpoint

Updated: 2026-10-08
Branch: `feature/creator-blog-pass-through-20261006`
Base commit: `b68d7fe` (`feat: collapse toys and wishlist sections`)

## Current State — 2026-10-08

Production `main` is at `bca49ee` (`fix: preserve creator owner blog access`); Netlify reports it ready. The user applied VIP entitlements migration 18 and owner blog-access migration 19, then confirmed both verification booleans are true. Basic listings expose at most four profile-card photos and no Gallery tab or Creator Blog; VIP listings get the full 20-photo Gallery and Creator Blog/paid subscriber content. A Basic downgrade keeps overflow VIP photos stored and hidden, and active fan passes retain content/media access through their expiry. Custom domains remain a planned VIP perk, not a V2 feature yet.

The public creator-pass popup is live: creator-specific benefits, exact verified avatar UUID copy, and the shared terminal teleport location when configured. There is no Direct IM or “already subscribed” bypass. The authenticated account page has a role-gated Superadmin shortcut, and internal page links use clean URLs.

The split `CC_V2_Directory_Terminal.lsl` / `CC_V2_Creator_Pass.lsl` pair is reported running on the finance-alt-owned prim. One approved L$3,200 creator-pass payment to Alek Zane completed and must not be repeated. The tested split script source and related tests are still local changes; committing/pushing them is separate from the VIP site release and does not install scripts in-world. Unrelated local payment/reminder test edits and checkpoint notes must be reviewed before any cleanup commit.

**Next discussion:** decide which premium profile features follow gallery/blog, beginning with custom-domain requirements and other V1 VIP perks. Do not run more real payment/refund tests or change terminal trust configuration without separate approval.

## Historical Creator Blog And Terminal Checkpoint

Paused by the user on 2026-10-06 at 22:09. **2026-10-07 update:** The finance alt owns and controls the running split terminal, `CC_V2_Directory_Terminal.lsl` plus `CC_V2_Creator_Pass.lsl`, with the existing private `CC_V2_Terminal_Config`. The earlier combined v4.2 script hit `Stack-Heap Collision`; both split scripts report ready and load configuration. Prim UUID: `86113e1e-c04c-8806-f4e2-caab710bc0e8`. Terminal account connection works after trusted verification settings were repaired.

Hosted Decap CMS login is restored: a GitHub OAuth App was registered and its provider installed on the V2 Netlify site after the user confirmed no provider was installed. The user reports the production site displays the 20-photo gallery feature. The creator-blog branch was fast-forward pushed to `origin/main` at `7e0718f`; the account-subscription list was deployed in `f56af8c`, followed by responsive account layout/card polish at `main@32d34f4`.

At 01:50 the user paid L$3,200 for Alek Zane's creator pass. The helper accepted receipt `c383a5a9-c528-8679-1341-dca62df43a31` but stopped before payout because it parsed `payment` instead of the API's `payout` JSON key. The corrected helper safely re-queried the same idempotent receipt, verified the backend still said `prepared`, and resumed it. The user reports Second Life confirmed payment to Alek Zane and the terminal logged "Creator subscription active for 30 days." This creator payout/activation test succeeded; do not repeat the payment.

Separate issue: selecting Directory Plans previously returned "Subscriptions are unavailable or a payment is awaiting confirmation" before querying plans. No payment was made in that attempt. The local core fix removes the Creator Pass session marker from its sticky startup block and checks creator state dynamically; nine focused tests pass, diagnostics and `git diff --check` are clean. This core fix is local-only and not confirmed installed in-world.

Next safe check, if still wanted: install the local core stale-lock fix in-world, then inspect Directory Plans and confirm whether Basic Monthly is still L$1; cancel without paying. The creator-pass test is complete; do not repeat it. Further payout/refund/ambiguous-transfer tests require separate approval. Never clear Linkset Data or change the working terminal IDs/secrets.

The signed-in account page has a responsive two-column desktop layout and single-column mobile layout. Creator subscriptions are cards with an avatar image where available, initials fallback, active/expiry status, and direct Open profile & blog link. Migration `202610070016_creator_blog_subscription_list.sql` adds the authenticated user-scoped RPC; the user reports applying it. Production is deployed at `main@32d34f4`, and the user confirms the live page shows Alek's active subscription card. Validation: 168 tests and production build pass; Playwright browser validation unavailable because Chromium is not installed. No additional payment is needed; the user plans to pause.

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

## Historical Continue At Home Notes

The steps below were written before the 2026-10-08 VIP release and are retained as a testing history. Their statements that migrations 18/19, production deployment, or tier gating are pending are superseded by the current status above.

1. Fetch and check out `feature/creator-blog-pass-through-20261006` from `origin`.
2. Read this guide and `NEXT_STEPS.md`; confirm `git status` is clean before resuming.
3. Review migration `supabase/migrations/202610060014_creator_blog_subscriptions.sql`, especially the owner/verified-avatar checks, private media policies, payment state transitions, service-role importer grant, and global finance-terminal setting.
4. Run `npm test` and `npm run build` after any edits.
5. Migrations 14/15 are already applied to the sole V2 project; do not rerun them. Treat this database as production-bound regardless of its `-dev` name.
6. The approved import and owner save/reload/playback checks are complete. Next test signed-link expiry while the profile remains unpublished; real subscriber/payment testing requires separate approval and finance-terminal readiness. The conventional Netlify branch URL returned 404; a preview is not confirmed. Keep any privileged environment values and signed URLs private, never chat or source.
7. For in-world payment testing, first coordinate the finance alt as terminal owner, keep the object non-group-deeded, set the exact trusted owner/object IDs in Netlify, and verify its private notecard setup. Grant `PERMISSION_DEBIT` only by an explicit in-world action from the finance-alt owner. Do not use real customer funds for the first test.
8. Compile and test the complete LSL script in-world. Exercise successful creator payout, definite payout failure/refund, and ambiguous transfer/manual-reconciliation behavior before enabling sales.

No GitHub `main` update or production deployment was part of that historical checkpoint. Later approved releases are recorded in the current status above.
