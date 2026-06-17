import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../../app.js"; 

let sellerToken: string;
let bidderToken: string;
let auctionId: string;


describe("E2E: Auction Full Flow", () => {
  beforeAll(async () => {
    // Register seller
    await request(app).post("/api/v1/auth/register").send({
      email: "seller_e2e@test.com",
      password: "12345678",
      role: "seller",
    });

    const sellerLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: "seller_e2e@test.com",
        password: "12345678",
      });

    sellerToken = sellerLogin.body.accessToken;

    // Register bidder
    await request(app).post("/api/v1/auth/register").send({
      email: "bidder_e2e@test.com",
      password: "12345678",
      role: "bidder",
    });

    const bidderLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: "bidder_e2e@test.com",
        password: "12345678",
      });

    bidderToken = bidderLogin.body.accessToken;
  });

  it("should create auction → activate → place bid → accept bid", 
    {timeout: 20000},
    async () => {
    // 1. Create auction
    const auctionRes = await request(app)
      .post("/api/v1/auctions")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        title: "E2E Guitar",
        description: "Test guitar",
        startingPrice: 100,
        endTime: new Date(Date.now() + 3600000).toISOString(),
      });

    auctionId = auctionRes.body.auction.id;

    expect(auctionId).toBeDefined();


    // 2. Activate auction
    await request(app)
      .patch(`/api/v1/auctions/${auctionId}/activate`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(200);

    // 3. Place bid
    const bidRes = await request(app)
      .post(`/api/v1/auctions/${auctionId}/bids`)
      .set("Authorization", `Bearer ${bidderToken}`)
      .send({ amount: 120 });

    expect(bidRes.status).toBe(201);

    // 4. Verify auction state
    const final = await request(app).get(
      `/api/v1/auctions/${auctionId}`
    );

    expect(Number(final.body.auction.currentPrice)).toBe(120);
  },
  
);
});