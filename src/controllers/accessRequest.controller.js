// src/controllers/accessRequest.controller.js

import {
  createAccessRequest,
  listAccessRequests,
  getAccessRequest,
  decideAccessRequest,
} from "../services/accessRequest.service.js";

import { asyncHandler } from "../utils/asyncHandler.js";
import { requireRole } from "../middlewares/requireRole.js"; // si lo usas en routes

// -----------------------
// Helpers
// -----------------------
const STATUS_MAP = {
  pending: "PENDING",
  approved: "APPROVED",
  rejected: "REJECTED",
};

function normalizeStatus(raw) {
  if (!raw) return undefined;

  const s = String(raw).trim();
  if (!s) return undefined;

  // Acepta pending/approved/rejected y también PENDING etc.
  const normalized = STATUS_MAP[s.toLowerCase()] ?? s.toUpperCase();

  // Ajusta si tu enum tiene más valores
  const allowed = ["PENDING", "APPROVED", "REJECTED"];
  if (!allowed.includes(normalized)) {
    const err = new Error(`Status inválido: ${raw}`);
    err.status = 400;
    throw err;
  }

  return normalized;
}

function toIntOrUndef(v) {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// -----------------------
// Controllers
// -----------------------
export const createAccessRequestCtrl = asyncHandler(async (req, res) => {
  const result = await createAccessRequest(req.body || {});
  res.status(201).json(result);
});

export const listAccessRequestsCtrl = asyncHandler(async (req, res) => {
  const status = normalizeStatus(req.query.status);
  const limit = toIntOrUndef(req.query.limit);
  const cursor = toIntOrUndef(req.query.cursor);

  const result = await listAccessRequests({ status, limit, cursor });
  res.json(result);
});

export const getAccessRequestCtrl = asyncHandler(async (req, res) => {
  const row = await getAccessRequest(req.params.id);
  if (!row) return res.status(404).json({ message: "No encontrado" });
  res.json(row);
});

export const decideAccessRequestCtrl = asyncHandler(async (req, res) => {
  const { decision, roles, department, notes } = req.body || {};

  const result = await decideAccessRequest({
    id: req.params.id,
    decision,
    roles,
    department,
    notes,
    approverUserId: req.user.id,
  });

  res.json(result);
});
