// src/app.js
import express from 'express';
import path from 'path';
import { verifyMailer } from './config/mailer.js';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import providerRoutes from './routes/provider.routes.js';
import userRoutes from './routes/user.routes.js';
import purchaseOrderRoutes from './routes/purchaseOrder.routes.js';
import documentRoutes from './routes/document.routes.js';
import documentReviewRoutes from './routes/documentReview.routes.js';
import digitalFilesRoutes from './routes/digitalFiles.routes.js';
import accessRequestRoutes from './routes/accessRequest.routes.js';
import calendarRoutes from './routes/calendar.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import satRoutes from "./routes/sat.routes.js";

// Carga variables de entorno
import './config/env.js';

// Rutas
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';

const app = express();
verifyMailer();

const allowedOrigins = (process.env.FRONT_PUBLIC_URLS || "http://localhost:5173")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);
console.log('🔒 CORS allowed origins:', allowedOrigins); // <- AÑADE ESTO

// Para que el frontend pueda enviar/recibir cookie HttpOnly (ajusta origin en prod)
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(cookieParser());
app.use(morgan('dev'));

app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/users', userRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/document-reviews', documentReviewRoutes);
app.use('/api/access-requests', accessRequestRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/payments', paymentRoutes);
app.use("/api/sat", satRoutes);


// Servir archivos estáticos de uploads
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
app.use('/api/digital-files', digitalFilesRoutes);

// Manejo de errores simple
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  res.status(status).json({ message: err.message || 'Internal Server Error' });
});

export default app;