# 协策达

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Employees use Codex desktop on macOS and Windows to share project knowledge and their own work progress. Managers need date-range reports across projects and departments. Every signed-in teammate can use all workspace features; there are no administrator or manager roles.

## Product Purpose

Keep a central project knowledge base accessible through MCP, and turn attributable progress submissions into useful management reports.

## Operating Context

Extend the existing Next.js ticket tracker, PostgreSQL database, MinIO storage, and Taiwan deployment at pms.techmation.my. Preserve existing projects, employees, assignments, and ticket history. Use the existing Gemma gateway for internal processing.

## Capabilities and Constraints

The new frontend shows reports, people, personal password settings, and Codex setup. All existing employee accounts are password protected, using the private initial-password setting until the employee changes their own password. Documentation and progress are managed through MCP. Reports group projects, employees, and work bullets, with submission coverage and unresolved external blockers. Dates use Asia/Kuala_Lumpur. Reports support English and Simplified Chinese. Generation is on demand.

## Brand Commitments

Preserve the application's existing name, assets, and visual style. Extend the existing interface rather than redesigning it.

## Product Principles

- Attribute work to authenticated employees and source evidence.
- Preserve historical records and make concurrent changes explicit.
- Distinguish missing submissions from an absence of work.
- Treat retrieved knowledge and model outputs as data, not instructions.
