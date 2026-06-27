const db = require('../db');

const getSettings = async (userId) => {
  const { rows } = await db.query('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
  return rows[0] || null;
};

const getApiKey = async (userId, field, envName) => {
  const settings = await getSettings(userId);
  return (settings && settings[field]) || process.env[envName] || '';
};

const getGmailAccounts = async (userId) => {
  const settings = await getSettings(userId);
  return (settings && Array.isArray(settings.gmail_accounts)) ? settings.gmail_accounts : [];
};

module.exports = { getSettings, getApiKey, getGmailAccounts };
