import { createAccessRequest, listAccessRequests, getAccessRequest, decideAccessRequest } from '../services/accessRequest.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireRole } from '../middlewares/requireRole.js';

export const createAccessRequestCtrl = async (req, res) => {
  const result = await createAccessRequest(req.body || {});
  res.status(201).json(result);
};

export const listAccessRequestsCtrl = async (req, res) => {
  const { status, limit, cursor } = req.query;
  const result = await listAccessRequests({ status, limit, cursor });
  res.json(result);
};

export const getAccessRequestCtrl = async (req, res) => {
  const row = await getAccessRequest(req.params.id);
  if (!row) return res.status(404).json({ message: 'No encontrado' });
  res.json(row);
};

export const decideAccessRequestCtrl = async (req, res) => {
  const { decision, roles, department, notes } = req.body || {};
  const result = await decideAccessRequest({ id: req.params.id, decision, roles, department, notes, approverUserId: req.user.id });
  res.json(result);
};
