import { Router } from 'express';
import validate from '../middlewares/validate.js';
import { createUser, listUsers,updateUser, deleteUser, getMe, updateMe } from '../controllers/user.controller.js';
import { createUserSchema, updateUserSchema, updateMeSchema } from '../schemas/user.schema.js';
import { requireAuth } from '../middlewares/requireAuth.js';

const router = Router();

router.get('/me', requireAuth, getMe);
router.patch('/me', requireAuth, validate(updateMeSchema), updateMe);

router.post('/', requireAuth, validate(createUserSchema), createUser);
router.get('/', requireAuth, listUsers);
router.patch('/:id', requireAuth, validate(updateUserSchema), updateUser);
router.delete('/:id', requireAuth, deleteUser);

export default router;