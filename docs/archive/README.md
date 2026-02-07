# Documentation Archive

Historical documentation from completed phases. These files are preserved for context and are not actively maintained.

**Archived**: 2026-02-04

## Structure

```
archive/
├── phase1/          Phase 1 completion & test reports
├── phase2/          Phase 2 analysis & review documents
├── phase2b/         Phase 2B refactoring & security
└── implementation/  Task logs & feature summaries
```

## When to use this archive

- Historical context for decisions and tradeoffs
- Deep implementation details and past test results
- Security audits and refactoring history

## Active documentation

For current, maintained docs:

- Root overview: [`README.md`](../../README.md)
- Setup: [`docs/dev-environment-setup.md`](../dev-environment-setup.md)
- Database: [`docs/database-setup.md`](../database-setup.md)
- API: [`docs/api-design.md`](../api-design.md)
- Migrations: [`scripts/migrations/README.md`](../../scripts/migrations/README.md)
- Schema: [`src/db/schema/README.md`](../../src/db/schema/README.md)

## Maintenance guidelines

1. Do not modify archived files (treat them as snapshots).
2. Add new archives under the appropriate subfolder.
3. Update this README when new archives are added.
4. Record changes in [`docs/DOCUMENTATION-CLEANUP-SUMMARY.md`](../DOCUMENTATION-CLEANUP-SUMMARY.md).
