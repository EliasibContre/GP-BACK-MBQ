// src/config/supabase.js
import { createClient } from "@supabase/supabase-js";

/**
 * Limpia variables de entorno:
 * - quita BOM, CR/LF
 * - quita comillas envolventes
 * - recorta espacios invisibles
 */
function cleanEnv(value) {
  if (value === undefined || value === null) return "";

  return String(value)
    .replace(/\uFEFF/g, "")          // BOM
    .replace(/\r/g, "")              // CR
    .replace(/\n/g, "")              // LF
    .trim()
    .replace(/^"(.*)"$/, "$1")       // quita "..."
    .replace(/^'(.*)'$/, "$1")       // quita '...'
    .trim();
}

const supabaseUrl = cleanEnv(process.env.SUPABASE_URL);
const supabaseServiceKey = cleanEnv(process.env.SUPABASE_SERVICE_KEY);

if (!supabaseUrl) {
  throw new Error("❌ Faltan SUPABASE_URL en .env");
}

if (!supabaseServiceKey) {
  throw new Error("❌ Faltan SUPABASE_SERVICE_KEY en .env");
}

// Validación: JWT debe tener 3 partes
const jwtParts = supabaseServiceKey.split(".");
if (jwtParts.length !== 3) {
  throw new Error(
    "❌ SUPABASE_SERVICE_KEY inválida: no parece JWT (debe tener 3 partes separadas por '.')"
  );
}

// Debug útil (déjalo mientras pruebas, luego lo comentas)
console.log("✅ Supabase URL:", supabaseUrl);
console.log("✅ Service Key length:", supabaseServiceKey.length);
console.log("✅ JWT parts:", jwtParts.length);

// Cliente Supabase (SOLO BACKEND)
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

/**
 * Subir archivo a Supabase Storage
 * @param {string} bucket
 * @param {string} path
 * @param {Buffer|Uint8Array} fileBuffer
 * @param {string} contentType
 */
export async function uploadToSupabase(
  bucket,
  path,
  fileBuffer,
  contentType = "application/pdf"
) {
  if (!bucket || !path) {
    throw new Error("Bucket y path son requeridos para uploadToSupabase()");
  }

  const { data, error } = await supabase.storage.from(bucket).upload(path, fileBuffer, {
    contentType,
    upsert: false,
  });

  if (error) {
    throw new Error(`Error al subir archivo: ${error.message}`);
  }

  return {
    path: data.path,
    fullPath: `${bucket}/${data.path}`,
  };
}

/**
 * Eliminar archivo de Supabase Storage
 */
export async function deleteFromSupabase(bucket, path) {
  if (!bucket || !path) return;

  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) {
    throw new Error(`Error al eliminar archivo: ${error.message}`);
  }
}

/**
 * Obtener URL pública (solo si el bucket es público)
 */
export function getPublicUrl(bucket, path) {
  if (!bucket || !path) return "";
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || "";
}

/**
 * Obtener URL firmada temporal (RECOMENDADO)
 * @param {string} bucket
 * @param {string} path
 * @param {number} expiresIn - segundos (default 1 hora)
 */
export async function getSignedUrl(bucket, path, expiresIn = 3600) {
  if (!bucket || !path) {
    throw new Error("Bucket y path son requeridos para getSignedUrl()");
  }

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);

  if (error) {
    // Dejamos trazas útiles para depurar (incluye status/statusCode si existe)
    console.error("❌ Error creando URL firmada:", {
      message: error.message,
      status: error.status,
      statusCode: error.statusCode,
      name: error.name,
    });
    throw new Error(`Error al crear URL firmada: ${error.message}`);
  }

  return data?.signedUrl;
}

/**
 * Verificar si un archivo existe en Supabase Storage
 */
export async function fileExists(bucket, path) {
  if (!bucket || !path) return false;

  try {
    const dir = path.split("/").slice(0, -1).join("/");
    const filename = path.split("/").pop();

    const { data, error } = await supabase.storage.from(bucket).list(dir, {
      search: filename,
      limit: 1,
    });

    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Listar buckets (debug)
 */
export async function listBuckets() {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(`Error listBuckets: ${error.message}`);
  return data || [];
}
