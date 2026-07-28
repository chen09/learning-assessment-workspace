create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

create type public.ui_language as enum ('zh', 'ja', 'en');
create type public.member_status as enum ('active', 'invited', 'removed');
create type public.question_set_status as enum (
  'draft',
  'processing',
  'needs_review',
  'confirmed',
  'archived'
);
create type public.question_type as enum (
  'single_choice',
  'multiple_choice',
  'typed_text',
  'word_order',
  'handwriting',
  'photo',
  'listening'
);
create type public.assignment_status as enum (
  'assigned',
  'in_progress',
  'submitted',
  'grading',
  'results_ready',
  'correcting',
  'completed',
  'withdrawn',
  'stopped'
);
create type public.attempt_kind as enum ('initial', 'correction', 'review');
create type public.response_kind as enum (
  'choice',
  'text',
  'tokens',
  'strokes',
  'photo'
);
create type public.grading_outcome as enum (
  'correct',
  'incorrect',
  'uncertain',
  'needs_parent_review'
);
create type public.job_status as enum (
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled'
);
create type public.job_type as enum (
  'extract_source',
  'generate_questions',
  'grade_submission',
  'render_printable',
  'split_paper_scan',
  'generate_audio',
  'purge_deleted_data'
);
create type public.library_status as enum (
  'pending',
  'published',
  'rejected',
  'unpublished'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  ui_language public.ui_language not null default 'en',
  guardian_confirmed_at timestamptz,
  terms_accepted_at timestamptz,
  privacy_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  purge_after timestamptz
);

create table public.family_members (
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status public.member_status not null default 'active',
  management_pin_hash text,
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (family_id, user_id)
);

create table public.family_invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  email text not null check (email = lower(email)),
  invited_by uuid not null references public.profiles (id),
  token_hash text not null unique,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references public.profiles (id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.children (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 40),
  grade_stage text not null check (char_length(grade_stage) between 1 and 60),
  ui_language public.ui_language not null default 'en',
  pin_hash text not null,
  failed_pin_attempts smallint not null default 0 check (failed_pin_attempts between 0 and 5),
  pin_locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (family_id, nickname)
);

create table public.knowledge_tags (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families (id) on delete cascade,
  subject text not null,
  code text not null,
  label jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique nulls not distinct (family_id, code)
);

create table public.question_sets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  title text not null check (char_length(title) between 1 and 160),
  subject text not null,
  status public.question_set_status not null default 'draft',
  difficulty text not null default 'standard'
    check (difficulty in ('reinforcement', 'standard', 'challenge', 'adaptive')),
  source_mode text not null default 'manual'
    check (source_mode in ('manual', 'generate', 'convert', 'similar')),
  instructions text,
  locale text not null default 'en',
  source_summary jsonb not null default '{}'::jsonb,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  question_set_id uuid not null references public.question_sets (id) on delete cascade,
  position integer not null check (position > 0),
  type public.question_type not null,
  prompt jsonb not null,
  options jsonb,
  answer_key jsonb not null,
  rubric jsonb not null default '{}'::jsonb,
  points numeric(6, 2) not null default 1 check (points > 0),
  primary_knowledge_tag_id uuid references public.knowledge_tags (id),
  transcript_policy text not null default 'never'
    check (transcript_policy in ('never', 'after_submission', 'always')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_set_id, position)
);

create table public.question_knowledge_tags (
  question_id uuid not null references public.questions (id) on delete cascade,
  knowledge_tag_id uuid not null references public.knowledge_tags (id) on delete cascade,
  is_primary boolean not null default false,
  primary key (question_id, knowledge_tag_id)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  owner_user_id uuid references public.profiles (id),
  bucket_id text not null check (bucket_id in ('sources', 'responses', 'audio', 'derived')),
  object_path text not null,
  media_type text not null,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  sha256 text,
  page_order integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (bucket_id, object_path)
);

create table public.question_assets (
  question_id uuid not null references public.questions (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  purpose text not null check (purpose in ('figure', 'audio', 'source_reference')),
  position integer not null default 1,
  primary key (question_id, asset_id)
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  question_set_id uuid not null references public.question_sets (id),
  child_id uuid not null references public.children (id),
  assigned_by uuid not null references public.profiles (id),
  status public.assignment_status not null default 'assigned',
  parent_note text check (char_length(parent_note) <= 300),
  mode text not null default 'practice' check (mode in ('practice', 'exam')),
  time_limit_seconds integer check (time_limit_seconds is null or time_limit_seconds > 0),
  replay_limit smallint check (replay_limit is null or replay_limit >= 0),
  assigned_at timestamptz not null default now(),
  started_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  child_id uuid not null references public.children (id),
  kind public.attempt_kind not null default 'initial',
  sequence integer not null check (sequence > 0),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  client_idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (assignment_id, sequence),
  unique (family_id, client_idempotency_key)
);

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  question_id uuid not null references public.questions (id),
  kind public.response_kind not null,
  answer jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create table public.response_assets (
  response_id uuid not null references public.responses (id) on delete cascade,
  asset_id uuid not null references public.assets (id),
  page_order integer not null default 1,
  primary key (response_id, asset_id)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  type public.job_type not null,
  status public.job_status not null default 'queued',
  subject_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error_code text,
  error_detail text,
  attempt_count smallint not null default 0,
  max_attempts smallint not null default 3 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_available_idx
  on public.jobs (status, available_at, created_at)
  where status in ('queued', 'failed');

create table public.question_results (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  question_id uuid not null references public.questions (id),
  outcome public.grading_outcome not null,
  awarded_points numeric(6, 2),
  confidence numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  feedback jsonb not null default '{}'::jsonb,
  grader_version text not null,
  parent_outcome public.grading_outcome,
  parent_awarded_points numeric(6, 2),
  parent_comment text check (char_length(parent_comment) <= 500),
  parent_reviewed_by uuid references public.profiles (id),
  parent_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create table public.correction_links (
  original_result_id uuid not null references public.question_results (id) on delete cascade,
  correction_attempt_id uuid not null references public.attempts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (original_result_id, correction_attempt_id)
);

create table public.review_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  knowledge_tag_id uuid not null references public.knowledge_tags (id),
  source_question_id uuid not null references public.questions (id),
  due_on date not null,
  interval_days integer not null default 1 check (interval_days in (1, 3, 7, 14, 30)),
  level text not null default 'standard'
    check (level in ('reinforcement', 'standard', 'challenge')),
  consecutive_standard_successes smallint not null default 0,
  failure_count smallint not null default 0,
  skipped_on date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index review_items_due_idx
  on public.review_items (child_id, due_on)
  where completed_at is null;

create table public.review_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  review_item_id uuid not null references public.review_items (id) on delete cascade,
  result public.grading_outcome,
  old_interval_days integer not null,
  new_interval_days integer not null,
  occurred_at timestamptz not null default now()
);

create table public.library_submissions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  question_set_id uuid not null references public.question_sets (id),
  submitted_by uuid not null references public.profiles (id),
  status public.library_status not null default 'pending',
  rights_confirmed_at timestamptz not null,
  privacy_confirmed_at timestamptz not null,
  reviewer_id uuid references public.profiles (id),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.library_items (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.library_submissions (id),
  snapshot jsonb not null,
  metadata jsonb not null,
  revision integer not null default 1,
  published_at timestamptz,
  unpublished_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.library_reports (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  library_item_id uuid not null references public.library_items (id),
  reported_by uuid not null references public.profiles (id),
  category text not null check (category in ('error', 'suitability', 'copyright')),
  detail text not null check (char_length(detail) between 1 and 1000),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families (id) on delete cascade,
  requested_by uuid not null references public.profiles (id),
  target_type text not null check (target_type in ('family', 'child', 'account', 'asset')),
  target_id uuid not null,
  requested_at timestamptz not null default now(),
  purge_after timestamptz not null default (now() + interval '30 days'),
  restored_at timestamptz,
  purged_at timestamptz
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  family_id uuid references public.families (id) on delete set null,
  actor_user_id uuid references public.profiles (id) on delete set null,
  actor_child_id uuid references public.children (id) on delete set null,
  action text not null,
  subject_type text not null,
  subject_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(new.raw_user_meta_data ->> 'full_name', ''),
        nullif(split_part(new.email, '@', 1), ''),
        'Parent'
      ),
      80
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger create_profile_after_auth_signup
after insert on auth.users
for each row execute function private.handle_new_auth_user();

create or replace function private.is_family_parent(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.family_members
    where family_id = target_family_id
      and user_id = (select auth.uid())
      and status = 'active'
  );
$$;

revoke all on function private.is_family_parent(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_family_parent(uuid) to authenticated;

create or replace function private.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false);
$$;

grant execute on function private.is_admin() to authenticated;

create or replace function private.enforce_family_parent_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'active' and (
    select count(*)
    from public.family_members
    where family_id = new.family_id
      and status = 'active'
      and user_id <> new.user_id
  ) >= 4 then
    raise exception 'family_parent_limit_reached' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger family_parent_limit
before insert or update of status on public.family_members
for each row execute function private.enforce_family_parent_limit();

create or replace function private.prevent_submitted_attempt_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.submitted_at is not null then
    raise exception 'submitted_attempt_is_immutable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger immutable_submitted_attempt
before update or delete on public.attempts
for each row execute function private.prevent_submitted_attempt_changes();

create or replace function private.prevent_submitted_response_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.attempts
    where id = coalesce(old.attempt_id, new.attempt_id)
      and submitted_at is not null
  ) then
    raise exception 'submitted_response_is_immutable' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger immutable_submitted_response
before update or delete on public.responses
for each row execute function private.prevent_submitted_response_changes();

create or replace function public.claim_next_job(worker_name text)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidate as (
    select id
    from public.jobs
    where status in ('queued', 'failed')
      and available_at <= now()
      and attempt_count < max_attempts
    order by created_at
    for update skip locked
    limit 1
  )
  update public.jobs j
  set status = 'running',
      locked_at = now(),
      locked_by = worker_name,
      attempt_count = attempt_count + 1,
      updated_at = now()
  from candidate
  where j.id = candidate.id
  returning j.*;
end;
$$;

revoke all on function public.claim_next_job(text) from public, anon, authenticated;
grant execute on function public.claim_next_job(text) to service_role;

alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.family_invitations enable row level security;

create policy profiles_own on public.profiles
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy families_member_read on public.families
  for select to authenticated using (private.is_family_parent(id));
create policy families_creator_insert on public.families
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy families_member_update on public.families
  for update to authenticated
  using (private.is_family_parent(id))
  with check (private.is_family_parent(id));

create policy family_members_read on public.family_members
  for select to authenticated using (private.is_family_parent(family_id));
create policy family_members_join_creator on public.family_members
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.families
      where id = family_id and created_by = (select auth.uid())
    )
  );
create policy family_members_manage on public.family_members
  for update to authenticated
  using (private.is_family_parent(family_id))
  with check (private.is_family_parent(family_id));

create policy family_invitations_parent_all on public.family_invitations
  for all to authenticated
  using (private.is_family_parent(family_id))
  with check (
    private.is_family_parent(family_id)
    and invited_by = (select auth.uid())
  );

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'children',
    'knowledge_tags',
    'question_sets',
    'questions',
    'assets',
    'assignments',
    'attempts',
    'responses',
    'jobs',
    'question_results',
    'review_items',
    'review_events',
    'library_submissions',
    'library_reports',
    'deletion_requests',
    'audit_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (private.is_family_parent(family_id)) with check (private.is_family_parent(family_id))',
      table_name || '_family_access',
      table_name
    );
  end loop;
end
$$;

alter table public.question_knowledge_tags enable row level security;
create policy question_knowledge_tags_family_access
  on public.question_knowledge_tags for all to authenticated
  using (
    exists (
      select 1 from public.questions
      where id = question_id and private.is_family_parent(family_id)
    )
  )
  with check (
    exists (
      select 1 from public.questions
      where id = question_id and private.is_family_parent(family_id)
    )
  );

alter table public.question_assets enable row level security;
create policy question_assets_family_access
  on public.question_assets for all to authenticated
  using (
    exists (
      select 1 from public.questions
      where id = question_id and private.is_family_parent(family_id)
    )
  )
  with check (
    exists (
      select 1 from public.questions
      where id = question_id and private.is_family_parent(family_id)
    )
  );

alter table public.response_assets enable row level security;
create policy response_assets_family_access
  on public.response_assets for all to authenticated
  using (
    exists (
      select 1 from public.responses
      where id = response_id and private.is_family_parent(family_id)
    )
  )
  with check (
    exists (
      select 1 from public.responses
      where id = response_id and private.is_family_parent(family_id)
    )
  );

alter table public.correction_links enable row level security;
create policy correction_links_family_access
  on public.correction_links for all to authenticated
  using (
    exists (
      select 1 from public.question_results
      where id = original_result_id and private.is_family_parent(family_id)
    )
  )
  with check (
    exists (
      select 1 from public.question_results
      where id = original_result_id and private.is_family_parent(family_id)
    )
  );

alter table public.library_items enable row level security;
create policy library_items_authenticated_read
  on public.library_items for select to authenticated
  using (published_at is not null and unpublished_at is null);
create policy library_items_admin_manage
  on public.library_items for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('sources', 'sources', false, 52428800),
  ('responses', 'responses', false, 52428800),
  ('audio', 'audio', false, 52428800),
  ('derived', 'derived', false, 52428800)
on conflict (id) do update set public = false;

create policy storage_family_read
  on storage.objects for select to authenticated
  using (
    bucket_id in ('sources', 'responses', 'audio', 'derived')
    and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    and private.is_family_parent(((storage.foldername(name))[1])::uuid)
  );

create policy storage_family_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('sources', 'responses', 'audio', 'derived')
    and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    and private.is_family_parent(((storage.foldername(name))[1])::uuid)
  );

create policy storage_family_update
  on storage.objects for update to authenticated
  using (
    bucket_id in ('sources', 'responses', 'audio', 'derived')
    and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    and private.is_family_parent(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id in ('sources', 'responses', 'audio', 'derived')
    and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    and private.is_family_parent(((storage.foldername(name))[1])::uuid)
  );

create policy storage_family_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('sources', 'responses', 'audio', 'derived')
    and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    and private.is_family_parent(((storage.foldername(name))[1])::uuid)
  );
