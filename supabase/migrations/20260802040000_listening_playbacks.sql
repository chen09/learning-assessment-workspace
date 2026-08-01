-- A server-side counter prevents a child from bypassing an exam replay limit
-- by refreshing the browser or opening another device.
create table public.attempt_audio_playbacks (
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  play_count smallint not null default 0 check (play_count >= 0 and play_count <= 10),
  updated_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

alter table public.attempt_audio_playbacks enable row level security;
create policy attempt_audio_playbacks_family_access
  on public.attempt_audio_playbacks for all to authenticated
  using (
    exists (
      select 1
      from public.attempts attempt
      where attempt.id = attempt_audio_playbacks.attempt_id
        and private.is_family_parent(attempt.family_id)
    )
  )
  with check (
    exists (
      select 1
      from public.attempts attempt
      where attempt.id = attempt_audio_playbacks.attempt_id
        and private.is_family_parent(attempt.family_id)
    )
  );

grant select, insert, update on public.attempt_audio_playbacks
  to authenticated, learning_api, learning_worker;
