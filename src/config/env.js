import dotenv from 'dotenv';
dotenv.config();

export const env = {
  port: Number(process.env.PORT || 3000),
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'change_me',
  cookieName: process.env.COOKIE_NAME || 'transport_enterprise_session',
  encryptionKey: process.env.ENCRYPTION_KEY || '01234567890123456789012345678901',
  uploadDir: process.env.UPLOAD_DIR || 'src/public/uploads',
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB || 8),
  metaApiVersion: process.env.META_API_VERSION || 'v21.0',
  metaGraphBase: process.env.META_GRAPH_BASE || 'https://graph.facebook.com',
  timezone: process.env.DEFAULT_TIMEZONE || 'America/Belem'
};
