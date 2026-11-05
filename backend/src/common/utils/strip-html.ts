export function stripHtmlTags(value?: string | null): string {
  if (!value) {
    return '';
  }

  return value
    // Decode HTML entities for angle brackets first in case tags were entity-encoded (&lt;i&gt;...&lt;/i&gt;)
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#0*60;|&#x0*3c;/gi, '<')
    .replace(/&#0*62;|&#x0*3e;/gi, '>')
    // Strip all HTML/XML/JATS tags (<i ...>, </i>, <em>, <jats:italic>, <sub>, <sup>, <scp>, etc.)
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    // Decode common HTML entities
    .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, ' ')
    .replace(/&amp;|&#0*38;|&#x0*26;/gi, '&')
    .replace(/&quot;|&#0*34;|&#x0*22;/gi, '"')
    .replace(/&apos;|&#0*39;|&#x0*27;/gi, "'")
    .replace(/&ndash;|&#8211;/gi, '–')
    .replace(/&mdash;|&#8212;/gi, '—')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripHtmlNullable(value?: string | null): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const cleaned = stripHtmlTags(value);
  return cleaned || null;
}
