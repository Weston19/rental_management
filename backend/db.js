const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.NEXT_PUBLIC_SUPABASE_URL_POSTGRES_USER,
    password: process.env.NEXT_PUBLIC_SUPABASE_URL_POSTGRES_PASSWORD,
    host: process.env.NEXT_PUBLIC_SUPABASE_URL_POSTGRES_HOST,
    port: 5432,
    database: process.env.NEXT_PUBLIC_SUPABASE_URL_POSTGRES_DATABASE,
    ssl: {
        rejectUnauthorized: false
    }
});

// Test connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Database connection error:', err.message);
    } else {
        console.log('✅ Database connected successfully');
        release();
    }
});

module.exports = pool;