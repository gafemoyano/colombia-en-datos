# Scalability Analysis: Single DuckDB File vs. Partitioned Storage

> Status: Analysis — addresses the concern that a single `observations.duckdb` file will not scale as indicator count grows.

---

## 1. Current Scale

| Metric | Value |
|--------|-------|
| Parquet files | 34,997 |
| Total data size | 595 MB |
| Unique indicators | 242 |
| Sample file row count | ~44,300 rows/year (with dimensions expanded) |

---

## 2. Projected Scale

### Assumptions (aggressive)

| Source | Indicators/year | Frequency | Dimensions | Rows/year/indicator | Rows/year/source |
|--------|----------------|-----------|------------|---------------------|------------------|
| DANE | 70 | Monthly | Urban (3) × Sex (2) × Age (5) × Dept (33) | ~11,880 | ~831,600 |
| DANE | 30 | Annual | Urban (3) × Sex (2) × Dept (33) | ~198 | ~5,940 |
| MinAmbiente | 20 | Annual | Dept (33) | ~33 | ~660 |
| Other sources | 30 | Mixed | Light dimensions | ~500 avg | ~15,000 |
| **Total** | **150** | | | | **~853,200** |

### 20-year projection

| Scenario | Total rows | DuckDB file size (estimated) |
|----------|-----------|------------------------------|
| Conservative (50% of projected) | ~8.5 M | ~2–4 GB |
| Projected | ~17 M | ~4–8 GB |
| Aggressive (2× projected) | ~34 M | ~8–16 GB |

**DuckDB's documented comfort zone is billions of rows.** Our 20-year projection is 2–3 orders of magnitude below that.

---

## 3. Why One File Is Fine (for now)

### DuckDB's columnar engine

DuckDB stores data in **row groups** (default ~120,000 rows per group). Each row group maintains **zone maps** — min/max values for every column. A query like:

```sql
SELECT * FROM observations
WHERE indicator_code = 'EMP' AND freq = 'M' AND time_period >= '2023-01'
```

…will **skip entire row groups** where `indicator_code` is not `EMP`. Unused dimension columns consume almost zero I/O because DuckDB is columnar.

### Query performance

| Query pattern | Expected time at 17 M rows |
|---------------|---------------------------|
| Single indicator, single frequency, national | < 50 ms |
| Single indicator, single frequency, all departments | < 100 ms |
| Multi-indicator comparison (2–5 indicators) | < 200 ms |
| Full table scan (rare) | < 2 s |

These numbers are based on DuckDB's published benchmarks and our current observed query times (~20–50 ms on 595 MB of scattered files).

---

## 4. Real Bottlenecks to Watch

| Bottleneck | When it happens | Mitigation |
|------------|-----------------|------------|
| **Write contention** | Two uploads at the same time | Already addressed: serialized writes. |
| **Backup size** | File grows to 10+ GB | DuckDB files compress well; nightly backup to R2/S3. |
| **Cold start on Fly.io** | Instance restarts, must load file into memory | DuckDB uses mmap; only touched pages load. A 10 GB file does not require 10 GB RAM. |
| **Vacuum/optimize** | Many updates create dead row groups | Monthly `OPTIMIZE` or `VACUUM` via cron. |
| **Schema migration** | Adding a new dimension column | Requires rewriting the file (DuckDB limitation). See §6. |

---

## 5. Escape Hatches: Paths to Partitioning

If the single file ever becomes a problem, we have **three migration paths** that do not require rewriting the query layer:

### Path A: Partitioned Parquet (Hive-style)

Keep one logical table, but store it as partitioned Parquet files:

```
data/canonical/
├── indicator=EMP/
│   ├── freq=M/
│   │   └── part-0001.parquet
│   └── freq=A/
│       └── part-0001.parquet
├── indicator=EMP_F/
│   └── ...
```

DuckDB queries it with:

```sql
SELECT * FROM read_parquet('data/canonical/*/*/*.parquet', hive_partitioning=1)
WHERE indicator = 'EMP' AND freq = 'M'
```

**Trade-off:** Slightly slower queries (Parquet vs native format), but writes are isolated per indicator.

### Path B: Multiple Attached DuckDB Files

Create one `.duckdb` file per area or per indicator group:

```
data/canonical/
├── empleo.duckdb
├── emicron.duckdb
├── calidad_vida.duckdb
```

Query layer attaches them:

```sql
ATTACH 'data/canonical/empleo.duckdb' AS empleo (READ_ONLY);
ATTACH 'data/canonical/emicron.duckdb' AS emicron (READ_ONLY);

SELECT * FROM empleo.observations
UNION ALL
SELECT * FROM emicron.observations
WHERE indicator_code = 'EMP' AND freq = 'M'
```

**Trade-off:** More files to manage, but writes are isolated and backups are granular.

### Path C: Mother Duck / DuckDB Cloud

If self-hosting becomes painful, DuckDB Cloud (Mother Duck) offers a managed serverless DuckDB with automatic scaling. Migration is minimal because the SQL is identical.

**Trade-off:** External dependency, ongoing cost. But the SQL layer stays the same.

---

## 6. The Real Risk: Schema Evolution

The only operation that **forces** a file rewrite is adding a new column to the canonical table. DuckDB does not support `ALTER TABLE ADD COLUMN` without rewriting the file.

At our projected scale (17 M rows), a full rewrite takes **~30–60 seconds**. This is acceptable for a rare schema migration, but not for routine operations.

### Mitigation: Reserve extension columns

Create the initial schema with **2–3 reserved VARCHAR columns**:

```sql
CREATE TABLE observations (
    -- ... existing columns ...
    ext_1 VARCHAR,
    ext_2 VARCHAR,
    ext_3 VARCHAR,
    ext_dimensions MAP(VARCHAR, VARCHAR)
);
```

When a data scientist needs a new dimension:
- **Fast path:** Use `ext_1`, `ext_2`, or `ext_3` (no file rewrite, just update `dimension_definitions`).
- **Slow path:** Add a properly named column when the dimension is reused across 3+ indicators (requires a one-time `OPTIMIZE` or file rewrite).

This gives us **5–10 years of runway** before we need a schema rewrite.

---

## 7. Recommendation

| Timeframe | Storage strategy | Rationale |
|-----------|-----------------|-----------|
| **Phase 1–2 (now)** | Single `observations.duckdb` | Simplicity, fast queries, one file to back up. |
| **Phase 3–4 (year 2–3)** | Same, with monthly `OPTIMIZE` | File may grow to 2–4 GB. Still trivial for DuckDB. |
| **Phase 5+ (year 3+)** | Evaluate Path A or B if needed | Only if write contention or backup size becomes painful. |

**Do not** prematurely partition. The complexity of managing multiple files (consistency, cross-indicator queries, backup orchestration) is not worth it until we have **>100M rows** or **>50 GB** of data.

---

## 8. Decision

> **We will start with a single `observations.duckdb` file.**
>
> We will add 2–3 reserved extension columns (`ext_1`, `ext_2`, `ext_3`) to defer schema rewrites.
>
> We will monitor file size and query latency monthly. If the file exceeds 10 GB or cold-start latency exceeds 500 ms, we will evaluate Path A (partitioned Parquet) or Path B (multiple attached databases).
