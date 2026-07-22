-- 0130_search_hybrid.sql
--
-- Hybrid keyword + semantic ranking for search_conversations.
--
-- Why: Apple's mean-pooled NLContextualEmbedding vectors are anisotropic — cosine
-- similarities cluster in a narrow ~0.85–0.92 band, so a short keyword query
-- ("golf") barely separates the relevant message from unrelated ones, and the
-- result reads as "everything, unfiltered". Postgres full-text cleanly isolates
-- keyword matches (verified: 'golf' → the 3 golf messages rank, everything else
-- scores 0), so we fuse the two:
--   • If the query has ANY keyword (full-text) matches → return ONLY those,
--     ranked by text relevance, semantic similarity as the tiebreaker.
--   • If it has NONE (the "find it without the exact words" case, e.g. "plumbing
--     upstairs" → "leak in the bathroom") → fall back to pure semantic top-N.
--
-- The RLS visibility logic is IDENTICAL to 0129 — this only changes ranking on
-- top of the already-visible set. `query_text` is added with a default so the
-- old (embedding, match_count) call shape still resolves (→ pure semantic),
-- meaning app + DB can deploy in any order without breaking.

-- Old signature had (vector, integer, double precision); replace it wholesale.
drop function if exists public.search_conversations(extensions.vector, integer, double precision);

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
                  where p.id = (select uid from me) and p.is_admin
                ) as is_admin ),
       -- Same RLS-scoped candidate set as migration 0129.
       visible as (
         select 'post'::text as source_type, p.id as source_id, p.text as content,
                p.created_at,
                1 - (e.embedding <=> query_embedding) as similarity,
                null::uuid as committee_id, null::text as area,
                null::uuid as house_id, p.id as post_id, p.author_id
         from public.content_embeddings e
         join public.posts p on p.id = e.source_id
         where e.source_type = 'post'
           and ( p.status = 'visible' or p.author_id = (select uid from me) or (select is_admin from adm) )
         union all
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
         select 'committee_message', m.id, m.text, m.created_at,
                1 - (e.embedding <=> query_embedding),
                m.committee_id, m.area, null, null, m.author_id
         from public.content_embeddings e
         join public.committee_messages m on m.id = e.source_id
         where e.source_type = 'committee_message' and m.deleted_at is null
           and ( m.status = 'visible' or m.author_id = (select uid from me) or (select is_admin from adm) )
           and public.can_access_committee_area(m.committee_id, m.area)
         union all
         select 'house_message', h.id, h.text, h.created_at,
                1 - (e.embedding <=> query_embedding),
                null, null, h.house_id, null, h.author_id
         from public.content_embeddings e
         join public.house_messages h on h.id = e.source_id
         where e.source_type = 'house_message' and h.deleted_at is null
           and ( h.status = 'visible' or h.author_id = (select uid from me) or (select is_admin from adm) )
           and public.is_house_member(h.house_id)
       ),
       scored as (
         select v.*,
                case when length(btrim(coalesce(query_text, ''))) > 0
                     then ts_rank(to_tsvector('english', v.content),
                                  websearch_to_tsquery('english', query_text))
                     else 0 end as lex
         from visible v
         where v.content is not null and length(btrim(v.content)) > 0
       ),
       flags as ( select bool_or(lex > 0) as any_lex from scored )
  select s.source_type, s.source_id, s.content, s.created_at, s.similarity,
         s.committee_id, s.area, s.house_id, s.post_id, s.author_id
  from scored s, flags f
  where (select uid from me) is not null                 -- members only
    and ( (f.any_lex and s.lex > 0) or (not f.any_lex) )  -- keyword-first, else semantic
  order by s.lex desc, s.similarity desc
  limit greatest(1, least(coalesce(match_count, 20), 100));
$$;

revoke all on function public.search_conversations(extensions.vector, text, integer) from public, anon;
grant execute on function public.search_conversations(extensions.vector, text, integer) to authenticated;

comment on function public.search_conversations(extensions.vector, text, integer) is
  'Hybrid keyword+semantic search, RLS-scoped (reuses can_access_committee_area / '
  'is_house_member + members-only/status/deleted gates against the caller). '
  'Keyword matches first, semantic fallback when there are none. See migration 0130.';
