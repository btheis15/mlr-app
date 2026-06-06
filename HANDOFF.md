# Handoff — tagging in comments + scoped chat tagging + chat edit/delete

Context for picking this up on the Mac mini. The app-side work lives in
**PR #106** (`btheis15/mlr-app`, branch `claude/tagging-comments-chats-B1aj3`):
*"Tag people in comments; scoped chat tagging + 24h edit/soft-delete."*
This file is just the to-do list of anything that finishes outside that PR.

## What shipped in PR #106 (app side)

1. **@mentions in Posts-feed comments (new).** The comment box has inline
   `@name` autocomplete over the member list; mentions persist in a new
   `post_comment_mentions` table and render highlighted (shared `MentionText`
   helper). See `components/PostsView.tsx`.
2. **Scoped @mentions in committee chat (already correct).** Chat mention
   autocomplete was already restricted to that committee's roster (Beautification
   members can only tag Beautification members, etc.) — no code change was needed.
3. **Edit / soft-delete for chat messages (new).** Authors can edit *or* delete
   their own message for **24h**; **admins can delete anytime**. Delete is a
   **soft delete** (`committee_messages.deleted_at`) → the bubble and any reply
   quoting it show **"message deleted"** for everyone. Edits stamp `edited_at`
   and show a subtle **"edited"**. The 24h-author / admin-anytime rule is
   enforced in **RLS**, not just the UI. See `components/CommitteeChat.tsx`.

## TODO — Supabase (run in the SQL editor, in order)

These migration files are in PR #106 under `supabase/migrations/`:

- [ ] `0022_post_comment_mentions.sql` — `post_comment_mentions` table
      (public-read, insert-on-own-comment) + realtime.
- [ ] `0023_committee_message_edit_delete.sql` — adds
      `committee_messages.deleted_at`, swaps the update policy to
      *author-within-24h OR admin*, and restricts hard `delete` to admins.

Both client reads degrade gracefully if the migration hasn't run yet (the
feature is just dormant — nothing breaks), so you can merge the PR and apply
these when convenient.

## TODO — Mac mini (`media-server/`)

- [ ] **Push on comment @mentions (optional, nice-to-have).** `push-sender.js`
      currently notifies on new committee chat messages + broadcast alerts only.
      It does **not** watch the Posts feed. If you want a push when someone
      `@mentions` you in a comment, add an `INSERT` listener on
      `post_comment_mentions` (mirror `handleMessage`): look up the comment →
      post → commenter name, then `sendToUser(mentioned_user_id, …)` for anyone
      whose `push_types` includes `mentions`. Skip notifying the comment author
      about their own mention. Deep-link `url` to `${APP_URL}/posts`.
- [x] **Edits/deletes must not re-notify.** Already handled — the chat listener
      is `INSERT`-only (`committee_messages`), so an edit or soft-delete (both
      `UPDATE`s) never fires a push. No change needed.

## Optional follow-up (not in scope of PR #106)

- [ ] **Harden committee mention scoping in RLS.** Mention *scoping* in chat is
      currently UI-level: the autocomplete only offers the roster, but a user who
      types `@Name ` by hand could still write a `committee_message_mentions` row
      for a non-member. The 24h/admin edit-delete rules are DB-enforced; mention
      scoping is not. If we want it airtight, tighten the
      `committee_message_mentions` insert policy to also require
      `is_committee_member(mentioned_user_id, committee_id)`. (Low urgency — it
      can't leak the room's contents, only attach a stray highlight.)
