const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/postgres');
const { JWT_SECRET, requireAuth, requireAdmin } = require('../middleware/auth');
const { validateRegister, validateLogin } = require('../middleware/validation');

// POST /api/auth/register
router.post('/register', validateRegister, async (req, res) => {
  const { email, password, role = 'customer' } = req.body;

  try {
    // Generate bcrypt hash (10 rounds matches the database gen_salt('bf', 10) convention)
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const result = await db.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING user_id, email, role, created_at`,
      [email.toLowerCase().trim(), hash, role]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { userId: user.user_id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        userId: user.user_id,
        email: user.email,
        role: user.role,
        createdAt: user.created_at,
      },
      token,
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'duplicate_email',
        message: 'An account with this email already exists.',
      });
    }
    if (err.constraint === 'chk_user_bcrypt') {
      return res.status(400).json({
        error: 'invalid_password_format',
        message: 'Password hashing format violation.',
      });
    }
    console.error('Registration error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to register user.' });
  }
});

// POST /api/auth/login
router.post('/login', validateLogin, async (req, res) => {
  const { email, password } = req.body;

  try {
    // Secure query: fetch user by email
    const result = await db.query(
      `SELECT user_id, email, password_hash, role, created_at
       FROM users
       WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Invalid email or password.',
      });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Invalid email or password.',
      });
    }

    const token = jwt.sign(
      { userId: user.user_id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.json({
      message: 'Login successful',
      user: {
        userId: user.user_id,
        email: user.email,
        role: user.role,
        createdAt: user.created_at,
      },
      token,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to log in.' });
  }
});

// GET /api/auth/me (Uses v_users_public view - Security requirement #13)
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT user_id, email, role, created_at
       FROM v_users_public
       WHERE user_id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'user_not_found', message: 'User does not exist.' });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Fetch me error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to fetch user profile.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully.' });
});

// GET /api/auth/users (Admin only)
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT user_id, email, role, created_at
       FROM v_users_public
       ORDER BY user_id ASC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to retrieve users.' });
  }
});

module.exports = router;

