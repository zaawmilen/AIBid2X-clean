import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";

describe("Security: Auth", () => {
  it("should reject invalid password login", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({
      email: "nonexistent@test.com",
      password: "wrongpass",
    });

    expect(res.status).toBe(401);
  });

  it("should prevent duplicate registration", async () => {
    await request(app).post("/api/v1/auth/register").send({
      email: "dup@test.com",
      password: "12345678",
      role: "bidder",
    });

    const res = await request(app).post("/api/v1/auth/register").send({
      email: "dup@test.com",
      password: "12345678",
      role: "bidder",
    });

    expect(res.status).toBe(409);
  });
});