begin;

select plan(6);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
)
values
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'parent-a@example.test',
    '',
    now(),
    now(),
    now()
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'parent-b@example.test',
    '',
    now(),
    now(),
    now()
  );

insert into public.families (id, name, created_by)
values
  (
    'a0000000-0000-0000-0000-000000000001',
    'Family A',
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    'b0000000-0000-0000-0000-000000000002',
    'Family B',
    '20000000-0000-0000-0000-000000000002'
  );

insert into public.family_members (family_id, user_id)
values
  (
    'a0000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    'b0000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002'
  );

insert into public.children (
  id,
  family_id,
  nickname,
  grade_stage,
  pin_hash
)
values
  (
    'a1000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'Child A',
    'Junior high 1',
    'fixture'
  ),
  (
    'b1000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-000000000002',
    'Child B',
    'Junior high 1',
    'fixture'
  );

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

select results_eq(
  'select name from public.families order by name',
  $$values ('Family A'::text)$$,
  'a parent can read their own family'
);

select is(
  (select count(*) from public.families where name = 'Family B'),
  0::bigint,
  'a parent cannot read another family'
);

select results_eq(
  'select nickname from public.children order by nickname',
  $$values ('Child A'::text)$$,
  'family-scoped child rows are isolated'
);

select throws_ok(
  $$
    insert into public.children (
      family_id,
      nickname,
      grade_stage,
      pin_hash
    )
    values (
      'b0000000-0000-0000-0000-000000000002',
      'Intruder',
      'Junior high 1',
      'fixture'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "children"',
  'a parent cannot insert into another family'
);

reset role;

insert into public.jobs (
  id,
  family_id,
  type,
  subject_id
)
values (
  'a2000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'extract_source',
  'a3000000-0000-0000-0000-000000000001'
);

set local role service_role;

select results_eq(
  $$
    select status::text
    from public.claim_next_job('pg-tap-worker')
  $$,
  $$values ('running'::text)$$,
  'the worker atomically claims the next available job'
);

select is(
  (select count(*) from public.claim_next_job('second-worker')),
  0::bigint,
  'a running job cannot be claimed a second time'
);

select * from finish();

rollback;
