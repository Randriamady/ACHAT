const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
require('dotenv').config();
const { closePool } = require('./db/pool');
const { migrate } = require('./db/migrate');
const achatsRouter = require('./routes/achats');
const { router: authRouter } = require('./routes/auth');
const usersRouter = require('./routes/users');
const adminRoutes = require('./routes/admin');
const sheetsRouter = require('./routes/sheets');
const app = express();
const PORT = Number(process.env.PORT || 8000);

// ============================================================
// CONFIGURATION 
// ============================================================

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(compression());

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowAllOrigins = allowedOrigins.includes('*');
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowAllOrigins || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origine CORS non autorisée'));
  }
}));

// Routes API
app.use('/api/auth', authRouter);
app.use('/api/achats', achatsRouter);
app.use('/api/users', usersRouter);
app.use('/api/admin', adminRoutes);
app.use('/api/sheets', sheetsRouter);

const frontendDist = path.resolve(__dirname, '..', 'achat-locaux-frontend', 'dist');
app.use(express.static(frontendDist));

app.use((err, req, res, next) => {
  // Gestion spécifique des erreurs de payload trop large
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ 
      error: 'Le fichier est trop volumineux. Taille maximale : 100MB.' 
    });
  }
  
  console.error('❌ Erreur serveur:', err);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

async function startServer(port = PORT) {
  try {
    await migrate();
  } catch (err) {
    console.error('❌ Démarrage annulé : migrations PostgreSQL impossibles.', err.message);
    process.exitCode = 1;
    return;
  }

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`✅ Serveur lancé sur http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${port} déjà utilisé. Arrêt du démarrage sans utiliser un autre port.`);
      process.exit(1);
      return;
    }

    console.error('❌ Erreur au démarrage du serveur :', err.message);
    process.exit(1);
  });

  const shutdown = () => {
    console.log('\n🛑 Arrêt du serveur demandé...');
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

startServer();