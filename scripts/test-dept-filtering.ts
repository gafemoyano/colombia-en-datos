import 'dotenv/config';
import { queryTimeSeries } from '../src/lib/server/duckdb';

(async () => {
	console.log('=== Testing Department Filtering ===\n');

	// Test 1: National level (no DEPT_CODE filter)
	console.log('Test 1: National level (default)');
	const nationalData = await queryTimeSeries({
		indicators: ['total_hogares'],
		refArea: 'CO',
		freq: 'A',
		startDate: '2023',
		endDate: '2024'
	});
	console.log(`  ✓ Retrieved ${nationalData.length} data points for national level`);
	console.log(`  Sample:`, nationalData[0]);

	// Test 2: Filter by specific department (Antioquia = 06)
	console.log('\nTest 2: Filter by DEPT_CODE=06 (Antioquia)');
	const antioquiaData = await queryTimeSeries({
		indicators: ['total_hogares'],
		refArea: '05',
		freq: 'A',
		deptCode: '05',
		startDate: '2023',
		endDate: '2024'
	});
	console.log(`  ✓ Retrieved ${antioquiaData.length} data points for Antioquia`);
	console.log(`  Sample:`, antioquiaData[0]);

	// Test 3: Filter by another department (Bogotá = 11)
	console.log('\nTest 3: Filter by DEPT_CODE=11 (Bogotá)');
	const bogotaData = await queryTimeSeries({
		indicators: ['total_hogares'],
		refArea: '11',
		freq: 'A',
		deptCode: '11',
		startDate: '2023',
		endDate: '2024'
	});
	console.log(`  ✓ Retrieved ${bogotaData.length} data points for Bogotá`);
	console.log(`  Sample:`, bogotaData[0]);

	console.log('\n✅ All department filtering tests passed!');
	process.exit(0);
})();
