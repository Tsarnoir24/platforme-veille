import { ExternalItem } from '../interfaces/connector.interface';

const CATEGORY_QUERIES: Record<string, string> = {
  SCIENTIFIQUE: 'scientifique, recherche, étude, laboratoire, microbiologie, analyse, chromatographie, spectrométrie, validation de méthode, détection',
  REGLEMENTAIRE: 'règlement, directive, décret, arrêté, loi, conformité, législation, avis sanitaire, limite maximale de résidus, LMR, rappel de produit, alerte',
  ACCREDITATION: 'ISO 17025, ISO/IEC 17025, accréditation, COFRAC, SOAC, audit, essai d’aptitude, intercomparaison, compétence technique, traçabilité métrologique',
  NORMATIF: 'norme, standard, ISO, IEC, AFNOR, ASTM, CEN, normalisation, méthode de référence, spécification technique, Codex Alimentarius',
  ENVIRONNEMENT: 'environnement, pollution, qualité de l’eau, eau potable, pesticide, sol, nappe phréatique, effluent, déchet, rejet, métaux lourds',
  AUTRE: '',
};

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function defaultQueryForCategory(category: string): string {
  return CATEGORY_QUERIES[category] ?? '';
}

export function parseSearchSubjects(query: string): string[] {
  const legacyLines = query.split(/\r?\n/);
  const legacyFormat = legacyLines.some((line) => /^\s*(principaux?|primary|secondaires?|secondary)\s*:/i.test(line));
  const subjectsText = legacyFormat
    ? legacyLines
      .filter((line) => /^\s*(principaux?|primary|secondaires?|secondary)\s*:/i.test(line))
      .map((line) => line.replace(/^\s*[^:]+:\s*/, ''))
      .join(',')
    : query;
  return [...new Set(subjectsText
    .split(',')
    .map((subject) => normalize(subject.trim().replace(/^"|"$/g, '')))
    .filter(Boolean))];
}

export function crossrefSearchQuery(query: string): string {
  return parseSearchSubjects(query).join(' ');
}

export function filterItemsByQuery(
  items: ExternalItem[],
  query: string,
): { items: ExternalItem[]; ignoredCount: number } {
  const subjects = parseSearchSubjects(query);
  if (!subjects.length) return { items, ignoredCount: 0 };

  const retained = items.filter((item) => {
    const searchable = normalize(`${item.title ?? ''} ${item.summary ?? ''}`);
    return subjects.some((subject) => searchable.includes(subject));
  });

  return { items: retained, ignoredCount: items.length - retained.length };
}
