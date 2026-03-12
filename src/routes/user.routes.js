import { Router } from 'express';
import validate from '../middlewares/validate.js';
import {
    createUser,
    listUsers,
    updateUser,
    deleteUser,
    getMe,
    updateMe
} from '../controllers/user.controller.js';
import {
    createUserSchema,
    updateUserSchema,
    updateMeSchema
} from '../schemas/user.schema.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireRole } from '../middlewares/requireRole.js';

const router = Router();

// Perfil propio
router.get('/me', requireAuth, getMe);
router.patch('/me', requireAuth, validate(updateMeSchema), updateMe);

// Gestión de usuarios: SOLO ADMIN
router.post(
    '/',
    requireAuth,
    requireRole(['ADMIN']),
    validate(createUserSchema),
    createUser
);

router.get(
    '/',
    requireAuth,
    requireRole(['ADMIN']),
    listUsers
);

router.patch(
    '/:id',
    requireAuth,
    requireRole(['ADMIN']),
    validate(updateUserSchema),
    updateUser
);

router.delete(
    '/:id',
    requireAuth,
    requireRole(['ADMIN']),
    deleteUser
);

export default router;