import duckdb from 'duckdb';
import { resolve } from 'path';

const db = new duckdb.Database(':memory:');

const files = [
	{
		path: 'data/emicron/A1.10_SME_OWNSTAT/FREQ=A/INDICATOR=NUM_SME_CTA_PROP/REF_AREA=CO/part-2019.parquet',
		label: 'EMICRON - NUM_SME_CTA_PROP'
	},
	{
		path: 'data/empleo/FREQ=M/INDICATOR=EMP/REF_AREA=CO/part-2019.parquet',
		label: 'EMPLEO - EMP'
	},
	{
		path: 'data/encuesta_calidad_vida/Cuadro_10_Poblacion_con_acceso_al_Sistema_General_de_Seguridad_Social_en_Salud_S_G_S_S_S_por_regimenes/FREQ=A/INDICATOR=afiliados/REF_AREA=05/part-2019.parquet',
		label: 'ECV - afiliados (dept 05)'
	}
];

const dimCols = ['DEPT_CODE', 'MUNI_CODE', 'GEO_LEVEL', 'URBAN_RURAL', 'SEX', 'AGE', 'ADJUSTMENT'];

async function run() {
	for (const { path: f, label } of files) {
		const fullPath = resolve(process.cwd(), f);
		console.log('\n===', label, '===');
		for (const col of dimCols) {
			try {
				const vals = await new Promise<{ v: string }[]>((res, rej) => {
					db.all(
						`SELECT DISTINCT "${col}" as v FROM read_parquet('${fullPath}')`,
						(err: Error | null, rows: any) => {
							if (err) rej(err);
							else res(rows as { v: string }[]);
						}
					);
				});
				const uniq = vals.map((r) => r.v).sort();
				console.log(`  ${col}: [${uniq.join(', ')}]`);
			} catch (e: any) {
				console.log(`  ${col}: [ERROR - ${e.message?.slice(0, 80)}]`);
			}
		}
	}
}

run().catch(console.error);
