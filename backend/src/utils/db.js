const { Pool } = require('pg');
require('dotenv').config();

// Fix Supabase self-signed certificate issue
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Optimized PostgreSQL Pool Configuration
const pool = new Pool({
    connectionString: (process.env.DATABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL_POSTGRES_URL)
        ?.replace(':5432/', ':6543/') // Use PgBouncer port
        ?.concat('?pgbouncer=true'), // Enable transaction pooling mode
    ssl: {
        rejectUnauthorized: false
    },
    // Optimized pool config for Vercel serverless
    max: 5, // Smaller pool for stateless serverless
    min: 0, // No persistent idle connections
    connectionTimeoutMillis: 5000, // Fail faster
    idleTimeoutMillis: 10000, // Recycle connections faster
    statement_timeout: 30000 // Max 30 seconds per query
});

pool.on('connect', () => {
    console.log('✅ New database connection established');
});

pool.on('error', (err) => {
    console.error('❌ Unexpected database pool error:', err.message);
    process.exit(-1);
});

// Test connection on startup
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Failed to connect to database:', err.message);
    } else {
        console.log('✅ Database connected successfully');
        release();
    }
});

module.exports = pool;
