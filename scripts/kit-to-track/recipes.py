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
]


def find(path):
    for r in RECIPES:
        if r["match"].search(path):
            return r
    return None


def squash(t):
    """Letter-spaced display type ("S E C T I O N 1") back to plain text."""
    return re.sub(r'\s+', ' ', t).strip()


def units(items, recipe, head):
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

    min_size = recipe.get("split_min_size", 0)
    starts = [(i, recipe["split"].match(txt(it)).group(1).strip())
              for i, it in enumerate(items[:ans_i])
              if it["kind"] == "text" and recipe["split"].match(txt(it))
              and it["size"] >= min_size]
    ans = [(i, items[i]) for i in range(ans_i, stop_i)
           if items[i]["kind"] == "text" and recipe["answers_split"].match(txt(items[i]))]

    out = []
    for n, (i, work) in enumerate(starts):
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
