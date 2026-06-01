import 'dotenv/config';
import { Pool } from 'pg';

async function createVectorIndex() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    console.log('▶ Checking embedding coverage...');
    const { rows: [stats] } = await pool.query(`
      SELECT COUNT(*) AS total, COUNT(embedding) AS with_embedding FROM auctions;
    `);
    console.log(`  Total: ${stats.total}  With embedding: ${stats.with_embedding}`);

    if (Number(stats.with_embedding) === 0) {
      console.log('\n⚠  No embeddings yet — run the embedding worker first\n');
      return;
    }

    console.log('\n▶ Creating HNSW index...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS auctions_embedding_hnsw_idx
      ON auctions USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
    `);
    console.log('✅ HNSW index created');
  } finally {
    await pool.end();
  }
}

createVectorIndex().catch((err) => { console.error('❌ Failed:', err); process.exit(1); });
