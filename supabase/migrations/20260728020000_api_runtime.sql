create table public.api_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  actor_id text not null,
  action text not null,
  idempotency_key text not null,
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  unique (family_id, actor_id, action, idempotency_key)
);

create table public.question_set_imports (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  question_set_id uuid not null references public.question_sets (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  filenames jsonb not null,
  purpose text not null check (purpose in ('use_as_questions', 'generate_similar')),
  status public.question_set_status not null default 'processing',
  created_at timestamptz not null default now()
);

alter table public.api_idempotency_keys enable row level security;
create policy api_idempotency_keys_family_access
  on public.api_idempotency_keys for all to authenticated
  using (private.is_family_parent(family_id))
  with check (private.is_family_parent(family_id));

alter table public.question_set_imports enable row level security;
create policy question_set_imports_family_access
  on public.question_set_imports for all to authenticated
  using (private.is_family_parent(family_id))
  with check (private.is_family_parent(family_id));

grant select, insert, update, delete
  on public.api_idempotency_keys, public.question_set_imports
  to authenticated;

create role learning_api nologin noinherit;
create role learning_worker nologin noinherit;

grant usage on schema public to learning_api, learning_worker;
grant select, insert, update on
  public.families,
  public.family_members,
  public.family_invitations,
  public.children,
  public.question_sets,
  public.question_set_imports,
  public.questions,
  public.assignments,
  public.attempts,
  public.responses,
  public.jobs,
  public.question_results,
  public.review_items,
  public.review_events,
  public.library_submissions,
  public.api_idempotency_keys,
  public.assets,
  public.audit_events
to learning_api;

grant select, insert, update on
  public.question_sets,
  public.question_set_imports,
  public.questions,
  public.assets,
  public.jobs,
  public.question_results,
  public.review_items,
  public.review_events,
  public.assignments,
  public.attempts,
  public.responses
to learning_worker;

grant usage, select on all sequences in schema public
  to learning_api, learning_worker;

grant execute on function public.claim_next_job(text) to learning_worker;
