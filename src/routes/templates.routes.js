const express = require('express');
const { body, param } = require('express-validator');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { validate } = require('../utils/validation');

const router = express.Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM templates WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ templates: rows });
}));

router.post('/',
  body('name').notEmpty(),
  body('subject').notEmpty(),
  body('body').notEmpty(),
  validate,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      'INSERT INTO templates (user_id, name, subject, body) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.user.id, req.body.name, req.body.subject, req.body.body]
    );
    res.status(201).json({ template: rows[0] });
  })
);

router.put('/:id',
  param('id').isUUID(),
  body('name').optional().notEmpty(),
  body('subject').optional().notEmpty(),
  body('body').optional().notEmpty(),
  validate,
  asyncHandler(async (req, res) => {
    const current = await db.query('SELECT * FROM templates WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    const template = { ...current.rows[0], ...req.body };
    const { rows } = await db.query(
      `UPDATE templates SET name=$1, subject=$2, body=$3, updated_at=NOW()
       WHERE id=$4 AND user_id=$5 RETURNING *`,
      [template.name, template.subject, template.body, req.params.id, req.user.id]
    );
    res.json({ template: rows[0] || null });
  })
);

router.delete('/:id',
  param('id').isUUID(),
  validate,
  asyncHandler(async (req, res) => {
    await db.query('DELETE FROM templates WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.status(204).send();
  })
);

module.exports = router;
