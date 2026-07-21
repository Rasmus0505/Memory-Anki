# Mind-map Flip-card Flow Widget

Cross-feature composition for review sessions and palace practice hosts.

- `FlipCardMindMapPanel` is the only flip-card mind-map surface. Palace learning and formal review both consume it through the widget index.
- The panel owns reveal navigation, keyboard/touch behavior, fullscreen/clear UI controls, view persistence, and the no-recenter-on-card-click policy.
- Question cards (`memoryAnkiQuestionCard` on node data) auto-reveal body text when their parent becomes `revealed` (shared `entities/review` cascade); set/clear via editor context menu.
- `MindMapReviewFlow` composes the shared panel with review completion and optional rating evidence. Palace learning keeps its own progress persistence and does not provide rating callbacks.
- Review domain transforms and reusable review UI remain in `features/review` or `entities/review`.
- Pages and route hosts must not import the widget controller internals directly.
