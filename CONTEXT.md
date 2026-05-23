# Colombia en Datos

Colombia en Datos helps people discover, understand, and compare Colombian statistical indicators with enough human context to interpret them correctly.

## Language

**Indicator**:
A statistical measure that can be selected, compared, and visualized over time.
_Avoid_: Metric, variable

**Indicator annotation**:
Spanish human-facing context such as name, description, or methodology that explains an **Indicator** for discovery, interpretation, or citation.
_Avoid_: Metadata, parquet metadata, imported annotation, curated annotation

**Data source**:
An origin of statistical data, such as a survey, registry, ministry dataset, or external provider dataset.
_Avoid_: Area, survey as the generic parent, encuesta as the generic parent

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

**Indicator frequency**:
The upload and validation scope for an **Indicator** at one **Frequency**.
_Avoid_: Indicator version, frequency row

**Published indicator**:
An **Indicator** that has published observations available for exploration.
_Avoid_: Saved indicator, validated indicator

**Observation dimension**:
A category used to slice observations of an **Indicator**.
_Avoid_: Filter, column, breakdown

**Reference area**:
The source coverage anchor for an observation series, usually Colombia as a whole.
_Avoid_: Department filter, municipality filter, geography selector

**Geographic observation dimension**:
An **Observation dimension** that slices observations by geographic level, department, or municipality.
_Avoid_: Reference area, region filter

**Explorer view**:
The end-user workspace for selecting **Indicators**, applying **Observation dimensions**, and visualizing observations over time.
_Avoid_: Dashboard, prototype, app v2

**Explicit filter choice**:
A user-selected **Observation dimension** constraint in the **Explorer view**.
_Avoid_: Implicit default, guessed filter

**All values option**:
A UI-only choice that removes an **Observation dimension** constraint in the **Explorer view**.
_Avoid_: Total, aggregate value

**Discovery controls**:
Explorer view controls used to choose or narrow the **Indicator** being explored.
_Avoid_: Filters, visualization controls

**Visualization controls**:
Explorer view controls used to constrain or split observations of the selected **Indicator**.
_Avoid_: Discovery controls, indicator search

**Split dimension**:
An **Observation dimension** selected to create separate visual series in the **Explorer view**.
_Avoid_: Group by, breakdown, trace dimension

**Chartable selection**:
An **Explorer view** state where each observation maps unambiguously to one visual point in one visual series.
_Avoid_: Valid query, renderable state

**Fixed dimension**:
An **Observation dimension** with only one applicable value for the current **Explorer view** state, excluding date range.
_Avoid_: Default filter, hidden filter

**Time axis**:
The ordered set of observed periods available for an **Indicator** at a selected **Frequency** in the **Explorer view**.
_Avoid_: Date input, calendar, free-text period

## Personas

**Data scientist**:  
A technical user who creates or transforms source data into indicator observations. They understand columnar data, schema mappings, and APIs. They are the primary users of the ingestion pipeline. _Avoid_: Analyst, uploader, admin.

**Curator**:  
A user who reviews and improves Spanish-facing indicator annotations (names, descriptions, methodology) in the admin UI. They do not need to be technical. _Avoid_: Editor, reviewer, admin.

## Relationships

- An **Indicator** has zero or more **Indicator annotations**.
- **Methodology** is part of an **Indicator annotation** when a formal definition or formula is available.
- A **Data source** provides one or more **Indicator groups**.
- An **Indicator group** belongs to exactly one **Data source**.
- An **Indicator group** contains one or more **Indicators**.
- An **Indicator** belongs to exactly one **Indicator group**.
- When a **Data source** has no meaningful grouping, it uses a default **Indicator group** named after the **Data source**.
- A **Source table** is an **Indicator group** when the grouping corresponds to a published table or sheet.
- An **Indicator** can have a stable **Measurement format** or produce series with different **Measurement formats**.
- An **Indicator** can be sliced by zero or more **Observation dimensions**.
- A **Reference area** anchors the coverage of an observation series; **Geographic observation dimensions** express department and municipality slices.
- An **Explorer view** presents one or more **Indicators** for comparison over time, even when an early interface limits selection to one **Indicator**.
- An **Explorer view** applies **Observation dimension** constraints only when the user makes an **Explicit filter choice**.
- An **All values option** is distinct from a source-provided total value.
- A **Chartable selection** requires every applicable **Observation dimension** to be an **Explicit filter choice**, the **Split dimension**, or a **Fixed dimension**.
- An **Observation dimension** cannot be both an **Explicit filter choice** and the **Split dimension**; the **Explicit filter choice** takes precedence.
- Date range constrains observations in the **Explorer view** but does not change which **Observation dimension** values are available for selection.
- The **Time axis** drives date range choices in the **Explorer view**; users choose observed periods instead of typing storage-formatted dates.
- **Explorer view** URLs identify **Observation dimensions** by their registry codes.
- **Discovery controls** choose the **Indicator**; **Visualization controls** constrain or split its observations.
- An **Indicator** can have observations at different **Frequencies** without becoming a different indicator.
- An **Indicator frequency** belongs to exactly one **Indicator**.
- A **Published indicator** is visible in the **Explorer view**.
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
- "Area", "survey", and "encuesta" were used as possible parents for ingestion; resolved: use **Data source** as the generic parent, with a survey/encuesta being one kind of **Data source**.
- "Area" was considered as a separate top-level grouping for indicators; resolved: do not use **Area** as a domain concept until a real product taxonomy exists.
