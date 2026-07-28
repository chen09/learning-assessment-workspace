create or replace function private.prevent_submitted_attempt_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if old.submitted_at is not null then
    raise exception 'submitted_attempt_is_immutable' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function private.prevent_submitted_response_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
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
