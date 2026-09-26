import dotenv from 'dotenv';
import path from 'path';

// Force load .env from backend folder
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { query, initDatabase } from '../src/db/pool';

async function testSupabase() {
  console.log('====================================================');
  console.log('  Testing Supabase PostgreSQL Connection');
  console.log('====================================================');

  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl || dbUrl.trim() === '' || dbUrl.includes('[YOUR-PASSWORD]')) {
    console.error('\n❌ ERROR: DATABASE_URL is not set or still contains [YOUR-PASSWORD].');
    console.error('Please create/edit backend/.env with your real Supabase password.');
    console.error('Example:');
    console.error('DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres\n');
    process.exit(1);
  }

  // Mask password for safe logging
  const maskedUrl = dbUrl.replace(/:([^:@]+)@/, ':****@');
  console.log(`Connecting to: ${maskedUrl}`);

  try {
    // 1. Basic Ping
    const start = Date.now();
    const pingResult = await query('SELECT NOW() as now, current_database() as db_name, version() as version;');
    const latency = Date.now() - start;

    console.log(`\n✓ Connection Successful!`);
    console.log(`  Database Name: ${pingResult.rows[0].db_name}`);
    console.log(`  Server Time:   ${pingResult.rows[0].now}`);
    console.log(`  Roundtrip Ping: ${latency}ms`);

    // 2. Schema Verification & Creation
    console.log('\nVerifying table schema in Supabase...');
    await initDatabase();

    // 3. Verify Table and Index
    const tableCheck = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'dynamic_qrs';
    `);

    if (tableCheck.rows.length === 0) {
      throw new Error('Table dynamic_qrs was not found in public schema.');
    }
    console.log('✓ Table "dynamic_qrs" exists and is ready in Supabase.');

    const indexCheck = await query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'dynamic_qrs' AND indexname = 'idx_dynamic_qrs_short_code';
    `);

    if (indexCheck.rows.length > 0) {
      console.log('✓ Unique index "idx_dynamic_qrs_short_code" is active.');
    }

    // 4. Test CRUD Operation
    console.log('\nTesting live INSERT / SELECT / DELETE against Supabase...');
    const testId = '00000000-0000-0000-0000-000000000001';
    const testCode = 'TEST01';

    // Cleanup any prior test record
    await query('DELETE FROM dynamic_qrs WHERE id = $1 OR short_code = $2', [testId, testCode]);

    // Insert
    await query(`
      INSERT INTO dynamic_qrs (id, short_code, destination_url, scan_count, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, 0, TRUE, NOW(), NOW())
    `, [testId, testCode, 'https://example.com/test']);
    console.log('✓ Test record inserted.');

    // Read back
    const selectRes = await query('SELECT * FROM dynamic_qrs WHERE short_code = $1', [testCode]);
    if (selectRes.rows.length === 0 || selectRes.rows[0].destination_url !== 'https://example.com/test') {
      throw new Error('Failed to query test record.');
    }
    console.log('✓ Test record verified.');

    // Cleanup
    await query('DELETE FROM dynamic_qrs WHERE id = $1', [testId]);
    console.log('✓ Test record cleaned up.');

    console.log('\n====================================================');
    console.log('🎉 SUPABASE POSTGRESQL IS 100% OPERATIONAL!');
    console.log('====================================================\n');
  } catch (error: any) {
    console.error('\n❌ Connection test failed:', error.message);
    if (error.message.includes('password authentication failed')) {
      console.error('👉 TIP: Check your database password in backend/.env. If it contains special characters (like @, #, $, %), URL-encode them (e.g. @ becomes %40).');
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      console.error('👉 TIP: Network connection issue or host unreachable. If using direct connection on port 5432, ensure IPv4 is enabled or use Supabase Connection Pooler.');
    }
    process.exit(1);
  }
}

testSupabase();
