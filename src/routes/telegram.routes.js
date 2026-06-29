'use strict';

const express = require('express');
const axios = require('axios');
const db = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const { normalizeUrl } = require('../utils/url');
const { runPageSpeed } = require('../services/pagespeed.service');
const { findEmailForDomain } = require('../services/finder.service');
const { getApiKey, getSettings } = require('../services/settings.service');

const router = express.Router();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USER_ID = parseInt(process.env.TELEGRAM_USER_ID, 10);
const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Send message to Telegram
const sendMessage = async (chatId, text, options = {}) => {
  try {
    await axios.post(`${API_URL}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      ...options
    });
  } catch (e) {
    console.error('Telegram send error:', e.message);
  }
};

// Get user from DB by telegram user id (use first user for now since app is single-user)
const getUser = async () => {
  const { rows } = await db.query('SELECT * FROM users LIMIT 1');
  return rows[0] || null;
};

// Format score with emoji
const scoreEmoji = (score) => {
  if (score === null || score === undefined) return '❓ N/A';
  if (score >= 90) return `🟢 ${score}`;
  if (score >= 70) return `🟡 ${score}`;
  return `🔴 ${score}`;
};

// Handle incoming Telegram messages
const handleMessage = async (message) => {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = (message.text || '').trim();

  // Security check
  if (userId !== ALLOWED_USER_ID) {
    await sendMessage(chatId, '⛔ Unauthorized access.');
    return;
  }

  const lower = text.toLowerCase();

  // ── HELP ──────────────────────────────────────────────────────
  if (lower === '/start' || lower === '/help') {
    await sendMessage(chatId, `
*🚀 MILLTOP TECH Bot*

Here's what I can do:

*Scanner*
/scan https://store.com — Scan a website

*Email Finder*
/find https://store.com — Find contact email

*Contacts*
/contacts — List all contacts
/addcontact email@example.com — Add a contact

*Tracker*
/tracker — View outreach tracker

*Campaigns*
/campaigns — List campaigns

*AI Assistant*
/ai your question here — Ask the AI

*Stats*
/stats — View platform stats

Just send me a URL and I'll scan it automatically!
    `.trim());
    return;
  }

  // ── AUTO SCAN if just a URL is sent ───────────────────────────
  if ((lower.startsWith('http://') || lower.startsWith('https://')) && !lower.includes(' ')) {
    await handleScan(chatId, text);
    return;
  }

  // ── SCAN ──────────────────────────────────────────────────────
  if (lower.startsWith('/scan ') || lower.startsWith('/scan\n')) {
    const url = text.split(/\s+/)[1];
    if (!url) { await sendMessage(chatId, '❌ Please provide a URL. Example: /scan https://store.com'); return; }
    await handleScan(chatId, url);
    return;
  }

  // ── FIND EMAIL ────────────────────────────────────────────────
  if (lower.startsWith('/find ')) {
    const url = text.split(/\s+/)[1];
    if (!url) { await sendMessage(chatId, '❌ Please provide a URL. Example: /find https://store.com'); return; }
    await handleFind(chatId, url);
    return;
  }

  // ── CONTACTS ─────────────────────────────────────────────────
  if (lower === '/contacts') {
    await handleContacts(chatId);
    return;
  }

  if (lower.startsWith('/addcontact ')) {
    const email = text.split(/\s+/)[1];
    await handleAddContact(chatId, email);
    return;
  }

  // ── TRACKER ──────────────────────────────────────────────────
  if (lower === '/tracker') {
    await handleTracker(chatId);
    return;
  }

  // ── CAMPAIGNS ────────────────────────────────────────────────
  if (lower === '/campaigns') {
    await handleCampaigns(chatId);
    return;
  }

  // ── STATS ────────────────────────────────────────────────────
  if (lower === '/stats') {
    await handleStats(chatId);
    return;
  }

  // ── AI ───────────────────────────────────────────────────────
  if (lower.startsWith('/ai ')) {
    const question = text.substring(4).trim();
    await handleAI(chatId, question);
    return;
  }

  // ── DEFAULT ──────────────────────────────────────────────────
  await sendMessage(chatId, '❓ I didn\'t understand that. Send /help to see what I can do.');
};

// ── HANDLERS ──────────────────────────────────────────────────────

const handleScan = async (chatId, input) => {
  await sendMessage(chatId, `🔍 Scanning *${input}*...\n_This takes 15-30 seconds_`);
  try {
    const user = await getUser();
    if (!user) { await sendMessage(chatId, '❌ No user found in database.'); return; }

    const url = text.split(/\s+/)[1].replace(/[\\/]+$/, '');
    const apiKey = await getApiKey(user.id, 'pagespeed_api_key', 'PAGESPEED_API_KEY');

    const [mobile, desktop] = await Promise.all([
      runPageSpeed(url, 'mobile', apiKey),
      runPageSpeed(url, 'desktop', apiKey)
    ]);

    const { rows } = await db.query(
      `INSERT INTO stores (user_id, url, mobile_performance, desktop_performance, mobile_seo, desktop_seo,
        mobile_best_practices, desktop_best_practices, mobile_accessibility, desktop_accessibility)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [user.id, url, mobile.performance, desktop.performance, mobile.seo, desktop.seo,
       mobile.bestPractices, desktop.bestPractices, mobile.accessibility, desktop.accessibility]
    );

    const store = rows[0];
    const domain = url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];

    await sendMessage(chatId, `
✅ *Scan Complete: ${domain}*

📱 *Mobile*
Performance: ${scoreEmoji(store.mobile_performance)}
SEO: ${scoreEmoji(store.mobile_seo)}
Best Practices: ${scoreEmoji(store.mobile_best_practices)}
Accessibility: ${scoreEmoji(store.mobile_accessibility)}

🖥 *Desktop*
Performance: ${scoreEmoji(store.desktop_performance)}
SEO: ${scoreEmoji(store.desktop_seo)}

${store.mobile_performance < 70 ? '⚠️ Low mobile performance — good outreach target!' : ''}

Use /find ${input} to find their email.
    `.trim());
  } catch (e) {
    await sendMessage(chatId, `❌ Scan failed: ${e.message}`);
  }
};

const handleFind = async (chatId, input) => {
  await sendMessage(chatId, `📧 Finding email for *${input}*...\n_Searching contact pages..._`);
  try {
    const user = await getUser();
    if (!user) { await sendMessage(chatId, '❌ No user found.'); return; }

    const hunterKey = await getApiKey(user.id, 'hunter_api_key', 'HUNTER_API_KEY');
    const result = await findEmailForDomain(input, hunterKey);

    if (result.email) {
      // Save to store
      const url = normalizeUrl(input);
      await db.query(
        `UPDATE stores SET contact_email=$1, email_source=$2, email_status=$3 
         WHERE user_id=$4 AND url LIKE $5`,
        [result.email, result.source, result.status, user.id, `%${url}%`]
      );

      await sendMessage(chatId, `
✅ *Email Found!*

📧 ${result.email}
🔍 Source: ${result.source}
🌐 Domain: ${input}

Reply with this email to add them as a contact!
      `.trim());
    } else {
      await sendMessage(chatId, `❌ No email found for *${input}*\n\nTry entering it manually in the app.`);
    }
  } catch (e) {
    await sendMessage(chatId, `❌ Error: ${e.message}`);
  }
};

const handleContacts = async (chatId) => {
  try {
    const user = await getUser();
    const { rows } = await db.query(
      'SELECT * FROM contacts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10',
      [user.id]
    );
    if (rows.length === 0) {
      await sendMessage(chatId, '📭 No contacts yet. Use /addcontact to add one.');
      return;
    }
    const list = rows.map((c, i) =>
      `${i + 1}. *${c.name || c.domain || 'Unknown'}*\n   📧 ${c.email}\n   Stage: ${c.outreach_stage || 'lead'}`
    ).join('\n\n');
    await sendMessage(chatId, `📋 *Your Contacts (last 10)*\n\n${list}`);
  } catch (e) {
    await sendMessage(chatId, `❌ Error: ${e.message}`);
  }
};

const handleAddContact = async (chatId, email) => {
  if (!email || !email.includes('@')) {
    await sendMessage(chatId, '❌ Please provide a valid email. Example: /addcontact hello@store.com');
    return;
  }
  try {
    const user = await getUser();
    await db.query(
      `INSERT INTO contacts (user_id, email, outreach_stage, status)
       VALUES ($1, $2, 'lead', 'new')`,
      [user.id, email]
    );
    await sendMessage(chatId, `✅ Contact *${email}* added successfully!`);
  } catch (e) {
    await sendMessage(chatId, `❌ Error: ${e.message}`);
  }
};

const handleTracker = async (chatId) => {
  try {
    const user = await getUser();
    const { rows } = await db.query(
      'SELECT * FROM tracker WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10',
      [user.id]
    );
    if (rows.length === 0) {
      await sendMessage(chatId, '📭 No tracker entries yet.');
      return;
    }
    const list = rows.map((e, i) =>
      `${i + 1}. *${e.store_name || e.website || 'Unknown'}*\n   Status: ${e.status || 'New'}\n   Email: ${e.email || 'N/A'}`
    ).join('\n\n');
    await sendMessage(chatId, `📊 *Outreach Tracker (last 10)*\n\n${list}`);
  } catch (e) {
    await sendMessage(chatId, `❌ Error: ${e.message}`);
  }
};

const handleCampaigns = async (chatId) => {
  try {
    const user = await getUser();
    const { rows } = await db.query(
      'SELECT * FROM campaigns WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10',
      [user.id]
    );
    if (rows.length === 0) {
      await sendMessage(chatId, '📭 No campaigns yet. Create one in the app.');
      return;
    }
    const list = rows.map((c, i) =>
      `${i + 1}. *${c.name}*\n   Status: ${c.status || 'draft'}`
    ).join('\n\n');
    await sendMessage(chatId, `📣 *Your Campaigns*\n\n${list}`);
  } catch (e) {
    await sendMessage(chatId, `❌ Error: ${e.message}`);
  }
};

const handleStats = async (chatId) => {
  try {
    const user = await getUser();
    const [stores, contacts, campaigns, tracker, emails] = await Promise.all([
      db.query('SELECT COUNT(*) FROM stores WHERE user_id=$1', [user.id]),
      db.query('SELECT COUNT(*) FROM contacts WHERE user_id=$1', [user.id]),
      db.query('SELECT COUNT(*) FROM campaigns WHERE user_id=$1', [user.id]),
      db.query('SELECT COUNT(*) FROM tracker WHERE user_id=$1', [user.id]),
      db.query('SELECT COUNT(*) FROM email_logs WHERE user_id=$1', [user.id])
    ]);
    await sendMessage(chatId, `
📊 *MILLTOP TECH Stats*

🏪 Stores Scanned: *${stores.rows[0].count}*
👥 Contacts: *${contacts.rows[0].count}*
📣 Campaigns: *${campaigns.rows[0].count}*
📋 Tracker Entries: *${tracker.rows[0].count}*
📧 Emails Sent: *${emails.rows[0].count}*
    `.trim());
  } catch (e) {
    await sendMessage(chatId, `❌ Error: ${e.message}`);
  }
};

const handleAI = async (chatId, question) => {
  if (!question) { await sendMessage(chatId, '❌ Please add a question. Example: /ai write me a cold email'); return; }
  await sendMessage(chatId, '🤖 Thinking...');
  try {
    const user = await getUser();
    const groqKey = await getApiKey(user.id, 'groq_api_key', 'GROQ_API_KEY');
    if (!groqKey) { await sendMessage(chatId, '❌ No Groq API key set. Add it in Settings.'); return; }

    const { data } = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You are MILLTOP TECH AI assistant. Help with cold email outreach, web optimization, and sales. Be concise and actionable. Keep responses under 300 words.' },
        { role: 'user', content: question }
      ],
      temperature: 0.7,
      max_tokens: 400
    }, {
      headers: { Authorization: `Bearer ${groqKey}` },
      timeout: 30000
    });

    const reply = data.choices[0].message.content;
    await sendMessage(chatId, `🤖 *AI Response*\n\n${reply}`);
  } catch (e) {
    await sendMessage(chatId, `❌ AI error: ${e.message}`);
  }
};

// ── WEBHOOK ENDPOINT ──────────────────────────────────────────────
router.post('/webhook', asyncHandler(async (req, res) => {
  res.sendStatus(200); // Always respond to Telegram immediately
  const { message } = req.body;
  if (message) {
    handleMessage(message).catch(console.error);
  }
}));

// ── SET WEBHOOK ───────────────────────────────────────────────────
router.get('/setup', asyncHandler(async (req, res) => {
  const webhookUrl = `${process.env.APP_URL}/api/telegram/webhook`;
  const { data } = await axios.post(`${API_URL}/setWebhook`, { url: webhookUrl });
  res.json(data);
}));

module.exports = router;
