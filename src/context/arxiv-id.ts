// Resolve an arXiv id from Zotero item metadata fields. Pure — no I/O.

export interface ArxivIdFields {
  extra?: string;
  url?: string;
  doi?: string;
  archiveID?: string;
}

// new-style: 2504.16054 (+ optional v3); legacy: hep-th/9901001 (+ optional v2)
// The digit groups are bounded by (^|\D) and (\D|$) so a slice of a longer
// numeric run (e.g. ...678.3539... inside a non-arXiv DOI) is not matched.
const NEW_STYLE = /(?:^|\D)(\d{4}\.\d{4,5})(v\d+)?(?:\D|$)/;
const LEGACY_STYLE = /([a-z][a-z-]*(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/;

function extractArxivId(text: string): string | null {
  // Anchor on an "arxiv" mention when present, to avoid matching stray
  // numbers (e.g. a non-arXiv DOI). Fall back to a bare scan otherwise.
  const anchored = text.match(/ar[xX]iv[:.\s/]*([^\s]+)/);
  const haystacks = anchored ? [anchored[1], text] : [text];
  for (const h of haystacks) {
    const m = h.match(NEW_STYLE) ?? h.match(LEGACY_STYLE);
    if (m) return `${m[1]}${m[2] ?? ""}`;
  }
  return null;
}

export function resolveArxivId(fields: ArxivIdFields): string | null {
  for (const raw of [fields.extra, fields.archiveID, fields.url, fields.doi]) {
    const id = raw ? extractArxivId(raw) : null;
    if (id) return id;
  }
  return null;
}
