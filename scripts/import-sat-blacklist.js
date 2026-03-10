import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import xlsx from 'xlsx';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

// Configuración
const EXCEL_FILE_PATH = process.argv[2] || 'C:\\Users\\USER\\Desktop\\Sistema\\GP-Backend\\scripts\\Listado_Completo_69-B.csv';
const BATCH_SIZE = 500;
const ADMIN_USER_ID = null; // No registrar importación si no hay usuario

// Mapeo de situaciones del SAT
const SITUATION_MAP = {
  'Presunto': 'PRESUNTO',
  'Desvirtuado': 'DESVIRTUADO',
  'Definitivo': 'DEFINITIVO',
  'Sentencia favorable': 'SENTENCIA_FAVORABLE',
  'Sentencia Favorable': 'SENTENCIA_FAVORABLE'
};

/**
 * Parsea una fecha en formato DD/MM/YYYY o similar
 */
function parseDate(dateStr) {
  if (!dateStr || dateStr === '' || dateStr === 'N/A') return null;
  
  try {
    // Si es número de Excel (serial date)
    if (typeof dateStr === 'number') {
      const date = xlsx.SSF.parse_date_code(dateStr);
      return new Date(date.y, date.m - 1, date.d);
    }
    
    // Si es string DD/MM/YYYY
    if (typeof dateStr === 'string') {
      const parts = dateStr.trim().split('/');
      if (parts.length === 3) {
        const [day, month, year] = parts.map(p => parseInt(p, 10));
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
          return new Date(year, month - 1, day);
        }
      }
    }
    
    return null;
  } catch (e) {
    console.warn('Error parseando fecha:', dateStr, e.message);
    return null;
  }
}

/**
 * Normaliza un string, devolviendo null si está vacío o es N/A
 */
function normalizeString(str) {
  if (!str || str === '' || str === 'N/A' || str.toString().trim() === '') return null;
  return str.toString().trim();
}

/**
 * Procesa una fila del Excel y la convierte al formato de SatBlacklist
 */
function processRow(row, rowIndex) {
  try {
    // Debug: Imprimir las claves de la primera fila para ver los nombres reales
    if (rowIndex === 2) {
      Object.keys(row).forEach((key, index) => {
      });
    }
    
    // Obtener las claves del objeto (columnas)
    const keys = Object.keys(row);
    
    // Mapeo por posición - la columna 0 es "Id", el RFC está en la columna 1
    const rfc = normalizeString(row[keys[1]] || row['RFC']);
    const name = normalizeString(row[keys[2]] || row['Nombre del Contribuyente']);
    const situationRaw = normalizeString(row[keys[3]] || row['Situación del contribuyente']);
    
    // Validaciones básicas - verificar que sea un RFC válido (formato: AAA010101AAA o AAAA010101AAA)
    if (!rfc) {
      return null;
    }
    
    // Verificar formato de RFC (12-13 caracteres, alfanumérico)
    const rfcPattern = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
    if (!rfcPattern.test(rfc.toUpperCase())) {
      if (rowIndex <= 5) {
        console.warn(`Fila ${rowIndex}: RFC con formato inválido: "${rfc}"`);
      }
      return null;
    }
    
    const situation = SITUATION_MAP[situationRaw] || 'PRESUNTO';
    
    // Presunción (columnas 4-7, ajustado por columna Id)
    const presuncionOficioSat = normalizeString(row[keys[4]]);
    const presuncionSatDate = parseDate(row[keys[5]]);
    const presuncionOficioDof = normalizeString(row[keys[6]]);
    const presuncionDofDate = parseDate(row[keys[7]]);
    
    // Desvirtuado (columnas 8-11)
    const desvirtuadoOficioSat = normalizeString(row[keys[8]]);
    const desvirtuadoSatDate = parseDate(row[keys[9]]);
    const desvirtuadoOficioDof = normalizeString(row[keys[10]]);
    const desvirtuadoDofDate = parseDate(row[keys[11]]);
    
    // Definitivo (columnas 12-15)
    const definitivoOficioSat = normalizeString(row[keys[12]]);
    const definitivoSatDate = parseDate(row[keys[13]]);
    const definitivoOficioDof = normalizeString(row[keys[14]]);
    const definitivoDofDate = parseDate(row[keys[15]]);
    
    // Sentencia (columnas 16-19)
    const sentenciaOficioSat = normalizeString(row[keys[16]]);
    const sentenciaSatDate = parseDate(row[keys[17]]);
    const sentenciaOficioDof = normalizeString(row[keys[18]]);
    const sentenciaDofDate = parseDate(row[keys[19]]);
    
    return {
      rfc: rfc.toUpperCase(),
      name: name || null,
      situation,
      presuncionOficioSat,
      presuncionSatDate,
      presuncionOficioDof,
      presuncionDofDate,
      desvirtuadoOficioSat,
      desvirtuadoSatDate,
      desvirtuadoOficioDof,
      desvirtuadoDofDate,
      definitivoOficioSat,
      definitivoSatDate,
      definitivoOficioDof,
      definitivoDofDate,
      sentenciaOficioSat,
      sentenciaSatDate,
      sentenciaOficioDof,
      sentenciaDofDate
    };
  } catch (error) {
    console.error(`Error procesando fila ${rowIndex}:`, error.message);
    return null;
  }
}

/**
 * Importa el archivo Excel a la base de datos
 */
async function importSatBlacklist() {
  
  // Verificar que el archivo existe
  if (!fs.existsSync(EXCEL_FILE_PATH)) {
    console.error(`❌ Error: No se encontró el archivo: ${EXCEL_FILE_PATH}`);
    process.exit(1);
  }
  
  
  // Leer el archivo Excel/CSV
  const workbook = xlsx.readFile(EXCEL_FILE_PATH);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  // Leer con la opción de rango para omitir filas vacías o de encabezado extra
  const rawData = xlsx.utils.sheet_to_json(worksheet, {
    defval: '',
    blankrows: false,
    raw: false
  });
  
  
  // Procesar filas
  const records = [];
  const errors = [];
  
  for (let i = 0; i < rawData.length; i++) {
    const processed = processRow(rawData[i], i + 2); // +2 porque Excel empieza en 1 y hay header
    if (processed) {
      records.push(processed);
    } else {
      errors.push(i + 2);
    }
  }
  
  if (errors.length > 0) {
  }
  
  if (records.length === 0) {
    console.error('\n❌ No hay registros válidos para importar');
    process.exit(1);
  }
  
  // Calcular hash del archivo
  const fileBuffer = fs.readFileSync(EXCEL_FILE_PATH);
  const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  
  // Verificar si ya se importó este archivo
  const existingImport = await prisma.satImport.findFirst({
    where: { fileHash }
  });
  
  if (existingImport) {
    
    // En ambiente no interactivo, cancelar
    if (!process.stdin.isTTY) {
      process.exit(0);
    }
  }
  
  // Insertar en lotes
  let inserted = 0;
  let skipped = 0;
  
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    
    try {
      // Usar createMany con skipDuplicates para evitar errores en RFCs duplicados
      const result = await prisma.satBlacklist.createMany({
        data: batch,
        skipDuplicates: true
      });
      
      inserted += result.count;
      skipped += batch.length - result.count;
      
      const progress = Math.min(i + BATCH_SIZE, records.length);
      process.stdout.write(`\r   Progreso: ${progress}/${records.length} (${inserted} insertados, ${skipped} duplicados)`);
    } catch (error) {
      console.error(`\n❌ Error en lote ${i / BATCH_SIZE + 1}:`, error.message);
      
      // Intentar insertar uno por uno en este lote
      for (const record of batch) {
        try {
          await prisma.satBlacklist.create({ data: record });
          inserted++;
        } catch (e) {
          if (e.code === 'P2002') {
            skipped++;
          } else {
            console.error(`   Error en RFC ${record.rfc}:`, e.message);
          }
        }
      }
    }
  }
  
  
  // Registrar la importación
  if (ADMIN_USER_ID) {
    try {
      await prisma.satImport.create({
        data: {
          filename: path.basename(EXCEL_FILE_PATH),
          fileHash,
          rows: inserted,
          loadedById: ADMIN_USER_ID
        }
      });
    } catch (e) {
      console.warn('⚠️  No se pudo registrar la importación en SatImport:', e.message);
    }
  } else {
  }
  
  // Estadísticas por situación
  const stats = await prisma.satBlacklist.groupBy({
    by: ['situation'],
    _count: true
  });
  
  stats.forEach(stat => {
  });
}

// Ejecutar
importSatBlacklist()
  .catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
