import { GenericContainer } from "testcontainers";
import { createPostgresContainer } from "./db/postgres.js";

export default async function globalSetup() {
  process.env.NODE_ENV = "test";
  process.env.DISABLE_RATE_LIMITS = "true";

  process.env.JWT_ACCESS_SECRET =
    process.env.JWT_ACCESS_SECRET ?? "x".repeat(40);

  process.env.JWT_REFRESH_SECRET =
    process.env.JWT_REFRESH_SECRET ?? "y".repeat(40);

  //
  // Redis container
  //
  if (!process.env.REDIS_URL) {
    const redis = await new GenericContainer("redis:7-alpine")
      .withExposedPorts(6379)
      .start();

    process.env.REDIS_URL =
      `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  }

  //
  // Postgres container
  //
  const { url } = await createPostgresContainer();

  process.env.DATABASE_URL = url;

  //
  // Import AFTER env vars exist
  //
  const { checkDatabaseConnection } =
    await import("../../db/index.js");

  //
  // Run migrations
  //
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const { fileURLToPath } = await import("url");
  const { dirname, join } = await import("path");

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const db = drizzle(pool);

    await migrate(db, {
      migrationsFolder: join(
        __dirname,
        "..",
        "..",
        "db",
        "migrations"
      ),
    });
  } finally {
    await pool.end();
  }

  await checkDatabaseConnection();
}