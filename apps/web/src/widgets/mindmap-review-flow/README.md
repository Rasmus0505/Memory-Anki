# Mind-map Review Flow Widget

Cross-feature composition for review sessions and palace practice hosts.

- Composes Review flow use cases, Mini Palace training, quiz launching, and the mind-map editor surface.
- Exposes the stable `MindMapReviewFlow` host contract through the widget index.
- Review domain transforms and reusable review UI remain in `features/review` or `entities/review`.
- Pages and route hosts must not import the widget controller internals directly.
