# ProxiMed GH – Hospital & Ambulance Proximity Staging App

A full-stack geospatial web application for mapping hospitals and ambulances in Ghana, with real-time proximity-based routing to help emergency responders reach patients faster.

---

## Overview

**ProxiMed GH** combines a **Node.js/Express backend** with a **Leaflet.js interactive map frontend** to visualize hospitals and ambulances across a geographic region. The application leverages **PostGIS** spatial queries to calculate real distances and identify the nearest available ambulances and hospitals for emergency dispatch.

### Key Features
- 🏥 **Hospital Locator**: Browse all registered hospitals with bed capacity and specialties
- 🚑 **Ambulance Tracking**: Real-time ambulance locations filtered by status (available, en route, busy)
- 📍 **Emergency Routing**: Click anywhere on the map to find the nearest hospital and available ambulance
- 🗺️ **Interactive Map**: Multiple base layers (streets, light, dark, satellite), zoom controls, and "locate me" feature
- 🌐 **PostGIS-Powered**: Accurate spatial distance calculations using PostgreSQL/PostGIS

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | HTML5, JavaScript (Vanilla), Leaflet.js (mapping library) |
| **Backend** | Node.js, Express.js |
| **Database** | PostgreSQL with PostGIS extension |
| **Deployment** | Works on local dev or AWS RDS + Node.js server |

---

## Project Structure

```
ProximedGH/
├── server.js              # Express backend; serves frontend + exposes /api/* endpoints
├── package.json           # Node.js dependencies and build config
├── package-lock.json      # Locked dependency versions
├── .env.example           # Template for environment variables
├── public/
│   └── index.html         # Main frontend page; Leaflet map + ambulance filters
└── README.md              # This file
```

---

## Getting Started

### Prerequisites

- **Node.js** (v14 or later)  
- **PostgreSQL** with **PostGIS** extension installed  
- A PostGIS database with `hospital` and `ambulance` tables  
- `.env` file with database credentials (see [Environment Setup](#environment-setup))

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Nii-26/ProximedGH.git
   cd ProximedGH
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your database details:
   ```env
   DB_HOST=your-rds-endpoint.rds.amazonaws.com
   DB_PORT=5432
   DB_USER=proximed
   DB_PASSWORD=your_password_here
   DB_NAME=proximed
   PORT=3000
   DB_SSL=true  # Set to true for AWS RDS; false for local Postgres
   ```

4. **Start the server:**
   ```bash
   npm start
   ```

5. **Open in browser:**
   ```
   http://localhost:3000
   ```

---

## API Endpoints

All endpoints return JSON. The frontend calls these via `fetch()`.

### 1. **Health Check**
```
GET /api/health
```
**Response:**
```json
{
  "status": "ok",
  "message": "ProxiMed GH API is running"
}
```
Use this to confirm the server and API are up.

---

### 2. **List All Hospitals**
```
GET /api/hospitals
```
**Response:**
```json
[
  {
    "hospital_id": 1,
    "name": "Korle Bu Teaching Hospital",
    "bed_capacity": 800,
    "specialties": "General, Cardiology, Neurology",
    "lat": 5.3431,
    "lng": -0.2097
  },
  ...
]
```
**Description:**  
Returns all hospitals with their location (lat/lng) and metadata. Called on page load to populate the map.

---

### 3. **List Ambulances (with optional filter)**
```
GET /api/ambulances?status=available
```

**Query Parameters:**
- `status` (optional): Filter by status. Allowed values: `available`, `en_route`, `busy`

**Response:**
```json
[
  {
    "ambulance_id": 101,
    "plate_number": "GR-1234-12",
    "status": "available",
    "station_id": 5,
    "lat": 5.3456,
    "lng": -0.2110
  },
  ...
]
```
**Description:**  
Returns ambulances filtered by status. Used for displaying and filtering ambulance markers on the map.

---

### 4. **Calculate Emergency Route**
```
GET /api/route-emergency?lat=5.3456&lng=-0.2110
```

**Query Parameters:**
- `lat` (required): Latitude of emergency location
- `lng` (required): Longitude of emergency location

**Response:**
```json
{
  "emergencyLocation": {
    "lat": 5.3456,
    "lng": -0.2110
  },
  "nearestHospitals": [
    {
      "hospital_id": 1,
      "name": "Korle Bu Teaching Hospital",
      "bed_capacity": 800,
      "distance_km": 2.34,
      "lat": 5.3431,
      "lng": -0.2097
    },
    ...
  ],
  "nearestAvailableAmbulance": {
    "ambulance_id": 101,
    "plate_number": "GR-1234-12",
    "distance_km": 1.12,
    "lat": 5.3456,
    "lng": -0.2110
  }
}
```
**Description:**  
Core routing logic. Given an emergency GPS coordinate, returns the 5 nearest hospitals and the nearest available ambulance, all ranked by **real spatial distance** (using PostGIS).

---

## Frontend Usage

### Interacting with the Map

1. **View Hospitals & Ambulances:**
   - Hospitals appear as blue **hospital emojis** (🏥)
   - Ambulances appear as colored circles (**🚑**) with status-based colors:
     - 🟢 **Green**: Available
     - 🟠 **Orange**: En route
     - 🔴 **Red**: Busy

2. **Filter Ambulances by Status:**
   - Use the checkboxes in the **Ambulance Filters** panel (top-left)
   - Select/deselect statuses to show/hide ambulances
   - Map updates in real-time

3. **Find Emergency Route:**
   - Click **"Route Emergency"** button, or
   - Click anywhere on the map to set an emergency point
   - The app calculates and displays:
     - Red marker at emergency location
     - Blue lines to nearest hospitals
     - Purple line to nearest available ambulance
   - Results appear in the **Results** panel with distances

4. **Map Controls:**
   - **Locate Me** (top-right): Centers map on your GPS position
   - **Layer Selector** (top-right): Switch between Streets, Light, Dark, or Satellite
   - **Zoom** (top-right): Zoom in/out

5. **Pop-ups:**
   - Click any hospital or ambulance marker for details
   - Shows name, bed capacity, specialties, or plate number

---

## Database Schema (Expected)

The app assumes the following PostGIS tables:

### `hospital` table
```sql
CREATE TABLE hospital (
  hospital_id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  bed_capacity INT,
  specialties TEXT,
  location GEOMETRY(Point, 4326)  -- PostGIS point in WGS84
);
```

### `ambulance` table
```sql
CREATE TABLE ambulance (
  ambulance_id SERIAL PRIMARY KEY,
  plate_number VARCHAR(20),
  status VARCHAR(20),  -- 'available', 'en_route', 'busy'
  station_id INT,
  location GEOMETRY(Point, 4326)  -- PostGIS point in WGS84
);
```

---

## Environment Variables

Create a `.env` file in the root directory:

```env
# Database connection
DB_HOST=localhost
DB_PORT=5432
DB_USER=proximed
DB_PASSWORD=your_secure_password
DB_NAME=proximed

# Server port
PORT=3000

# SSL for AWS RDS (set to 'true' for production)
DB_SSL=false
```

**Note:** Never commit the `.env` file to version control. Use `.env.example` as a template.

---

## Error Handling

### Common Issues

| Error | Cause | Solution |
|-------|-------|----------|
| "API responded with 500" | Database connection failed | Check `.env` credentials and database is running |
| "Database query failed" | Missing tables or schema | Ensure `hospital` and `ambulance` tables exist with PostGIS columns |
| "status must be one of: available, en_route, busy" | Invalid status filter | Use only valid statuses in query params |
| "Cannot GET /api/hospitals" | Server not running | Run `npm start` |

---

## Development Notes

- **CORS Enabled**: The backend allows requests from any origin (frontend can be hosted separately or on same server).
- **Static Files**: Frontend files served from `/public` directory.
- **Error Logging**: Backend logs database errors to console; check server output for debugging.
- **PostGIS Queries**: Distance calculations use `ST_Distance()` (in meters, converted to km).

---

## Future Enhancements

- [ ] Real-time ambulance tracking via WebSocket
- [ ] Patient intake/emergency call logging
- [ ] Routing optimization (multiple ambulances, multi-stop)
- [ ] Mobile app (React Native / Flutter)
- [ ] Analytics dashboard (response times, coverage maps)
- [ ] SMS alerts for ambulance dispatch

---

## License

This project is open-source. See your preferred license (e.g., MIT, GPL) for usage rights.

---

## Contributing

Contributions are welcome! Please fork the repository, create a feature branch, and submit a pull request.

```bash
git checkout -b feature/your-feature
git add .
git commit -m "Add your feature"
git push origin feature/your-feature
```

---

## Contact & Support

For issues, questions, or suggestions, please open a GitHub Issue or contact the maintainer.

**Repository:** [Nii-26/ProximedGH](https://github.com/Nii-26/ProximedGH)

---

## Acknowledgments

- [Leaflet.js](https://leafletjs.com/) – Interactive mapping library
- [PostGIS](https://postgis.net/) – Spatial database extension
- [Express.js](https://expressjs.com/) – Web framework
- OpenStreetMap contributors – Map tiles
