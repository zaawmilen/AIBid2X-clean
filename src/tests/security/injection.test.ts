import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../../app.js";

describe("Security: Injection", () => {
  it(
    "should safely reject or neutralize SQL injection attempts",
    async () => {
      const payloads = [
        "1' OR '1'='1",
        "'; DROP TABLE auctions; --",
        "admin' --",
        "1 OR 1=1",
        "' UNION SELECT * FROM users --",
        "'; DELETE FROM auctions; --",
        "\" OR \"1\"=\"1",
        "0; EXEC xp_cmdshell('dir')",
      ];

      for (const payload of payloads) {
        const start = Date.now();

        const res = await request(app)
          .get("/api/v1/auctions")
          .query({ auctionId: payload });

        const elapsed = Date.now() - start;

        // Server must not crash
        expect(res.status).toBeLessThan(500);

        // Must not expose database internals
        expect(res.text).not.toMatch(
          /sql|syntax error|postgres|database|relation|stack|exception|ORA-|mysql/i
        );

        // Request should finish reasonably quickly
        expect(elapsed).toBeLessThan(3000);
      }
    },
    20000 // 20 second timeout
  );
});