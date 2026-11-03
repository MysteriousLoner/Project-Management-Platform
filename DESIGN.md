---
name: "协策达 — Shared workspace"
description: "The existing green workspace language extended to reports, people, password settings, and Codex setup."
colors:
  green: "#286443"
  green-dark: "#1c4c32"
  green-soft: "#e5f2e9"
  ink: "#17211b"
  muted: "#68736c"
  line: "#dfe5df"
  line-soft: "#edf0ed"
  surface: "#ffffff"
  canvas: "#f5f7f3"
  sidebar: "#18231d"
  sidebar-text: "#c0ccc3"
  field-border: "#bcc8be"
  field-focus: "#6e9c7e"
  red: "#b63838"
  red-soft: "#fbeaea"
  amber-soft: "#fbf0d9"
  pending-text: "#74480a"
typography:
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    lineHeight: 1.75
  label:
    fontSize: "13px"
    fontWeight: 600
  action:
    fontSize: "13px"
    fontWeight: 700
  compact:
    fontSize: "12px"
  mono:
    fontFamily: "ui-monospace, monospace"
    fontSize: "12px"
    lineHeight: 1.7
rounded:
  status: "4px"
  field: "7px"
  control: "8px"
  navigation: "9px"
  panel: "12px"
spacing:
  field-label: "7px"
  action-gap: "9px"
  form-stack: "15px"
  controls-gap: "16px"
  panel-padding: "22px"
  columns-gap: "24px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.surface}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "8px 15px"
  button-primary-hover:
    backgroundColor: "{colors.green-dark}"
  button-secondary:
    backgroundColor: "#edf4ef"
    textColor: "{colors.green-dark}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "8px 15px"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "#3b4740"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "8px 15px"
  report-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
  report-paper:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
  job-ready:
    backgroundColor: "{colors.green-soft}"
    textColor: "{colors.green-dark}"
    rounded: "{rounded.status}"
    padding: "3px 7px"
---

# Design System: 协策达 — Shared workspace

## Overview

**Creative North Star: "Incumbent workspace continuity"**

This is a record of the built workspace extension, rather than a newly selected visual identity. Its authority is the shared stylesheet and the implemented reports, people, password, Codex setup, and workspace frame. The existing application name and icon remain the identity anchors. Unexamined ticket-tracker surfaces are outside this record.

Dark green navigation frames an off-white working canvas. White surfaces, quiet borders, compact controls, and a single green action color support task completion and reading. Reports receive more whitespace and longer line spacing than surrounding controls. The implemented stack names Inter first and falls back to local system UI fonts; the root layout does not load a separate webfont.

**Key Characteristics:**

- Green actions and selection states within a restrained neutral workspace.
- Native date, select, password, and text controls with persistent labels.
- Compact navigation and controls around a spacious report document.
- Rounded corners, thin borders, and shallow action depth.

## Colors

### Primary

- **Workspace green** (`green`): primary actions, keyboard focus, and text carets.
- **Deep green** (`green-dark`): primary action hover, secondary action text, and ready-state text.
- **Pale green** (`green-soft`): ready-state labels and selected text.

### Neutral

- **Green-black ink** (`ink`) and **muted green-gray** (`muted`): content and supporting information.
- **Off-white canvas** (`canvas`) and **white surface** (`surface`): the page ground and working surfaces.
- **Forest sidebar** (`sidebar`) and **light sidebar text** (`sidebar-text`): persistent workspace navigation.
- **Quiet borders** (`line`, `line-soft`): panel edges and internal dividers.
- **Field border** (`field-border`) and **field focus** (`field-focus`): the report and teammate controls.

### Status colors

- **Failure red** (`red`, `red-soft`): failed generation and form errors.
- **Pending amber** (`pending-text`, `amber-soft`): queued and generating report states.

**The Labeled State Rule.** Status color accompanies a readable state name. Ready, Queued, Generating, and Failed remain explicit text.

## Typography

The interface uses one sans-serif family stack. There is no separate expressive display face. The hierarchy is task sized: page headings, section headings, content, then supporting metadata. The frontmatter records recurrent roles, not every local size.

- **Headline:** workspace titles; reduces to a smaller heading on mobile (25px).
- **Title:** people and setup sections. Report projects use a nearby size (19px); employee names use compact bold text (14px).
- **Body:** report bullets and setup prose. Report content uses a generous reading line height; supporting report paragraphs use a slightly tighter one (1.7).
- **Label / action:** form labels and compact buttons. Password labels inherit the existing smaller form treatment (11px, bold).
- **Compact:** metadata and helper text. History details and job labels are smaller (11px).
- **Mono:** the selectable setup prompt only.

Dates in report controls, history, and document headers use tabular numerals. Report copy wraps long content; the selected report article is constrained to a reading measure (78ch), and setup content to a similar measure (80ch).

## Layout

The desktop frame uses a fixed left sidebar (246px) and a main content area offset by the same amount. Main padding is generous enough for controls and documents (32px 42px 72px). At the narrower desktop breakpoint (1000px), the sidebar contracts (210px), and main padding tightens (28px 24px 70px).

At the mobile breakpoint (720px), the sidebar enters normal document flow and spans the page. All five workspace destinations wrap into visible rows; this extension does not inherit the ticket navigation's horizontal overflow. Main content has no left offset and uses the effective later stylesheet padding (23px 15px 80px).

Report controls form a wrapping row above a two-column workspace: history (248px), a flexible document, and an intercolumn gap (24px). At the report breakpoint (1050px), history becomes a horizontal scroll list above the document. On mobile, labels can wrap, the generation action spans the controls, and document padding tightens (27px 21px).

People uses a wrapping teammate form above a scrollable table. Password settings form a narrow single column (maximum 480px). Setup is a reading column with a full-width, vertically resizable prompt. These layouts use content width rather than decorative dashboard tiles.

## Elevation & Depth

Borders and surface contrast carry most separation. Report controls and paper are flat at rest. Primary actions have a shallow green shadow; hover darkens the action and lifts it slightly (1px). The existing sidebar has a restrained green radial highlight, and the retained application icon has its own soft shadow. Neither treatment is a new page decoration system.

**The Quiet Surface Rule.** Use the existing border and surface separation for report containers; reserve the recorded lift for primary actions.

## Shapes

Controls and history selections use gently rounded corners. Report fields are slightly tighter than buttons; navigation and notices are slightly softer. The report paper and filter container share broader panel corners. Thin solid borders, rather than heavy outlines, define persistent containers. Status labels are compact rounded rectangles, not large pills.

## Components

### Buttons

Primary green actions are compact, bold, and sentence case, with a minimum height (39px). Secondary actions have a pale green background and quiet green border; ghost actions are white with the shared border. Disabled buttons reduce opacity (0.48) and show a disabled cursor. Primary hover uses deep green, a small lift, and the existing brief transition (140ms ease). Secondary and ghost buttons retain their base treatment on hover; no additional hover color is established.

### Inputs / Fields

Report and teammate controls retain native behavior, a white fill, a thin border, and a minimum height (42px). Generic password inputs inherit the shared field treatment with slightly larger control corners (8px). Focus changes the field border and adds a soft ring; keyboard focus adds a green outline (3px, offset 3px). Keep visible labels and native password autocomplete semantics.

### Navigation

The shared frame has five text-link destinations, using compact padding and rounded selection backgrounds. Active navigation has a pale translucent green fill, light text, and semibold weight; hover has a light translucent fill. The existing brand name and application icon precede navigation. The signed-in name and sign-out control sit in the footer. Mobile wraps the workspace links into rows without clipping destinations.

### Cards / Containers

Report controls and paper use white fill and the common border. History choices are transparent by default, receive a soft fill on hover, and use a white surface with a green-gray border when selected. Empty, loading, queued, failed, and saved-report content occupy the same document surface instead of adding competing containers.

### Status labels and feedback

Job labels pair their color with text. Feedback uses inline status or alert semantics. Form errors are red text; request errors use the existing pale red alert. Copy feedback remains adjacent to the action. The password reminder is part of the screen frame and is excluded from report printing.

### Report document

Project headings introduce grouped employee sections and work bullets. Coverage and blockers use the same document hierarchy. Saved metadata and export actions sit in a separate toolbar. Print removes navigation, workspace headings, filters, history, reminder, toolbar, and other screen-only UI, leaving a borderless report on white. Project and employee blocks avoid page breaks within them where the browser can honor it.

## Do's and Don'ts

### Do:

- **Do** extend the existing green, off-white, border-led workspace and retained brand assets.
- **Do** keep labels, native controls, visible keyboard focus, and readable job-state names.
- **Do** use compact controls around the more spacious report reading surface.
- **Do** keep all five workspace destinations visible in wrapping mobile rows.

### Don't:

- **Don't** introduce a replacement identity while extending these workspace screens.
- **Don't** encode report job state by color alone.
- **Don't** print workspace chrome or the initial-password reminder with a report.
- **Don't** apply this scoped record to unrelated ticket-tracker patterns without inspecting them.
