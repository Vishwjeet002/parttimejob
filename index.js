const express = require('express');
const mysql = require('mysql2');
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




const SECRET_KEY = 'jwt_secret';

// ✅ Connect to MySQL
const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '4205',
    database: 'nokari'
});

connection.connect(err => {
    if (err) throw err;
    console.log("✅ Connected to MySQL Database");
});



// Serve uploaded resumes
app.use('/uploads', express.static('uploads'));

// Configure File Upload Storage
const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// Fetch All Jobs with Remaining Vacancies
app.get('/jobs', (req, res) => {
    const query = `
        SELECT id, position, vacancies, filled_positions, 
               (vacancies - filled_positions) AS remaining_vacancies, requirements
        FROM jobs
    `;

    connection.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Post a New Job
app.post('/jobs', (req, res) => {
    const { position, vacancies, requirements } = req.body;

    const query = `INSERT INTO jobs (position, vacancies, filled_positions, requirements) VALUES (?, ?, 0, ?)`;
    connection.query(query, [position, vacancies, requirements], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).send("✅ Job posted successfully");
    });
});

// Submit a Job Application
app.post('/apply', upload.single('resume'), (req, res) => {
    const { jobId, firstName, lastName, email, skills } = req.body;
    const resumePath = `/uploads/${req.file.filename}`;

    // Check if there are remaining vacancies
    connection.query(`SELECT vacancies, filled_positions FROM jobs WHERE id = ?`, [jobId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        if (results.length === 0) {
            return res.status(404).json({ error: "Event not found" });
        }

        const { vacancies, filled_positions } = results[0];
        if (filled_positions >= vacancies) {
            return res.status(400).json({ error: "No vacancies left for this Event" });
        }

        // Insert Application
        const insertQuery = `
            INSERT INTO applications (job_id, first_name, last_name, email, skills, resume)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        connection.query(insertQuery, [jobId, firstName, lastName, email, skills, resumePath], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });

            // Update Filled Positions and Decrease Vacancies
            const updateQuery = `
                UPDATE jobs 
                SET filled_positions = filled_positions + 1, 
                    vacancies = vacancies - 1 
                WHERE id = ?
            `;
            connection.query(updateQuery, [jobId], (err, updateResult) => {
                if (err) return res.status(500).json({ error: err.message });
                res.status(200).send("✅ Application submitted successfully & Requirement updated");
            });
        });
    });
});

// Fetch Applicants for a Job
app.get('/applicants/:jobId', (req, res) => {
    const jobId = req.params.jobId;

    const query = `SELECT first_name, last_name, email, skills, resume FROM applications WHERE job_id = ?`;
    connection.query(query, [jobId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        if (results.length === 0) {
            return res.json({ message: "No applicants yet." });
        }

        res.json(results);
    });
});





// ✅ Signup Route (Only Username & Password)
app.post('/register', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: '❌ Username and Password are required!' });
    }

    bcrypt.hash(password, 10, (err, hash) => {
        if (err) return res.status(500).json({ error: err.message });

        const sql = 'INSERT INTO users (username, password_hash) VALUES (?, ?)';
        connection.query(sql, [username, hash], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: '✅ User registered successfully!' });
        });
    });
});

// ✅ Login Route (Verify Username & Password)
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    const sql = 'SELECT * FROM users WHERE username = ?';
    connection.query(sql, [username], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        if (results.length === 0) {
            return res.status(401).json({ error: '❌ User not found!' });
        }

        const user = results[0];
        bcrypt.compare(password, user.password_hash, (err, isMatch) => {
            if (err) return res.status(500).json({ error: err.message });

            if (!isMatch) {
                return res.status(401).json({ error: '❌ Incorrect password!' });
            }

            const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, { expiresIn: '1h' });

            res.cookie('token', token, { httpOnly: true }).json({ message: '✅ Login successful!', token });
        });
    });
});

// ✅ Start Server
app.listen(5000, () => {
    console.log("🚀 Server running on port 5000");
});














// // Start Server
// app.listen(5000, () => {
//     console.log("🚀 Server running on port 5000");
// });