# Kit → track file

Converts an SSO "Meet the Music" teaching-kit PDF into a Sound Annotator track
file (see `public/track-schema.md`), score excerpts included.

```bash
python3 scripts/kit-to-track/kit2track.py "<kit>.pdf" <output-dir>
```

Needs `pymupdf` and `pillow`. Import the results with the home page's
**Import → Choose files…**, which takes the whole batch at once.

What it maps:

| in the kit | in the track |
| --- | --- |
| a Listening Guide's "Bar N — prose" paragraph | a note, bar number in its chip |
| a guide laid out as a table with timings | a note at its **real** start/end time |
| a bold "Bars X–Y Section Z" heading | a structure section, bracketed in the overview |
| a score excerpt under a paragraph | an image inside that note |
| a Learning Activities task | a question note — so a `?view=` link opens as a worksheet |
| Suggested Answers | ordinary notes, never questions, so they stay out of a student's copy |

Most kits carry bar numbers and no timings; those notes are stamped at
placeholder seconds (1, 2, 3 …) in document order, so retiming against a
recording is dragging, not retyping. The nine kits whose guide is a timed table
come out with real times and need no retiming at all.

Scanned kits with no text layer (the pre-2020 season compilations) are skipped
rather than imported empty — they would need OCR.
