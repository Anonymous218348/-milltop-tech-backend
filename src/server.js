require('dotenv').config();

const app = require('./app');
const { pool } = require('./db');

const port = process.env.PORT || 5000;

const server = app.listen(port, () => {
  console.log(`MILLTOP TECH API running on port ${port}`);
});

const shutdown = async () => {
  console.log('Shutting down API...');
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
