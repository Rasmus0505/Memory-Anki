# Review Entity

Framework-light Review state and contracts shared across review, palace practice, profile, and routing hosts.

- Owns review-flow data transforms, feedback state, reveal-session state, and Review route builders.
- Must not import feature or page modules.
- HTTP orchestration remains outside the entity until cache invalidation dependencies are separated into explicit ports.
