-- The API role may create and read a sanitized public-library snapshot after
-- a separately configured reviewer approves a submission. It never receives
-- delete permission on public library items.
grant select, insert on public.library_items to learning_api;
