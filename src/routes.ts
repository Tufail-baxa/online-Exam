import { Router } from 'express';
import { authRoutes } from './modules/auth/auth.routes';
import { attemptRoutes } from './modules/attempts/attempt.routes';

export const apiRoutes = Router();

apiRoutes.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok', time: new Date() } }));
apiRoutes.use('/auth', authRoutes);
apiRoutes.use('/student', attemptRoutes);

// Mounted in later phases:
// apiRoutes.use('/student', dashboardRoutes, examCatalogRoutes, resultRoutes);
// apiRoutes.use('/admin', adminRoutes);
