const express = require('express');
const { body, param } = require('express-validator');
const { stringify } = require('csv-stringify/sync');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { validate } = require('../utils/validation');

const router = express.Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM tracker WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ entries: rows });
}));

router.post('/',
  body('website').optional().isURL({ require_protocol: false }),
  body('email').optional().isEmail().normalizeEmail(),
  validate,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `INSERT INTO tracker (user_id, store_name, website, email, mobile_score, subject_used, reply, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'new'),$9) RETURNING *`,
      [
        req.user.id,
        req.body.storeName || null,
        req.body.website || null,
        req.body.email || null,
        req.body.mobileScore || null,
        req.body.subjectUsed || null,
        req.body.reply || null,
        req.body.status || null,
        req.body.notes || null
      ]
    );
    res.status(201).json({ entry: rows[0] });
  })
);

router.get('/export', asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM tracker WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
  const csv = stringify(rows, { header: true });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="milltop-tracker.csv"');
  res.send(csv);
}));

router.put('/:id',
  param('id').isUUID(),
  validate,
  asyncHandler(async (req, res) => {
    const current = await db.query('SELECT * FROM tracker WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    const entry = { ...current.rows[0], ...req.body };
    const { rows } = await db.query(
      `UPDATE tracker SET store_name=$1, website=$2, email=$3, mobile_score=$4, subject_used=$5,
       reply=$6, status=$7, notes=$8, updated_at=NOW()
       WHERE id=$9 AND user_id=$10 RETURNING *`,
      [
        entry.storeName || entry.store_name || null,
        entry.website || null,
        entry.email || null,
        entry.mobileScore || entry.mobile_score || null,
        entry.subjectUsed || entry.subject_used || null,
        entry.reply || null,
        entry.status || 'new',
        entry.notes || null,
        req.params.id,
        req.user.id
      ]
    );
    res.json({ entry: rows[0] || null });
  })
);

router.delete('/:id',
  param('id').isUUID(),
  validate,
  asyncHandler(async (req, res) => {
    await db.query('DELETE FROM tracker WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.status(204).send();
  })
);

module.exports = router;
