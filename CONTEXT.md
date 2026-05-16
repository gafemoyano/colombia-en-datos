# Colombia en Datos

Colombia en Datos helps people discover, understand, and compare Colombian statistical indicators with enough human context to interpret them correctly.

## Language

**Indicator**:
A statistical measure that can be selected, compared, and visualized over time.
_Avoid_: Metric, variable

**Indicator annotation**:
Spanish human-facing context such as name, description, or methodology that explains an **Indicator** for discovery, interpretation, or citation.
_Avoid_: Metadata, parquet metadata, imported annotation, curated annotation

**Indicator group**:
A source-derived or catalog-defined grouping that provides shared context for one or more **Indicators**.
_Avoid_: Category, folder, collection

**Source table**:
A published table or sheet from an original data source that supplies context for one or more **Indicators**.
_Avoid_: Category, folder, source sheet

**Measurement format**:
The unit, scale, and display precision needed to present observed values correctly.
_Avoid_: Indicator annotation, metadata

**Methodology**:
A formal definition, formula, or source explanation that clarifies how an **Indicator** is constructed.
_Avoid_: Description, notes

**Attention need**:
A missing or low-quality **Indicator annotation** that should prompt an admin to improve it.
_Avoid_: Review state, approval status

**Observation dimension**:
A category used to slice observations of an **Indicator**.
_Avoid_: Filter, column, breakdown

## Personas

**Data scientist**:  
A technical user who creates or transforms source data into indicator observations. They understand columnar data, schema mappings, and APIs. They are the primary users of the ingestion pipeline. _Avoid_: Analyst, uploader, admin.

**Curator**:  
A user who reviews and improves Spanish-facing indicator annotations (names, descriptions, methodology) in the admin UI. They do not need to be technical. _Avoid_: Editor, reviewer, admin.

## Relationships

- An **Indicator** has zero or more **Indicator annotations**.
- **Methodology** is part of an **Indicator annotation** when a formal definition or formula is available.
- An **Indicator group** contains one or more **Indicators**.
- A **Source table** is an **Indicator group** when the grouping corresponds to a published table or sheet.
- An **Indicator** can have a stable **Measurement format** or produce series with different **Measurement formats**.
- An **Indicator** can be sliced by zero or more **Observation dimensions**.
- An **Indicator** can have observations at different **Frequencies** without becoming a different indicator.
- A single **Observation** has exactly one **Frequency**.
- The `indicators` table does not store **Frequency**; it is purely a property of each **Observation** row.
- An **Attention need** belongs to an **Indicator annotation**.
- A **Data scientist** creates **Indicators** and their observations through the ingestion pipeline.
- A **Data scientist** is responsible for transforming source data into the system's **Observation schema** before upload. The system does not perform column mapping.

## Example dialogue

> **Dev:** "Should the unit and source appear as **Indicator annotations**?"
> **Domain expert:** "Source is an **Indicator annotation**; unit belongs to the **Measurement format** because it can vary by series, while sex and age are **Observation dimensions** because they slice the observations."

## Flagged ambiguities

- "metadata" was used to mean all non-measure data from the data engineering perspective; resolved: use **Indicator annotation** for human-facing context and avoid using "metadata" as the domain term.
