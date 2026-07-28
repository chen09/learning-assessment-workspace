alter role learning_api bypassrls;
alter role learning_worker bypassrls;

grant learning_api, learning_worker to postgres;

create or replace function public.claim_next_job(worker_name text)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.jobs
  set status = 'failed',
      error_code = 'stale_worker_lock',
      error_detail = 'The previous worker stopped before completing the job.',
      available_at = now(),
      locked_at = null,
      locked_by = null,
      updated_at = now()
  where status = 'running'
    and locked_at < now() - interval '15 minutes'
    and attempt_count < max_attempts;

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
grant execute on function public.claim_next_job(text)
  to service_role, learning_worker;
