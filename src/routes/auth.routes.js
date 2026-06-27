const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body } = require('express-validator');
const db = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const { validate } = require('../utils/validation');
const { HttpError } = require('../utils/httpError');

const router = express.Router();

const tokenFor = (user) => jwt.sign(
  { sub: user.id, email: user.email },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
);

router.post('/register',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  validate,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const hashed = await bcrypt.hash(password, 12);
    try {
      const { rows } = await db.query(
        'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email, created_at',
        [email, hashed]
      );
      res.status(201).json({ user: rows[0], token: tokenFor(rows[0]) });
    } catch (error) {
      if (error.code === '23505') throw new HttpError(409, 'Email is already registered');
      throw error;
    }
  })
);

router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  validate,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const { rows } = await db.query('SELECT id, email, password, created_at FROM users WHERE email = $1', [email]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new HttpError(401, 'Invalid email or password');
    }
    delete user.password;
    res.json({ user, token: tokenFor(user) });
  })
);

module.exports = router;
