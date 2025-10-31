# Feature Gap Analysis & Implementation Plan

## Current Implementation Status
✅ Basic indicator selection with search
✅ Date range filters (start/end)
✅ Frequency selector (M/A)
✅ Multi-indicator chart display
✅ Real DuckDB parquet querying

## Missing Features from MVP

### High Priority

1. **URBAN_RURAL Dimension Support** (`by` parameter)
   - [ ] Add dimension selector dropdown (like in MVP line 101-109)
   - [ ] Support for T/U/R (Total/Urban/Rural) filtering
   - [ ] Automatically detect available dimensions from parquet columns
   - [ ] Show separate traces for each dimension value (e.g., "EMP · Urbano", "EMP · Rural")

2. **Indicator Metadata Display** (notes section)
   - [ ] Create `/api/meta/{indicator}` endpoint
   - [ ] Display indicator title, category, source, methodology below chart
   - [ ] Show unit and unit_mult information
   - [ ] Support for multiple indicators metadata display

3. **Share Link Functionality**
   - [ ] "Copy Link" button to share current view
   - [ ] Build URL with all current filters (indicators, dates, frequency, by)
   - [ ] Support loading state from URL parameters

4. **Excel Download**
   - [ ] `/api/data_multi_xlsx` endpoint
   - [ ] "Download XLSX" button
   - [ ] Export current chart data to Excel

### Medium Priority

5. **Collections Support**
   - [ ] `/api/collections` endpoint
   - [ ] Allow grouping indicators into collections
   - [ ] Quick select entire collection of indicators

6. **Automatic Frequency Detection**
   - [ ] When selecting indicators, auto-detect which frequencies are available
   - [ ] Switch frequency automatically if current one has no data

7. **Status Messages**
   - [ ] Show data count and query info (like "Observaciones: 245 • EMP / CO [M]")
   - [ ] Loading states with better feedback
   - [ ] Error messages for failed queries

### Low Priority

8. **Percentage/Share Visualization**
   - [ ] Calculate percentages relative to a denominator indicator
   - [ ] Useful for showing composition (like SME breakdown)

9. **Advanced Filtering**
   - [ ] Support for SEX, AGE, ADJUSTMENT dimensions
   - [ ] GEO_LEVEL, DEPT_CODE, MUNI_CODE for geographic filtering

## Technical Enhancements Needed

### Backend (API Routes)

```typescript
// New endpoints needed:
GET /api/meta/{indicator}          // Indicator metadata
GET /api/dims/{indicator}           // Available dimensions
GET /api/collections                // List collections
GET /api/data_multi_xlsx            // Excel export
```

### Frontend Components

```
- DimensionSelector.svelte          // For by/urban_rural selection
- MetadataDisplay.svelte            // Show indicator notes
- ShareButton.svelte                // Copy link functionality
- ExportButton.svelte               // Download XLSX
- StatusBar.svelte                  // Query info display
```

### Data Flow

1. **Dimension Detection**: Query parquet columns to find available dimensions
2. **Multi-dimension Queries**: Support `by` parameter in DuckDB queries
3. **Metadata Integration**: Load and display from metadata JSON or database
4. **URL State Management**: Sync all filters with URL query params

## Implementation Priority

### Phase 1 (Current Sprint)
1. Add logging to duckdb.ts
2. URBAN_RURAL dimension support
3. Metadata display endpoint and component

### Phase 2
4. Share link functionality
5. Excel download
6. Status messages

### Phase 3
7. Collections support
8. Advanced dimensions (SEX, AGE, etc.)
9. Percentage visualizations

## Key Differences from MVP

| Feature | MVP (api_mvp.py) | Current SvelteKit | Status |
|---------|------------------|-------------------|---------|
| Multi-indicator | ✅ | ✅ | Done |
| Date filters | ✅ | ✅ | Done |
| Frequency select | ✅ | ✅ | Done |
| URBAN_RURAL (by) | ✅ | ❌ | **Missing** |
| Metadata/notes | ✅ | ❌ | **Missing** |
| Share link | ✅ | ❌ | **Missing** |
| XLSX download | ✅ | ❌ | **Missing** |
| Collections | ✅ | ❌ | **Missing** |
| Dimensions API | ✅ | ❌ | **Missing** |
| Auto-freq detect | ✅ | ❌ | **Missing** |

## Notes on Parquet Structure

From the MVP, we see that:
- Parquet files may contain additional columns beyond TIME_PERIOD, OBS_VALUE, UNIT, UNIT_MULT
- Common dimensions: URBAN_RURAL, SEX, AGE, ADJUSTMENT, GEO_LEVEL, DEPT_CODE, MUNI_CODE
- When dimension not selected, default to URBAN_RURAL='T' (Total)
- Need to query parquet schema to detect available dimensions per indicator
