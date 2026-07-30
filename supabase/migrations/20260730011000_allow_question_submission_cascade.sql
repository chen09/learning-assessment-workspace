create or replace function private.prevent_submitted_question_response_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_attempt_id uuid;
  target_question_id uuid;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
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
