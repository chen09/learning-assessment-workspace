alter type public.job_type add value if not exists 'analyze_completed_worksheet';

create table public.completed_worksheet_imports (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  title text not null check (char_length(title) between 1 and 160),
  subject text not null check (char_length(subject) between 1 and 80),
  document_language public.ui_language not null,
  feedback_language public.ui_language not null,
  filenames jsonb not null,
  response_paths jsonb not null,
  answer_source_paths jsonb not null default '[]'::jsonb,
  reference_source_paths jsonb not null default '[]'::jsonb,
  status text not null default 'processing'
    check (status in (
      'processing', 'needs_review', 'confirmed', 'grading',
      'results_ready', 'failed'
    )),
  extraction jsonb not null default '{}'::jsonb,
  question_set_id uuid references public.question_sets (id) on delete set null,
  assignment_id uuid references public.assignments (id) on delete set null,
  attempt_id uuid references public.attempts (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index completed_worksheet_imports_family_created_idx
  on public.completed_worksheet_imports (family_id, created_at desc);

alter table public.completed_worksheet_imports enable row level security;

create policy completed_worksheet_imports_family_access
  on public.completed_worksheet_imports for all to authenticated
  using (private.is_family_parent(family_id))
  with check (private.is_family_parent(family_id));

grant select, insert, update, delete
  on public.completed_worksheet_imports
  to authenticated, learning_api, learning_worker;
