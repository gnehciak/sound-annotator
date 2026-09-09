"""Per-document recipes for kits whose shape no general rule captures.

Most kits fall to the heuristics in kit2track_generic. A few don't, and tuning
the general rules to fit them kept breaking the ones that already worked — each
change helped two documents and regressed a third. These are the exceptions,
described explicitly instead: how the document divides into works, where it
stops, and what a track should be called.
"""
import re

RECIPES = [
    {
        # Three works, each introduced by "<Work> - activities". Its answers
        # section repeats those names as sub-headings and carries the filled-in
        # guide table — the only place the timings appear — so each work's
        # track takes its activities AND its answers.
        "match": re.compile(r'Noordhuis-TEACHING BOOK', re.I),
        "split": re.compile(r'^(.{3,40}?)\s*[-–]\s*activities\s*$', re.I),
        "answers_at": re.compile(r'^Suggested answers\s*$', re.I),
        "answers_split": re.compile(r'^(Water Crossing|Le Hameau Omi|Mayfair)\s*$', re.I),
        "stop": re.compile(r'^(Links and resources)\s*$', re.I),
        "title": "Nadje Noordhuis: {work}",
    },
    {
        # A concert guide, not a per-work booklet: it runs Basics → Artists →
        # Resource Library → four lesson plans, all covering both works
        # together. Splitting it by work would cut every section in half, so it
        # is one track, starting at Section 1 and skipping cover and contents.
        "match": re.compile(r'MSO HAYDN AND SCULTHORPE', re.I),
        "single": True,
        "start": re.compile(r'^S\s?E\s?C\s?T\s?I\s?O\s?N\s?1', re.I),
        "title": "MSO Curriculum Concert: Haydn and Sculthorpe",
    },
    {
        # Three works, each a bold "Composer – Work" heading followed by the
        # same run of sections (Background / From the composer / Listening
        # guides / Activities). After the third work the document stops being a
        # per-work resource and becomes a composition workshop deck, so the
        # last track ends where those slides start.
        "match": re.compile(r'AMD 2024 Program 2', re.I),
        "split": re.compile(r'^((?:Alex Pozniak|Nick Russoniello|Elena Kats-Chernin)'
                            r'\s*[-–—]\s*.{3,60}?)\s*$', re.I),
        "split_min_size": 16,
        "answers_at": re.compile(r'^About me:\s*$', re.I),
        "answers_split": re.compile(r'^(?!x)x'),          # never matches: no answers section
        "stop": re.compile(r'^About me:\s*$', re.I),
        "title": "{work}",
    },
    {
        # OCR'd scan. Its cover is display type that comes back as noise
        # ("fae Se Ee er"), so the title is stated rather than read.
        "match": re.compile(r'Kakadu Analysis', re.I),
        "single": True,
        "title": "Peter Sculthorpe: Kakadu — Analysis",
    },
    {
        # OCR'd scan: a book of analyses from one Music Day, kept whole.
        "match": re.compile(r'Paul Stanhope.*Book of analysis', re.I),
        "single": True,
        "title": "MLC Australian Music Day 2002: Book of Analyses",
    },
    {
        # OCR'd scan. A suite: each movement gets a "Listening Outline", though
        # the scan renders their separators inconsistently (colon, dash, none).
        "match": re.compile(r'Out of the Blue', re.I),
        "split": re.compile(r'^Listening Outline\s*[:\-–—]?\s*(.{0,50})$', re.I),
        "answers_at": re.compile(r'^(?!x)x'),
        "answers_split": re.compile(r'^(?!x)x'),
        "stop": re.compile(r'^(?!x)x'),
        "title": "Out of the Blue — {work}",
    },
    {
        # Old SSO season books: several works, each with the same run of
        # sections. The index names them, and each work's analysis is the split
        # point — "Analysis" in the 2005/2009 books, "Listening Outline" in 2010.
        "match": re.compile(r'SSO (Meet the Music )?(2005|2009|2010)', re.I),
        "index_works": True,
        "split": re.compile(r'^(Analysis|Listening Outline)\s*$', re.I),
        "answers_at": re.compile(r'^(?!x)x'),
        "answers_split": re.compile(r'^(?!x)x'),
        "stop": re.compile(r'^(?!x)x'),
        "title": "{work}",
    },
]


SECTION_WORD = re.compile(
    r'^(Orchestration|Sound Excerpts|Background|Outcomes|Analysis|Activities|Answers'
    r'|Listening Outline|Index|Contents|Page\s*\d+|\d+)\s*[.\s]*$', re.I)
INDEX_JUNK = re.compile(r'^(CD Track|Track Listing|Compact Disc)', re.I)


def works_from_index(doc):
    """Work titles from an old SSO season index.

    Every work is listed as its title (and, in the older books, its composer)
    followed by the same run of section names. So each "Orchestration" line
    marks a work, and the title is the text immediately above it that isn't
    itself a section name or a page number.
    """
    for pno in range(min(8, len(doc))):
        lines = [re.sub(r'\s+', ' ', l).strip() for l in doc[pno].get_text().split('\n')]
        lines = [l for l in lines if l]
        if not any(re.match(r'^Orchestration\s*$', l, re.I) for l in lines):
            continue
        works = []
        for i, l in enumerate(lines):
            if not re.match(r'^Orchestration\s*$', l, re.I):
                continue
            parts = []
            for j in range(i - 1, max(-1, i - 4), -1):
                t = lines[j]
                if SECTION_WORD.match(t) or INDEX_JUNK.match(t) or len(t) < 3:
                    break
                parts.insert(0, t)
            if parts:
                works.append(" — ".join(parts[:2]) if len(parts) > 1 else parts[0])
        if works:
            return works
    return []


def find(path):
    for r in RECIPES:
        if r["match"].search(path):
            return r
    return None


def squash(t):
    """Letter-spaced display type ("S E C T I O N 1") back to plain text."""
    return re.sub(r'\s+', ' ', t).strip()


def units(items, recipe, head, doc=None):
    """(title, items) per track, following the recipe."""
    def txt(it):
        return squash(head(it["text"])) if it["kind"] == "text" else ""

    if recipe.get("single"):
        start = 0
        if recipe.get("start"):
            start = next((i for i, it in enumerate(items)
                          if it["kind"] == "text"
                          and recipe["start"].match(re.sub(r'\s', '', txt(it))[:12])), 0)
        return [(recipe["title"], items[start:])]

    # where the answers section begins, and where the document stops
    ans_i = next((i for i, it in enumerate(items)
                  if it["kind"] == "text" and recipe["answers_at"].match(txt(it))), len(items))
    stop_i = next((i for i in range(ans_i, len(items))
                   if items[i]["kind"] == "text" and recipe["stop"].match(txt(items[i]))), len(items))

    if recipe.get("index_works") and doc is not None:
        idx = works_from_index(doc)
        # Skip split points on the index page itself.
        first_body = next((i for i, it in enumerate(items) if it["page"] > 0), 0)
        pts = [i for i, it in enumerate(items)
               if i > first_body and it["kind"] == "text"
               and recipe["split"].match(squash(head(it["text"])))]
        # The heading also appears inside a work's answers, so there are more
        # split points than works. The index is authoritative about how many
        # works there are: keep that many, and let the last run to the end.
        if idx and len(pts) > len(idx):
            pts = pts[:len(idx)]
        out = []
        for n, i in enumerate(pts):
            end = pts[n + 1] if n + 1 < len(pts) else len(items)
            title = idx[n] if n < len(idx) else f"Work {n + 1}"
            out.append((recipe["title"].format(work=title), items[i:end]))
        return out

    min_size = recipe.get("split_min_size", 0)
    starts = [(i, recipe["split"].match(txt(it)).group(1).strip())
              for i, it in enumerate(items[:ans_i])
              if it["kind"] == "text" and recipe["split"].match(txt(it))
              and it["size"] >= min_size]
    ans = [(i, items[i]) for i in range(ans_i, stop_i)
           if items[i]["kind"] == "text" and recipe["answers_split"].match(txt(items[i]))]

    out = []
    for n, (i, work) in enumerate(starts):
        work = work.strip(' :-–—') or f"Movement {n + 1}"
        end = starts[n + 1][0] if n + 1 < len(starts) else ans_i
        chunk = items[i:end]
        # bolt on this work's answers, where they exist
        for k, (j, it) in enumerate(ans):
            if squash(head(it["text"])).lower().startswith(work.lower()[:12]):
                aend = ans[k + 1][0] if k + 1 < len(ans) else stop_i
                chunk = chunk + items[j:aend]
                break
        out.append((recipe["title"].format(work=work), chunk))
    return out
