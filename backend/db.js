const { Pool } = require('pg');
require('dotenv').config();

console.log('🔍 DB Connection string (partial):', process.env.NEXT_PUBLIC_SUPABASE_URL_POSTGRES_URL ? process.env.NEXT_PUBLIC_SUPABASE_URL_POSTGRES_URL.substring(0, 50) + '...' : 'NOT FOUND!');

const pool = new Pool({
    connectionString: process.env.NEXT_PUBLIC_SUPABASE_URL_POSTGRES_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Test connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Database connection error:', err.message);
        console.error('❌ Full error:', err);
    } else {
        console.log('✅ Database connected successfully');
        release();
    }
});

module.exports = pool;