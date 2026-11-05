const DEFAULT_QUERIES: Record<string, string> = {
  SCIENTIFIQUE: 'scientifique, recherche, étude, laboratoire, microbiologie, analyse, chromatographie, spectrométrie, validation de méthode, détection',
  REGLEMENTAIRE: 'règlement, directive, décret, arrêté, loi, conformité, législation, avis sanitaire, limite maximale de résidus, LMR, rappel de produit, alerte',
  ACCREDITATION: 'ISO 17025, ISO/IEC 17025, accréditation, COFRAC, SOAC, audit, essai d’aptitude, intercomparaison, compétence technique, traçabilité métrologique',
  NORMATIF: 'norme, standard, ISO, IEC, AFNOR, ASTM, CEN, normalisation, méthode de référence, spécification technique, Codex Alimentarius',
  ENVIRONNEMENT: 'environnement, pollution, qualité de l’eau, eau potable, pesticide, sol, nappe phréatique, effluent, déchet, rejet, métaux lourds',
  AUTRE: '',
};

let dynamicCategoriesMap: Record<string, string> = {};

export function registerCategoryQueries(categories: Array<{ code: string; defaultQuery?: string | null; default_query?: string | null }>) {
  for (const cat of categories) {
    if (cat.code) {
      dynamicCategoriesMap[cat.code] = cat.defaultQuery || cat.default_query || DEFAULT_QUERIES[cat.code] || '';
    }
  }
}

export function defaultSourceQuery(category: string): string {
  return dynamicCategoriesMap[category] ?? DEFAULT_QUERIES[category] ?? '';
}

export function simpleSourceQuery(query: string): string {
  const lines = query.split(/\r?\n/);
  if (!lines.some((line) => /^\s*(principaux?|primary|secondaires?|secondary)\s*:/i.test(line))) {
    return query;
  }
  return lines
    .filter((line) => /^\s*(principaux?|primary|secondaires?|secondary)\s*:/i.test(line))
    .map((line) => line.replace(/^\s*[^:]+:\s*/, ''))
    .join(', ')
    .replace(/"/g, '');
}
