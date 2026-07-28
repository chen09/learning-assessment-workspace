alter table public.question_set_imports
  add column source_paths jsonb not null default '[]'::jsonb;
