CREATE TABLE IF NOT EXISTS achat_sheet_settings (
  sheet_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  visible_user_ids JSONB,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

INSERT INTO achat_sheet_settings (sheet_key, name) VALUES
  ('colonne', 'En cours'),
  ('tous', 'Tous'),
  ('attente_comite', 'En attente comité'),
  ('valide_comite', 'Validé comité'),
  ('livre', 'Livré')
ON CONFLICT (sheet_key) DO NOTHING;
