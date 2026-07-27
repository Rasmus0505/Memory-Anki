# Pages

Route-level composition for Memory Anki. Pages may compose widgets and runtime modules (through each module's `public.ts`), but must not own reusable domain logic or call backend endpoints directly.

`create/PalaceEditorPage` owns route-level composition across palace editing, mind-map editor/import/experience, and quiz-launcher capabilities. Editor-backed Knowledge outline and Palace version preview UI live beside the page; reusable Palace editing state and business panels remain in `modules/content` (palace-edit UI), which has no production dependency on other modules' internals. Learning-group selection and cross-feature canvas composition remain page-owned.

`library/PalaceListPage` and `library/PalaceLibraryPage` own the optional Review-session warmup composition; `modules/content` (palace-catalog UI) owns catalog behavior without importing Review module internals.

`settings/SettingsOverviewPage` composes Profile settings with Review maintenance commands and Shortcuts UI through explicit component ports; `modules/settings` (profile UI) remains independent of those modules.

`library/KnowledgeLibraryPage` owns Knowledge route composition across the mind-map editor, experience modes, import workflow, and reusable Knowledge dialogs.
