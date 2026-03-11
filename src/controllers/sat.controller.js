// src/controllers/sat.controller.js
import crypto from "crypto";
import XLSX from "xlsx";
import { prisma } from "../config/prisma.js";
import { uploadToSupabase } from "../config/supabase.js";

const DEFAULT_BUCKET = process.env.SAT_BLACKLIST_BUCKET || "sat-lists";

/**
 * Normaliza headers para compararlos aunque cambien acentos, puntos, etc.
 */
function normalizeHeader(s = "") {
    return String(s || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/**
 * Intenta detectar una columna por sinónimos.
 * Regresa la key normalizada que exista en idx, o null.
 */
function resolveColumn(idx, candidates) {
    for (const c of candidates) {
        const key = normalizeHeader(c);
        if (idx[key] !== undefined) return key;
    }
    return null;
}

function getCell(row, idx, key) {
    if (!key) return "";
    const i = idx[key];
    if (i === undefined) return "";
    return row?.[i] ?? "";
}

/**
 * Parse flexible de fechas desde texto:
 * - dd/mm/yyyy, dd-mm-yyyy
 * - yyyy-mm-dd
 * Si no se puede, regresa null.
 */
function pickDateFromText(text) {
    const s = String(text || "").trim();

    // dd/mm/yyyy o dd-mm-yyyy
    let m = s.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (m) {
        const dd = Number(m[1]);
        const mm = Number(m[2]);
        const yyyy = Number(m[3]);
        const d = new Date(Date.UTC(yyyy, mm - 1, dd));
        return isNaN(d.getTime()) ? null : d;
    }

    // yyyy-mm-dd
    m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
        const yyyy = Number(m[1]);
        const mm = Number(m[2]);
        const dd = Number(m[3]);
        const d = new Date(Date.UTC(yyyy, mm - 1, dd));
        return isNaN(d.getTime()) ? null : d;
    }

    return null;
}

/**
 * Mapea situación a tu enum SATSituation:
 * PRESUNTO | DESVIRTUADO | DEFINITIVO | SENTENCIA_FAVORABLE
 */
function detectSituacion(raw) {
    const v = String(raw || "")
        .trim()
        .toUpperCase();
    if (v.includes("DEFINIT")) return "DEFINITIVO";
    if (v.includes("DESVIR")) return "DESVIRTUADO";
    if (v.includes("SENTEN")) return "SENTENCIA_FAVORABLE";
    if (v.includes("PRESUN")) return "PRESUNTO";
    // fallback seguro
    return "PRESUNTO";
}

/**
 * Lee CSV/XLSX/XLS a matriz [ [header...], [row...], ...]
 */
function readRowsFromBuffer(buffer, originalname) {
    const isCSV = /\.csv$/i.test(originalname);
    let wb;

    if (isCSV) {
        // SAT muchas veces viene en latin1/Windows-1252
        let text = buffer.toString("utf8");
        const suspicious = text.includes("�") || text.includes("\u0000");
        if (suspicious) text = buffer.toString("latin1");
        wb = XLSX.read(text, { type: "string" });
    } else {
        wb = XLSX.read(buffer, { type: "buffer" });
    }

    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
}

/**
 * Encuentra la fila de headers (donde exista RFC) y crea un idx:
 * idx["rfc"] = 0, idx["nombre del contribuyente"] = 1, ...
 */
function buildHeaderIndex(rows) {
    const headerRowIndex = rows.findIndex(
        (r) => Array.isArray(r) && r.some((cell) => normalizeHeader(cell) === "rfc")
    );

    if (headerRowIndex === -1) return { headerRowIndex: -1, idx: {} };

    const headerRow = rows[headerRowIndex];
    const idx = {};
    headerRow.forEach((h, i) => {
        const key = normalizeHeader(h);
        if (key) idx[key] = i;
    });

    return { headerRowIndex, idx };
}

/**
 *  Path fijo "latest" (SIN acumulaciones)
 * Guarda siempre el último archivo importado. Sobrescribe por extensión.
 * Ej:
 *  imports/sat-blacklist/latest.xlsx
 *  imports/sat-blacklist/latest.csv
 */
function latestSatKey(originalname) {
    const m = String(originalname || "")
        .toLowerCase()
        .match(/\.(csv|xlsx|xls)$/);
    const ext = m?.[1] || "xlsx";
    return `imports/sat-blacklist/latest.${ext}`;
}

export async function importSatBlacklist(req, res) {
    try {
        if (!req.file) return res.status(400).json({ message: "Falta archivo (field: file)" });
        if (!req.user?.id) return res.status(401).json({ message: "No autenticado" });

        const { originalname, buffer, mimetype } = req.file;

        // 0) Validar extensión
        const extOk = /\.(csv|xlsx|xls)$/i.test(originalname);
        if (!extOk) return res.status(400).json({ message: "Formato inválido. Usa CSV/XLSX/XLS." });

        // 1) Hash para dedupe (evita reprocesar si es idéntico al último import)
        const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

        const last = await prisma.satImport.findFirst({ orderBy: { createdAt: "desc" } });
        if (last?.fileHash === fileHash) {
            return res.json({
                ok: true,
                message: "Archivo idéntico al último import. Sin cambios.",
                importId: last.id,
            });
        }

        // 2) (Opcional) subir a storage SIN acumulaciones (latest + upsert=true)
        // Si storage falla, NO tumbo el import: solo aviso.
        try {
            const bucket = DEFAULT_BUCKET;
            const storagePath = latestSatKey(originalname);

            await uploadToSupabase(bucket, storagePath, buffer, {
                contentType: mimetype || "application/octet-stream",
                upsert: true, //  reemplaza, no acumula
            });

        } catch (e) {
            console.warn("[SAT IMPORT] Storage upload failed:", e?.message || e);
        }

        // 3) Crear registro SatImport ANTES de usarlo (evita "importRow before initialization")
        const importRow = await prisma.satImport.create({
            data: {
                filename: originalname,
                fileHash,
                rows: 0,
                loadedById: req.user.id,
            },
        });

        // 4) Parsear
        const rows = readRowsFromBuffer(buffer, originalname);
        const { headerRowIndex, idx } = buildHeaderIndex(rows);

        if (headerRowIndex === -1) {
            await prisma.satImport.update({ where: { id: importRow.id }, data: { rows: 0 } });
            return res.status(400).json({ message: "No se detectó encabezado con columna RFC" });
        }

        // 5) Resolver columnas (sinónimos para sobrevivir a 2026)
        const colRFC = resolveColumn(idx, ["rfc", "r.f.c."]);

        const colName = resolveColumn(idx, [
            "nombre del contribuyente",
            "razon social",
            "denominacion o razon social",
            "denominacion/razon social",
            "nombre",
        ]);

        const colSit = resolveColumn(idx, [
            "situacion del contribuyente",
            "situacion",
            "estatus",
            "estado",
            "situacion fiscal",
        ]);

        // Opcionales
        const colPresSat = resolveColumn(idx, [
            "presuncion oficio sat",
            "presuncion oficio",
            "numero y fecha de oficio global de presuncion sat",
        ]);
        const colPresSatDate = resolveColumn(idx, ["presuncion sat fecha", "fecha presuncion sat"]);
        const colPresDof = resolveColumn(idx, [
            "presuncion oficio dof",
            "numero y fecha de oficio global de presuncion dof",
        ]);
        const colPresDofDate = resolveColumn(idx, ["presuncion dof fecha", "fecha presuncion dof"]);

        const colDesvSat = resolveColumn(idx, ["desvirtuado oficio sat", "desvirtuado sat oficio"]);
        const colDesvSatDate = resolveColumn(idx, ["desvirtuado sat fecha", "fecha desvirtuado sat"]);
        const colDesvDof = resolveColumn(idx, ["desvirtuado oficio dof", "desvirtuado dof oficio"]);
        const colDesvDofDate = resolveColumn(idx, ["desvirtuado dof fecha", "fecha desvirtuado dof"]);

        const colDefSat = resolveColumn(idx, ["definitivo oficio sat", "definitivo sat oficio"]);
        const colDefSatDate = resolveColumn(idx, ["definitivo sat fecha", "fecha definitivo sat"]);
        const colDefDof = resolveColumn(idx, ["definitivo oficio dof", "definitivo dof oficio"]);
        const colDefDofDate = resolveColumn(idx, ["definitivo dof fecha", "fecha definitivo dof"]);

        const colSenSat = resolveColumn(idx, ["sentencia oficio sat", "sentencia sat oficio"]);
        const colSenSatDate = resolveColumn(idx, ["sentencia sat fecha", "fecha sentencia sat"]);
        const colSenDof = resolveColumn(idx, ["sentencia oficio dof", "sentencia dof oficio"]);
        const colSenDofDate = resolveColumn(idx, ["sentencia dof fecha", "fecha sentencia dof"]);

        const dataRows = rows.slice(headerRowIndex + 1);

        // 6) Construir payload + conteo de duplicados REAL
        const payload = [];
        const rfcs = [];

        for (const r of dataRows) {
            if (!Array.isArray(r)) continue;

            const rfc = String(getCell(r, idx, colRFC)).trim().toUpperCase();
            if (!rfc) continue;

            rfcs.push(rfc);

            const name = String(getCell(r, idx, colName)).trim() || null;
            const situation = detectSituacion(getCell(r, idx, colSit));

            payload.push({
                rfc,
                name,
                situation,

                presuncionOficioSat: String(getCell(r, idx, colPresSat)).trim() || null,
                presuncionSatDate: pickDateFromText(getCell(r, idx, colPresSatDate)),

                presuncionOficioDof: String(getCell(r, idx, colPresDof)).trim() || null,
                presuncionDofDate: pickDateFromText(getCell(r, idx, colPresDofDate)),

                desvirtuadoOficioSat: String(getCell(r, idx, colDesvSat)).trim() || null,
                desvirtuadoSatDate: pickDateFromText(getCell(r, idx, colDesvSatDate)),

                desvirtuadoOficioDof: String(getCell(r, idx, colDesvDof)).trim() || null,
                desvirtuadoDofDate: pickDateFromText(getCell(r, idx, colDesvDofDate)),

                definitivoOficioSat: String(getCell(r, idx, colDefSat)).trim() || null,
                definitivoSatDate: pickDateFromText(getCell(r, idx, colDefSatDate)),

                definitivoOficioDof: String(getCell(r, idx, colDefDof)).trim() || null,
                definitivoDofDate: pickDateFromText(getCell(r, idx, colDefDofDate)),

                sentenciaOficioSat: String(getCell(r, idx, colSenSat)).trim() || null,
                sentenciaSatDate: pickDateFromText(getCell(r, idx, colSenSatDate)),

                sentenciaOficioDof: String(getCell(r, idx, colSenDof)).trim() || null,
                sentenciaDofDate: pickDateFromText(getCell(r, idx, colSenDofDate)),
            });
        }

        const uniqueRfcs = new Set(rfcs);
        const duplicatesInFile = rfcs.length - uniqueRfcs.size;

        // 7) Guardar SIN transaction (evita P2028 por timeout)
        // ⚠️ OJO: esto borra toda la tabla. Está perfecto si solo manejas UNA lista (69-B completa).
        await prisma.satBlacklist.deleteMany();

        // createMany por chunks
        const chunkSize = 1500;
        let inserted = 0;

        for (let i = 0; i < payload.length; i += chunkSize) {
            const chunk = payload.slice(i, i + chunkSize);
            const r = await prisma.satBlacklist.createMany({ data: chunk, skipDuplicates: true });
            inserted += r.count;
        }

        // 8) Actualizar satImport
        await prisma.satImport.update({
            where: { id: importRow.id },
            data: { rows: inserted },
        });

        return res.json({
            ok: true,
            message: "Importación SAT completada",
            importId: importRow.id,
            totalParsed: payload.length,
            inserted,
            uniqueRfcs: uniqueRfcs.size,
            duplicatesInFile,
            skippedBecauseDuplicateOrConflict: Math.max(0, payload.length - inserted),
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            message: "Error importando blacklist SAT",
            detail: err?.message,
        });
    }
}

export async function quickCheckRfc(req, res) {
    try {
        const rfc = String(req.params.rfc || "").trim().toUpperCase();
        if (!rfc) return res.status(400).json({ message: "RFC requerido" });

        const row = await prisma.satBlacklist.findUnique({ where: { rfc } });

        if (!row) return res.json({ found: false, rfc });

        return res.json({
            found: true,
            rfc,
            situation: row.situation,
            name: row.name,
            data: row,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Error verificando RFC", detail: err?.message });
    }
}