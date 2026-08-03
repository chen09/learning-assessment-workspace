alter table public.completed_worksheet_imports
  add column source_assignment_id uuid
    references public.assignments (id) on delete set null;

create index completed_worksheet_imports_source_assignment_idx
  on public.completed_worksheet_imports (source_assignment_id)
  where source_assignment_id is not null;
