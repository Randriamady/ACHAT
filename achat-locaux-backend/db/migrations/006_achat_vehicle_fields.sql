ALTER TABLE achats
ADD COLUMN IF NOT EXISTS immatriculation_vehicule TEXT,
ADD COLUMN IF NOT EXISTS utilisateur_vehicule TEXT;
