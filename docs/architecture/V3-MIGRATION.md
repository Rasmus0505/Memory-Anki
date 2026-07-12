# Architecture V3 Migration

Architecture V3 is developed in parallel with the production architecture. The old tree is a behavior and migration baseline only; new business implementation belongs in the V3 modules declared by `system-map.yaml`.

## Facts

- `system-map.yaml` owns module dependencies, source layout and table prefixes.
- `use-cases.yaml` owns the public command/query catalog and required tests.
- Each backend module README is the local AI navigation card.
- `tools/check_architecture_v3.py` validates both frontend and backend module shape and public dependency boundaries.

## Migration rule

A capability is considered migrated only when its frontend, application use cases, domain rules, persistence adapter and tests are owned by the same V3 module. Do not add forwarding facades from V3 to legacy modules. Temporary migration readers must be placed under the owning V3 module infrastructure and must never be exported publicly.

## Cutover rule

The existing `check_architecture.py` remains active while the legacy product is executable. It is removed only during the final cutover, after V3 has no imports from legacy business modules and the data migration gates pass.
