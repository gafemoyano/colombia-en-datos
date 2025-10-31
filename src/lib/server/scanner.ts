import { readdir } from 'fs/promises';
import { join } from 'path';

export interface ParquetFile {
	area: string;
	category: string;
	frequency: string;
	indicator: string;
	refArea: string;
	year: number;
	filePath: string;
}

// Map folder names to area codes
const AREA_NAME_MAPPING: Record<string, string> = {
	encuesta_calidad_vida: 'calidad_vida'
};

async function scanAreaWithCategory(
	areaPath: string,
	area: string,
	category: string
): Promise<ParquetFile[]> {
	const results: ParquetFile[] = [];
	const categoryPath = join(areaPath, category);

	const freqDirs = await readdir(categoryPath, { withFileTypes: true });

	for (const freqEntry of freqDirs) {
		if (!freqEntry.isDirectory() || !freqEntry.name.startsWith('FREQ=')) continue;
		const frequency = freqEntry.name.replace('FREQ=', '');
		const freqPath = join(categoryPath, freqEntry.name);

		const indicatorDirs = await readdir(freqPath, { withFileTypes: true });

		for (const indicatorEntry of indicatorDirs) {
			if (!indicatorEntry.isDirectory() || !indicatorEntry.name.startsWith('INDICATOR=')) continue;
			const indicator = indicatorEntry.name.replace('INDICATOR=', '');
			const indicatorPath = join(freqPath, indicatorEntry.name);

			const refAreaDirs = await readdir(indicatorPath, { withFileTypes: true });

			for (const refAreaEntry of refAreaDirs) {
				if (!refAreaEntry.isDirectory() || !refAreaEntry.name.startsWith('REF_AREA=')) continue;
				const refArea = refAreaEntry.name.replace('REF_AREA=', '');
				const refAreaPath = join(indicatorPath, refAreaEntry.name);

				const files = await readdir(refAreaPath, { withFileTypes: true });

				for (const file of files) {
					if (!file.isFile() || !file.name.endsWith('.parquet')) continue;
					const match = file.name.match(/^part-(\d{4})\.parquet$/);
					if (!match) continue;
					const year = parseInt(match[1], 10);

					const filePath = join(refAreaPath, file.name);

					results.push({
						area,
						category,
						frequency,
						indicator,
						refArea,
						year,
						filePath
					});
				}
			}
		}
	}

	return results;
}

async function scanAreaWithoutCategory(areaPath: string, area: string): Promise<ParquetFile[]> {
	const results: ParquetFile[] = [];

	const freqDirs = await readdir(areaPath, { withFileTypes: true });

	for (const freqEntry of freqDirs) {
		if (!freqEntry.isDirectory() || !freqEntry.name.startsWith('FREQ=')) continue;
		const frequency = freqEntry.name.replace('FREQ=', '');
		const freqPath = join(areaPath, freqEntry.name);

		const indicatorDirs = await readdir(freqPath, { withFileTypes: true });

		for (const indicatorEntry of indicatorDirs) {
			if (!indicatorEntry.isDirectory() || !indicatorEntry.name.startsWith('INDICATOR=')) continue;
			const indicator = indicatorEntry.name.replace('INDICATOR=', '');
			const indicatorPath = join(freqPath, indicatorEntry.name);

			const refAreaDirs = await readdir(indicatorPath, { withFileTypes: true });

			for (const refAreaEntry of refAreaDirs) {
				if (!refAreaEntry.isDirectory() || !refAreaEntry.name.startsWith('REF_AREA=')) continue;
				const refArea = refAreaEntry.name.replace('REF_AREA=', '');
				const refAreaPath = join(indicatorPath, refAreaEntry.name);

				const files = await readdir(refAreaPath, { withFileTypes: true });

				for (const file of files) {
					if (!file.isFile() || !file.name.endsWith('.parquet')) continue;
					const match = file.name.match(/^part-(\d{4})\.parquet$/);
					if (!match) continue;
					const year = parseInt(match[1], 10);

					const filePath = join(refAreaPath, file.name);

					results.push({
						area,
						category: area,
						frequency,
						indicator,
						refArea,
						year,
						filePath
					});
				}
			}
		}
	}

	return results;
}

export async function scanDataDirectory(dataPath: string): Promise<ParquetFile[]> {
	const results: ParquetFile[] = [];

	const areas = await readdir(dataPath, { withFileTypes: true });

	for (const areaEntry of areas) {
		if (!areaEntry.isDirectory()) continue;
		const folderName = areaEntry.name;
		const areaPath = join(dataPath, folderName);

		// Map folder name to area code (e.g., encuesta_calidad_vida -> calidad_vida)
		const area = AREA_NAME_MAPPING[folderName] || folderName;

		const entries = await readdir(areaPath, { withFileTypes: true });

		const hasFreqDir = entries.some((e) => e.isDirectory() && e.name.startsWith('FREQ='));

		if (hasFreqDir) {
			// Direct FREQ structure (e.g., empleo)
			const areaResults = await scanAreaWithoutCategory(areaPath, area);
			results.push(...areaResults);
		} else {
			// Category-based structure (e.g., emicron, encuesta_calidad_vida)
			for (const categoryEntry of entries) {
				if (!categoryEntry.isDirectory()) continue;
				const category = categoryEntry.name;
				const categoryResults = await scanAreaWithCategory(areaPath, area, category);
				results.push(...categoryResults);
			}
		}
	}

	return results;
}
