import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import expressLayouts from 'express-ejs-layouts';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server as SocketIOServer } from 'socket.io';

import { env } from './config/env.js';
import { attachUser } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import agentRoutes from './routes/agents.js';
import conversationRoutes from './routes/conversations.js';
import settingsRoutes from './routes/settings.js';
import metaWebhookRoutes from './routes/metaWebhooks.js';
import { registerIo } from './services/realtimeService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsAbs = path.resolve(env.uploadDir);
fs.mkdirSync(uploadsAbs, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: '*' } });
registerIo(io);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');
app.locals.appUrl = env.appUrl;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 600 }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(attachUser);

app.use(authRoutes);
app.use(dashboardRoutes);
app.use(agentRoutes);
app.use(conversationRoutes);
app.use(settingsRoutes);
app.use(metaWebhookRoutes);

app.use((req, res) => {
  res.status(404).render('dashboard/error', {
    title: 'Página não encontrada',
    message: 'A página solicitada não existe.'
  });
});

io.use((socket, next) => {
  const tenantId = socket.handshake.auth?.tenantId;
  if (!tenantId) return next(new Error('tenantId obrigatório'));
  socket.data.tenantId = tenantId;
  next();
});

io.on('connection', (socket) => {
  socket.join(`tenant:${socket.data.tenantId}`);
});

server.listen(env.port, () => {
  console.log(`Servidor enterprise rodando em ${env.appUrl}`);
});
