"""Rebuild an AMC listening-guide table from the page geometry.

These kits lay their guides out as a four-column table — Section | Bar Numbers |
Timing | Compositional Features — running over several pages. PyMuPDF's reading
order interleaves the columns, and its table finder infers a ragged grid with
most cells empty, so neither gives usable rows. The cells do sit on a clean
x-grid though, so cluster the lines into columns by their left edge and start a
new row whenever the Section or Bar column speaks. That recovers the bar numbers
*and* the real timings these kits carry.
"""
import fitz, re

HEADER = re.compile(r'^(Section|Bar|Timing|Compositional|Musical|Structure|Features|Numbers)', re.I)
# Page furniture that sits inside the table's x-range and would otherwise become
# a row of its own: the per-copy licence stamp and bare page numbers.
JUNK = re.compile(r'^(This eBook is licenced|©|\d{1,3}$|Page \d|Listening Guide)', re.I)
TIME = re.compile(r"(\d{1,3})\s*[’'`]\s*(\d{2})\s*[”\"]?")


def _lines(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        if b["type"] != 0: continue
        for l in b["lines"]:
            t = "".join(s["text"] for s in l["spans"]).strip()
            if t: out.append((round(l["bbox"][1], 1), round(l["bbox"][0]), t))
    out.sort()
    return out


def column_edges(page):
    """Left edges of the guide table's columns, taken from its header row."""
    hdr = [(y, x, t) for y, x, t in _lines(page) if HEADER.match(t)]
    if len(hdr) < 3: return None
    y0 = hdr[0][0]
    xs = sorted({x for y, x, t in hdr if abs(y - y0) < 6})
    return xs if len(xs) >= 3 else None


def rows_on(page, edges):
    """(section, bars, timing, [feature lines]) for each row started on a page."""
    def col(x):
        c = 0
        for i, e in enumerate(edges):
            if x >= e - 6: c = i
        return c
    rows, cur = [], None
    for y, x, t in _lines(page):
        if HEADER.match(t) and len(t) < 24: continue
        if JUNK.match(t): continue
        c = col(x)
        if c <= 1 and not TIME.search(t):
            # A new row begins when the Section or Bar column speaks.
            if cur is None or c == 0 or (c == 1 and cur[1]):
                cur = [t if c == 0 else "", t if c == 1 else "", "", []]
                rows.append(cur); continue
            if c == 1 and not cur[1]: cur[1] = t; continue
        if cur is None:
            cur = ["", "", "", []]; rows.append(cur)
        if c == 2 or TIME.search(t) and c <= 2:
            if not cur[2]: cur[2] = t
            else: cur[3].append(t)
        else:
            cur[3].append(t)
    return rows


def guide_rows(doc, first_page, last_page):
    """Every table row across the guide's pages, columns intact."""
    edges = None
    for p in range(first_page, min(last_page + 1, len(doc))):
        edges = column_edges(doc[p]) or edges
        if edges: break
    if not edges: return []
    out = []
    for p in range(first_page, min(last_page + 1, len(doc))):
        out.extend(rows_on(doc[p], edges))
    # A continuation row (no section, no bars, no time) belongs to the row above.
    merged = []
    for r in out:
        if not r[0] and not r[1] and not r[2] and merged:
            merged[-1][3].extend(r[3])
        else:
            merged.append(r)
    # A row earns its place by saying something: a timing, a bar range, or prose.
    return [r for r in merged
            if (r[3] and " ".join(r[3]).strip()) or (r[1] and r[2])]


def secs(t):
    m = TIME.search(t or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None
