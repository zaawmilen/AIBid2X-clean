import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";

describe("Contract: Auction API", () => {
  it("GET /auctions should return correct structure", 
    { timeout: 60000 },
    async () => {
    const res = await request(app).get("/api/v1/auctions");

    expect(res.status).toBe(200);

    expect(res.body).toHaveProperty("auctions");
    expect(Array.isArray(res.body.auctions)).toBe(true);

    if (res.body.auctions.length > 0) {
      const auction = res.body.auctions[0];

      expect(auction).toHaveProperty("id");
      expect(auction).toHaveProperty("title");
      expect(auction).toHaveProperty("status");
      expect(auction).toHaveProperty("currentPrice");
    }
  });
});