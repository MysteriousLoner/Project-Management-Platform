---
version: 1
slug: "app-reports-reports-view-tsx"
primary_target: "app/reports/reports-view.tsx"
related_targets: ["app/reports/page.tsx","app/workspace-frame.tsx","app/password/page.tsx","app/password/password-form.tsx","app/accounts/page.tsx","app/accounts/accounts-view.tsx","app/codex-setup/page.tsx","app/codex-setup/setup-prompt.tsx","app/globals.css"]
---

# Shared workspace extension

## Scope and visitor mode

Primary target: reports. Related targets: workspace frame, people, personal password, and Codex setup. Operate is primary; reading the report and setup instructions uses Read. This is a narrow extension of the existing application, preserving its green/off-white interface and native controls.

## Audience, job, and action

Signed-in employees share the same workspace access. Reports let a teammate choose a date range and language, generate a report, inspect saved jobs, read project/employee work, and copy or print a saved document. People connects employee records to password-protected accounts. Personal password settings let an employee change their own password. Setup supplies a selectable, copyable prompt for connecting Codex desktop.

## Content and proof

The report document groups projects, then employees and bullets; submission coverage and unresolved external blockers remain explicit sections. Missing submissions do not imply no work. Malaysia dates and English/Simplified Chinese output are visible choices. Job history and text states make generation status inspectable.

## Built direction

A dark green sidebar contains the retained application icon/name and five destinations. A compact controls row leads into history beside a white report document on an off-white canvas. At narrower widths, history moves above the document; on mobile, workspace links wrap into visible rows. The central moment is one readable, attributable report with the supporting controls around it. People, password, and setup remain ordinary task/reading columns in the same frame.

## Constraints and finish evidence

Use app/globals.css and the implemented components as visual ground truth; DESIGN.md records their shared vocabulary. Keep native controls, persistent labels, focus treatment, report status text, and the existing application identity. Printed reports exclude the screen frame, action toolbar, and initial-password reminder. No new identity or composition approval is asserted: this extension did not select an approved image comp.

The review assets at .impeccable/review/desktop.jpg and mobile.jpg are synthetic full-page previews; the mobile preview has a 390px outer frame and 375px content. They are inspection evidence, not live production screenshots. The independent reviewer scored two corrections resolved, with a ship disposition for that fix list: all five mobile navigation destinations wrap visibly, and the password reminder is screen-only. Both corrections are present in the built sources.

## Unresolved decisions

No unresolved visual direction decision is recorded. Deployment and live service behavior are outside this design record.
