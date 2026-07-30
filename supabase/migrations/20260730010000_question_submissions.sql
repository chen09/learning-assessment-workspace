create table public.question_submissions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  question_id uuid not null references public.questions (id),
  job_id uuid not null unique references public.jobs (id) on delete cascade,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

alter table public.question_submissions enable row level security;
create policy question_submissions_family_access
  on public.question_submissions for all to authenticated
  using (private.is_family_parent(family_id))
  with check (private.is_family_parent(family_id));

grant select, insert, update on public.question_submissions
  to authenticated, learning_api, learning_worker;

create or replace function private.prevent_submitted_question_response_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_attempt_id uuid;
  target_question_id uuid;
begin
  target_attempt_id := coalesce(new.attempt_id, old.attempt_id);
  target_question_id := coalesce(new.question_id, old.question_id);
  if exists (
    select 1
    from public.question_submissions
    where attempt_id = target_attempt_id
      and question_id = target_question_id
  ) then
    raise exception 'submitted_question_is_immutable'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger immutable_submitted_question_response
before insert or update or delete on public.responses
for each row execute function private.prevent_submitted_question_response_changes();
