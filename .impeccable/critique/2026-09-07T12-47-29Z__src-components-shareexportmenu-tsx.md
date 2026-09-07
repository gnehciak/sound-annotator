---
target: the share/export panel
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-09-07T12-47-29Z
slug: src-components-shareexportmenu-tsx
---
# Critique — Share/Export panel (`src/components/ShareExportMenu.tsx`)

Method: dual-agent (A: design review · B: detector + browser evidence)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | No pending/saved feedback; nothing outside the panel says a track is public. |
| 2 | Match System / Real World | 3 | "Anyone with the link" is excellent; "Also list on Browse" names an internal page. |
| 3 | User Control and Freedom | 2 | Link-off silently clears edit + publish; no confirm on publish or removal. |
| 4 | Consistency and Standards | 2 | Three heading treatments; `pop-row`/`btn-icon`/`btn-primary` all bypassed. |
| 5 | Error Prevention | 2 | Illegal edit+publish pair prevented, but via a silently disabled control. |
| 6 | Recognition Rather Than Recall | 2 | Four identical `?` dots; Browse must be recalled from elsewhere. |
| 7 | Flexibility and Efficiency | 3 | Enter submits, role chip one-click; no keyboard route, no invite-as-editor. |
| 8 | Aesthetic and Minimalist Design | 3 | Much better than the prose version; still 16 targets in 304px. |
| 9 | Error Recovery | 2 | Generic error; clipboard failure swallowed; disabled reason invisible. |
| 10 | Help and Documentation | 3 | Copy is well written; the delivery (4 anonymous dots) is the failure. |
| **Total** | | **24/40** | **Functional but frustrating** |

## Detector (Assessment B)

12 findings, all `design-system-font-size`, all advisory. Endemic: `HomePage.tsx` carries 11 of the same rule. Target-specific drift was the two `11.5px` values (now normalised). Contrast passed everywhere measured (muted help 7.27:1, placeholder 7.73:1, LED URL 6.71:1). 11 of 17 controls under the 24px hit-target floor; no focus trap; Escape dropped focus to `<body>`; `aria-controls` absent on all four disclosures; the disabled Browse switch was unreachable by keyboard with its reason in a `title`.

## Priority issues and what shipped

- **[P0] Publishing was one unconfirmed flip, invisible afterwards.** → inline confirm naming the track; a signal dot on the header trigger; the trigger's tint now means "shared", not "menu open".
- **[P1] The panel never said what was true right now.** → a mono status readout (`READ-ONLY · NOT LISTED`), signal-hued only for the loud states.
- **[P1] Four anonymous `?` dots.** → one "explain" toggle for the whole panel.
- **[P2] A failed shares fetch rendered as "nobody has access."** → skeleton / list / "Couldn't load — Retry" as three distinct states.
- **[P2] Component-vocabulary drift.** → one mono section-label style, `pop-row` exports, `btn-icon` help, `btn-primary` Copy, decorative icons de-tinted.
