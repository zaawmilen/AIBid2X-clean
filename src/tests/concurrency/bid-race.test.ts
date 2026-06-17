import { describe, it, expect } from "vitest";
import { db } from "../../db/index.js";
import { auctions } from "../../db/schema.js";
import { eq } from "drizzle-orm";

import { createTestUsers } from "../fixtures/userFactory.js";
import { createTestAuction } from "../fixtures/auctionFactory.js";
import { placeBid } from "../../services/bid.service.js";

describe("bid race", () => {
  it("ensures highest bid wins under concurrency", 
    { timeout: 20000 },
    async () => {
    const bidders = await createTestUsers(db, 10);

    const auction = await createTestAuction(db, {
      startingPrice: 100,
    });

    await db
      .update(auctions)
      .set({
        status: "active",
        startTime: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(auctions.id, auction.id));

    const results = await Promise.allSettled(
      bidders.map((b: { id: string }, i: number) =>
        placeBid(auction.id, b.id, 101 + i)
      )
    );

    const fulfilled = results.filter(
      (r) => r.status === "fulfilled"
    ) as PromiseFulfilledResult<any>[];

    const failed = results.filter(
      (r) => r.status === "rejected"
    );

    expect(fulfilled.length).toBeGreaterThan(0);

    const [updated] = await db
      .select()
      .from(auctions)
      .where(eq(auctions.id, auction.id))
      .limit(1);

    expect(updated).toBeDefined();
    expect(Number(updated!.currentPrice)).toBe(110);
    expect(failed.length + fulfilled.length).toBe(10);
  });
});