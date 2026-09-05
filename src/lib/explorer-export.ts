import type { ExplorerPageModel } from '$lib/server/explorer';

export type ExportModel = Pick<
	ExplorerPageModel,
	'chart' | 'state' | 'metadatas' | 'canonicalSearch'
>;
type Cell = string | number | null;

export function exportRows(model: ExportModel): Cell[][] {
	const metadata = new Map(model.metadatas.map((item) => [item.code, item]));
	return [
		[
			'indicador_codigo',
			'indicador',
			'serie',
			'periodo',
			'frecuencia',
			'valor',
			'unidad',
			'unidad_multiplicador',
			'dimension_desagregada',
			'valor_desagregado_codigo',
			'valor_desagregado',
			'filtros',
			'fuente'
		],
		...model.chart.series.flatMap((series) => {
			const meta = metadata.get(series.indicatorCode);
			return series.points.map((point) => [
				series.indicatorCode,
				meta?.name || series.indicatorCode,
				series.name,
				point.time,
				model.state.freq,
				point.value,
				meta?.unit ?? null,
				meta?.unitMult ?? null,
				model.state.by,
				series.splitValue,
				series.splitLabel,
				JSON.stringify(model.state.filters),
				meta?.sourceCitation ?? null
			]);
		})
	];
}

export function toCsv(rows: Cell[][]): string {
	return (
		'\uFEFF' +
		rows
			.map((row) =>
				row
					.map((cell) => {
						if (cell == null) return '';
						// Quoting alone does not prevent spreadsheet formula execution.
						let text = String(cell);
						if (typeof cell === 'string' && /^[\s\uFEFF]*[=+\-@\t\r\n]/.test(text))
							text = "'" + text;
						return '"' + text.replaceAll('"', '""') + '"';
					})
					.join(',')
			)
			.join('\r\n') +
		'\r\n'
	);
}

export async function downloadExport(model: ExportModel, format: 'csv' | 'xlsx', origin: string) {
	if (model.chart.status !== 'chartable' || !model.chart.series.some((s) => s.points.length)) {
		throw new Error('No hay datos para descargar.');
	}
	const rows = exportRows(model);
	let blob: Blob;
	if (format === 'csv') {
		blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
	} else {
		const { default: writeExcelFile } = await import('write-excel-file/browser');
		blob = await writeExcelFile([
			{ sheet: 'Datos', data: rows },
			{
				sheet: 'Contexto',
				data: [
					['Selección', `${origin}/explore?${model.canonicalSearch}`],
					['Exportado (UTC)', new Date().toISOString()],
					['Alcance', 'Selección completa; el zoom y las series ocultas no modifican la descarga.'],
					['Filtros', JSON.stringify(model.state.filters)],
					['Inicio', model.state.start],
					['Fin', model.state.end],
					...model.metadatas.flatMap((meta) => [
						[meta.code, meta.name],
						['Fuente', meta.sourceCitation],
						['Descripción', meta.description],
						['Metodología', meta.methodology],
						['Actualizado', meta.updated]
					])
				]
			}
		]).toBlob();
	}
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = `colombia-en-datos-${new Date().toISOString().slice(0, 10)}.${format}`;
	document.body.append(link);
	link.click();
	link.remove();
	// Allow the browser to start consuming the download before releasing it.
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
