// src/utils/contractSignatureDetector.js
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";

class NodeCanvasFactory {
    create(width, height) {
        const w = Math.max(1, Math.floor(width));
        const h = Math.max(1, Math.floor(height));
        const canvas = createCanvas(w, h);
        const context = canvas.getContext("2d");
        return { canvas, context };
    }

    reset(canvasAndContext, width, height) {
        if (!canvasAndContext?.canvas) return;
        canvasAndContext.canvas.width = Math.max(1, Math.floor(width));
        canvasAndContext.canvas.height = Math.max(1, Math.floor(height));
    }

    destroy(canvasAndContext) {
        if (!canvasAndContext?.canvas) return;
        canvasAndContext.canvas.width = 0;
        canvasAndContext.canvas.height = 0;
        canvasAndContext.canvas = null;
        canvasAndContext.context = null;
    }
}

function clamp01(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
}

function clampInt(value, fallback, min = 1) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, n);
}

/**
 * Detecta si hay indicios visuales de firma manuscrita
 * en la zona final de la ÚLTIMA página del contrato.
 *
 * No valida autenticidad legal. Solo presencia visual de trazo.
 */
export async function detectContractSignature(pdfBuffer, opts = {}) {
    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
        throw new Error("Buffer de PDF inválido para analizar firma");
    }

    const options = {
        scale: Number(opts.scale ?? 2.2),

        // Región a analizar en la última página:
        // ajustada a "zona final" y priorizando lado derecho
        // donde suele firmar el prestador/proveedor.
        regionTopRatio: clamp01(opts.regionTopRatio, 0.68),
        regionBottomRatio: clamp01(opts.regionBottomRatio, 0.93),
        regionLeftRatio: clamp01(opts.regionLeftRatio, 0.46),
        regionRightRatio: clamp01(opts.regionRightRatio, 0.97),

        // Heurísticos
        darkPixelThreshold: clampInt(opts.darkPixelThreshold, 165, 1),
        minInkRatio: Number(opts.minInkRatio ?? 0.0045),     // 0.45%
        minActiveRows: clampInt(opts.minActiveRows, 12, 1),
        minActiveCols: clampInt(opts.minActiveCols, 40, 1),
        minDarkPixels: clampInt(opts.minDarkPixels, 650, 1),
    };

    let pdf = null;
    const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(pdfBuffer),
        useWorkerFetch: false,
        isEvalSupported: false,
        useSystemFonts: true,
        verbosity: 0,
    });

    try {
        pdf = await loadingTask.promise;

        if (!pdf?.numPages) {
            throw new Error("No se pudo leer el PDF del contrato");
        }

        const lastPageNumber = pdf.numPages;
        const page = await pdf.getPage(lastPageNumber);

        const viewport = page.getViewport({ scale: options.scale });
        const canvasFactory = new NodeCanvasFactory();
        const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);

        try {
            const renderContext = {
                canvasContext: canvasAndContext.context,
                viewport,
                canvasFactory,
            };

            const renderTask = page.render(renderContext);
            await renderTask.promise;

            const pngBuffer = canvasAndContext.canvas.toBuffer("image/png");

            const image = sharp(pngBuffer).greyscale().normalise();

            const meta = await image.metadata();
            const width = Number(meta.width || 0);
            const height = Number(meta.height || 0);

            if (!width || !height) {
                throw new Error("No se pudo obtener tamaño de la imagen del PDF");
            }

            const left = Math.max(0, Math.floor(width * options.regionLeftRatio));
            const top = Math.max(0, Math.floor(height * options.regionTopRatio));
            const right = Math.min(width, Math.floor(width * options.regionRightRatio));
            const bottom = Math.min(height, Math.floor(height * options.regionBottomRatio));

            const regionWidth = Math.max(1, right - left);
            const regionHeight = Math.max(1, bottom - top);

            const { data, info } = await image
                .extract({
                    left,
                    top,
                    width: regionWidth,
                    height: regionHeight,
                })
                .raw()
                .toBuffer({ resolveWithObject: true });

            const channels = Number(info.channels || 1);
            const totalPixels = info.width * info.height;

            let darkPixels = 0;
            const rowDarkCounts = new Array(info.height).fill(0);
            const colDarkCounts = new Array(info.width).fill(0);

            for (let y = 0; y < info.height; y++) {
                for (let x = 0; x < info.width; x++) {
                    const idx = (y * info.width + x) * channels;
                    const gray = data[idx]; // greyscale => primer canal

                    if (gray < options.darkPixelThreshold) {
                        darkPixels++;
                        rowDarkCounts[y]++;
                        colDarkCounts[x]++;
                    }
                }
            }

            const inkRatio = totalPixels > 0 ? darkPixels / totalPixels : 0;

            // Filtro para evitar ruido mínimo y texto muy pequeño
            const rowActivationThreshold = Math.max(2, Math.floor(info.width * 0.01));
            const colActivationThreshold = Math.max(2, Math.floor(info.height * 0.02));

            const activeRows = rowDarkCounts.filter((n) => n >= rowActivationThreshold).length;
            const activeCols = colDarkCounts.filter((n) => n >= colActivationThreshold).length;

            const detected =
                darkPixels >= options.minDarkPixels &&
                inkRatio >= options.minInkRatio &&
                activeRows >= options.minActiveRows &&
                activeCols >= options.minActiveCols;

            return {
                detected,
                pageAnalyzed: lastPageNumber,
                region: {
                    left,
                    top,
                    width: regionWidth,
                    height: regionHeight,
                    pageWidth: width,
                    pageHeight: height,
                    ratios: {
                        top: options.regionTopRatio,
                        bottom: options.regionBottomRatio,
                        left: options.regionLeftRatio,
                        right: options.regionRightRatio,
                    },
                },
                metrics: {
                    darkPixels,
                    totalPixels,
                    inkRatio: Number(inkRatio.toFixed(6)),
                    activeRows,
                    activeCols,
                    darkPixelThreshold: options.darkPixelThreshold,
                    minInkRatio: options.minInkRatio,
                    minActiveRows: options.minActiveRows,
                    minActiveCols: options.minActiveCols,
                    minDarkPixels: options.minDarkPixels,
                },
            };
        } finally {
            canvasFactory.destroy(canvasAndContext);
        }
    } finally {
        try {
            await loadingTask.destroy();
        } catch {
            // noop
        }
        try {
            if (pdf) await pdf.destroy();
        } catch {
            // noop
        }
    }
}