require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('./index');

const run = async () => {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
  await pool.end();
  console.log('Database schema migrated successfully.');
};

run().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
