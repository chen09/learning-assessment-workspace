alter table public.question_set_imports
  add column answer_filenames jsonb not null default '[]'::jsonb,
  add column answer_source_paths jsonb not null default '[]'::jsonb,
  add column reference_filenames jsonb not null default '[]'::jsonb,
  add column reference_source_paths jsonb not null default '[]'::jsonb;

comment on column public.question_set_imports.answer_source_paths is
  'Private grading references. These paths must never be returned through child APIs.';

comment on column public.question_set_imports.reference_source_paths is
  'Private source material and worked examples used to generate or validate questions.';
