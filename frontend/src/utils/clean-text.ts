export function stripHtmlTags(value?: string | null): string {
  if (!value) {
    return '';
  }

  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#0*60;|&#x0*3c;/gi, '<')
    .replace(/&#0*62;|&#x0*3e;/gi, '>')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, ' ')
    .replace(/&amp;|&#0*38;|&#x0*26;/gi, '&')
    .replace(/&quot;|&#0*34;|&#x0*22;/gi, '"')
    .replace(/&apos;|&#0*39;|&#x0*27;/gi, "'")
    .replace(/&ndash;|&#8211;/gi, '–')
    .replace(/&mdash;|&#8212;/gi, '—')
    .replace(/\s+/g, ' ')
    .trim();
}

export function renderSafeInlineHtml(value?: string | null): string {
  if (!value) {
    return '';
  }

  // First normalize any entity-encoded tags like &lt;i&gt; to <i>
  const normalized = value
    .replace(/&lt;(\/?(?:i|em|b|strong|sub|sup))\b[^&]*&gt;/gi, '<$1>')
    .replace(/<(\/?(?:i|em|b|strong|sub|sup))\b[^>]*>/gi, '___TAG_$1___')
    // Strip any other HTML/XML/JATS tags completely
    .replace(/&lt;\/?[a-zA-Z][^&]*&gt;/g, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '');

  // Escape HTML special characters
  const escaped = normalized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // Restore safe inline formatting tags (<i>, </i>, <em>, </em>, <b>, </b>, <strong>, </strong>, <sub>, </sub>, <sup>, </sup>)
  return escaped.replace(/___TAG_(\/?(?:i|em|b|strong|sub|sup))___/gi, (_, tag) => `<${tag.toLowerCase()}>`);
}
