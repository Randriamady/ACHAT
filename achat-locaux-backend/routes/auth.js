const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { query, verifyPassword, hashPassword } = require('../db/pool');
const { normalizeRole } = require('./permissions');

const activeTokens = new Map();
const revokedTokens = new Set();
const configuredAuthSecret = process.env.AUTH_SECRET || process.env.JWT_SECRET;
if (process.env.NODE_ENV === 'production' && !configuredAuthSecret) {
  throw new Error('AUTH_SECRET ou JWT_SECRET est obligatoire en production.');
}
const AUTH_SECRET = configuredAuthSecret || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL_SECONDS = 8 * 60 * 60;

function signTokenPayload(payload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function getUserFromToken(token) {
  if (!token || revokedTokens.has(token)) return null;

  const separator = token.indexOf('.');
  if (separator < 1) return activeTokens.get(token) || null;

  const encodedPayload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expectedSignature = crypto.createHmac('sha256', AUTH_SECRET).update(encodedPayload).digest('base64url');
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000) || !payload.user) return null;
    const cachedUser = activeTokens.get(token);
    if (cachedUser) return cachedUser;
    activeTokens.set(token, payload.user);
    return payload.user;
  } catch (err) {
    return null;
  }
}

async function getCurrentUserFromToken(token) {
  const tokenUser = getUserFromToken(token);
  if (!tokenUser || !tokenUser.id) return null;

  let result;
  try {
    result = await query(
      'SELECT id, identifier, name, avatar_url, role, is_active FROM users WHERE id = $1',
      [tokenUser.id]
    );
  } catch (err) {
    console.error('Erreur vérification du compte de session:', err.message);
    throw err;
  }

  const currentUser = result.rows[0];
  if (!currentUser || currentUser.is_active === false) {
    revokedTokens.add(token);
    activeTokens.delete(token);
    return null;
  }

  const publicUser = {
    id: currentUser.id,
    identifier: currentUser.identifier,
    name: currentUser.name || currentUser.identifier,
    avatar_url: currentUser.avatar_url || null,
    role: normalizeRole(currentUser.role || 'user')
  };
  activeTokens.set(token, publicUser);
  return publicUser;
}

function extractToken(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return req.headers['x-auth-token'] || null;
}

router.post('/login', async (req, res) => {
  const identifier = String(req.body?.identifier || req.body?.username || '').trim();
  const password = req.body?.password;

  if (!identifier || !password) {
    return res.status(400).json({ ok: false, message: 'Identifiant et mot de passe requis.' });
  }

  try {
    const result = await query(
      `SELECT id, identifier, password_hash, name, avatar_url, role FROM users WHERE LOWER(identifier) = LOWER($1) AND is_active = TRUE`,
      [identifier]
    );
    const user = result.rows[0];

    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ ok: false, message: 'Identifiants invalides.' });
    }

    const publicUser = {
      id: user.id,
      identifier: user.identifier,
      name: user.name || user.identifier,
      avatar_url: user.avatar_url || null,
      role: normalizeRole(user.role || 'user')
    };
    const token = signTokenPayload({
      user: publicUser,
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
    });
    activeTokens.set(token, publicUser);

    return res.json({ ok: true, token, user: publicUser });
  } catch (err) {
    console.error('Erreur login:', err.message);
    return res.status(500).json({ ok: false, message: 'Erreur serveur lors de la connexion.' });
  }
});

router.get('/me', async (req, res) => {
  const token = extractToken(req);
  const user = await getCurrentUserFromToken(token);
  if (!user) {
    return res.status(401).json({ ok: false, message: 'Non autorisé.' });
  }
  return res.json({ ok: true, user });
});

router.get('/online', async (req, res) => {
  const token = extractToken(req);
  if (!await getCurrentUserFromToken(token)) {
    return res.status(401).json({ ok: false, message: 'Non autorisé.' });
  }

  const activeUsers = await query('SELECT id FROM users WHERE is_active = TRUE');
  const activeUserIds = new Set(activeUsers.rows.map(user => String(user.id)));
  const uniqueUsers = new Map();
  for (const [token, user] of activeTokens.entries()) {
    if (!getUserFromToken(token) || !activeUserIds.has(String(user.id))) {
      revokedTokens.add(token);
      activeTokens.delete(token);
      continue;
    }
    const key = user.id !== undefined && user.id !== null
      ? String(user.id)
      : String(user.identifier || user.name || '');
    if (!uniqueUsers.has(key)) uniqueUsers.set(key, user);
  }

  const users = Array.from(uniqueUsers.values()).map(user => ({
    id: user.id,
    identifier: user.identifier,
    name: user.name || user.identifier,
    avatar_url: user.avatar_url || null,
    role: user.role || 'user'
  }));

  return res.json({ ok: true, users });
});

router.post('/logout', (req, res) => {
  const token = extractToken(req);
  if (token) {
    revokedTokens.add(token);
    activeTokens.delete(token);
  }
  return res.json({ ok: true });
});

router.patch('/profile', async (req, res) => {
  const token = extractToken(req);
  try {
    const currentUser = await getCurrentUserFromToken(token);
    if (!currentUser) {
      return res.status(401).json({ ok: false, message: 'Non autorisé.' });
    }

    const name = String(req.body?.name || req.body?.full_name || '').trim();
    const identifier = String(req.body?.identifier || req.body?.username || '').trim();
    const password = req.body?.password;
    const avatar_url = String(req.body?.avatar_url || '').trim();

    if (!name || !identifier) {
      return res.status(400).json({ ok: false, message: 'Nom et identifiant requis.' });
    }

    const existing = await query(
      `SELECT id FROM users WHERE LOWER(identifier) = LOWER($1) AND id <> $2`,
      [identifier, currentUser.id]
    );

    if (existing.rowCount > 0) {
      return res.status(409).json({ ok: false, message: 'Cet identifiant est déjà utilisé.' });
    }

    const params = [name, identifier];
    let sql = `UPDATE users SET name = $1, identifier = $2, updated_at = NOW()`;

    if (avatar_url) {
      params.push(avatar_url);
      sql += `, avatar_url = $${params.length}`;
    }

    if (password && String(password).trim()) {
      const hashedPassword = hashPassword(String(password));
      params.push(hashedPassword);
      sql += `, password_hash = $${params.length}`;
    }

    params.push(currentUser.id);
    sql += ` WHERE id = $${params.length}`;
    await query(sql, params);

    const result = await query(
      `SELECT id, identifier, name, avatar_url, role FROM users WHERE id = $1`,
      [currentUser.id]
    );

    const updatedUser = {
      id: result.rows[0].id,
      identifier: result.rows[0].identifier,
      name: result.rows[0].name || result.rows[0].identifier,
      avatar_url: result.rows[0].avatar_url || null,
      role: normalizeRole(result.rows[0].role || 'user')
    };

    activeTokens.set(token, updatedUser);

    return res.json({ ok: true, user: updatedUser });
  } catch (err) {
    console.error('Erreur update profile:', err.message);
    return res.status(500).json({ ok: false, message: 'Erreur serveur lors de la mise à jour du profil.' });
  }
});

router.post('/register', async (req, res) => {
  const identifier = String(req.body?.identifier || req.body?.username || '').trim();
  const password = req.body?.password;
  const name = req.body?.name || req.body?.full_name || '';
  const requestedRole = String(req.body?.role || 'back office').trim().toLowerCase();
  const role = normalizeRole(requestedRole);

  if (!name || !identifier || !password) {
    return res.status(400).json({ ok: false, message: 'Nom complet, identifiant et mot de passe requis.' });
  }

  const token = extractToken(req);
  const requester = await getCurrentUserFromToken(token);
  if (!requester || normalizeRole(requester.role) !== 'admin') {
    return res.status(403).json({ ok: false, message: 'Seul un administrateur peut créer un compte.' });
  }

  const allowedRoles = new Set(['achat', 'admin','validateur', 'cdg', 'back_office']);
  if (!allowedRoles.has(role)) {
    return res.status(400).json({ ok: false, message: 'Rôle de compte invalide.' });
  }

  try {
    const existing = await query(`SELECT id FROM users WHERE LOWER(identifier) = LOWER($1)`, [identifier]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ ok: false, message: 'Cet identifiant est déjà utilisé.' });
    }

    const hashedPassword = hashPassword(password);
    const result = await query(
      `INSERT INTO users (identifier, password_hash, name, role, is_active) VALUES ($1, $2, $3, $4, TRUE) RETURNING id, identifier, name, role`,
      [identifier, hashedPassword, name, role]
    );

    return res.status(201).json({ ok: true, user: result.rows[0] });
  } catch (err) {
    console.error('Erreur register:', err.message);
    return res.status(500).json({ ok: false, message: 'Erreur serveur lors de la création du compte.' });
  }
});

module.exports = {
  router,
};

// Retourne l'utilisateur public correspondant au token présent dans la requête (ou null)
async function getUserFromTokenReq(req) {
  const token = extractToken(req);
  return getCurrentUserFromToken(token);
}

module.exports.getUserFromTokenReq = getUserFromTokenReq;
