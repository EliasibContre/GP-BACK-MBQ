import crypto from "crypto";
import { prisma } from "../config/prisma.js";
import { supabase } from "../config/supabase.js";
import { logAudit } from "../utils/audit.js";

const BUCKET = process.env.PAYMENT_EVIDENCE_BUCKET || "payment-evidence";
const SIGNED_URL_EXPIRES = Number(process.env.SIGNED_URL_EXPIRES || 3600);

function safeFileName(name = "archivo") {
    return String(name).replace(/[^\w\-\.]+/g, "_").slice(0, 120);
}

function kindFromFile({ mimeType, fileName, kind }) {
    if (kind) return String(kind).toUpperCase();
    const n = String(fileName || "").toLowerCase();
    if (n.endsWith(".pdf")) return "PDF";
    if (n.endsWith(".xml")) return "XML";
    if (mimeType === "application/pdf") return "PDF";
    if (mimeType === "application/xml" || mimeType === "text/xml") return "XML";
    return "OTHER";
}

async function ensurePaymentExists(paymentId) {
    const p = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p) {
        const e = new Error("Payment no encontrado");
        e.status = 404;
        throw e;
    }
    return p;
}

// POST /api/payments/:paymentId/evidence
export async function uploadPaymentEvidence(req, res) {
    const paymentId = Number(req.params.paymentId);
    if (!Number.isFinite(paymentId)) {
        return res.status(400).json({ message: "paymentId inválido" });
    }

    const userId = req.user?.id ?? null;
    const file = req.file;
    const { comment, kind } = req.body;

    if (!file) return res.status(400).json({ message: "Archivo requerido" });

    await ensurePaymentExists(paymentId);

    const fileName = safeFileName(file.originalname);
    const mimeType = file.mimetype;
    const sizeBytes = file.size;

    const evidenceKind = kindFromFile({ mimeType, fileName, kind });

    const sha256 = crypto.createHash("sha256").update(file.buffer).digest("hex");
    const ext = fileName.includes(".") ? fileName.split(".").pop() : "bin";
    const unique = crypto.randomBytes(10).toString("hex");

    const path = `payments/${paymentId}/${evidenceKind}/${Date.now()}_${unique}.${ext}`;

    const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file.buffer, { contentType: mimeType, upsert: false });

    if (upErr) {
        return res.status(500).json({ message: "Error al subir evidencia", detail: upErr.message });
    }

    // versionado por kind (activo)
    const last = await prisma.paymentEvidence.findFirst({
        where: { paymentId, kind: evidenceKind, isActive: true },
        orderBy: { version: "desc" },
        select: { version: true },
    });
    const version = (last?.version || 0) + 1;

    // desactiva anterior del mismo kind
    await prisma.paymentEvidence.updateMany({
        where: { paymentId, kind: evidenceKind, isActive: true },
        data: { isActive: false },
    });

    const created = await prisma.paymentEvidence.create({
        data: {
            paymentId,
            uploadedById: userId,
            kind: evidenceKind,
            bucket: BUCKET,
            path,
            fileName,
            mimeType,
            sizeBytes,
            sha256,
            version,
            isActive: true,
            comment: comment || null,
        },
    });

    await logAudit(prisma, {
        action: "payment.evidence.upload",
        entity: "PaymentEvidence",
        entityId: created.id,
        userId,
        metadata: { paymentId, kind: evidenceKind, fileName, path, version },
    });

    return res.status(201).json(created);
}

// GET /api/payments/:paymentId/evidence
export async function listPaymentEvidence(req, res) {
    const paymentId = Number(req.params.paymentId);
    if (!Number.isFinite(paymentId)) {
        return res.status(400).json({ message: "paymentId inválido" });
    }

    await ensurePaymentExists(paymentId);

    const rows = await prisma.paymentEvidence.findMany({
        where: { paymentId },
        orderBy: [{ kind: "asc" }, { version: "desc" }, { createdAt: "desc" }],
    });

    return res.json(rows);
}

// GET /api/evidence/:id/signed-url?download=1
export async function getEvidenceSignedUrl(req, res) {
    const { id } = req.params;
    const download = String(req.query.download || "0") === "1";

    const row = await prisma.paymentEvidence.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ message: "Evidencia no encontrada" });

    const opts = download ? { download: row.fileName } : undefined;

    const { data, error } = await supabase.storage
        .from(row.bucket)
        .createSignedUrl(row.path, SIGNED_URL_EXPIRES, opts);

    if (error) return res.status(500).json({ message: "Error al firmar URL", detail: error.message });

    return res.json({ url: data.signedUrl, expires: SIGNED_URL_EXPIRES });
}