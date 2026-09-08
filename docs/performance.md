# Explorer performance measurements

Set `PERFORMANCE_TRACING=1` in the server environment and restart the server to
enable tracing for `/explore`, including SvelteKit `__data.json` navigations.
Unset it or set it to `0` to disable. No collector or additional credentials are
required. Production deployment and environment changes require approval.

Tracing does not cache results, change SQL, remove scans, add optimistic state or
change chart loading behavior. Capture a baseline before those changes.

## Server

Each traced request emits an `explorer-performance-start` JSON log and an
`explorer-performance` completion log. A start without completion can indicate
an unfinished request or process termination; check machine logs too. Fly may
time out a client before the application finishes its work.

The `X-Request-ID` response header and page data's `performanceRequestId` match
the JSON log's `requestId`. Each redirect has its own request ID; preserve the
browser Network log to see the complete chain. SvelteKit data redirects can be
encoded in a successful HTTP response: `status` is the HTTP status, not a claim
that the chart is valid or that no redirect occurred.

Logs include route, data-request flag, machine, region, Fly image reference,
elapsed milliseconds, process RSS, V8 heap used/total, external memory, array-buffer
memory, process CPU deltas and event-loop utilization. Memory values are end-of-request
snapshots, not per-request allocations. Array-buffer memory is included in external
memory; neither external memory nor RSS minus heap is a DuckDB-specific measurement.
**Process metrics cover all work during the interval**, including overlapping
requests; they are not exclusive resource usage for one request.

Spans have `id`, `parentId`, `startMs` relative to the request, `durationMs`,
`status`, and returned row counts where applicable. They cover:

- `explorer_model` → `catalog` → `published_frequencies` → `observed_frequencies`
- `metadata`, `time_axis`, `dimension_registry`
- `common_values`, `private_values`, `value_labels`
- `chart` (query plus validation and series construction)
- `turso_execute` and `duckdb_query` nested beneath their calling stage
- `duckdb_initialize` separately on an uncached database handle

The gap between `chart` and its DuckDB child includes result validation and series
construction. Other parent/child gaps include application work and scheduling.
Database spans include client/driver overhead, queueing and result materialization.
They do **not** separate Turso network from remote execution, or DuckDB execution
from volume I/O. Use provider diagnostics, controlled query profiles and Fly/Linux
CPU, memory-pressure and I/O-pressure metrics for that next level of attribution.
Only the libSQL `execute` path used by explorer reads is instrumented, not admin
transactions or batch writes.

`Server-Timing` includes server duration and sums by operation name. These are
inclusive timings: **do not add them together or treat parallel query sums as
wall time**. Use the nested span start/end times to reconstruct the critical path.
Server duration ends when SvelteKit resolves the response; it excludes sending
the response body to the browser and any deferred streaming work. Current
explorer data is awaited, not streamed as deferred promises.

Tracing captures every explorer request while enabled. There is a cap of 256
spans per request, with a `droppedSpans` counter, and a bounded set of static
operation names in headers. The new logs contain no SQL text, query parameters,
raw URLs, credentials or error messages. Existing application error logs are
unchanged. Keep collection windows short to limit log volume.

## Browser

Open DevTools → Network (Preserve log) and Performance. Reload after enabling
tracing. Record a theme/indicator/filter selection and wait for the chart.

- Inspect the `__data.json` request's Timing tab for server operations, connection
  timing, TTFB, download time and bytes. Initial HTML is a separate workload.
- User Timing measures named `explorer:*` carry `detail.navigationId`,
  `detail.requestId`, `detail.component`, `detail.phase` and completion status.
- `initial-load-to-data-ready` starts at the document time origin and includes
  network and hydration. `navigation-to-data-ready` starts in `beforeNavigate`
  and ends in `afterNavigate`, covering `goto`, links and back/forward navigation.
- `import`, `render`, and `render-to-frame-opportunity` separate Plotly import,
  `Plotly.react()` completion and the next animation-frame callback. An import
  may hit the module cache. A frame opportunity is **not guaranteed screen paint**;
  use a DevTools recording to investigate actual paint or long tasks.
- Join the navigation start and final chart frame by `navigationId` for overall
  navigation-to-chart latency. The start mark knows the _previous_ page's request
  ID; the completion measure and chart marks carry the returned request ID.
- A superseded navigation gets a cancellation mark when another navigation
  starts. Stale chart completions are excluded. Network failures/cancellation
  may leave starts without completion; inspect Network/console for the cause.

Inspect recent measurements in the console:

```js
console.table(
	performance
		.getEntriesByType('measure')
		.filter((entry) => entry.name.startsWith('explorer:'))
		.map((entry) => ({ startMs: entry.startTime, durationMs: entry.duration, ...entry.detail }))
);
```

Only the latest 120 application marks/measures are retained. Record with DevTools
for longer sessions. Browser telemetry is local to the browser; it is not uploaded
to a server. Review HARs before sharing: they can contain sensitive headers/data.

## Baseline protocol

Use the reported EMICRON theme-only and PI_127 indicator URLs. Include a source
change, dimension change, date change and two-indicator comparison. Test a fresh
browser and warmed repeat navigations separately, first serially, then under
controlled concurrency. Record request/query counts, returned rows and bytes,
redirects, failures, elapsed time and machine size/version. Do not discard timeouts
from the report. Report sample count with percentiles; three samples are not a
meaningful p95. Orb browser timings do not represent Bogotá network latency.

For production resource attribution, correlate Fly metrics and read-only
`/proc/pressure/{cpu,memory,io}`, `/proc/meminfo` snapshots with request timestamps.
No extra health-check queries or per-request filesystem probes were added.
