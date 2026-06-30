const { Pool } = require('pg');
require('dotenv').config();

// Fix Supabase self-signed certificate issue
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Supabase requires special SSL handling
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL_POSTGRES_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.connect((err, client, release) => {
    if (err) {
        console.error('Database connection error:', err.message);
    } else {
        console.log('✅ Database connected successfully');
        release();
    }
});

module.exports = pool;
