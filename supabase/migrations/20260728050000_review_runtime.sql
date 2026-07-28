create unique index review_items_active_source_idx
  on public.review_items (child_id, source_question_id)
  where completed_at is null;

grant select, insert, update on public.knowledge_tags
  to learning_api, learning_worker;
