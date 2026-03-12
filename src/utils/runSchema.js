import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sql = fs.readFileSync(path.join(__dirname, '../../db/schema.sql'), 'utf8');
await pool.query(sql);
console.log('Schema criado com sucesso.');
await pool.end();
