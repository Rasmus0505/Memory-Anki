# Pages

Route-level composition for Memory Anki. Pages may compose widgets and features, but must not own reusable domain logic or call backend endpoints directly.

`create/PalaceEditorPage` owns route-level composition across palace editing, mind-map editor/import/experience, mini-palace, and quiz-launcher capabilities. Editor-backed Knowledge outline and Palace version preview UI live beside the page; reusable Palace editing state and business panels remain in `features/palace-edit`, which has no production dependency on other features. Mini Palace controller creation, URL deep-link handling, and cross-feature canvas composition remain page-owned.

`library/PalaceListPage` and `library/PalaceLibraryPage` own the optional Review-session warmup composition; `features/palace-catalog` owns catalog behavior without importing Review feature internals.

`settings/SettingsOverviewPage` composes Profile settings with Review maintenance commands and Shortcuts UI through explicit component ports; `features/profile` remains independent of those features.

`library/KnowledgeLibraryPage` owns Knowledge route composition across the mind-map editor, experience modes, import workflow, and reusable Knowledge dialogs.
