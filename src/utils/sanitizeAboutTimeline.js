const VALID_YEAR = /^(19|20)\d{2}$/;
const CORRUPT_MILESTONE_RE =
  /busineExpansion|Singaporess|ss accounts|buExpansion|ness accounts/i;

/**
 * Normalize aboutTimeline CMS payload: valid 4-digit years, dedupe years, clean milestones.
 */
export function sanitizeAboutTimelineEnglishData(data) {
  if (!data || typeof data !== 'object') return data;

  const items = Array.isArray(data.items) ? data.items : [];
  const seenYears = new Set();
  const cleaned = [];

  for (const raw of items) {
    const year = String(raw?.year ?? '').trim();
    if (!VALID_YEAR.test(year) || seenYears.has(year)) continue;
    seenYears.add(year);

    const rawList = Array.isArray(raw.milestones)
      ? raw.milestones
      : raw?.milestone
        ? [raw.milestone]
        : [];

    const msSeen = new Set();
    const milestones = rawList
      .map((m) => String(m ?? '').trim())
      .filter((m) => {
        if (!m || CORRUPT_MILESTONE_RE.test(m)) return false;
        if (msSeen.has(m)) return false;
        msSeen.add(m);
        return true;
      });

    if (milestones.length === 0) continue;
    cleaned.push({ year, milestones });
  }

  cleaned.sort((a, b) => Number(a.year) - Number(b.year));

  return {
    ...data,
    items: cleaned,
  };
}
