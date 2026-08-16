// ProxiMed GH — minimal staging server
// Serves the frontend AND exposes one API endpoint that queries PostGIS.

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Allow the frontend (served from anywhere, including this same server) to call the API
app.use(cors());
app.use(express.json());

// Serve the static frontend (index.html, etc.) from /public
app.use(express.static('public'));

// PostGIS connection — reads from .env (see .env.example)
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  // RDS requires SSL; local Postgres for testing does not. Set DB_SSL=true on staging.
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

// Simple health check — confirms the server itself is up
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'ProxiMed GH API is running' });
});

// The one required query for this milestone: hospitals as GeoJSON-ish points
app.get('/api/hospitals', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        hospital_id,
        name,
        bed_capacity,
        specialties,
        ST_Y(location) AS lat,
        ST_X(location) AS lng
      FROM hospital
      ORDER BY hospital_id;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('DB query failed:', err.message);
    res.status(500).json({ error: 'Database query failed', detail: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ProxiMed GH server running on port ${PORT}`);
});
