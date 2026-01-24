import { Router } from 'express';
import { searchProviders, getProviderByRfc, createProvider, updateProvider, inactivateProvider, reactivateProvider, getProviderById, getMyProviderData, updateMyProviderData, getProviderByRfcStrict } from '../controllers/provider.controller.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import validate from '../middlewares/validate.js'; // ← sin llaves
import { createProviderSchema,updateProviderSchema, inactivateProviderSchema, updateMyProviderSchema } from '../schemas/provider.schema.js';

const router = Router();

//Rutas para los datos del proveedor aprobado
router.get('/me', requireAuth, getMyProviderData);
router.patch('/me', requireAuth, updateMyProviderData);

//Busqueda
router.get('/search', requireAuth, searchProviders);

//Rutas con prefijo
router.get('/id/:id', requireAuth, getProviderById);
//nueva ruta para rfc baja estricta
router.get('/by-rfc/:rfc', requireAuth, getProviderByRfcStrict);

router.get('/:rfc', requireAuth, getProviderByRfc);

//CRUD administración
router.post('/', validate(createProviderSchema), createProvider);
router.patch('/:id', requireAuth, validate(updateProviderSchema), updateProvider);
router.patch('/:id/inactivate', requireAuth, validate(inactivateProviderSchema), inactivateProvider);
router.patch('/:id/reactivate', requireAuth, reactivateProvider);



export default router;
