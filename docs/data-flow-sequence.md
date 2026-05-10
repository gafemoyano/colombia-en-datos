# Data Flow Sequence Diagram

This diagram illustrates the complete data flow from the main indicator visualization page through the API layer to DuckDB for querying parquet files, and back to the frontend for visualization.

## Sequence Diagram

```mermaid
sequenceDiagram
    participant User
    participant Page as +page.svelte<br/>(Frontend)
    participant DataAPI as /api/data<br/>(API Endpoint)
    participant MetaAPI as /api/meta<br/>(API Endpoint)
    participant DuckDB as duckdb.ts<br/>(Query Layer)
    participant SQLite as SQLite DB<br/>(Metadata)
    participant Parquet as Parquet Files<br/>(Time Series Data)
    participant Chart as PlotlyChart.svelte<br/>(Visualization)

    User->>Page: Select indicators & filters

    Note over Page: User selects:<br/>- Indicators<br/>- Frequency<br/>- Date range<br/>- Dimensions

    par Parallel API Calls
        Page->>MetaAPI: GET /api/meta/{indicator}?freq=M
        MetaAPI->>DuckDB: getIndicatorMetadata(code, freq, refArea)
        DuckDB->>SQLite: Query indicators table
        SQLite-->>DuckDB: Indicator record & file paths
        DuckDB->>Parquet: Read parquet schema<br/>DESCRIBE SELECT * FROM read_parquet()
        Parquet-->>DuckDB: Column names & types
        DuckDB->>Parquet: SELECT UNIT, UNIT_MULT, DECIMALS<br/>FROM read_parquet() LIMIT 1
        Parquet-->>DuckDB: Unit metadata
        DuckDB-->>MetaAPI: IndicatorMetadata object
        MetaAPI-->>Page: JSON {code, name, unit,<br/>availableDimensions}
    and
        Page->>DataAPI: GET /api/data?indicator=X&freq=M<br/>&ref_area=CO&start=2019-01
        DataAPI->>DuckDB: queryTimeSeries(params)

        Note over DuckDB: Build query with filters:<br/>- Indicators<br/>- Ref area<br/>- Date range<br/>- Dimensions

        DuckDB->>SQLite: Query indicators &<br/>indicatorFiles tables
        SQLite-->>DuckDB: File paths filtered by<br/>year & ref_area

        loop For each parquet file
            DuckDB->>Parquet: Read columns schema
            Parquet-->>DuckDB: Available columns
            DuckDB->>Parquet: SELECT TIME_PERIOD, OBS_VALUE<br/>FROM read_parquet()<br/>WHERE filters
            Parquet-->>DuckDB: Time series data rows
        end

        Note over DuckDB: Aggregate data from<br/>all files & sort by time

        DuckDB-->>DataAPI: IndicatorData[]
        DataAPI-->>Page: JSON {data: [...],<br/>meta: {count, indicators}}
    end

    Note over Page: Transform API response<br/>into Plotly format:<br/>{x: [dates], y: [values],<br/>type: 'scatter'}

    Page->>Chart: Pass Plotly data & layout
    Chart->>Chart: Import plotly.js-dist-min
    Chart->>Chart: plotly.newPlot(container,<br/>data, layout)
    Chart-->>User: Render interactive chart

    User->>Page: Modify filters/dimensions
    Page->>DataAPI: New GET /api/data with<br/>updated parameters
    Note over DataAPI,Parquet: Query cycle repeats...
    DataAPI-->>Page: Updated data
    Page->>Chart: Update with new data
    Chart->>Chart: plotly.react(container,<br/>newData, layout)
    Chart-->>User: Chart updates smoothly
```

## Component Overview

### 1. Frontend (`+page.svelte`)

- **Location**: `src/routes/(app)/app/+page.svelte`
- **Responsibilities**:
  - Manages user selections (indicators, filters, dimensions)
  - Makes parallel API calls for metadata and data
  - Transforms API responses into Plotly chart format
  - Updates chart when filters change

### 2. Data API Endpoint

- **Location**: `src/routes/api/data/+server.ts`
- **Responsibilities**:
  - Receives query parameters (indicators, ref_area, frequency, date range, dimensions)
  - Delegates to DuckDB query layer
  - Returns formatted JSON response with data and metadata

### 3. Metadata API Endpoint

- **Location**: `src/routes/api/meta/[indicator]/+server.ts`
- **Responsibilities**:
  - Retrieves indicator metadata
  - Returns available dimensions and unit information

### 4. DuckDB Query Layer

- **Location**: `src/lib/server/duckdb.ts`
- **Key Functions**:
  - `queryTimeSeries()`: Main data query function
  - `getIndicatorMetadata()`: Retrieves indicator metadata and available dimensions
  - `getParquetColumns()`: Reads parquet file schema
- **Responsibilities**:
  - Queries SQLite for indicator metadata and file paths
  - Filters parquet files by year and reference area
  - Executes SQL queries on parquet files using DuckDB
  - Applies dimension filters and date ranges
  - Aggregates and sorts results from multiple files

### 5. Data Storage

#### SQLite Database

- **Location**: `drizzle/db.sqlite`
- **Schema**: `src/lib/db/schema/`
- **Tables**:
  - `indicators`: Indicator definitions (code, name, description, source)
  - `indicatorFiles`: Maps indicators to parquet file paths with year and ref_area
  - `categories` & `areas`: Organizational hierarchy

#### Parquet Files

- **Location**: `data/` directory (organized by dataset)
- **Format**: SDMX-based columns
  - `TIME_PERIOD`: Date/time value
  - `OBS_VALUE`: Numeric observation
  - `REF_AREA`: Geographic reference (e.g., 'CO' for Colombia)
  - `FREQ`: Frequency (M=Monthly, A=Annual)
  - Dimension columns: `URBAN_RURAL`, `SEX`, `AGE`, `DEPT_CODE`, etc.

### 6. Visualization (`PlotlyChart.svelte`)

- **Location**: `src/lib/components/PlotlyChart.svelte`
- **Responsibilities**:
  - Dynamically imports Plotly.js
  - Renders interactive charts using Plotly
  - Updates charts reactively when data changes

## Data Flow Steps

1. **User Interaction**: User selects indicators and applies filters
2. **Parallel API Calls**: Frontend makes simultaneous requests for metadata and data
3. **Metadata Retrieval**:
   - Query SQLite for indicator info
   - Read parquet schema for available dimensions
   - Return unit information
4. **Data Query**:
   - Query SQLite for relevant parquet file paths
   - Filter files by year and reference area
   - For each file:
     - Read schema to validate dimension columns
     - Execute SQL query with WHERE clauses
     - Collect time series data
   - Aggregate and sort all results
5. **Response Formation**: Format data as JSON with metadata
6. **Data Transformation**: Convert to Plotly format
7. **Visualization**: Render interactive chart
8. **Updates**: When filters change, repeat steps 4-7

## Performance Optimizations

- **Parallel API Calls**: Metadata and data fetched simultaneously
- **File Filtering**: Only query parquet files within date range
- **Column Detection**: Dynamic dimension filtering based on available columns
- **In-Memory DuckDB**: Fast analytical queries on parquet files
- **Reactive Updates**: Plotly's `react()` method for smooth chart updates
