function toFiniteNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = typeof value === 'number'
    ? value
    : Number(String(value).trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculateAchatFields(row) {
  if (!row || typeof row !== 'object') return row;

  const montantBudget = toFiniteNumber(row.montant_budget);
  const prixReference = toFiniteNumber(row.prix_reference);
  const prixUnitaire = toFiniteNumber(row.prix_unitaire);
  const quantite = toFiniteNumber(row.quantite);
  const montantHt = prixUnitaire !== null && quantite !== null
    ? roundMoney(prixUnitaire * quantite)
    : null;

  row.montant_ht = montantHt;
  row.ecart_budget = montantBudget !== null && montantHt !== null
    ? roundMoney(montantBudget - montantHt)
    : null;
  row.statut_budget = montantBudget === null || montantHt === null
    ? null
    : montantBudget >= montantHt
      ? '✅ Budget Conforme'
      : montantBudget === 0
        ? '⛔ Hors budget'
        : '↗️ Dépassement';
  row.ecart_pourcentage = prixReference !== null && prixReference !== 0 && prixUnitaire !== null
    ? Math.round(((prixUnitaire - prixReference) / prixReference + Number.EPSILON) * 10000) / 10000
    : null;
  row.gain_achat = prixReference !== null && prixUnitaire !== null && quantite !== null
    ? roundMoney((prixReference - prixUnitaire) * quantite)
    : null;

  return row;
}

module.exports = { calculateAchatFields };