-- 0129_semantic_search.sql
--
-- Semantic ("find it without the exact words") search over every conversation
-- surface — the resort Feed (posts + comments), committee/area chat, and house
-- chat — powered by on-device Apple embeddings generated on the Mac mini
-- (NaturalLanguage's NLContextualEmbedding, 512-d, via media-server/embed-service).
--
-- THE RLS GUARANTEE (why this can't leak):
--   Content is embedded ONCE into a single locked table (content_embeddings).
--   Search is a SECURITY DEFINER RPC that re-applies the EXACT SAME visibility
--   rules the chat/feed screens already use — reusing the existing helper
--   functions can_access_committee_area() (0063) and is_house_member() (0064),
--   plus the members-only + status='visible' + not-deleted gates. Because
--   auth.uid() inside a SECURITY DEFINER function still resolves to the CALLING
--   user (it reads the request JWT, not the DB role), each member gets exactly
--   their own slice — join a committee and its history is searchable instantly;
--   leave and it disappears — with no per-user index to maintain. The embeddings
--   table itself is deny-all (no policy, no grant to anon/authenticated), so the
--   ONLY way to read it is through this one filtering RPC.
--
-- Design notes:
--   • Embeddings are L2-normalized on the mini, so cosine distance (<=>) is the
--     right operator and similarity = 1 - distance.
--   • Search is EXACT (scan + sort under the visibility joins), not the HNSW
--     approximate path — at this app's scale (thousands of messages) that's
--     sub-millisecond and guarantees the true top-K *visible* rows. The HNSW
--     index is created anyway so this scales if the corpus ever grows large.
--   • We store only a content_hash (not the raw text) — the indexer uses it to
--     detect edits; search returns the live text straight from the base tables,
--     so results always reflect the current (and still-visible) message.

-- 1) pgvector (Supabase convention: install into the extensions schema).
create extension if not exists vector with schema extensions;

-- 2) One shared embedding per piece of content. Keyed by (source_type, source_id).
create table if not exists public.content_embeddings (
  source_type  text not null check (source_type in
                 ('post','post_comment','committee_message','house_message')),
  source_id    uuid not null,
  content_hash text not null,               -- sha256 of the embedded text; edit detection
  embedding    extensions.vector(512) not null,
  updated_at   timestamptz not null default now(),
  primary key (source_type, source_id)
);

comment on table public.content_embeddings is
  'On-device Apple (NLContextualEmbedding) vectors for semantic search. Locked: '
  'no anon/authenticated access — read ONLY via public.search_conversations(), '
  'written ONLY by the mac-mini indexer (service_role). See migration 0129.';

-- Approximate-NN index (unused at current scale, future-proofing).
create index if not exists content_embeddings_hnsw
  on public.content_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

-- 3) Lock it down. RLS on + no policy = deny all for anon/authenticated.
--    The indexer uses service_role (bypasses RLS); search uses the DEFINER RPC.
alter table public.content_embeddings enable row level security;
revoke all on public.content_embeddings from anon, authenticated;
grant all on public.content_embeddings to service_role;

-- 4) The RLS-scoped search RPC. SECURITY DEFINER so it can read the locked
--    embeddings table, but it re-derives per-user visibility from the caller's
--    auth.uid() using the app's own helper functions — so results are identical
--    to what the caller can already see in the Feed/chat.
create or replace function public.search_conversations(
  query_embedding extensions.vector(512),
  match_count integer default 20,
  min_similarity double precision default 0.0
)
returns table (
  source_type  text,
  source_id    uuid,
  content      text,
  created_at   timestamptz,
  similarity   double precision,
  committee_id uuid,
  area         text,
  house_id     uuid,
  post_id      uuid,
  author_id    uuid
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with me as ( select auth.uid() as uid ),
       adm as ( select exists (
                  select 1 from public.profiles p
                  where p.id = (select uid from me) and p.is_admin
                ) as is_admin )
  select r.source_type, r.source_id, r.content, r.created_at, r.similarity,
         r.committee_id, r.area, r.house_id, r.post_id, r.author_id
  from (
    -- POSTS — any signed-in member (0081); visible, or your own, or admin.
    select 'post'::text as source_type, p.id as source_id, p.text as content,
           p.created_at,
           1 - (e.embedding <=> query_embedding) as similarity,
           null::uuid as committee_id, null::text as area,
           null::uuid as house_id, p.id as post_id, p.author_id
    from public.content_embeddings e
    join public.posts p on p.id = e.source_id
    where e.source_type = 'post'
      and ( p.status = 'visible'
            or p.author_id = (select uid from me)
            or (select is_admin from adm) )

    union all
    -- POST COMMENTS — comment AND its parent post must be visible to you.
    select 'post_comment', c.id, c.text, c.created_at,
           1 - (e.embedding <=> query_embedding),
           null, null, null, c.post_id, c.author_id
    from public.content_embeddings e
    join public.post_comments c on c.id = e.source_id
    join public.posts pp on pp.id = c.post_id
    where e.source_type = 'post_comment'
      and ( c.status = 'visible' or c.author_id = (select uid from me) or (select is_admin from adm) )
      and ( pp.status = 'visible' or pp.author_id = (select uid from me) or (select is_admin from adm) )

    union all
    -- COMMITTEE MESSAGES — roster+area gate (0063); not deleted; visible/own/admin.
    select 'committee_message', m.id, m.text, m.created_at,
           1 - (e.embedding <=> query_embedding),
           m.committee_id, m.area, null, null, m.author_id
    from public.content_embeddings e
    join public.committee_messages m on m.id = e.source_id
    where e.source_type = 'committee_message'
      and m.deleted_at is null
      and ( m.status = 'visible' or m.author_id = (select uid from me) or (select is_admin from adm) )
      and public.can_access_committee_area(m.committee_id, m.area)

    union all
    -- HOUSE MESSAGES — house-member gate (0064); not deleted; visible/own/admin.
    select 'house_message', h.id, h.text, h.created_at,
           1 - (e.embedding <=> query_embedding),
           null, null, h.house_id, null, h.author_id
    from public.content_embeddings e
    join public.house_messages h on h.id = e.source_id
    where e.source_type = 'house_message'
      and h.deleted_at is null
      and ( h.status = 'visible' or h.author_id = (select uid from me) or (select is_admin from adm) )
      and public.is_house_member(h.house_id)
  ) r
  where (select uid from me) is not null          -- members only: guests get nothing
    and r.content is not null
    and length(btrim(r.content)) > 0
    and r.similarity >= min_similarity
  order by r.similarity desc
  limit greatest(1, least(coalesce(match_count, 20), 100));
$$;

-- Only signed-in members may call it (the body also hard-guards on auth.uid()).
revoke all on function public.search_conversations(extensions.vector, integer, double precision) from public, anon;
grant execute on function public.search_conversations(extensions.vector, integer, double precision) to authenticated;

comment on function public.search_conversations(extensions.vector, integer, double precision) is
  'RLS-scoped semantic search across posts/comments/committee+house chat. '
  'SECURITY DEFINER but re-applies per-caller visibility via can_access_committee_area/'
  'is_house_member + members-only/status/deleted gates. See migration 0129.';
