-- Structured imports create a private figure/audio link after the question is
-- persisted. The API role needs that narrow insert permission; it must not be
-- able to modify or delete existing links.
grant select, insert on public.question_assets to learning_api;
