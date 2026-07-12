# Mind-map Document

Pure document-domain code for mind maps.

- Owns normalization, serialization, fingerprints, node identifiers, and legacy payload compatibility.
- Must not import FastAPI, SQLAlchemy, database tables, palace, knowledge, backup, or learning modules.
- Other backend modules import only `memory_anki.modules.mindmap_document.api`.
- Palace and knowledge modules own ORM projection, persistence, conflict policy, and version creation.
