# CI configuration

Backend source validation performs one dependency install for lint, type checking, Prisma schema/client validation and build. The full coverage suite remains in `tests.yml`; migrated PostgreSQL integration and browser E2E remain blocking. Backend source validation no longer repeats the plain suite already covered by the coverage job.

Placeholder deployment and the legacy AWS/EKS route are manual failures. Use the canonical Backline release process. Reintroducing a legacy deployment route requires explicit operator authorization, exact-source qualification, immutable image selection, real health checks and recovery evidence.
