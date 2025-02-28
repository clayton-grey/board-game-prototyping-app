// server/app.js
import express from 'express';
import cors from 'cors';
import path from 'path';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import config from './config.js';
import adminRoutes from './routes/admin.js';

/**
 * Instead of import.meta.url + fileURLToPath, we'll use process.cwd() or
 * a known relative path from the project root. This is simpler for Node + Babel.
 *
 * If your 'client' folder is in the project root, then process.cwd() will
 * typically be the root when you run 'npm start', so this resolves correctly.
 * Adjust the path if your structure differs or if you run the app from a subfolder.
 */
const ROOT_DIR = process.cwd(); 
// or, if needed, you can do something like:
// const ROOT_DIR = path.resolve(__dirname, '../..'); // if you prefer

const app = express();

app.use(express.json());
app.use(cors({ origin: '*' }));

// Serve static frontend files from /client relative to the project root
app.use(express.static(path.join(ROOT_DIR, 'client')));

// If you have a /shared folder:
app.use('/shared', express.static(path.join(ROOT_DIR, 'shared')));

// API Routes
app.use('/auth', authRoutes);
app.use('/projects', projectRoutes);
app.use('/admin', adminRoutes);

// Serve index.html for root (assuming /client/index.html exists)
app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'client', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global Error Handler:', err.stack || err);
  const status = err.statusCode || 500;
  const msg = err.message || 'Server Error';
  res.status(status).json({ message: msg });
});

export default app;
