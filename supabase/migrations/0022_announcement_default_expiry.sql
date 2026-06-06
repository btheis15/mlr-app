-- 0022_announcement_default_expiry.sql
-- Admin alerts shouldn't sit at the top of everyone's app forever. The app's
-- composer now always sends an expires_at (default 6h, up to 30 days), but give
-- the column a server-side default too so any alert inserted without one still
-- auto-hides after 6 hours rather than living forever. The banner already hides
-- rows past expires_at (and people can still dismiss sooner with ✕). Existing
-- rows are left untouched (a NULL expires_at = never expires, e.g. old notices).
-- Apply after 0021.
alter table public.announcements
  alter column expires_at set default (now() + interval '6 hours');
