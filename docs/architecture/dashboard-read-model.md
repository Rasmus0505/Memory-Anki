# Dashboard Read Model

Dashboard is a composition context. It does not own palace, review, or study-session behavior and must not import those contexts' internal application modules.

## Dependency Direction

```text
dashboard.application -> palaces.api
dashboard.application -> reviews.api
dashboard.application -> sessions.api
```

The public facades expose stable read capabilities while their owner contexts retain implementation freedom. New dashboard metrics should first be implemented by the owning context and exported intentionally through its facade.

Dashboard currently still assembles a local SQL read projection over the shared legacy schema. A later migration may move those ORM-heavy projections behind owner-provided query ports, but no new private application dependency is allowed.
