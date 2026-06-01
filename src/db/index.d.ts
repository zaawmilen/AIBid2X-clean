import { Pool } from 'pg';
import * as schema from './schema.js';
declare const pool: Pool;
export declare const db: import("drizzle-orm/node-postgres").NodePgDatabase<typeof schema>;
export declare function checkDatabaseConnection(): Promise<void>;
export declare function closeDatabasePool(): Promise<void>;
export { pool };
//# sourceMappingURL=index.d.ts.map