const express = require('express');
const axios = require('axios');
const { body } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { validate } = require('../utils/validation');
const { getApiKey } = require('../services/settings.service');
const { HttpError } = require('../utils/httpError');

const router = express.Router();
router.use(requireAuth);

router.post('/chat',
  body('message').notEmpty(),
  body('history').optional().isArray(),
  validate,
  asyncHandler(async (req, res) => {
    const apiKey = await getApiKey(req.user.id, 'groq_api_key', 'GROQ_API_KEY');
    if (!apiKey) throw new HttpError(400, 'Groq API key is not configured');

    const messages = [
      {
        role: 'system',
        content: 'You are the MILLTOP TECH AI assistant. Give practical cold email outreach, SEO optimization, sales, and web agency growth advice.'
      },
      ...(req.body.history || []),
      { role: 'user', content: req.body.message }
    ];

    const { data } = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.5
    }, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 30000
    });

    res.json({ response: data.choices[0].message.content });
  })
);

module.exports = router;
