const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_URL_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_URL_SUPABASE_ANON_KEY
);

// Multer setup for memory storage (for uploads)
const upload = multer({ storage: multer.memoryStorage() });

async function uploadFile(file, bucket, path) {
    const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, file.buffer, {
            contentType: file.mimetype,
            upsert: true
        });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(data.path);

    return publicUrl;
}

module.exports = { supabase, upload, uploadFile };
