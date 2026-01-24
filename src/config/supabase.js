import { createClient } from '@supabase/supabase-js';

// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY; // Service role key (server-side only)

if (!supabaseUrl || !supabaseServiceKey) {
}

// Cliente de Supabase con service role (bypass RLS)
export const supabase = supabaseUrl && supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

/**
 * Subir archivo a Supabase Storage
 * @param {string} bucket - Nombre del bucket ('purchase-orders', 'invoices', 'provider-documents')
 * @param {string} path - Ruta dentro del bucket (ej: 'provider-123/doc.pdf')
 * @param {Buffer} fileBuffer - Contenido del archivo
 * @param {string} contentType - MIME type (ej: 'application/pdf')
 * @returns {Promise<{url: string, path: string}>}
 */
export async function uploadToSupabase(bucket, path, fileBuffer, contentType = 'application/pdf') {
  if (!supabase) {
    throw new Error('Supabase no está configurado. Verifica las variables de entorno SUPABASE_URL y SUPABASE_SERVICE_KEY');
  }

  // Subir archivo
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, fileBuffer, {
      contentType,
      upsert: false // No sobrescribir si existe
    });

  if (error) {
    throw new Error(`Error al subir archivo: ${error.message}`);
  }

  // Obtener URL pública
  const { data: urlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(path);

  return {
    url: urlData.publicUrl,
    path: data.path,
    fullPath: `${bucket}/${data.path}`
  };
}

/**
 * Eliminar archivo de Supabase Storage
 * @param {string} bucket - Nombre del bucket
 * @param {string} path - Ruta del archivo en el bucket
 */
export async function deleteFromSupabase(bucket, path) {
  if (!supabase) {
    console.warn('Supabase no configurado. No se puede eliminar archivo.');
    return;
  }

  const { error } = await supabase.storage
    .from(bucket)
    .remove([path]);

  if (error) {
    throw new Error(`Error al eliminar archivo: ${error.message}`);
  }
}

/**
 * Obtener URL pública de un archivo
 * @param {string} bucket - Nombre del bucket
 * @param {string} path - Ruta del archivo
 * @returns {string}
 */
export function getPublicUrl(bucket, path) {
  if (!supabase) {
    return `/uploads/${bucket}/${path}`; // Fallback a URL local
  }

  const { data } = supabase.storage
    .from(bucket)
    .getPublicUrl(path);

  return data.publicUrl;
}

/**
 * Obtener URL firmada temporal (para archivos privados)
 * @param {string} bucket - Nombre del bucket
 * @param {string} path - Ruta del archivo
 * @param {number} expiresIn - Tiempo de expiración en segundos (default: 1 hora)
 * @returns {Promise<string>}
 */
export async function getSignedUrl(bucket, path, expiresIn = 3600) {
  if (!supabase) {
    return `/uploads/${bucket}/${path}`; // Fallback
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error) {
    console.error('Error creando URL firmada:', error);
    throw new Error(`Error al crear URL firmada: ${error.message}`);
  }

  return data.signedUrl;
}

/**
 * Verificar si un archivo existe en Supabase Storage
 * @param {string} bucket - Nombre del bucket
 * @param {string} path - Ruta del archivo
 * @returns {Promise<boolean>}
 */
export async function fileExists(bucket, path) {
  if (!supabase) return false;

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(path.split('/').slice(0, -1).join('/'), {
        search: path.split('/').pop()
      });

    return !error && data && data.length > 0;
  } catch (e) {
    return false;
  }
}
