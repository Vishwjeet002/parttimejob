// index.js
require('dotenv').config(); // load .env at top

const express = require('express');
const mysql = require('mysql2/promise'); // promise-based mysql2
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// load secrets from environment
const {
  DB_HOST,
  DB_USER,
  DB_PASSWORD,
  DB_NAME,
  DB_PORT,
  JWT_SECRET,
  PORT
} = process.env;

if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
  console.error('Missing required DB env variables. Check your .env file.');
  process.exit(1);
}

const SECRET_KEY = JWT_SECRET || 'jwt_secret';

// create a pool for better production behavior
const pool = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  port: DB_PORT ? Number(DB_PORT) : 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// quick test of the connection on startup
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log('✅ Connected to MySQL (pool).');
    conn.release();
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
    process.exit(1);
  }
})();

// Serve uploaded resumes
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configure File Upload Storage (multer)
const storage = multer.diskStorage({
  destination: path.join(__dirname, 'uploads'),
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// ---------- ROUTES (converted to async/await) ---------- //

// Fetch All Jobs with Remaining Vacancies
app.get('/jobs', async (req, res) => {
  try {
    const query = `
      SELECT id, position, vacancies, filled_positions,
             (vacancies - filled_positions) AS remaining_vacancies, requirements
      FROM jobs
    `;
    const [rows] = await pool.query(query);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Post a New Job
app.post('/jobs', async (req, res) => {
  try {
    const { position, vacancies, requirements } = req.body;
    const query = `INSERT INTO jobs (position, vacancies, filled_positions, requirements) VALUES (?, ?, 0, ?)`;
    await pool.query(query, [position, vacancies, requirements]);
    res.status(201).send('✅ Job posted successfully');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Submit a Job Application
app.post('/apply', upload.single('resume'), async (req, res) => {
  try {
    const { jobId, firstName, lastName, email, skills } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'Resume file is required' });
    }
    const resumePath = `/uploads/${req.file.filename}`;

    // Check remaining vacancies
    const [jobs] = await pool.query(`SELECT vacancies, filled_positions FROM jobs WHERE id = ?`, [jobId]);
    if (jobs.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const { vacancies, filled_positions } = jobs[0];
    if (filled_positions >= vacancies) {
      return res.status(400).json({ error: 'No vacancies left for this job' });
    }

    // Insert application
    const insertQuery = `
      INSERT INTO applications (job_id, first_name, last_name, email, skills, resume)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    await pool.query(insertQuery, [jobId, firstName, lastName, email, skills, resumePath]);

    // Update counts
    const updateQuery = `
      UPDATE jobs
      SET filled_positions = filled_positions + 1,
          vacancies = GREATEST(vacancies - 1, 0)
      WHERE id = ?
    `;
    await pool.query(updateQuery, [jobId]);

    res.status(200).send('✅ Application submitted successfully & Requirement updated');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Fetch Applicants for a Job
app.get('/applicants/:jobId', async (req, res) => {
  try {
    const jobId = req.params.jobId;
    const query = `SELECT first_name, last_name, email, skills, resume FROM applications WHERE job_id = ?`;
    const [rows] = await pool.query(query, [jobId]);
    if (!rows.length) return res.json({ message: 'No applicants yet.' });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Signup Route
app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and Password are required' });

    const hash = await bcrypt.hash(password, 10);
    const sql = 'INSERT INTO users (username, password_hash) VALUES (?, ?)';
    await pool.query(sql, [username, hash]);
    res.json({ message: '✅ User registered successfully!' });
  } catch (err) {
    console.error(err);
    // handle duplicate username error
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Login Route
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const sql = 'SELECT * FROM users WHERE username = ?';
    const [rows] = await pool.query(sql, [username]);

    if (rows.length === 0) return res.status(401).json({ error: 'User not found' });

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return res.status(401).json({ error: 'Incorrect password' });

    const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, { expiresIn: '1h' });
    res.cookie('token', token, { httpOnly: true }).json({ message: '✅ Login successful!', token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Start Server
const port = PORT || 5000;
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
