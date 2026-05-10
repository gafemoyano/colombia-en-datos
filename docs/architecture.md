# High-Level Architecture

This document provides a high-level overview of the Colombia en Datos web application architecture.

## System Architecture Diagram

```mermaid
graph TB
    subgraph "Client Layer"
        Browser[Web Browser]
        Landing[Landing Page]
        AppUI[App Interface]
    end

    subgraph "SvelteKit Application"
        subgraph "Frontend Components"
            Hero[Hero Section]
            Catalog[Indicators Catalog]
            IndicatorSelector[Indicator Selector]
            DimensionSelector[Dimension Selector]
            PlotlyChart[Plotly Chart Component]
            MetadataDisplay[Metadata Display]
        end

        subgraph "API Routes (Server)"
            DataAPI["/api/data<br/>GET"]
            MetaAPI["/api/meta/:indicator<br/>GET"]
            DeptAPI["/api/departamentos<br/>GET"]
            DimsAPI["/api/dims/:indicator<br/>GET"]
            IndicatorsAPI["/api/indicators<br/>GET"]
            ContactAPI["/api/contact<br/>POST"]
        end

        subgraph "Server Libraries"
            DuckDBLib[DuckDB Query Engine]
            DBClient[Drizzle ORM Client]
            Scanner[Data Scanner]
        end
    end

    subgraph "Data Layer"
        subgraph "Metadata Database"
            SQLite[(SQLite DB)]
            Tables{{"Tables:<br/>• indicators<br/>• indicatorFiles<br/>• categories<br/>• areas<br/>• departamentos<br/>• users<br/>• collections"}}
        end

        subgraph "Time Series Storage"
            ParquetFiles[("Parquet Files<br/>(Columnar Format)")]
            Empleo["data/empleo/<br/>Employment Data"]
            Emicron["data/emicron/<br/>SME Data"]
            CalidadVida["data/encuesta_calidad_vida/<br/>Quality of Life Surveys"]
        end
    end

    subgraph "External Services"
        EmailService[Email Service<br/>Contact Form]
    end

    %% Client to Frontend
    Browser --> Landing
    Browser --> AppUI
    Landing --> Hero
    Landing --> Catalog
    AppUI --> IndicatorSelector
    AppUI --> DimensionSelector
    AppUI --> PlotlyChart
    AppUI --> MetadataDisplay

    %% Frontend to API
    IndicatorSelector --> IndicatorsAPI
    IndicatorSelector --> MetaAPI
    DimensionSelector --> DimsAPI
    DimensionSelector --> DeptAPI
    PlotlyChart --> DataAPI
    Landing --> ContactAPI

    %% API to Server Libraries
    DataAPI --> DuckDBLib
    MetaAPI --> DuckDBLib
    DimsAPI --> DuckDBLib
    IndicatorsAPI --> DBClient
    DeptAPI --> DBClient
    ContactAPI --> EmailService

    %% Server Libraries to Data
    DuckDBLib --> SQLite
    DuckDBLib --> ParquetFiles
    DBClient --> SQLite
    Scanner --> ParquetFiles
    Scanner --> SQLite

    %% Data Organization
    SQLite -.-> Tables
    ParquetFiles --> Empleo
    ParquetFiles --> Emicron
    ParquetFiles --> CalidadVida

    classDef client fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef frontend fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef api fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef server fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    classDef data fill:#fce4ec,stroke:#880e4f,stroke-width:2px
    classDef external fill:#f5f5f5,stroke:#424242,stroke-width:2px

    class Browser,Landing,AppUI client
    class Hero,Catalog,IndicatorSelector,DimensionSelector,PlotlyChart,MetadataDisplay frontend
    class DataAPI,MetaAPI,DeptAPI,DimsAPI,IndicatorsAPI,ContactAPI api
    class DuckDBLib,DBClient,Scanner server
    class SQLite,Tables,ParquetFiles,Empleo,Emicron,CalidadVida data
    class EmailService external
```

## Component Layer Architecture

```mermaid
graph LR
    subgraph "Presentation Layer"
        Routes["Routes<br/>• (landing)<br/>• (app)"]
        Components["UI Components<br/>• Selectors<br/>• Charts<br/>• Displays"]
    end

    subgraph "Business Logic Layer"
        API["API Endpoints<br/>RESTful Services"]
        Stores["Svelte Stores<br/>State Management"]
    end

    subgraph "Data Access Layer"
        DuckDB["DuckDB Engine<br/>Analytical Queries"]
        Drizzle["Drizzle ORM<br/>Metadata CRUD"]
    end

    subgraph "Storage Layer"
        Metadata["SQLite<br/>Relational Data"]
        TimeSeries["Parquet<br/>Columnar Data"]
    end

    Routes --> Components
    Components --> API
    Components --> Stores
    API --> DuckDB
    API --> Drizzle
    DuckDB --> Metadata
    DuckDB --> TimeSeries
    Drizzle --> Metadata

    classDef presentation fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    classDef business fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef dataAccess fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef storage fill:#fce4ec,stroke:#c2185b,stroke-width:2px

    class Routes,Components presentation
    class API,Stores business
    class DuckDB,Drizzle dataAccess
    class Metadata,TimeSeries storage
```

## Technology Stack

```mermaid
graph TB
    subgraph "Frontend Technologies"
        Svelte5["Svelte 5<br/>Reactive UI Framework"]
        SvelteKit["SvelteKit<br/>Full-Stack Framework"]
        Tailwind["Tailwind CSS 4<br/>Utility-First CSS"]
        PlotlyJS["Plotly.js<br/>Interactive Charts"]
        TypeScript["TypeScript<br/>Type Safety"]
    end

    subgraph "Backend Technologies"
        Node["Node.js<br/>Runtime Environment"]
        AdapterNode["@sveltejs/adapter-node<br/>Production Deployment"]
    end

    subgraph "Data Technologies"
        DuckDBTech["DuckDB<br/>In-Memory Analytics"]
        DrizzleTech["Drizzle ORM<br/>Type-Safe ORM"]
        SQLiteTech["SQLite<br/>Embedded Database"]
        ParquetTech["Apache Parquet<br/>Columnar Storage"]
    end

    subgraph "Development Tools"
        Vite["Vite<br/>Build Tool"]
        Vitest["Vitest<br/>Unit Testing"]
        ESLint["ESLint<br/>Code Linting"]
        Prettier["Prettier<br/>Code Formatting"]
        DrizzleKit["Drizzle Kit<br/>Database Migrations"]
    end

    SvelteKit --> Svelte5
    SvelteKit --> Node
    Svelte5 --> Tailwind
    Svelte5 --> PlotlyJS
    SvelteKit --> TypeScript
    Node --> AdapterNode
    SvelteKit --> DuckDBTech
    SvelteKit --> DrizzleTech
    DrizzleTech --> SQLiteTech
    DuckDBTech --> ParquetTech
    DuckDBTech --> SQLiteTech

    classDef frontend fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef backend fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef data fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    classDef dev fill:#f5f5f5,stroke:#424242,stroke-width:2px

    class Svelte5,SvelteKit,Tailwind,PlotlyJS,TypeScript frontend
    class Node,AdapterNode backend
    class DuckDBTech,DrizzleTech,SQLiteTech,ParquetTech data
    class Vite,Vitest,ESLint,Prettier,DrizzleKit dev
```

## Data Flow Architecture

```mermaid
flowchart TD
    Start([User Visits Site]) --> Landing{Landing or App?}

    Landing -->|Landing Page| LandingFlow[Show Hero & Catalog]
    Landing -->|App Page| AppFlow[Show Dashboard]

    AppFlow --> SelectIndicators[Select Indicators & Filters]
    SelectIndicators --> ParallelCalls{Parallel API Calls}

    ParallelCalls -->|Metadata| MetaFlow[/api/meta/:indicator]
    ParallelCalls -->|Data| DataFlow[/api/data]

    MetaFlow --> QueryMeta[Query SQLite + Parquet Schema]
    DataFlow --> QueryData[Query SQLite for Files]

    QueryMeta --> ReturnMeta[Return Dimensions & Units]
    QueryData --> FilterFiles[Filter by Year & Area]
    FilterFiles --> DuckDBQuery[Execute DuckDB Queries]
    DuckDBQuery --> ReadParquet[Read Parquet Files]
    ReadParquet --> AggregateData[Aggregate & Sort Results]
    AggregateData --> ReturnData[Return Time Series Data]

    ReturnMeta --> Transform[Transform to Plotly Format]
    ReturnData --> Transform

    Transform --> RenderChart[Render Interactive Chart]
    RenderChart --> UserInteraction[User Modifies Filters]
    UserInteraction --> SelectIndicators

    LandingFlow --> ContactForm{Contact Form?}
    ContactForm -->|Yes| SendEmail[POST /api/contact]
    ContactForm -->|No| Browse[Browse Catalog]
    Browse --> AppFlow

    classDef userAction fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef apiCall fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef dataOp fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    classDef rendering fill:#f3e5f5,stroke:#4a148c,stroke-width:2px

    class Start,SelectIndicators,UserInteraction,ContactForm,Browse userAction
    class MetaFlow,DataFlow,SendEmail apiCall
    class QueryMeta,QueryData,FilterFiles,DuckDBQuery,ReadParquet,AggregateData dataOp
    class RenderChart,Transform,LandingFlow,AppFlow rendering
```

## Key Architectural Patterns

### 1. **Full-Stack Framework Pattern**

- SvelteKit provides both client-side interactivity and server-side rendering
- File-based routing for pages and API endpoints
- Server-side code runs in Node.js environment

### 2. **Hybrid Data Storage Pattern**

- **SQLite**: Lightweight relational database for metadata, relationships, and reference data
- **Parquet**: Columnar storage for large-scale time series data
- **DuckDB**: In-memory analytical engine that bridges both storage systems

### 3. **API-First Architecture**

- RESTful API endpoints for all data operations
- Clear separation between UI and data layer
- Enables future mobile app or external integrations

### 4. **Component-Based UI**

- Reusable Svelte components for common UI patterns
- Reactive state management with Svelte's built-in stores
- TypeScript for type safety across components

### 5. **Progressive Enhancement**

- Landing page with static content loads fast
- App interface progressively loads data as needed
- Interactive charts rendered client-side with Plotly

### 6. **Performance Optimization**

- Parallel API calls for metadata and data
- Year-based file filtering to reduce query scope
- In-memory DuckDB for fast analytical queries
- Columnar parquet format for efficient data scanning

## Deployment Architecture

```mermaid
graph TB
    subgraph "Production Environment"
        LB[Load Balancer]

        subgraph "Application Server"
            NodeApp[Node.js Application<br/>SvelteKit + Adapter Node]
            StaticAssets[Static Assets<br/>CSS, JS, Images]
        end

        subgraph "Data Storage"
            SQLiteFile[(SQLite Database<br/>Metadata)]
            ParquetDir[("Parquet Files<br/>Time Series Data")]
        end
    end

    Users[Users] --> LB
    LB --> NodeApp
    NodeApp --> StaticAssets
    NodeApp --> SQLiteFile
    NodeApp --> ParquetDir

    classDef external fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef app fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef data fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px

    class Users,LB external
    class NodeApp,StaticAssets app
    class SQLiteFile,ParquetDir data
```

## Directory Structure

```
frontend/
├── src/
│   ├── lib/
│   │   ├── components/          # Reusable UI components
│   │   ├── db/                  # Database schemas and clients
│   │   ├── landing/             # Landing page components
│   │   ├── server/              # Server-side logic (DuckDB, etc.)
│   │   └── stores/              # Svelte stores
│   ├── routes/
│   │   ├── (landing)/           # Landing page route group
│   │   ├── (app)/               # Application route group
│   │   └── api/                 # API endpoints
│   └── app.html                 # HTML template
├── data/                        # Parquet files organized by dataset
│   ├── empleo/
│   ├── emicron/
│   └── encuesta_calidad_vida/
├── drizzle/                     # Database migrations and SQLite DB
├── scripts/                     # Seed and utility scripts
├── static/                      # Static assets
└── docs/                        # Documentation
```

## Key Features

1. **Data Visualization Platform**: Interactive time series charts for Colombian economic indicators
2. **Multi-Dataset Support**: Employment, SME, and Quality of Life data
3. **Advanced Filtering**: By department, time period, demographics, and custom dimensions
4. **Metadata Management**: Rich indicator metadata with units, sources, and descriptions
5. **Responsive Design**: Works on desktop and mobile devices
6. **Type-Safe Development**: Full TypeScript coverage for reliability
7. **Performance Optimized**: Fast queries with DuckDB and efficient parquet storage

## Scalability Considerations

- **Horizontal Scaling**: Stateless Node.js app can be replicated
- **Database Scaling**: SQLite is embedded; consider PostgreSQL for multi-instance deployments
- **Data Growth**: Parquet files are partitioned by year and area for efficient querying
- **Caching**: Browser caching for static assets, potential for Redis caching layer
- **CDN Integration**: Static assets can be served via CDN for global performance
