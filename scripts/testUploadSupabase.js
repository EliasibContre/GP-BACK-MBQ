import dotenv from 'dotenv';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: './.env' });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Faltan variables SUPABASE_URL o SUPABASE_SERVICE_KEY en .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function run() {
  try {
    console.log('Listando buckets...');
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    if (listError) {
      console.error('Error listando buckets:', listError.message || listError);
    } else {
      console.log('Buckets:', buckets.map(b => b.name).join(', '));
    }

    const bucket = 'provider-documents';
    const path = `test-uploads/test-${Date.now()}.txt`;
    const content = 'Prueba de upload desde script local: ' + new Date().toISOString();
    const buffer = Buffer.from(content);

    console.log(`Subiendo a bucket=${bucket} path=${path} bytes=${buffer.length}`);
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, buffer, { contentType: 'text/plain' });

    if (error) {
      console.error('Error subiendo archivo:', error.message || error);
      process.exit(1);
    }

    console.log('Upload OK, data:', data);

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
    console.log('Public URL:', urlData.publicUrl);
  } catch (e) {
    console.error('Error ejecutando testUploadSupabase:', e.message || e);
    process.exit(1);
  }
}

run();
