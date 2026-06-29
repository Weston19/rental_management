const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.NEXT_PUBLIC_SUPABASE_URL_POSTGRES_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Test connection
pool.connect((err, client, release) => {
    if (err) {
        console.error(' Database connection error:', err.message);
    } else {
        console.log(' Database connected successfully');
        release();
    }
});

module.exports = pool;