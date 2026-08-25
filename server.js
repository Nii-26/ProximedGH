// ProxiMed GH — minimal staging server
// Serves the frontend AND exposes one API endpoint that queries PostGIS.

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

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

// Ambulance tracking — supports an optional ?status= filter (available / en_route / busy)
app.get('/api/ambulances', async (req, res) => {
  const { status } = req.query;
  const allowedStatuses = ['available', 'en_route', 'busy'];

  try {
    let query = `
      SELECT
        ambulance_id,
        plate_number,
        status,
        station_id,
        ST_Y(location) AS lat,
        ST_X(location) AS lng
      FROM ambulance
    `;
    const params = [];

    if (status) {
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${allowedStatuses.join(', ')}` });
      }
      query += ' WHERE status = $1';
      params.push(status);
    }

    query += ' ORDER BY ambulance_id;';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('DB query failed:', err.message);
    res.status(500).json({ error: 'Database query failed', detail: err.message });
  }
});

// Routing calculation: given an emergency location, return the nearest hospitals
// AND the nearest available ambulance, each ranked by real spatial distance (km).
app.get('/api/route-emergency', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'lat and lng query params are required and must be numbers' });
  }

  try {
    // $1 = lng, $2 = lat (PostGIS point order is lng, lat)
    const hospitalsResult = await pool.query(`
      SELECT
        hospital_id,
        name,
        bed_capacity,
        specialties,
        ST_Y(location) AS lat,
        ST_X(location) AS lng,
        ROUND((ST_Distance(location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000)::numeric, 2) AS distance_km
      FROM hospital
      WHERE bed_capacity > 0
      ORDER BY location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
      LIMIT 5;
    `, [lng, lat]);

    const ambulancesResult = await pool.query(`
      SELECT
        ambulance_id,
        plate_number,
        status,
        ST_Y(location) AS lat,
        ST_X(location) AS lng,
        ROUND((ST_Distance(location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000)::numeric, 2) AS distance_km
      FROM ambulance
      WHERE status = 'available'
      ORDER BY location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
      LIMIT 3;
    `, [lng, lat]);

    res.json({
      emergency_location: { lat, lng },
      nearest_hospitals: hospitalsResult.rows,
      nearest_ambulances: ambulancesResult.rows
    });
  } catch (err) {
    console.error('DB query failed:', err.message);
    res.status(500).json({ error: 'Database query failed', detail: err.message });
  }
});

// One-click dispatch assignment: persists an incident, creates a dispatch record
// linking it to the chosen ambulance and hospital, and marks that ambulance en_route.
app.post('/api/dispatch', async (req, res) => {
  const { lat, lng, description, severity, ambulance_id, hospital_id } = req.body;

  if (
    typeof lat !== 'number' || typeof lng !== 'number' ||
    !ambulance_id || !hospital_id
  ) {
    return res.status(400).json({ error: 'lat, lng, ambulance_id, and hospital_id are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Confirm the ambulance is still available — prevents double-dispatching
    // if two dispatchers act on the same unit at nearly the same time.
    const ambulanceCheck = await client.query(
      `SELECT status FROM ambulance WHERE ambulance_id = $1 FOR UPDATE`,
      [ambulance_id]
    );
    if (ambulanceCheck.rows.length === 0) {
      throw { statusCode: 404, message: 'Ambulance not found' };
    }
    if (ambulanceCheck.rows[0].status !== 'available') {
      throw { statusCode: 409, message: 'This ambulance is no longer available' };
    }

    // 1. Persist the incident
    const incidentResult = await client.query(
      `INSERT INTO incident (location, description, severity)
       VALUES (ST_SetSRID(ST_MakePoint($1, $2), 4326), $3, $4)
       RETURNING incident_id, reported_at`,
      [lng, lat, description || 'Emergency reported via ProxiMed GH', severity || 'high']
    );
    const incident_id = incidentResult.rows[0].incident_id;

    // 2. Create the dispatch record
    const dispatchResult = await client.query(
      `INSERT INTO dispatch (incident_id, ambulance_id, hospital_id, status)
       VALUES ($1, $2, $3, 'assigned')
       RETURNING dispatch_id, dispatch_time, status`,
      [incident_id, ambulance_id, hospital_id]
    );

    // 3. Mark the ambulance en_route so it disappears from the "available" filter
    await client.query(
      `UPDATE ambulance SET status = 'en_route' WHERE ambulance_id = $1`,
      [ambulance_id]
    );

    await client.query('COMMIT');

    res.json({
      dispatch_id: dispatchResult.rows[0].dispatch_id,
      incident_id,
      dispatch_time: dispatchResult.rows[0].dispatch_time,
      status: dispatchResult.rows[0].status,
      ambulance_id,
      hospital_id
    });
  } catch (err) {
    await client.query('ROLLBACK');
    const statusCode = err.statusCode || 500;
    console.error('Dispatch failed:', err.message);
    res.status(statusCode).json({ error: err.message || 'Dispatch failed' });
  } finally {
    client.release();
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ProxiMed GH server running on port ${PORT}`);
});