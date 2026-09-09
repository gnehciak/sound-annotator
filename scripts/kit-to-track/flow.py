"""Linear reading-order flow of a kit PDF: text paragraphs and images, in order."""
import fitz, re, io, base64
from PIL import Image

PAGENO_RE = re.compile(r'^\d{1,3}$')

def flow(path, skip_pages=1):
    doc = fitz.open(path)
    items = []
    for pno in range(skip_pages, len(doc)):
        page = doc[pno]
        h = page.rect.height
        rows = []
        for b in page.get_text("dict")["blocks"]:
            y = b["bbox"][1]
            if b["type"] == 1:
                w, ht = b["bbox"][2]-b["bbox"][0], b["bbox"][3]-b["bbox"][1]
                rows.append((y, {"kind": "image", "page": pno, "bbox": b["bbox"],
                                 "w": w, "h": ht}))
                continue
            lines = []
            for l in b["lines"]:
                t = "".join(s["text"] for s in l["spans"]).strip()
                if t: lines.append(t)
            if not lines: continue
            txt = " ".join(lines).strip()
            if PAGENO_RE.match(txt): continue
            if b["bbox"][1] > h - 60 and len(txt) < 80: continue
            sizes = [s["size"] for l in b["lines"] for s in l["spans"]]
            bold = any("Bold" in s["font"] for l in b["lines"] for s in l["spans"])
            rows.append((y, {"kind": "text", "page": pno, "text": txt, "lines": lines,
                             "size": round(max(sizes), 1), "bold": bold}))
        for _, it in sorted(rows, key=lambda r: r[0]):
            items.append(it)
    return doc, items

def links(doc):
    out = []
    for p in doc:
        for l in p.get_links():
            u = l.get("uri")
            if u: out.append((p.number, u))
    return out

def png_data_uri(doc, page_no, bbox, max_w=1000, zoom=2.0):
    """Render the image's rectangle off the page rather than pulling its xref —
    that way masks, CMYK and multi-xref composites all come out as they look."""
    clip = fitz.Rect(*bbox)
    pix = doc[page_no].get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip, alpha=False)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    if img.width > max_w:
        img = img.resize((max_w, max(1, round(img.height * max_w / img.width))), Image.LANCZOS)
    # Notation is black on white: greyscale + a small palette keeps staves crisp
    # at a fraction of the bytes, which matters when it all rides inside JSON.
    img = img.convert("L").convert("P", palette=Image.ADAPTIVE, colors=64)
    buf = io.BytesIO(); img.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(), len(buf.getvalue())
