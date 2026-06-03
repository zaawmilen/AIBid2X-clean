import { pool } from "../../db/index.js";

describe("postgres connection", () => {
  it("connects", async () => {
    const result = await pool.query("SELECT 1");

    expect(result.rows.length).toBe(1);
  });
});