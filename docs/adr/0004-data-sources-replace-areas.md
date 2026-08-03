# Data sources replace areas as the indicator parent

We model the top-level origin of indicator data as a **Data source**, not an Area, because the current grouping reflects provenance such as surveys, registries, or provider datasets rather than a stable product taxonomy. The legacy `areas` table was migrated to `data_sources`, `indicator_groups` now belongs to a data source, and indicator-specific provenance text is named `source_citation` to avoid overloading “source”.
