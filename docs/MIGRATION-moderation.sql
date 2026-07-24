-- Migration modération Wera (docs/SIGNALEMENT.md)
-- À exécuter une fois dans Supabase → SQL Editor.
-- Le backend fonctionne sans (mode dégradé), mais la console de modération
-- a besoin de ces colonnes pour fermer les dossiers et suivre les sanctions.

-- Signalements : statut de dossier, note libre, identifiant d'appel
alter table reports add column if not exists status  text not null default 'open';
alter table reports add column if not exists note    text;
alter table reports add column if not exists call_id text;

-- Anti-abus : 1 signalement max par (signaleur, appel)
create unique index if not exists reports_reporter_call_uniq
  on reports (reporter_id, call_id) where call_id is not null;

-- Tri de la console : dossiers ouverts par membre
create index if not exists reports_open_by_reported
  on reports (reported_id) where status = 'open';

-- Membres : compteur d'antécédents + suspension temporaire
alter table users add column if not exists prior_sanctions int not null default 0;
alter table users add column if not exists suspended_until timestamptz;
