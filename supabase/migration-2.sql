-- Update für bestehende Datenbanken (Regeln, Farben, schnelleres Live-Update).
-- Im Supabase SQL Editor einmal ausführen. Mehrfaches Ausführen schadet nicht.
alter table public.cards add column if not exists color text;
alter table public.sessions replica identity full;
alter table public.session_members replica identity full;
