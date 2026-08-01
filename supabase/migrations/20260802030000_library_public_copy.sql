-- Public library cards remain anonymous and safe to read directly.  The
-- matching answers/rubrics live in this private runtime-only table so an API
-- copy can remain gradeable without ever exposing grading material to another
-- family or the browser.
create table private.library_item_private_content (
  library_item_id uuid primary key
    references public.library_items (id) on delete cascade,
  content jsonb not null,
  created_at timestamptz not null default now()
);

revoke all on private.library_item_private_content from public, anon, authenticated;
grant usage on schema private to learning_api;
grant select, insert on private.library_item_private_content to learning_api;

-- A copied public item becomes a new family-owned confirmed question set and
-- questions, so the API needs the normal runtime write permissions.
grant insert on public.question_sets, public.questions to learning_api;
