-- 0131_search_keyword_precision.sql
--
-- Fix: search returned relevant hits on top but padded the result with totally
-- irrelevant messages, and "pork" (matches nothing) returned everything.
--
-- Root cause: the 0130 hybrid used `ts_rank(...) > 0` to decide "is this a keyword
-- match". For MULTI-WORD queries ts_rank returns a TINY non-zero (~1e-20) for
-- NON-matching docs — so `> 0` was true for everything, and the "any keyword
-- match? then keep only matches, else semantic-everything" logic collapsed into
-- "return everything". (Single-word queries happened to return exactly 0, which
-- is why "golf" looked fine but "golf hat" didn't.)
--
-- Fix: filter with the boolean full-text match operator `@@` (exact: does the
-- doc satisfy the tsquery?), and use ts_rank ONLY for ordering. This makes search
-- strictly keyword-driven and precise:
--   • "golf hat"  → only the messages that actually contain golf AND hat
--   • "pork"      → nothing → the UI shows "No matching messages"
-- RLS visibility logic is unchanged; signature is unchanged (create-or-replace),
-- so no app/media-server change is needed.
--
-- Note: this is now PURE keyword search — the semantic vectors only break ties
-- among keyword matches (ordered by ts_rank, then embedding similarity). The
-- "find it without the exact words" semantic behavior is intentionally off,
-- because Apple's mean-pooled embeddings are too anisotropic (all cosine sims
-- ~0.85-0.92) to separate relevant from irrelevant without keywords. Restoring
-- true semantic recall cleanly would require mean-centering the embeddings so a
-- similarity threshold becomes meaningful (a future enhancement).

create or replace function public.search_conversations(
  query_embedding extensions.vector(512),
  query_text text default '',
  match_count integer default 20
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
                  where p.id = (select uid from me) and p.is_admin ) as is_admin ),
       tsq as ( select websearch_to_tsquery('english', coalesce(query_text, '')) as q ),
       visible as (
         select 'post'::text as source_type, p.id as source_id, p.text as content, p.created_at,
                1 - (e.embedding <=> query_embedding) as similarity,
                null::uuid as committee_id, null::text as area, null::uuid as house_id, p.id as post_id, p.author_id
         from public.content_embeddings e join public.posts p on p.id = e.source_id
         where e.source_type='post'
           and ( p.status='visible' or p.author_id=(select uid from me) or (select is_admin from adm) )
         union all
         select 'post_comment', c.id, c.text, c.created_at, 1 - (e.embedding <=> query_embedding),
                null, null, null, c.post_id, c.author_id
         from public.content_embeddings e join public.post_comments c on c.id=e.source_id
              join public.posts pp on pp.id=c.post_id
         where e.source_type='post_comment'
           and ( c.status='visible' or c.author_id=(select uid from me) or (select is_admin from adm) )
           and ( pp.status='visible' or pp.author_id=(select uid from me) or (select is_admin from adm) )
         union all
         select 'committee_message', m.id, m.text, m.created_at, 1 - (e.embedding <=> query_embedding),
                m.committee_id, m.area, null, null, m.author_id
         from public.content_embeddings e join public.committee_messages m on m.id=e.source_id
         where e.source_type='committee_message' and m.deleted_at is null
           and ( m.status='visible' or m.author_id=(select uid from me) or (select is_admin from adm) )
           and public.can_access_committee_area(m.committee_id, m.area)
         union all
         select 'house_message', h.id, h.text, h.created_at, 1 - (e.embedding <=> query_embedding),
                null, null, h.house_id, null, h.author_id
         from public.content_embeddings e join public.house_messages h on h.id=e.source_id
         where e.source_type='house_message' and h.deleted_at is null
           and ( h.status='visible' or h.author_id=(select uid from me) or (select is_admin from adm) )
           and public.is_house_member(h.house_id)
       ),
       scored as (
         select v.*,
                ts_rank(to_tsvector('english', v.content), (select q from tsq)) as lex
         from visible v
         where v.content is not null and length(btrim(v.content)) > 0
           -- Exact boolean keyword match — NOT ts_rank>0 (which is ~1e-20 for
           -- non-matching multi-word queries and leaks everything through).
           and to_tsvector('english', v.content) @@ (select q from tsq)
       )
  select s.source_type, s.source_id, s.content, s.created_at, s.similarity,
         s.committee_id, s.area, s.house_id, s.post_id, s.author_id
  from scored s
  where (select uid from me) is not null
  order by s.lex desc, s.similarity desc, s.created_at desc
  limit greatest(1, least(coalesce(match_count, 20), 100));
$$;

comment on function public.search_conversations(extensions.vector, text, integer) is
  'Keyword-precise, RLS-scoped conversation search (full-text @@ filter, ts_rank + '
  'embedding-similarity ordering). No keyword match => no rows. See migration 0131.';
