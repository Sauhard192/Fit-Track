# Activity Progress Tracker

## Product scope

- This app analyzes pool-swimming FIT activities. Ignore cycling and other sports.
- Use the real FIT files in `fit files/files`; `fit files/sample` is only for isolated testing.
- Keep drills separate from normal swim efforts. Rest laps are not part of effort trends.
- The primary audience is a UI/UX designer with no coding experience, so user-facing language should be plain and concise.

## Stack and commands

- Frontend: React 19 and Vite.
- Icons: `lucide-react`.
- FIT parsing: Python `fitdecode` through `scripts/export_swims.py`.
- Python dependencies are installed locally in `.python_packages`.
- Run locally with `npm run dev`.
- Rebuild swim data with `python3 scripts/export_swims.py`.
- Verify frontend changes with `npm run build`.

## Data rules

- `public/data/swims.json` is generated from FIT files; do not hand-edit it.
- Pace is weighted by lap distance when combining efforts.
- Cadence comes directly from the FIT lap field `avg_cadence` and is displayed in `spm`.
- Strokes per length is total strokes divided by active pool lengths, falling back to distance divided by pool length.
- PR progression is chronological. A PR is a strictly faster pace than every earlier matching effort.
- On the All styles tab, PRs are grouped by lap distance and are mutually exclusive across stroke styles.
- On a specific style tab, PRs are grouped by lap distance and that stroke style.
- Pool-length and time-range filters apply before the effort chart is rendered.
- Heart-rate analysis uses linear regression with a 95% confidence band, FIT-defined heart-rate zones, residual outliers, and hexbin density.

## Interface conventions

- Maintain the dark, minimal Swiss typographic style and clean sans-serif typography.
- Reuse the existing `menuButton` and `menuList` treatment for dropdowns.
- Use Lucide icons for interface actions.
- Keep controls compact, keyboard accessible, and responsive.
- Interactive elements need hover, focus, pressed, active, and disabled states where relevant.
- Chart tooltips must remain within chart bounds.
- Chart scrolling pans the chart; pinch gestures zoom the chart rather than the page.
- Non-PR effort points are visible but disabled; PR points are emphasized and interactive.
- The latest PR in each visible distance category is orange.
- Pace trend and stroke-rate analysis share lap-distance and stroke-style filters; other visualizations own their filters independently.
- Weekly volume scrolls horizontally, with the latest weeks shown first on load and older weeks available by scrolling back.
- Below tablet width, use bottom navigation and keep the activities table horizontally scrollable.
- Dropdown button labels stay on one line and truncate with an ellipsis when space is limited.
- Activities are listed latest first.
- FIT imports show progress while the local parser rebuilds swim data; changes to generated data must not reload the page mid-import.
- Activity deletion supports single or multi-select, always requires confirmation, and stages FIT files until the generated analytics data updates successfully.
- Import and deletion update only affected activities; do not rescan the complete FIT archive for these actions.
- Close confirmation dialogs when an action begins and report completed imports or deletions with temporary snackbar toasts.
- Production runs through `server.mjs`; `DATA_DIR` must point to persistent storage for generated swim data and uploaded FIT files.
- The current hosted version is intentionally public and has no authentication on viewing, importing, or deletion.

## Editing discipline

- Keep changes tightly scoped and preserve existing user work.
- Use `apply_patch` for manual edits.
- Do not add unrelated abstractions or redesign sections outside the request.
- Run the production build before handing off frontend changes.
