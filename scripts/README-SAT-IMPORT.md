# Importación de Lista Negra del SAT

Este script permite importar la lista negra del SAT desde un archivo Excel a la base de datos.

## Requisitos

1. Instalar la dependencia `xlsx`:
```bash
npm install xlsx
```

2. Tener un archivo Excel con la lista del SAT (generalmente descargado desde el portal oficial del SAT)

## Estructura esperada del Excel

El script espera un archivo Excel con las siguientes columnas (pueden variar los nombres exactos):

| Columna | Campo en BD | Ejemplo |
|---------|-------------|---------|
| RFC | `rfc` | ABC123456XYZ |
| Nombre del contribuyente | `name` | EMPRESA EJEMPLO SA DE CV |
| Situación del contribuyente | `situation` | Definitivo |
| Presunción - Oficio SAT | `presuncionOficioSat` | 500-05-00-00-00-2024-12345 |
| Presunción - Fecha | `presuncionSatDate` | 15/01/2024 |
| Presunción - DOF | `presuncionOficioDof` | DOF-2024-001 |
| Presunción - Publicación DOF | `presuncionDofDate` | 20/01/2024 |
| (Similar para Desvirtuado, Definitivo y Sentencia) | | |

## Uso

### Opción 1: Usar el nombre por defecto
```bash
# Coloca tu archivo Excel como "lista-negra-sat.xlsx" en la raíz del backend
node scripts/import-sat-blacklist.js
```

### Opción 2: Especificar ruta del archivo
```bash
node scripts/import-sat-blacklist.js /ruta/a/tu/archivo.xlsx
```

### Opción 3: Archivo en otra carpeta
```bash
node scripts/import-sat-blacklist.js "C:\Users\USER\Downloads\lista-sat-2024.xlsx"
```

## Configuración

### Cambiar el ID del usuario administrador
Edita la línea 11 del script:
```javascript
const ADMIN_USER_ID = 1; // Cambia esto por el ID de tu usuario admin
```

### Ajustar tamaño de lotes
Si tienes problemas de memoria o timeouts, reduce el tamaño del lote (línea 12):
```javascript
const BATCH_SIZE = 500; // Reduce a 100 o 250 si hay problemas
```

## Características

✅ **Detección de duplicados**: Salta automáticamente RFCs que ya existen en la BD
✅ **Hash de archivo**: Detecta si el mismo archivo Excel ya fue importado
✅ **Procesamiento por lotes**: Importación rápida incluso con miles de registros
✅ **Manejo de errores**: Continúa la importación aunque algunas filas tengan errores
✅ **Estadísticas**: Muestra resumen detallado al final
✅ **Auditoría**: Registra la importación en la tabla `SatImport`

## Mapeo de Situaciones

El script mapea automáticamente los valores del Excel a los enums de Prisma:

| Excel | BD (enum SATSituation) |
|-------|------------------------|
| Presunto | PRESUNTO |
| Desvirtuado | DESVIRTUADO |
| Definitivo | DEFINITIVO |
| Sentencia favorable | SENTENCIA_FAVORABLE |

## Formato de Fechas

El script soporta:
- Fechas de Excel (número serial)
- Formato DD/MM/YYYY
- Strings compuestos como "Oficio: XXX, Fecha: 15/01/2024"

## Ejemplo de salida

```
╔════════════════════════════════════════════════════════════╗
║  IMPORTACIÓN DE LISTA NEGRA DEL SAT                       ║
╚════════════════════════════════════════════════════════════╝

📂 Archivo: C:\Users\USER\Desktop\lista-negra-sat.xlsx
📖 Leyendo archivo Excel...
✅ 15234 filas encontradas en la hoja "Hoja1"

⚙️  Procesando datos...
✅ 15180 registros válidos
⚠️  54 filas con errores: 2, 45, 67, 89, 123...

💾 Insertando en base de datos...
   Progreso: 15180/15180 (15180 insertados, 0 duplicados)

╔════════════════════════════════════════════════════════════╗
║  RESUMEN DE IMPORTACIÓN                                    ║
╠════════════════════════════════════════════════════════════╣
║  ✅ Registros insertados:    15180                         ║
║  ⏭️  Registros duplicados:    0                            ║
║  ⚠️  Filas con errores:       54                           ║
╚════════════════════════════════════════════════════════════╝

📊 Distribución por situación:
   DEFINITIVO: 12340
   PRESUNTO: 2100
   DESVIRTUADO: 540
   SENTENCIA_FAVORABLE: 200

✨ Importación completada exitosamente
```

## Solución de problemas

### "No se encontró el archivo"
- Verifica la ruta del archivo
- Usa rutas absolutas si estás en otra carpeta
- En Windows, usa comillas si la ruta tiene espacios

### "Error parseando fecha"
- Revisa que las columnas de fecha tengan formato correcto
- El script imprime advertencias por cada fecha inválida
- Las fechas inválidas se guardan como `null`

### "Error: P2002 (Unique constraint)"
- El RFC ya existe en la base de datos
- El script salta estos registros automáticamente

### "Transaction timeout"
- Reduce `BATCH_SIZE` a un valor menor (100 o 250)
- Verifica tu conexión a la base de datos

## Actualizar la lista

Para actualizar con una nueva lista del SAT:

1. Descarga el nuevo Excel del SAT
2. Ejecuta el script con el nuevo archivo
3. Los RFCs nuevos se insertarán
4. Los RFCs existentes se saltarán (no se actualizan)

Si necesitas **reemplazar** toda la lista:
```bash
# Borra toda la tabla primero (¡CUIDADO!)
npx prisma db execute --sql "TRUNCATE TABLE \"SatBlacklist\" RESTART IDENTITY CASCADE"

# Luego importa
node scripts/import-sat-blacklist.js nuevo-archivo.xlsx
```

## Notas importantes

⚠️ **El script NO actualiza registros existentes**, solo inserta nuevos
⚠️ **Verifica el mapeo de columnas** si tu Excel tiene nombres diferentes
⚠️ **Prueba primero con un Excel pequeño** (10-20 filas) para verificar el mapeo
