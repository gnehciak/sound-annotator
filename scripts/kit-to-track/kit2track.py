"""Turn an SSO 'Meet the Music' kit PDF into a Sound Annotator track file.

The 38 modern kits share one template: a Listening Guide of "Bar N — prose"
paragraphs (with score excerpts sitting under the paragraph they illustrate),
then Learning Activities of numbered tasks, then Suggested Answers. That maps
onto the track model almost directly — a guide paragraph is a note, a bold
"Bars X - Y Section Z" heading is a structure section, a task's questions are
question notes (which is what makes a shared link open as a worksheet), and the
answers come back as ordinary notes so they never show up in a student's copy.

The kits carry bar numbers, not timings, so every note is stamped at a
placeholder second (1, 2, 3 …) in document order; the bar number is the real
anchor and rides in the note's `bar` chip. Retiming against a recording is then
a matter of dragging notes, not re-typing them.
"""
import fitz, re, json, sys, os, html
from flow import flow, links, png_data_uri

ENTRY_RE = re.compile(r'^Bars?\s+(\d+)\s*(?:[-–—]|to)?\s*(\d+)?\s*(.*)$', re.S)
# A guide laid out as a table: "Introduction 1 - 41 0.40' - 2.52' The four themes…"
# These kits are the lucky ones — they carry real timings, not just bars.
ROW_RE = re.compile(
    r"^(?P<name>[A-Z][^\d]{0,38}?)\s+(?P<b1>\d+)\s*[-–—]\s*(?P<b2>\d+)\s+"
    r"(?P<t1>\d{1,3}[.:]\d{2})['’]?\s*[-–—]\s*(?P<t2>\d{1,3}[.:]\d{2})['’]?\s+(?P<rest>.+)$")
# The same table without a section column: "1 - 46 0:00 - 0:44 ● Allegro Moderato…"
ROW2_RE = re.compile(
    r"^(?P<b1>\d+)\s*[-–—]\s*(?P<b2>\d+)\s+(?P<t1>\d{1,3}[.:]\d{2})['’]?\s*[-–—]\s*"
    r"(?P<t2>\d{1,3}[.:]\d{2})['’]?\s+(?P<rest>.+)$")


def secs(t):
    m, s = t.replace(":", ".").split(".")[:2]
    return int(m) * 60 + int(s)
SECTION_RE = re.compile(
    r'(Section\s+[A-Z0-9]|Coda|Introduction|Exposition|Development|Recapitulation'
    r'|Movement|Variation|Interlude|Finale|Part\s+\d|Scene\s+\d)', re.I)
MARKER_RE = re.compile(r'^\s*(?:[•▪◦‣·]|o(?=\s)|\d+[.)]|[a-z][.)])\s*')
MARKER_ONLY = re.compile(r'^\s*[•▪◦‣·o]\s*$')
STOP_HEADS = re.compile(
    r'^(Audio Excerpts?|Score Excerpts?|Performance videos?|Learning Activities'
    r'|Glossary|Appendix|Syllabus|Acknowledge|Suggested Answers)', re.I)
GUIDE_HEAD = re.compile(r'Listening\s+guide|Overview\s*&\s*Detailed Analysis', re.I)
ACT_HEAD = re.compile(r'^(Learning Activities|Activity\s+1\b)', re.I)
# Some kits were made in a Word build whose ligature glyphs export as the wrong
# codepoints — "Ɵ" for "ti" and friends. Left alone the prose is unreadable.
LIGATURES = str.maketrans({"Ɵ": "ti", "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl"})
ANSWERS_HEAD = re.compile(r'^(Suggested Answers|Sample Answers|Answers\b)', re.I)
TASK_RE = re.compile(r'^(Task\s+\d+|Activity\s+\d+)\b(.*)$', re.I)
# Syllabus outcome codes and other table debris: "P4, P5", "4.7, 4.8, 4.9", "H2, H3"
NOISE_RE = re.compile(r'^(?:[PH]?\d+(?:\.\d+)?[,\s]*)+$')
QUESTIONY = re.compile(r'\?|^(Focus|Scaffolding|Discuss|Describe|Compare|Listen|Identify)', re.I)


def esc(t):
    return html.escape(t, quote=False)


def para_html(lines):
    """Block lines → HTML. Wrapped lines rejoin; bullet runs become a list.

    PyMuPDF hands back a bullet glyph as its own line, so a marker-only line is
    folded into the one after it before anything else looks at the text.
    """
    merged = []
    for ln in lines:
        if merged and MARKER_ONLY.match(merged[-1]):
            merged[-1] = merged[-1].strip() + " " + ln.strip()
        else:
            merged.append(ln)
    out, bullets, para = [], [], []

    def flush_para():
        if para:
            t = " ".join(para).strip()
            if t and not NOISE_RE.match(t): out.append(f"<p>{esc(t)}</p>")
            para.clear()

    def flush_bullets():
        if bullets:
            out.append("<ul>" + "".join(f"<li>{esc(b)}</li>" for b in bullets if b) + "</ul>")
            bullets.clear()

    for ln in merged:
        s = ln.strip()
        if not s: continue
        if MARKER_RE.match(s) and len(MARKER_RE.sub("", s).strip()) > 2:
            flush_para()
            bullets.append(MARKER_RE.sub("", s).strip())
        elif bullets:
            bullets[-1] = (bullets[-1] + " " + s).strip()   # wrapped list item
        else:
            para.append(s)
    flush_para(); flush_bullets()
    return "".join(out)


def bar_label(a, b):
    return f"bb. {a}–{b}" if b else str(a)


def cover_title(doc, fallback):
    """The title page's largest run of type — always the work, then the composer.

    "Largest run", not "largest size": the Acknowledgements heading overleaf is
    often set at the same size, so only the *first* unbroken run counts. The
    cover itself is a full-page image in most kits, so the type lives on the
    page after it.
    """
    lines = []
    for pno in range(min(2, len(doc))):
        for b in doc[pno].get_text("dict")["blocks"]:
            if b["type"] != 0: continue
            for l in b["lines"]:
                t = "".join(s["text"] for s in l["spans"]).strip()
                sz = round(max((s["size"] for s in l["spans"]), default=0), 1)
                if t: lines.append((sz, t))
    if not lines: return fallback
    top = max(sz for sz, _ in lines)
    runs, cur, started = [], [], False
    for sz, t in lines:
        if sz == top:
            if started and cur is not runs[-1] if runs else False: pass
            cur.append(t); started = True
        elif started and cur:
            runs.append(cur); cur = []; started = False
    if cur: runs.append(cur)
    run = runs[0] if runs else []
    # Many covers set only the composer at the largest size and the work just
    # under it — a title of "MOZART" helps nobody, so take the next run too.
    joined = " ".join(run).strip()
    if len(joined) < 26 and len(runs) > 1:
        run = run + runs[1]
    elif len(joined) < 26:
        nxt = [t for sz, t in lines if sz < top and len(t) > 6]
        run = run + nxt[:1]
    title = re.sub(r'\s+', ' ', " ".join(run)).strip()
    title = re.sub(r'\s*(Stage \d.*|Teachers? Resource.*|Meet the Music.*|Learning & Engagement.*)$',
                   '', title, flags=re.I)
    return title.strip(" -–—") or fallback


BOILER = re.compile(r'^(Acknowledge|Contents|Contact|Sydney Symphony|Teachers? Resource|Learning)', re.I)


def title_from_filename(path):
    """Kit filenames are "COMPOSER_Work-Name_Meet-the-Music_YEAR" — a decent
    title when the cover has none set larger than the boilerplate."""
    n = os.path.basename(path).rsplit(".", 1)[0]
    n = re.sub(r'[_\- ]*Meet[_\- ]?the[_\- ]?Music.*$', '', n, flags=re.I)
    n = re.sub(r'[_\- ]*Teaching[_\- ]resource.*$', '', n, flags=re.I)
    n = re.sub(r'\s*\(\d+\)$', '', n.replace("_", " ").replace("-", " "))
    return re.sub(r'\s+', ' ', n).strip()


def build(path, max_img_bytes=300_000):
    doc, items = flow(path)
    yt = [u for _, u in links(doc) if "youtu" in u]
    title = cover_title(doc, "")
    if not title or BOILER.match(title) or len(title) < 8:
        title = title_from_filename(path)

    notes = []
    # Notes carry an optional real time; everything else is stamped later, in
    # order, so the timeline stays monotonic whichever kind of guide this is.
    def add(at=None, **kw):
        n = {"_t": at}; n.update(kw); notes.append(n); return n

    def attach_image(cur, it):
        if cur is None or it["w"] < 60 or it["h"] < 18: return
        uri, nbytes = png_data_uri(doc, it["page"], it["bbox"])
        if nbytes <= max_img_bytes:
            cur["contentHtml"] += f'<img src="{uri}">'

    def find(pred, start=0):
        for i in range(start, len(items)):
            if items[i]["kind"] == "text" and pred(items[i]["text"].strip()):
                return i
        return -1

    # ---- listening guide ---------------------------------------------------
    gi = find(lambda s: GUIDE_HEAD.search(s) and len(s) < 45)
    guide_n, timed_n, sections = 0, 0, []
    if gi >= 0:
        cur, cur_kind, prev_was_section = None, None, False
        for it in items[gi + 1:]:
            if it["kind"] == "image":
                attach_image(cur, it); continue
            s = it["text"].strip().translate(LIGATURES)
            it["lines"] = [l.translate(LIGATURES) for l in it["lines"]]
            if STOP_HEADS.match(s) and len(s) < 60: break
            if not s or NOISE_RE.match(s): continue
            # A table's own header row ("Section Bars Time Feature") is not a note.
            if it["bold"] and len(s) < 60 and re.search(r'\bBars?\b', s) and re.search(r'\bTime\b', s):
                continue

            row = ROW_RE.match(s) or ROW2_RE.match(s)
            m = ENTRY_RE.match(s)
            # "Prologue (bars 1 - 275)" — a movement heading set larger than the
            # table under it. Only inside the guide, so body copy can't match.
            is_movement = (it["size"] >= 13.5 and len(s) < 60 and not row
                           and not STOP_HEADS.match(s))
            is_section = bool(it["bold"] and SECTION_RE.search(s) and len(s) < 70)
            # The Overview lists every section before the guide proper starts;
            # those lines look exactly like headings, so a run of them is text.
            heading_now, is_section = is_section, is_section and not prev_was_section
            prev_was_section = heading_now

            if row and "name" not in row.groupdict():
                cur = add(at=secs(row["t1"]), bar=bar_label(row["b1"], row["b2"]),
                          contentHtml=para_html([row["rest"].strip()]))
                if secs(row["t2"]) > secs(row["t1"]): cur["end"] = secs(row["t2"])
                cur_kind = "entry"; guide_n += 1; timed_n += 1
            elif row:
                cur = add(at=secs(row["t1"]), sectionName=row["name"].strip(),
                          structure=True, tags=["form"],
                          bar=bar_label(row["b1"], row["b2"]),
                          contentHtml=f"<p><strong>{esc(row['name'].strip())}</strong></p>"
                                      + para_html([row["rest"].strip()]))
                if secs(row["t2"]) > secs(row["t1"]): cur["end"] = secs(row["t2"])
                cur_kind = "entry"; guide_n += 1; timed_n += 1
            elif is_movement or is_section:
                nums = re.findall(r'\d+', s)
                name = re.sub(r'\s*\(?\s*Bars?\s*[\d\s\-–—]+\)?', ' ', s).strip(" -–—()") or s
                cur = add(structure=True, sectionName=name, tags=["form"],
                          contentHtml=f"<p><strong>{esc(s)}</strong></p>")
                if nums: cur["bar"] = bar_label(nums[0], nums[1] if len(nums) > 1 else None)
                sections.append(cur); cur_kind = "section"; guide_n += 1
            elif m and m.group(3) and len(m.group(3)) > 3:
                # Strip the "Bar N" prefix off the FIRST line only. `s` is every
                # line joined, so pasting m.group(3) in front of lines[1:] would
                # repeat the whole tail of the paragraph.
                first = re.sub(r'^Bars?\s+\d+\s*(?:[-–—]|to)?\s*\d*\s*', '', it["lines"][0]).strip()
                rest = ([first] if first else []) + it["lines"][1:]
                cur = add(bar=bar_label(m.group(1), m.group(2)), contentHtml=para_html(rest))
                cur_kind = "entry"; guide_n += 1
            elif cur is not None and cur_kind in ("entry", "section"):
                cur["contentHtml"] += para_html(it["lines"])
            elif cur is not None and cur_kind == "para" and len(cur["contentHtml"]) < 700:
                # Loose prose accumulates into a readable note rather than one
                # note per line — but stops well short of a wall of text.
                cur["contentHtml"] += para_html(it["lines"])
            else:
                # A guide that is neither prose entries nor a table still reads
                # fine as one note per paragraph — better than one giant note.
                cur = add(contentHtml=para_html(it["lines"]))
                cur_kind = "para"; guide_n += 1

    # A structure bracket wants a span; give each untimed section the
    # placeholder seconds its own notes occupy, so the overview draws the shape.
    for i, sec in enumerate(sections):
        j = notes.index(sec)
        nxt = next((notes.index(sections[k]) for k in range(i + 1, len(sections))), len(notes))
        if nxt - j > 1: sec["_span"] = nxt - j - 1

    # ---- learning activities, then the answers -----------------------------
    ai = find(lambda s: ACT_HEAD.match(s) and len(s) < 40)
    q_n, a_n = 0, 0
    if ai >= 0:
        cur, activity, answers = None, "", False
        for it in items[ai + 1:]:
            if it["kind"] == "image":
                attach_image(cur, it); continue
            s = it["text"].strip().translate(LIGATURES)
            it["lines"] = [l.translate(LIGATURES) for l in it["lines"]]
            if not s or NOISE_RE.match(s): continue
            if re.match(r'^(Glossary|Appendix|Acknowledge)', s, re.I) and len(s) < 40: break
            if ANSWERS_HEAD.match(s) and len(s) < 60:
                answers, cur, activity = True, None, ""
                continue
            m = TASK_RE.match(s)
            if m and len(s) < 90:
                if m.group(1).lower().startswith("activity"):
                    activity, cur = s, None
                    continue
                head = f"{activity} — {s}" if activity else s
                if answers:
                    cur = add(tags=["comment"],
                              contentHtml=f"<p><strong>Answer · {esc(head)}</strong></p>")
                    a_n += 1
                else:
                    cur = add(question=True, tags=["comment"],
                              contentHtml=f"<p><strong>{esc(head)}</strong></p>")
                    q_n += 1
            elif cur is not None:
                cur["contentHtml"] += para_html(it["lines"])
            elif not answers and QUESTIONY.search(s) and len(s) > 25:
                cur = add(question=True, tags=["comment"],
                          contentHtml=(f"<p><strong>{esc(activity)}</strong></p>" if activity else "")
                                      + para_html(it["lines"]))
                q_n += 1

    # Stamp every note: a real time where the kit gave one, otherwise one
    # second past the note before it. Monotonic by construction, so the notes
    # list and the overview both read in document order.
    t = 0
    for n in notes:
        at = n.pop("_t", None)
        t = max(t + 1, at if at is not None else 0)
        n["start"] = t
        span = n.pop("_span", None)
        if span and "end" not in n: n["end"] = t + span
        if "end" in n and n["end"] <= n["start"]: n.pop("end")
        # A note that covers a span pushes the clock past it, so the questions
        # that follow the guide never land inside the last section's bracket.
        t = max(t, n.get("end", t))

    source = None
    if len(set(yt)) == 1:
        vid = re.search(r'(?:v=|youtu\.be/|embed/)([\w-]{11})', yt[0])
        if vid: source = {"type": "youtube", "youtubeUrl": yt[0], "videoId": vid.group(1)}

    return {
        "format": "sound-annotator-project",
        "version": 1,
        "exportedAt": 0,
        "project": {
            "title": title,
            **({"source": source} if source else {}),
            "settings": {"overviewOpen": True, "noteOrder": "timeline"},
            "annotations": [
                {k: v for k, v in n.items() if k == "start" or v not in (None, "", [])}
                for n in notes if n.get("contentHtml")
            ],
        },
    }, guide_n, q_n, a_n, timed_n


def slug(t):
    s = re.sub(r'[^A-Za-z0-9]+', '-', t).strip('-').lower()
    return (s or "kit")[:70]


if __name__ == "__main__":
    src, outdir = sys.argv[1], sys.argv[2]
    d, g, q, a, timed = build(src)
    if not d["project"]["annotations"]:
        print(f"{os.path.basename(src)[:44]:<46} SKIPPED — no listening guide or activities found "
              f"(scanned images only?)")
        sys.exit(0)
    out = os.path.join(outdir, slug(d["project"]["title"]) + ".json")
    with open(out, "w") as f:
        json.dump(d, f, ensure_ascii=False)
    print(f"{os.path.basename(src)[:44]:<46} guide{g:<4} q{q:<4} ans{a:<4} "
          f"{'timed' if timed else '  bars':<6}{os.path.getsize(out)//1024:>5}KB  {d['project']['title'][:44]}")
