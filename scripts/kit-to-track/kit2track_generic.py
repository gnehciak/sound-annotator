"""Convert a non-SSO teaching kit into one Sound Annotator track per work.

The SSO kits share one template; these don't. An AMC anthology carries three or
four works in one PDF, so the split has to come from the document itself: its
table of contents names the works, and each name reappears as a heading further
in. Anchoring on where that heading actually falls avoids guessing at printed-
vs-PDF page offsets, and bounds the last work so it can't swallow the appendix.

A kit with no such contents becomes a single track. Everything downstream —
paragraph joining, bullet lists, guide tables with real timings, score excerpts
as inline images, tasks as question notes — is the SSO converter's machinery
(kit2track.py).
"""
import fitz, re, json, sys, os
from flow import flow, png_data_uri
from kit2track import (para_html, esc, bar_label, ENTRY_RE, SECTION_RE, ROW_RE,
                       ROW2_RE, secs, NOISE_RE, LIGATURES, slug)
import amc_guide

GUIDE = re.compile(r'^(Listening\s+guides?|Listening/Musicolog)\b', re.I)
STOP = re.compile(
    r'^(Score Excerpt|Score Video|Appendix|References|Bibliograph|Acknowledge'
    r'|Contents|Glossary|Further (listening|reading)|Syllabus)', re.I)
ACT = re.compile(r'^(Activit|Task\s+\d|Questions?\b)', re.I)
# Contents entries: "4. Judy Bailey: So Many Rivers" / "6. Jenna Cave: Orange…"
TOC_ENTRY = re.compile(r'^\s*\d{1,2}\.?\s+(.{6,80}?)\s*$')
FRONT = re.compile(
    r'^(Introduction|References|Bibliograph|Teaching Ideas|Contents|Table of'
    r'|Acknowledge|About|Appendix|Glossary|Conclusion|Foreword|Preface'
    r'|The .{0,20}Score$|Three Composers|Resources)', re.I)


def clean(it):
    it["lines"] = [l.translate(LIGATURES) for l in it["lines"]]
    return it["text"].strip().translate(LIGATURES)


def toc_works(items):
    """Work titles from the table of contents — the numbered entries that name a
    piece. Confined to the contents page itself: a numbered-line pattern also
    matches a bibliography, and scanning past the page picks the whole of one up.
    """
    start = next((i for i, it in enumerate(items[:150])
                  if it["kind"] == "text"
                  and re.match(r'^(Table of contents|Contents)$', it["text"].strip(), re.I)), None)
    if start is None: return []
    page = items[start]["page"]
    out = []
    for it in items[start + 1:]:
        if it["page"] > page + 1: break
        if it["kind"] != "text": continue
        for line in it["lines"]:
            m = TOC_ENTRY.match(line.strip())
            if not m: continue
            name = re.sub(r'\s+', ' ', m.group(1)).strip(' .')
            if len(name) < 6 or FRONT.match(name) or name.isdigit(): continue
            if re.search(r'https?://|\(\d{4}\)|‘.{20,}', name): continue   # a citation
            if name not in out: out.append(name)
    return out


TAIL = re.compile(r'^\s*(?:\d{1,2}\.?\s+)?(Teaching Ideas|References|Bibliograph'
                  r'|Appendix|Glossary|Further (listening|reading)|Conclusion)', re.I)


def norm(t):
    """Loose heading comparison — contents and body differ in smart quotes,
    spacing and punctuation."""
    t = t.lower().replace('\u2018', "'").replace('\u2019', "'")
    return re.sub(r'[^a-z0-9 ]+', ' ', re.sub(r'\s+', ' ', t)).strip()


def split_units(items, works, kit):
    """One unit per work.

    The listening guides are the dependable landmark: an anthology has exactly
    one per work, in contents order. But a unit must *start* at its own work
    heading, not at the previous guide — otherwise the first work inherits the
    whole front matter (acknowledgements, copyright, "About the AMC") as notes.
    So walk back from each guide to the nearest line that matches the work's
    title, and fall back to the end of the front matter when there isn't one.
    """
    guides = [i for i, it in enumerate(items)
              if it["kind"] == "text" and GUIDE.match(it["text"].strip())
              and len(it["text"].strip()) < 60]
    if not guides:
        return [(works[0] if len(works) == 1 else kit, items)]

    def work_head(g, title, floor):
        piece = title.split(':', 1)[1] if ':' in title else title
        key = norm(piece)[:26]
        if len(key) >= 5:
            for j in range(g - 1, floor - 1, -1):
                it = items[j]
                if it["kind"] == "text" and len(it["text"]) < 90 and key in norm(it["text"]):
                    return j
        # No heading found: skip whatever front matter sits above the guide.
        for j in range(g - 1, floor - 1, -1):
            it = items[j]
            if it["kind"] == "text" and FRONT.match(it["text"].strip()) and len(it["text"]) < 60:
                return j + 1
        return floor

    units, floor = [], 0
    for n, g in enumerate(guides):
        title = works[n] if n < len(works) else f"{kit} — work {n + 1}"
        start = work_head(g, title, floor)
        end = guides[n + 1] if n + 1 < len(guides) else len(items)
        if n + 1 == len(guides):
            tail = next((j for j in range(g, len(items))
                         if items[j]["kind"] == "text" and TAIL.match(items[j]["text"].strip())
                         and len(items[j]["text"].strip()) < 40), None)
            if tail: end = tail
        units.append((title, items[start:end]))
        floor = g + 1
    return units


def build_units(path, max_img_bytes=300_000):
    doc, items = flow(path, skip_pages=0)
    works = toc_works(items)

    kit = re.sub(r'^(AMC Resource Kit -|DET Kit -|Resource Kit -)\s*', '',
                 os.path.basename(path).rsplit('.', 1)[0]).strip(' "')
    units = split_units(items, works, kit)

    out = []
    for title, chunk in units:
        notes, cur, kind, mode, timed = [], None, None, "body", 0
        img_budget = [3_000_000]   # a track carries its excerpts, not a whole book

        def add(at=None, **kw):
            n = {"_t": at}; n.update(kw); notes.append(n); return n

        # An AMC guide is a four-column table spread over pages; reading order
        # scrambles it, so rebuild it from the page geometry instead (amc_guide).
        gi = next((k for k, it in enumerate(chunk)
                   if it["kind"] == "text" and GUIDE.match(it["text"].strip())
                   and len(it["text"].strip()) < 60), None)
        table_rows = []
        if gi is not None:
            p0 = chunk[gi]["page"]
            p1 = chunk[-1]["page"]
            for k in range(gi + 1, len(chunk)):
                t = chunk[k]
                if t["kind"] == "text" and (ACT.match(t["text"].strip()) or TAIL.match(t["text"].strip())) \
                        and len(t["text"].strip()) < 60:
                    p1 = t["page"]; break
            try:
                table_rows = amc_guide.guide_rows(doc, p0, p1)
            except Exception:
                table_rows = []
        if len(table_rows) >= 4:
            for r in table_rows:
                body = " ".join(r[3]).strip()
                if not body and not r[0]: continue
                at = amc_guide.secs(r[2])
                n = add(at=at, contentHtml=(f"<p><strong>{esc(r[0])}</strong></p>" if r[0] else "")
                                           + para_html([body]) if body or r[0] else "")
                if r[0]:
                    n["structure"] = True; n["sectionName"] = r[0][:60]; n["tags"] = ["form"]
                bars = re.findall(r'\d+', r[1] or "")
                if bars: n["bar"] = bar_label(bars[0], bars[1] if len(bars) > 1 else None)
                if at is not None: timed += 1
            # Give each timed row a span up to the next one, so the overview reads.
            timedn = [n for n in notes if n.get("_t") is not None]
            for a, b in zip(timedn, timedn[1:]):
                if b["_t"] > a["_t"]: a["end"] = b["_t"]

        for it in chunk:
            if table_rows and it["kind"] == "text" and GUIDE.match(it["text"].strip()):
                mode = "table"; cur = None; kind = None; continue
            if mode == "table":
                s2 = it["text"].strip() if it["kind"] == "text" else ""
                if s2 and (ACT.match(s2) or TAIL.match(s2)) and len(s2) < 60:
                    mode = "questions" if ACT.match(s2) else "skip"
                    cur = (add(question=True, tags=["comment"],
                               contentHtml=f"<p><strong>{esc(s2)}</strong></p>")
                           if mode == "questions" else None)
                    kind = "head"
                continue
            if it["kind"] == "image":
                if cur is None or it["w"] < 60 or it["h"] < 18: continue
                if img_budget[0] <= 0: continue
                uri, nb = png_data_uri(doc, it["page"], it["bbox"])
                if nb <= max_img_bytes:
                    cur["contentHtml"] += f'<img src="{uri}">'
                    img_budget[0] -= nb
                continue
            s = clean(it)
            if not s or NOISE_RE.match(s): continue
            if GUIDE.match(s) and len(s) < 60:
                mode, cur, kind = "guide", None, None; continue
            if ACT.match(s) and len(s) < 90 and mode != "body":
                mode = "questions"
                cur = add(question=True, tags=["comment"],
                          contentHtml=f"<p><strong>{esc(s)}</strong></p>")
                kind = "head"; continue
            if (STOP.match(s) or TAIL.match(s)) and len(s) < 60:
                mode, cur, kind = "skip", None, None; continue
            if mode == "skip": continue
            if it["bold"] and len(s) < 60 and not ENTRY_RE.match(s) and mode != "questions":
                cur = add(contentHtml=f"<p><strong>{esc(s)}</strong></p>"); kind = "head"; continue

            row = ROW_RE.match(s) or ROW2_RE.match(s)
            m = ENTRY_RE.match(s)
            if row and mode == "guide":
                named = "name" in row.groupdict()
                cur = add(at=secs(row["t1"]), bar=bar_label(row["b1"], row["b2"]),
                          contentHtml=(f"<p><strong>{esc(row['name'].strip())}</strong></p>" if named else "")
                                      + para_html([row["rest"].strip()]),
                          **({"structure": True, "tags": ["form"],
                              "sectionName": row["name"].strip()} if named else {}))
                if secs(row["t2"]) > secs(row["t1"]): cur["end"] = secs(row["t2"])
                kind = "head"; timed += 1
            elif it["bold"] and SECTION_RE.search(s) and len(s) < 70 and mode == "guide":
                nums = re.findall(r'\d+', s)
                cur = add(structure=True, tags=["form"],
                          sectionName=re.sub(r'\s*Bars?\s*[\d\s\-–—]+', ' ', s).strip(' -–—') or s,
                          contentHtml=f"<p><strong>{esc(s)}</strong></p>")
                if nums: cur["bar"] = bar_label(nums[0], nums[1] if len(nums) > 1 else None)
                kind = "head"
            elif m and m.group(3) and len(m.group(3)) > 3 and mode == "guide":
                first = re.sub(r'^Bars?\s+\d+\s*(?:[-–—]|to)?\s*\d*\s*', '', it["lines"][0]).strip()
                cur = add(bar=bar_label(m.group(1), m.group(2)),
                          contentHtml=para_html(([first] if first else []) + it["lines"][1:]))
                kind = "head"
            elif cur is not None and (kind == "head" or len(cur["contentHtml"]) < 700):
                cur["contentHtml"] += para_html(it["lines"]); kind = "body"
            else:
                cur = add(contentHtml=para_html(it["lines"]),
                          **({"question": True, "tags": ["comment"]} if mode == "questions" else {}))
                kind = "body"

        t = 0
        for n in notes:
            at = n.pop("_t", None)
            t = max(t + 1, at if at is not None else 0)
            n["start"] = t
            if "end" in n and n["end"] <= n["start"]: n.pop("end")
            t = max(t, n.get("end", t))
        keep = [n for n in notes if n.get("contentHtml")]
        if len(keep) < 3: continue
        out.append(({
            "format": "sound-annotator-project", "version": 1, "exportedAt": 0,
            "project": {"title": title[:90],
                        "settings": {"overviewOpen": True, "noteOrder": "timeline"},
                        "annotations": keep},
        }, timed))
    return out


if __name__ == "__main__":
    src, outdir = sys.argv[1], sys.argv[2]
    print(os.path.basename(src)[:60])
    for d, timed in build_units(src):
        p = os.path.join(outdir, slug(d["project"]["title"]) + ".json")
        with open(p, "w") as f: json.dump(d, f, ensure_ascii=False)
        a = d["project"]["annotations"]
        print(f"   {d['project']['title'][:46]:<48} notes{len(a):<4} q{sum(1 for x in a if x.get('question')):<4}"
              f" {'timed' if timed else '     '} {os.path.getsize(p)//1024:>4}KB")
