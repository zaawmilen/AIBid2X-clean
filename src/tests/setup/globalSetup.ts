import { checkDatabaseConnection } from '../../db/index.js';

export default async function globalSetup() {
	// Ensure the test database is reachable before running tests
	await checkDatabaseConnection();
}
