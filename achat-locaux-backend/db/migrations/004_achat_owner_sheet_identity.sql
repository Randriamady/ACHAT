ALTER TABLE achat_sheet_settings
ADD COLUMN IF NOT EXISTS owner_name TEXT;

UPDATE achat_sheet_settings
SET owner_name = CASE sheet_key
  WHEN 'colonne_gaelle' THEN 'Gaëlle RAKOTOVAO'
  WHEN 'colonne_jeannie' THEN 'Jeannie'
  WHEN 'colonne_raissa' THEN 'Raissa'
  WHEN 'colonne_ando' THEN 'ANDO'
  ELSE owner_name
END
WHERE sheet_key IN ('colonne_gaelle', 'colonne_jeannie', 'colonne_raissa', 'colonne_ando');

CREATE UNIQUE INDEX IF NOT EXISTS idx_achat_sheet_settings_owner_name
ON achat_sheet_settings (LOWER(TRIM(owner_name)))
WHERE owner_name IS NOT NULL;
