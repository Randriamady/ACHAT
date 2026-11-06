INSERT INTO achat_sheet_settings (sheet_key, name, is_enabled, visible_user_ids)
SELECT 'colonne_gaelle', 'Gaëlle RAKOTOVAO', is_enabled, visible_user_ids
FROM achat_sheet_settings
WHERE sheet_key = 'colonne'
ON CONFLICT (sheet_key) DO NOTHING;

INSERT INTO achat_sheet_settings (sheet_key, name, is_enabled, visible_user_ids)
SELECT 'colonne_jeannie', 'Jeannie', is_enabled, visible_user_ids
FROM achat_sheet_settings
WHERE sheet_key = 'colonne'
ON CONFLICT (sheet_key) DO NOTHING;

INSERT INTO achat_sheet_settings (sheet_key, name, is_enabled, visible_user_ids)
SELECT 'colonne_raissa', 'Raissa', is_enabled, visible_user_ids
FROM achat_sheet_settings
WHERE sheet_key = 'colonne'
ON CONFLICT (sheet_key) DO NOTHING;

INSERT INTO achat_sheet_settings (sheet_key, name, is_enabled, visible_user_ids)
SELECT 'colonne_ando', 'ANDO', is_enabled, visible_user_ids
FROM achat_sheet_settings
WHERE sheet_key = 'colonne'
ON CONFLICT (sheet_key) DO NOTHING;
