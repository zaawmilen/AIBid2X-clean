import { PostgreSqlContainer } from "@testcontainers/postgresql";

export async function createPostgresContainer() {
  const container = await new PostgreSqlContainer("postgres:15-alpine")
    .withDatabase("testdb")
    .withUsername("test")
    .withPassword("test")
    .start();

  return container;
}