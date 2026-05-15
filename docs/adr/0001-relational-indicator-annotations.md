# Store indicator annotations relationally

User-facing indicator annotations and indicator groups are stored in SQLite as the runtime source of truth, even when their initial values are seeded from parquet files, folder structure, or catalog JSON. Import files are only bootstrap inputs: after initial seeding, annotation changes are made through the admin UI or directly in the database, not by repeatedly syncing JSON/parquet metadata at runtime.
