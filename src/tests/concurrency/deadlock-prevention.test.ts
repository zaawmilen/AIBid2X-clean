// src/tests/concurrency/deadlock-prevention.test.ts

import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../../app.js";

describe("Concurrency: Deadlock Prevention", () => {
  it(
    "should process many concurrent bids without deadlock",
    { timeout: 60000 },
    async () => {
      // Seller
      const sellerEmail = `seller-${Date.now()}@test.com`;

      await request(app).post("/api/v1/auth/register").send({
        email: sellerEmail,
        password: "12345678",
        role: "seller",
      });

      const sellerLogin = await request(app).post("/api/v1/auth/login").send({
        email: sellerEmail,
        password: "12345678",
      });

      const sellerToken = sellerLogin.body.accessToken;

      // Create auction
      const auctionRes = await request(app)
        .post("/api/v1/auctions")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
          title: "Deadlock Test Auction",
          description: "Testing concurrent bidding",
          startingPrice: 100,
          endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        });

      expect(auctionRes.status).toBe(201);
      const auctionId = auctionRes.body.auction.id;

      // Activate auction
      const activateRes = await request(app)
        .patch(`/api/v1/auctions/${auctionId}/activate`)
        .set("Authorization", `Bearer ${sellerToken}`);
      expect(activateRes.status).toBe(200);

      // Bidder
      const bidderEmail = `bidder-${Date.now()}@test.com`;

      await request(app).post("/api/v1/auth/register").send({
        email: bidderEmail,
        password: "12345678",
        role: "bidder",
      });

      const bidderLogin = await request(app).post("/api/v1/auth/login").send({
        email: bidderEmail,
        password: "12345678",
      });

      const bidderToken = bidderLogin.body.accessToken;

      // Fire many concurrent bids
      const start = Date.now();

      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          request(app)
            .post(`/api/v1/auctions/${auctionId}/bids`)
            .set("Authorization", `Bearer ${bidderToken}`)
            .send({ amount: 110 + i })
        )
      );

      const duration = Date.now() - start;

      // No request should hang forever
      expect(duration).toBeLessThan(20000); // allow up to 20s for concurrency

      // At least one bid succeeds
      const successes = responses.filter(r =>
          [200, 201].includes(r.status)
        );

        expect(successes.length).toBeGreaterThan(0);

      // No server errors caused by deadlocks
      const serverErrors = responses.filter(r => r.status >= 500);

          expect(serverErrors.length).toBe(0);
    }
  );
});
