import { GenericContainer } from "testcontainers";

export async function startRedis() {
  const container = await new GenericContainer("redis:7-alpine")
    .withExposedPorts(6379)
    .start();

  const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;

  return { container, url };
}