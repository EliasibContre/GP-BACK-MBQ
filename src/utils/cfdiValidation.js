// src/utils/cfdiValidation.js
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true, // quita cfdi: y tfd:
    trimValues: true,
});

function isUUID(s) {
    return /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89abAB][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$/.test(
        String(s || "")
    );
}

function pick(obj, key) {
    // soporto tanto "Rfc" como "RFC"
    return obj?.[`@_${key}`] ?? obj?.[`@_${key.toUpperCase()}`] ?? obj?.[`@_${key.toLowerCase()}`];
}

export function validateCfdiXml(xmlBuffer, { requireTimbre = true } = {}) {
    let json;

    try {
        const xmlText = Buffer.isBuffer(xmlBuffer) ? xmlBuffer.toString("utf8") : String(xmlBuffer || "");
        json = parser.parse(xmlText);
    } catch {
        return { ok: false, error: "XML inválido (no se pudo parsear)" };
    }

    const comprobante = json?.Comprobante;
    if (!comprobante) return { ok: false, error: "No es CFDI: falta nodo Comprobante" };

    const version = pick(comprobante, "Version");
    if (!version || (String(version) !== "4.0" && String(version) !== "3.3")) {
        return { ok: false, error: "CFDI: Version inválida (esperado 3.3 o 4.0)" };
    }

    const total = pick(comprobante, "Total");
    const subTotal = pick(comprobante, "SubTotal");
    const fecha = pick(comprobante, "Fecha");
    if (!total || !subTotal || !fecha) {
        return { ok: false, error: "CFDI incompleto: faltan Total/SubTotal/Fecha" };
    }

    const emisor = comprobante?.Emisor;
    const receptor = comprobante?.Receptor;
    const rfcEmisor = pick(emisor, "Rfc");
    const rfcReceptor = pick(receptor, "Rfc");
    if (!rfcEmisor || !rfcReceptor) {
        return { ok: false, error: "CFDI incompleto: faltan RFC de Emisor/Receptor" };
    }

    const tfd = comprobante?.Complemento?.TimbreFiscalDigital;
    const uuid = pick(tfd, "UUID");

    if (requireTimbre) {
        if (!uuid) return { ok: false, error: "CFDI sin timbre: falta UUID" };
        if (!isUUID(uuid)) return { ok: false, error: "UUID inválido" };
    }

    return {
        ok: true,
        data: {
            version: String(version),
            uuid: uuid || null,
            rfcEmisor: String(rfcEmisor).toUpperCase(),
            rfcReceptor: String(rfcReceptor).toUpperCase(),
            total: String(total),
            fecha: String(fecha),
        },
    };
}