import { GenericContainer } from "testcontainers";

let container: any;

export async function createPostgresContainer() {
  // use a pgvector-enabled image for tests
  container = await new GenericContainer("ankane/pgvector:latest")
    .withEnvironment({
      POSTGRES_USER: "test",
      POSTGRES_PASSWORD: "test",
      POSTGRES_DB: "test_db",
    })
    .withExposedPorts(5432)
    .start();

  const port = container.getMappedPort(5432);
  const host = container.getHost();

  const url = `postgresql://test:test@${host}:${port}/test_db`;

  return {
    container,
    url,
  };
}

export async function stopPostgresContainer() {
  await container?.stop();
}