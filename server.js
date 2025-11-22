// server.js
// --- Required Node.js Modules ---
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs/promises');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

// --- Ngrok Modules & Setup ---
const ngrok = require('ngrok');
require('dotenv').config();

// --- Server Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e8, // 100 MB limit
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// ⭐ START: CONTENT SECURITY POLICY MIDDLEWARE
// This block fixes the "default-src 'none'" error by setting a proper security policy.
app.use((req, res, next) => {
    res.setHeader(
        'Content-Security-Policy',
        // FIX: Added cdn.jsdelivr.net to style-src and cdn.socket.io to script-src
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdn.socket.io; " +
        "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com https://cdn.jsdelivr.net; " +
        "font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com; " +
        "img-src 'self' data:; " +
        "connect-src 'self' https://*.ngrok-free.app wss://*.ngrok-free.app;"
    );
    next();
});
// ⭐ END: MIDDLEWARE

// Serve static files (your HTML, CSS, JS, images).
app.use(express.static(path.join(__dirname, 'public')));
// Increase limit for standard JSON requests as well
app.use(express.json({ limit: '50mb' }));
// This is critical for ngrok and external access to work correctly.
app.use(cors());

// --- Directories Setup (FIXED: Moved to the top of the file) ---
const uploadDir = path.join(__dirname, 'public', 'uploads');
const tempUploadDir = path.join(__dirname, 'temp_uploads');

// --- MySQL Database Connection (UPDATED FOR RENDER/CLOUD) ---
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'telecon',
    // Cloud databases often require SSL. Check environment variable.
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined
};

const pool = mysql.createPool(dbConfig);


// ⭐ START: FIX - ADDED MULTER CONFIGURATION & UPLOAD ROUTE
// --- Multer Configuration for File Uploads ---
// This tells multer where to save the files and what to name them.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Files will be saved in the 'public/uploads' directory.
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // To avoid name conflicts, we add a timestamp to the original file name.
    const safeFilename = file.originalname.replace(/\s/g, '_');
    cb(null, Date.now() + '-' + safeFilename);
  }
});

const upload = multer({ storage: storage });

// --- Route to Handle File Uploads ---
// This is the endpoint your client-side code is trying to POST to.
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    // If no file was uploaded, send an error status.
    console.warn('[Upload] Received upload request with no file.');
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  // If the file was uploaded successfully, send back a success response.
  // The client-side code expects a JSON object with a 'url' property.
  const fileUrl = `/uploads/${req.file.filename}`;
  console.log(`[Upload] File '${req.file.originalname}' uploaded successfully. Available at: ${fileUrl}`);
  res.status(200).json({
    message: 'File uploaded successfully',
    url: fileUrl
  });
});
// ⭐ END: FIX


// ⭐ START: ROUTE HANDLER FOR VIDEO CALLS
// This route handles GET requests to /call/:roomId, fixing the "Cannot GET" error.
app.get('/call/:roomId', async (req, res) => {
    const { roomId } = req.params;
    const { token } = req.query; // Token is expected for validation

    if (!token) {
        console.warn(`[Call Route] Access denied for room ${roomId}. Token is missing.`);
        return res.status(401).send('Authentication token is missing. You cannot join this call.');
    }

    try {
        // Validate that an appointment exists with this ID and token
        const [rows] = await pool.query(
            'SELECT id FROM appointments WHERE id = ? AND authToken = ?',
            [roomId, token]
        );

        if (rows.length === 0) {
            console.warn(`[Call Route] Invalid access attempt for room ${roomId}. Room not found or token is invalid.`);
            return res.status(404).send('Call room not found or your link is invalid.');
        }

        // If validation passes, serve the main video call page.
        console.log(`[Call Route] Serving main.html for room ${roomId}.`);
        res.sendFile(path.join(__dirname, 'public', 'main.html'));

    } catch (error) {
        console.error(`[Call Route] Server error validating call room ${roomId}:`, error);
        res.status(500).send('Server error while trying to join the call.');
    }
});
// ⭐ END: ROUTE HANDLER

async function testDbConnection() {
    let connection;
    try {
        connection = await pool.getConnection();
        console.log('[MySQL] Successfully connected to the database.');
        connection.release();
    } catch (error) {
        console.error('[MySQL] !!! CRITICAL: Could not connect to the database. !!!');
        console.error(`[MySQL] Error: ${error.message}`);
        console.error('[MySQL] Please check your dbConfig in server.js and ensure the MySQL server is running.');
        throw error; // Throw the error so the main process can catch it.
    } finally {
        if (connection) connection.release();
    }
}

// --- ⭐ FIX: ADDED DATABASE SCHEMA INITIALIZATION & MIGRATION ---
async function ensureDatabaseSchema() {
    console.log('[MySQL] Verifying and updating database schema...');
    let connection;
    try {
        connection = await pool.getConnection();

        // Check for 'isOnline' column in 'users' table
        const [isOnlineRows] = await connection.query(
            "SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'isOnline'",
            [dbConfig.database]
        );
        if (isOnlineRows.length === 0) {
            console.log('[MySQL] Schema Update: "isOnline" column missing in "users" table. Adding it...');
            await connection.query("ALTER TABLE users ADD COLUMN isOnline TINYINT(1) DEFAULT 0");
            console.log('[MySQL] Schema Update: "isOnline" column added successfully.');
        }

        // Check for 'profilePicture' column in 'users' table
        const [profilePictureRows] = await connection.query(
            "SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'profilePicture'",
            [dbConfig.database]
        );
        if (profilePictureRows.length === 0) {
            console.log('[MySQL] Schema Update: "profilePicture" column missing in "users" table. Adding it...');
            await connection.query("ALTER TABLE users ADD COLUMN profilePicture VARCHAR(255) DEFAULT NULL");
            console.log('[MySQL] Schema Update: "profilePicture" column added successfully.');
        }
        
        console.log('[MySQL] Database schema verification complete.');

    } catch (error) {
        console.error('[MySQL] !!! CRITICAL: Failed to verify or update database schema. !!!');
        throw error;
    } finally {
        if (connection) connection.release();
    }
}


async function createUsersTable() {
    const sql = `
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(255) NOT NULL UNIQUE,
            email VARCHAR(255) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            fullname VARCHAR(255),
            role ENUM('Patient', 'Doctor', 'Admin') NOT NULL,
            specialty VARCHAR(255),
            dob DATE,
            gender VARCHAR(20),
            address TEXT,
            phone VARCHAR(50),
            profilePicture VARCHAR(255),
            isOnline TINYINT(1) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
    try {
        await pool.query(sql);
        console.log('[MySQL] "users" table checked/created successfully.');
    } catch (error) {
        console.error('[MySQL] Error creating "users" table:', error);
        throw error;
    }
}

async function createAppointmentsTable() {
    const sql = `
        CREATE TABLE IF NOT EXISTS appointments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            patientName VARCHAR(255) NOT NULL,
            doctorName VARCHAR(255),
            specialty VARCHAR(255),
            subject VARCHAR(255) NOT NULL,
            appointmentDate DATE NOT NULL,
            appointmentTime TIME NOT NULL,
            status VARCHAR(50) DEFAULT 'Pending',
            notes TEXT,
            rejectionNotes TEXT,
            authToken VARCHAR(255),
            roomCreated TINYINT(1) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
    try {
        await pool.query(sql);
        console.log('[MySQL] "appointments" table checked/created successfully.');
    } catch (error) {
        console.error('[MySQL] Error creating "appointments" table:', error);
        throw error;
    }
}

async function createMedicalHistoryTable() {
    const sql = `
        CREATE TABLE IF NOT EXISTS medical_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            appointment_id INT NOT NULL,
            patient_username VARCHAR(255) NOT NULL,
            doctor_username VARCHAR(255) NOT NULL,
            diagnosis VARCHAR(255) NOT NULL,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
     try {
        await pool.query(sql);
        console.log('[MySQL] "medical_history" table checked/created successfully.');
    } catch (error) {
        console.error('[MySQL] Error creating "medical_history" table:', error);
        throw error;
    }
}

async function createRoomsTable() {
    const sql = `
        CREATE TABLE IF NOT EXISTS rooms (
            room_id VARCHAR(255) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (room_id)
        );
    `;
    try {
        await pool.query(sql);
        console.log('[MySQL] "rooms" table checked/created successfully.');
    } catch (error) {
        console.error('[MySQL] Error creating "rooms" table:', error);
        throw error;
    }
}

async function createChatHistoryTable() {
    const sql = `
        CREATE TABLE IF NOT EXISTS chat_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            room_id_fk VARCHAR(255) NOT NULL,
            username VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            file_url VARCHAR(255),
            timestamp TIMESTAMP NOT NULL,
            senderId VARCHAR(255),
            receiverId VARCHAR(255),
            appointmentId INT
        );
    `;
    try {
        await pool.query(sql);
        console.log('[MySQL] "chat_history" table checked/created successfully.');
    } catch (error) {
        console.error('[MySQL] Error creating "chat_history" table:', error);
        throw error;
    }
}

async function createActivityLogsTable() {
    const createTableSql = "CREATE TABLE IF NOT EXISTS activity_logs (id INT AUTO_INCREMENT PRIMARY KEY, message TEXT NOT NULL, `timestamp` TIMESTAMP DEFAULT CURRENT_TIMESTAMP);";
    try {
        await pool.query(createTableSql);
        console.log('[MySQL] "activity_logs" table checked/created successfully.');
    } catch (error) {
        console.error('[MySQL] Error creating "activity_logs" table:', error);
        throw error;
    }
}
// --- END DATABASE SCHEMA INITIALIZATION ---


/**
 * Saves an activity message to the database and broadcasts it to all admins.
 * @param {string} message The activity message to log.
 */
async function logActivity(message) {
    try {
        const sql = `INSERT INTO activity_logs (message) VALUES (?)`.trim();
        const [result] = await pool.query(sql, [message]);
        const insertId = result.insertId;

        const [rows] = await pool.query('SELECT message, `timestamp` FROM activity_logs WHERE id = ?', [insertId]);
        const newActivity = rows[0];

        if (newActivity) {
            const sockets = await io.fetchSockets();
            sockets.forEach(sock => {
                if (sock.data.user?.role === 'Admin') {
                    sock.emit('admin:activity:new', {
                        message: newActivity.message,
                        timestamp: newActivity.timestamp
                    });
                }
            });
            console.log(`[Activity Log] Logged and broadcasted: "${message}"`);
        }
    } catch (error) {
        console.error('[Activity Log] Failed to log activity:', error);
    }
}

/**
 * Notifies relevant parties about an appointment update for real-time dashboard sync.
 * This function now emits a single 'appointments:update' event to all clients to trigger a full refresh.
 * @param {string | number} appointmentId The ID of the appointment that was modified.
 * @param {object} [notification] Optional notification payload for specific users.
 * @param {string} [notification.patientMessage] A specific message to show the patient as a toast/notification.
 * @param {string} [notification.doctorMessage] A specific message to show the doctor as a toast/notification.
 */
async function notifyAppointmentUpdate(appointmentId, notification) {
    try {
        const [appRows] = await pool.query(
            `SELECT patientName, doctorName FROM appointments WHERE id = ?`.trim(),
            [appointmentId]
        );
        if (appRows.length === 0) {
            console.warn(`[Notify] Could not find appointment #${appointmentId} to broadcast update.`);
            return;
        }
        const { patientName, doctorName } = appRows[0];
        
        // Emitting a generic 'refetch' event is more efficient than sending the whole list,
        // as it allows clients to re-request their own filtered data.
        io.emit('appointments:refetch');

        if (notification?.doctorMessage && doctorName) {
            io.to(`user_room_${doctorName}`).emit('notification', { message: notification.doctorMessage });
        }
        if (notification?.patientMessage && patientName) {
            io.to(`user_room_${patientName}`).emit('notification', { message: notification.patientMessage });
        }

        console.log(`[Notify] Successfully sent sync updates for appointment #${appointmentId} to all relevant parties.`);
    } catch (error) {
        console.error(`[Notify] Failed to send notifications for appointment #${appointmentId}:`, error);
    }
}

// --- Chat History & User Database Operations ---

async function createOrGetRoomInDb(roomId) {
    // ⭐ FIX: Prevent null/undefined room IDs by throwing an error.
    if (!roomId) {
        throw new Error(`Invalid room ID provided: ${roomId}`);
    }
    const sql = 'INSERT INTO rooms (room_id, created_at) VALUES (?, NOW()) ON DUPLICATE KEY UPDATE room_id=room_id;'.trim();
    try {
        await pool.query(sql, [roomId]);
        console.log(`[MySQL] Ensured room "${roomId}" exists in the database.`);
    } catch (error) {
        console.error(`[MySQL] Error ensuring room "${roomId}" exists in DB:`, error);
        throw error; // Re-throw to be caught by the calling function
    }
}

async function saveChatMessage(room, messageObj) {
    const sql = `INSERT INTO chat_history (room_id_fk, username, message, file_url, timestamp, senderId, receiverId, appointmentId) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`.trim();
    const params = [
        room,
        messageObj.username,
        messageObj.message,
        messageObj.fileUrl,
        new Date(messageObj.timestamp),
        messageObj.senderId,
        messageObj.receiverId,
        messageObj.appointmentId
    ];

    try {
        await createOrGetRoomInDb(room); // This will now throw if `room` is invalid
        await pool.query(sql, params);
        console.log(`[MySQL] SUCCESS: Saved message for room "${room}" to database.`);
    } catch (error) {
        // This will catch the error from createOrGetRoomInDb or the INSERT query
        console.error(`[MySQL] ERROR: Failed to save message for room "${room}". Reason:`, error.message);
    }
}

async function loadChatHistory(room) {
    const sql = `SELECT username, message, file_url, timestamp FROM chat_history WHERE room_id_fk = ? ORDER BY timestamp ASC;`.trim();
    try {
        const [rows] = await pool.query(sql, [room]);
        console.log(`[MySQL] Loaded ${rows.length} messages for room "${room}".`);
        return rows.map(row => ({
            username: row.username,
            message: row.message,
            fileUrl: row.file_url,
            timestamp: new Date(row.timestamp).toISOString()
        }));
    } catch (error) {
        console.error(`[MySQL] Error loading chat history for room "${room}":`, error);
        return [];
    }
}

// ⭐ FIX: Modified to filter out 'Completed', 'Rejected', and 'Cancelled' statuses for patients.
// ⭐⭐ FIX 2: Added LEFT JOIN to fetch doctor details for the message view.
async function loadAppointmentsForPatient(patientName) {
    const sql = `
        SELECT
            app.*,
            doctor.fullname AS doctorFullName,
            doctor.profilePicture AS doctorProfilePic
        FROM appointments AS app
        LEFT JOIN users AS doctor ON app.doctorName = doctor.username
        WHERE app.patientName = ?  // <--- FIXED: Removed the status filter
        ORDER BY app.created_at DESC
    `.trim();
    try {
        const [rows] = await pool.query(sql, [patientName]);
        return rows;
    } catch (error) {
        console.error(`[Appointments] Error loading appointments for patient ${patientName}:`, error);
        throw error; 
    }
}


async function loadAppointmentsForDoctor(doctorName) {
    const sql = `SELECT * FROM appointments WHERE doctorName = ? AND status NOT IN ('Completed', 'Rejected', 'Cancelled') ORDER BY created_at DESC`.trim();
    const [rows] = await pool.query(sql, [doctorName]);
    return rows;
}

// This function remains unfiltered for the Admin role.
async function loadAllAppointments() {
    const sql = `SELECT app.*, patient.fullname AS patientFullName, patient.profilePicture AS patientProfilePic, doctor.fullname AS doctorFullName, doctor.profilePicture AS doctorProfilePic FROM appointments AS app LEFT JOIN users AS patient ON app.patientName = patient.username LEFT JOIN users AS doctor ON app.doctorName = doctor.username ORDER BY app.created_at DESC`.trim();
    try {
        const [rows] = await pool.query(sql);
        return rows;
    } catch (error) {
        console.error('Error loading all appointments:', error);
        throw error;
    }
}

// ⭐ NEW: Added a dedicated function to load appointments for the doctor dashboard view.
async function loadAppointmentsForDoctorDashboard(doctorName, specialty) {
    const sql = `
        SELECT app.*,
               patient.fullname AS patientFullName,
               patient.profilePicture AS patientProfilePic,
               doctor.fullname AS doctorFullName,
               doctor.profilePicture AS doctorProfilePic
        FROM appointments AS app
        LEFT JOIN users AS patient ON app.patientName = patient.username
        LEFT JOIN users AS doctor ON app.doctorName = doctor.username
        WHERE (app.doctorName = ? OR (app.specialty = ? AND app.status = 'Pending'))
          AND app.status NOT IN ('Completed', 'Rejected', 'Cancelled')
        ORDER BY app.created_at DESC
    `.trim();
    try {
        const [rows] = await pool.query(sql, [doctorName, specialty]);
        return rows;
    } catch (error) {
        console.error(`Error loading dashboard appointments for Doctor ${doctorName}:`, error);
        throw error;
    }
}


async function getDoctorPatients(doctorName) {
    const sql = `SELECT DISTINCT p.username AS patientUsername, p.fullname AS patientName, p.profilePicture AS patientProfilePicture FROM appointments AS a INNER JOIN users AS p ON a.patientName = p.username WHERE a.doctorName = ? AND a.status IN ('Accepted', 'Completed') ORDER BY a.appointmentDate DESC, a.appointmentTime DESC;`.trim();
    try {
        const [rows] = await pool.query(sql, [doctorName]);
        console.log(`[Messages] Found ${rows.length} patients for doctor '${doctorName}'.`);
        return rows;
    } catch (error) {
        console.error(`[Messages] Error fetching patient list for doctor '${doctorName}':`, error);
        return [];
    }
}

async function getChatHistoryForDoctor(doctorUsername, patientUsername) {
    const sql = `SELECT ch.message, ch.file_url AS fileUrl, ch.timestamp, ch.username AS senderUsername, u.fullname AS senderName, ch.appointmentId FROM chat_history AS ch INNER JOIN appointments AS a ON ch.appointmentId = a.id INNER JOIN users AS u ON ch.username = u.username WHERE (a.doctorName = ? AND a.patientName = ?) ORDER BY ch.timestamp ASC;`.trim();
    try {
        const [rows] = await pool.query(sql, [doctorUsername, patientUsername]);
        console.log(`[Messages] Loaded ${rows.length} messages for doctor '${doctorUsername}' and patient '${patientUsername}'.`);
        return rows;
    } catch (error) {
        console.error(`[Messages] Error fetching chat history for patient '${patientUsername}':`, error);
        return [];
    }
}

async function getChatHistoryForPatient(patientUsername, doctorUsername) {
    const sql = `SELECT ch.message, ch.file_url AS fileUrl, ch.timestamp, ch.username AS senderUsername, u.fullname AS senderName, ch.appointmentId FROM chat_history AS ch INNER JOIN appointments AS a ON ch.appointmentId = a.id INNER JOIN users AS u ON ch.username = u.username WHERE (a.patientName = ? AND a.doctorName = ?) ORDER BY ch.timestamp ASC;`.trim();
    try {
        const [rows] = await pool.query(sql, [patientUsername, doctorUsername]);
        console.log(`[Messages] Loaded ${rows.length} messages for patient '${patientUsername}' and doctor '${doctorUsername}'.`);
        return rows;
    } catch (error) {
        console.error(`[Messages] Error fetching chat history for patient '${patientUsername}':`, error);
        return [];
    }
}

async function fetchDashboardStats() {
    try {
        const [consultationsToday] = await pool.query(`SELECT COUNT(*) as count FROM appointments WHERE DATE(appointmentDate) = CURDATE() AND status = 'Completed'`.trim());
        const [pendingAppointments] = await pool.query(`SELECT COUNT(*) as count FROM appointments WHERE status = 'Pending'`.trim());
        const [activeDoctors] = await pool.query(`SELECT COUNT(*) as count FROM users WHERE role = 'Doctor' AND isOnline = 1`.trim());
        const [newPatientsToday] = await pool.query(`SELECT COUNT(*) as count FROM users WHERE role = 'Patient' AND DATE(created_at) = CURDATE()`.trim());

        return {
            consultationsToday: consultationsToday[0].count,
            pendingAppointments: pendingAppointments[0].count,
            activeDoctors: activeDoctors[0].count,
            newPatientsCount: newPatientsToday[0].count
        };
    } catch (error) {
        console.error('[Admin Dashboard] Error fetching dashboard stats:', error);
        return {};
    }
}

async function fetchMainDashboardChartData() {
    try {
        const sql = `SELECT DATE_FORMAT(appointments.created_at, '%Y-%m-%d') AS period, COUNT(DISTINCT CASE WHEN appointments.status = 'Completed' THEN appointments.id ELSE NULL END) AS consultations, COUNT(DISTINCT CASE WHEN users.role = 'Patient' THEN users.id ELSE NULL END) AS newPatients FROM appointments LEFT JOIN users ON DATE(users.created_at) = DATE(appointments.created_at) AND users.role = 'Patient' WHERE appointments.created_at >= CURDATE() - INTERVAL 7 DAY GROUP BY period ORDER BY period ASC`.trim();
        const [rows] = await pool.query(sql);

        const labels = [];
        const consultations = [];
        const newPatients = [];
        
        for (let i = 6; i >= 0; i--) {
            const date = new Date(new Date().setDate(new Date().getDate() - i)).toISOString().slice(0, 10);
            labels.push(date);
            const dataRow = rows.find(row => row.period === date);
            consultations.push(dataRow ? dataRow.consultations : 0);
            newPatients.push(dataRow ? dataRow.newPatients : 0);
        }

        return { labels, consultations, newPatients };
    } catch (error) {
        console.error('[Admin Dashboard] Error fetching main dashboard chart data:', error);
        return { labels: [], consultations: [], newPatients: [] };
    }
}

async function fetchCalendarAppointments(start, end) {
    try {
        const sql = `
            SELECT
                a.id, a.appointmentDate, a.appointmentTime, a.status, a.patientName, a.doctorName, a.subject,
                p.fullname AS patientFullName,
                d.fullname AS doctorFullName
            FROM appointments a
            LEFT JOIN users p ON a.patientName = p.username
            LEFT JOIN users d ON a.doctorName = d.username
            WHERE a.appointmentDate BETWEEN ? AND ?
        `.trim();
        const [rows] = await pool.query(sql, [start, end]);
        
        return rows;
    } catch (error) {
        console.error('[Admin Calendar] Error fetching appointments:', error);
        return [];
    }
}
async function fetchDoctorAppointments(doctorUsername, start, end) {
    try {
        const sql = `
            SELECT
                a.id, a.appointmentDate, a.appointmentTime, a.status, a.patientName, a.doctorName, a.subject,
                p.fullname AS patientFullName,
                d.fullname AS doctorFullName
            FROM appointments a
            LEFT JOIN users p ON a.patientName = p.username
            LEFT JOIN users d ON a.doctorName = d.username
            WHERE a.doctorName = ? AND a.appointmentDate BETWEEN ? AND ?
        `.trim();
        const [rows] = await pool.query(sql, [doctorUsername, start, end]);

        return rows;
    } catch (error) {
        console.error('[Doctor Calendar] Error fetching appointments for doctor:', error);
        return [];
    }
}
function getStatusColor(status) {
    switch (status) {
        case 'Pending': return '#FFD700'; // Gold
        case 'Accepted': return '#32CD32'; // LimeGreen
        case 'Completed': return '#808080'; // Gray
        case 'Rejected':
        case 'Cancelled': return '#DC143C'; // Crimson
        case 'Rescheduled-Pending': return '#FFA500'; // Orange
        default: return '#007BFF'; // Blue
    }
}

async function fetchActivityFeed() {
    try {
        const [rows] = await pool.query('SELECT message, `timestamp` FROM activity_logs ORDER BY `timestamp` DESC LIMIT 10'.trim());
        return rows;
    } catch (error) {
        console.error('[Admin Dashboard] Error fetching activity feed:', error);
        return [];
    }
}

async function fetchTopDiagnoses(filter = 'week', startDate = null, endDate = null) {
    try {
        let sql = `SELECT diagnosis, COUNT(*) AS count FROM medical_history WHERE diagnosis IS NOT NULL AND diagnosis != ''`.trim();
        const params = [];
        const now = new Date();

        switch (filter) {
            case 'day':
                sql += ' AND DATE(created_at) = CURDATE()';
                break;
            case 'week':
                sql += ' AND YEARWEEK(created_at, 1) = YEARWEEK(CURDATE(), 1)';
                break;
            case 'month':
                sql += ' AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())';
                break;
            case 'range':
                if (startDate && endDate) {
                    sql += ' AND created_at BETWEEN ? AND ?';
                    params.push(startDate, endDate);
                }
                break;
        }

        sql += ' GROUP BY diagnosis ORDER BY count DESC LIMIT 10';
        const [rows] = await pool.query(sql, params);
        return { labels: rows.map(r => r.diagnosis), data: rows.map(r => r.count) };
    } catch (error) {
        console.error('[Analytics] Error fetching top diagnoses:', error);
        return { labels: [], data: [] };
    }
}

async function fetchConsultationsOverTime(filter = 'week', startDate = null, endDate = null) {
    try {
        let sql;
        const params = [];
        const now = new Date();

        switch (filter) {
            case 'day':
                sql = `SELECT HOUR(created_at) AS period, COUNT(*) AS count FROM appointments WHERE DATE(created_at) = CURDATE() AND status = 'Completed' GROUP BY period ORDER BY period ASC`.trim();
                break;
            case 'week':
                sql = `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS period, COUNT(*) AS count FROM appointments WHERE YEARWEEK(created_at, 1) = YEARWEEK(CURDATE(), 1) AND status = 'Completed' GROUP BY period ORDER BY period ASC`.trim();
                break;
            case 'month':
                sql = `SELECT DATE_FORMAT(created_at, '%Y-%m') AS period, COUNT(*) AS count FROM appointments WHERE YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE()) AND status = 'Completed' GROUP BY period ORDER BY period ASC`.trim();
                break;
            case 'range':
                if (startDate && endDate) {
                    sql = `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS period, COUNT(*) AS count FROM appointments WHERE created_at BETWEEN ? AND ? AND status = 'Completed' GROUP BY period ORDER BY period ASC`.trim();
                    params.push(startDate, endDate);
                } else {
                    throw new Error('Start and End dates are required for custom range.');
                }
                break;
            default:
                throw new Error('Invalid filter provided for consultations over time.');
        }

        const [rows] = await pool.query(sql, params);
        return { labels: rows.map(r => r.period), data: rows.map(r => r.count) };
    } catch (error) {
        console.error('[Analytics] Error fetching consultations over time:', error);
        return { labels: [], data: [] };
    }
}

async function fetchDoctorLoad() {
    try {
        const [rows] = await pool.query(`SELECT d.fullname AS doctorName, COUNT(a.id) AS consultationCount FROM users d JOIN appointments a ON d.username = a.doctorName WHERE d.role = 'Doctor' GROUP BY doctorName ORDER BY consultationCount DESC LIMIT 10`.trim());
        return { labels: rows.map(r => r.doctorName), data: rows.map(r => r.consultationCount) };
    } catch (error) {
        console.error('[Analytics] Error fetching doctor load:', error);
        return { labels: [], data: [] };
    }
}


async function fetchPatientDemographics() {
    try {
        const [genderData] = await pool.query(`SELECT CASE WHEN gender IS NULL OR gender = '' THEN 'Unspecified' ELSE gender END AS gender, COUNT(*) AS count FROM users WHERE role = 'Patient' GROUP BY gender`.trim());
        const [ageData] = await pool.query(`SELECT CASE WHEN TIMESTAMPDIFF(YEAR, dob, CURDATE()) < 18 THEN 'Under 18' WHEN TIMESTAMPDIFF(YEAR, dob, CURDATE()) BETWEEN 18 AND 29 THEN '18-29' WHEN TIMESTAMPDIFF(YEAR, dob, CURDATE()) BETWEEN 30 AND 49 THEN '30-49' WHEN TIMESTAMPDIFF(YEAR, dob, CURDATE()) >= 65 THEN '65+' ELSE 'Unknown' END AS ageGroup, COUNT(*) AS count FROM users WHERE role = 'Patient' AND dob IS NOT NULL GROUP BY ageGroup ORDER BY ageGroup`.trim());
        const [diagnosisData] = await pool.query(`SELECT diagnosis, COUNT(*) AS count FROM medical_history WHERE diagnosis IS NOT NULL AND diagnosis != '' GROUP BY diagnosis ORDER BY count DESC`.trim());

        return {
            gender: {
                labels: genderData.map(d => d.gender),
                data: genderData.map(d => d.count)
            },
            age: {
                labels: ageData.map(d => d.ageGroup),
                data: ageData.map(d => d.count)
            },
            combinedDiagnosis: {
                labels: diagnosisData.map(d => d.diagnosis),
                data: diagnosisData.map(d => d.count)
            }
        };
    } catch (error) {
        console.error('[Analytics] Error fetching patient demographics:', error);
        return {};
    }
}


// --- In-Memory User Management & Online Status ---
const usersInRooms = new Map();
const onlineUsers = new Set();
const userSockets = new Map();

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // --- MODIFIED: Added broadcast event for online status updates ---
    socket.on('user:online', async ({ username }, callback) => {
        if (!username) {
            console.warn(`[Online Status] Received 'user:online' event without a username.`);
            return callback && callback({ success: false, message: 'Username not provided.' });
        }
        
        try {
            const [rows] = await pool.query('SELECT username, role, fullname, specialty FROM users WHERE username = ? LIMIT 1'.trim(), [username]);
        
            if (rows.length > 0) {
                const user = rows[0];
                socket.data.user = {
                    username: user.username,
                    role: user.role,
                    fullName: user.fullname,
                    specialty: user.specialty
                };
        
                const userRoom = `user_room_${user.username}`;
                socket.join(userRoom);
                console.log(`[Socket Rooms] User '${user.username}' (socket ${socket.id}) joined their private room: ${userRoom}`);

                userSockets.set(socket.id, user.username);
                // Check if the user is already marked as online by another device
                if (!onlineUsers.has(user.username)) {
                    onlineUsers.add(user.username);
                    await pool.query('UPDATE users SET isOnline = 1 WHERE username = ?'.trim(), [user.username]);
                    console.log(`[Online Status] User '${user.username}' is now online.`);
                    // Broadcast the online status change to all clients
                    io.emit('user:status-changed', { username: user.username, isOnline: true });
                }
        
                console.log(`[Online Status] Associated socket ${socket.id} with user '${user.username}'. Total online users: ${onlineUsers.size}`);
        
                return callback && callback({ success: true, user: socket.data.user });
            } else {
                console.warn(`[Online Status] User '${username}' not found in database.`);
                return callback && callback({ success: false, message: 'User not found.' });
            }
        } catch (error) {
            console.error(`[Online Status] Database error for user '${username}':`, error);
            return callback && callback({ success: false, message: 'An internal server error occurred.' });
        }
    });

    // --- NEW: Handler to check a specific user's online status ---
    socket.on('user:get:online-status', (data, callback) => {
        const { username } = data;
        if (!username) {
            return callback({ isOnline: false });
        }
        const isOnline = onlineUsers.has(username);
        callback({ isOnline });
    });
    
    socket.on('patient:get:profile', async (data) => {
        const { username } = data;
        if (!username) return;

        console.log(`[Profile] Fetching profile for patient: ${username}`);
        try {
            const sql = 'SELECT username, fullname AS fullName, email, phone, address, dob, profilePicture FROM users WHERE username = ? AND role = "Patient"'.trim();
            const [rows] = await pool.query(sql, [username]);

            if (rows.length > 0) {
                const userProfile = rows[0];
                if (userProfile.dob) {
                    const birthDate = new Date(userProfile.dob);
                    const today = new Date();
                    let age = today.getFullYear() - birthDate.getFullYear();
                    const monthDifference = today.getMonth() - birthDate.getMonth();
                    if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < birthDate.getDate())) {
                        age--;
                    }
                    userProfile.age = age;
                }
                socket.emit('patient:profile:data', userProfile);
            } else {
                console.warn(`[Profile] Patient profile not found for user: ${username}`);
            }
        } catch (error) {
            console.error(`[Profile] Error fetching patient profile for ${username}:`, error);
        }
    });

    socket.on('patient:update:profile', async (data) => {
        const { username, email, phone } = data;
        console.log(`[Profile] Updating profile for patient: ${username}`);
        try {
            const sql = 'UPDATE users SET email = ?, phone = ? WHERE username = ? AND role = "Patient"'.trim();
            await pool.query(sql, [email, phone, username]);
            socket.emit('patient:profile:updated', { success: true });
        } catch (error) {
            console.error(`[Profile] Error updating profile for ${username}:`, error);
            socket.emit('patient:profile:updated', { success: false, message: 'Failed to update profile.' });
        }
    });

    socket.on('patient:change:password', async (data) => {
        const { username, currentPassword, newPassword } = data;
        console.log(`[Profile] Password change attempt for user: ${username}`);
        try {
            const [rows] = await pool.query('SELECT password FROM users WHERE username = ?'.trim(), [username]);
            if (rows.length === 0) {
                return socket.emit('patient:password:changed', { success: false, message: 'User not found.' });
            }
            const user = rows[0];
            const isMatch = await bcrypt.compare(currentPassword, user.password);
            if (!isMatch) {
                return socket.emit('patient:password:changed', { success: false, message: 'Incorrect current password.' });
            }
            const saltRounds = 10;
            const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);
            await pool.query('UPDATE users SET password = ? WHERE username = ?'.trim(), [hashedNewPassword, username]);
            socket.emit('patient:password:changed', { success: true });
        } catch (error) {
            console.error(`[Profile] Error changing password for ${username}:`, error);
            socket.emit('patient:password:changed', { success: false, message: 'Server error during password change.' });
        }
    });

    socket.on('patient:update:profile-picture', async (data) => {
        if (!data || !data.username || !data.imageData) {
            console.error('[Profile] Invalid data received for profile picture update.');
            return socket.emit('patient:profile-picture:updated', { success: false, message: 'Invalid request data.' });
        }
        
        const { username, imageData } = data;
        console.log(`[Profile] Updating profile picture for user: ${username}`);
        
        try {
            const matches = imageData.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
            
            if (!matches || matches.length !== 3) {
                throw new Error('Invalid base64 image data format.');
            }

            let imageType = matches[1];
            let extension = imageType.split('+')[0]; // Handles types like 'svg+xml' -> 'svg'
            
            const imageBuffer = Buffer.from(matches[2], 'base64');
            
            const filename = `avatar_${username}_${Date.now()}.${extension}`;
            const filepath = path.join(uploadDir, filename);
            const fileUrl = `/uploads/${filename}`;

            await fs.writeFile(filepath, imageBuffer);
            
            await pool.query('UPDATE users SET profilePicture = ? WHERE username = ?'.trim(), [fileUrl, username]);
            
            console.log(`[Profile] Successfully updated profile picture for ${username}. New URL: ${fileUrl}`);
            socket.emit('patient:profile-picture:updated', { success: true, newImageUrl: fileUrl });

        } catch (error) {
            console.error(`[Doctor Profile] CRITICAL ERROR updating profile picture for ${username}:`, error);
            socket.emit('patient:profile-picture:updated', { success: false, message: 'Server failed to process the image.' });
        }
    });

    socket.on('doctor:get:profile', async (data) => {
        const { username } = data;
        if (!username) return;

        console.log(`[Doctor Profile] Fetching profile for doctor: ${username}`);
        try {
            const sql = 'SELECT username, fullname AS fullName, email, phone, address, dob, specialty, profilePicture FROM users WHERE username = ? AND role = "Doctor"'.trim();
            const [rows] = await pool.query(sql, [username]);

            if (rows.length > 0) {
                const userProfile = rows[0];
                if (userProfile.dob) {
                    const birthDate = new Date(userProfile.dob);
                    const today = new Date();
                    let age = today.getFullYear() - birthDate.getFullYear();
                    const monthDifference = today.getMonth() - birthDate.getMonth();
                    if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < birthDate.getDate())) {
                        age--;
                    }
                    userProfile.age = age;
                }
                socket.emit('doctor:profile:data', userProfile);
            } else {
                console.warn(`[Doctor Profile] Doctor profile not found for user: ${username}`);
            }
        } catch (error) {
            console.error(`[Doctor Profile] Error fetching doctor profile for ${username}:`, error);
        }
    });

    socket.on('doctor:update:profile', async (data) => {
        const { username, email, phone, specialty } = data;
        console.log(`[Doctor Profile] Updating profile for doctor: ${username}`);
        try {
            const sql = 'UPDATE users SET email = ?, phone = ?, specialty = ? WHERE username = ? AND role = "Doctor"'.trim();
            await pool.query(sql, [email, phone, specialty, username]);
            socket.emit('doctor:profile:updated', { success: true });
        } catch (error) {
            console.error(`[Doctor Profile] Error updating profile for ${username}:`, error);
            socket.emit('doctor:profile:updated', { success: false, message: 'Failed to update profile.' });
        }
    });

    socket.on('doctor:change:password', async (data) => {
        const { username, currentPassword, newPassword } = data;
        console.log(`[Doctor Profile] Password change attempt for user: ${username}`);
        try {
            const [rows] = await pool.query('SELECT password FROM users WHERE username = ?'.trim(), [username]);
            if (rows.length === 0) {
                return socket.emit('doctor:password:changed', { success: false, message: 'User not found.' });
            }
            const user = rows[0];
            const isMatch = await bcrypt.compare(currentPassword, user.password);
            if (!isMatch) {
                return socket.emit('doctor:password:changed', { success: false, message: 'Incorrect current password.' });
            }
            const saltRounds = 10;
            const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);
            await pool.query('UPDATE users SET password = ? WHERE username = ?'.trim(), [hashedNewPassword, username]);
            socket.emit('doctor:password:changed', { success: true });
        } catch (error) {
            console.error(`[Doctor Profile] Error changing password for ${username}:`, error);
            socket.emit('doctor:password:changed', { success: false, message: 'Server error during password change.' });
        }
    });

    socket.on('doctor:update:profile-picture', async (data) => {
        if (!data || !data.username || !data.imageData) {
            console.error('[Doctor Profile] Invalid data received for profile picture update.');
            return socket.emit('doctor:profile-picture:updated', { success: false, message: 'Invalid request data.' });
        }
        
        const { username, imageData } = data;
        console.log(`[Doctor Profile] Updating profile picture for user: ${username}`);
        
        try {
            const matches = imageData.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
            
            if (!matches || matches.length !== 3) {
                throw new Error('Invalid base64 image data format.');
            }

            let imageType = matches[1];
            let extension = imageType.split('+')[0]; // Handles types like 'svg+xml' -> 'svg'
            
            const imageBuffer = Buffer.from(matches[2], 'base64');
            
            const filename = `avatar_${username}_${Date.now()}.${extension}`;
            const filepath = path.join(uploadDir, filename);
            const fileUrl = `/uploads/${filename}`;

            await fs.writeFile(filepath, imageBuffer);
            
            await pool.query('UPDATE users SET profilePicture = ? WHERE username = ?'.trim(), [fileUrl, username]);
            
            console.log(`[Profile] Successfully updated profile picture for ${username}. New URL: ${fileUrl}`);
            socket.emit('doctor:profile-picture:updated', { success: true, newImageUrl: fileUrl });

        } catch (error) {
            console.error(`[Doctor Profile] CRITICAL ERROR updating profile picture for ${username}:`, error);
            socket.emit('doctor:profile-picture:updated', { success: false, message: 'Server failed to process the image.' });
        }
    });

    // --- REVISED: Updated the `admin:get:dashboard-data` handler to use the new data fetching functions
    socket.on('admin:get:dashboard-data', async () => {
        if (socket.data.user?.role !== 'Admin') {
            return socket.emit('admin:dashboard-data', { success: false, message: 'Access denied.' });
        }
        try {
            const stats = await fetchDashboardStats();
            const activityFeed = await fetchActivityFeed();
            const mainDashboardChart = await fetchMainDashboardChartData();
            socket.emit('admin:dashboard-data', {
                success: true,
                stats,
                activityFeed,
                mainDashboardChart
            });
        } catch (error) {
            console.error('[Admin Dashboard] Error fetching dashboard data:', error);
            socket.emit('admin:dashboard-data', { success: false, message: 'Failed to fetch dashboard data.' });
        }
    });

    // --- REVISED: Updated `admin:get:analytics-data` to use new fetching functions and simplify the data structure
    socket.on('admin:get:analytics-data', async () => {
        if (socket.data.user?.role !== 'Admin') {
            return socket.emit('admin:analytics-data', { success: false, message: 'Access denied.' });
        }
        try {
            const topDiagnoses = await fetchTopDiagnoses('week');
            const consultationsOverTime = await fetchConsultationsOverTime('week');
            const doctorLoad = await fetchDoctorLoad();
            const demographics = await fetchPatientDemographics();

            socket.emit('admin:analytics-data', {
                success: true,
                diagnoses: topDiagnoses,
                consultations: consultationsOverTime,
                doctorLoad,
                demographics
            });
        } catch (error) {
            console.error('[Admin Analytics] Error fetching analytics data:', error);
            socket.emit('admin:analytics-data', { success: false, message: 'Failed to fetch analytics data.' });
        }
    });
    
    // --- FIX: Changed to emit a response instead of using a callback to match client-side logic ---
    socket.on('admin:get:chart-data', async ({ chart, filter, range }) => {
        if (socket.data.user?.role !== 'Admin') {
            return socket.emit('admin:analytics-data:updated', { success: false, message: 'Access denied.' });
        }
        try {
            let data;
            if (chart === 'diagnoses') {
                data = await fetchTopDiagnoses(filter, range?.startDate, range?.endDate);
            } else if (chart === 'consultations') {
                data = await fetchConsultationsOverTime(filter, range?.startDate, range?.endDate);
            } else {
                return socket.emit('admin:analytics-data:updated', { success: false, message: 'Invalid chart type.' });
            }
            
            socket.emit('admin:analytics-data:updated', { success: true, chartData: data, chart: chart });
        } catch (error) {
            console.error(`[Analytics] Error fetching ${chart} data with filter ${filter}:`, error);
            socket.emit('admin:analytics-data:updated', { success: false, message: 'Failed to fetch chart data.' });
        }
    });

    socket.on('admin:get:calendar-appointments', async ({ start, end }, callback) => {
        if (socket.data.user?.role !== 'Admin') {
            return callback({ success: false, message: 'Access denied.' });
        }
        try {
            const appointmentData = await fetchCalendarAppointments(start, end);
            const appointments = appointmentData.map(app => ({
                ...app,
                // The client-side calendar expects these properties for the modal
                patientName: app.patientFullName,
                doctorName: app.doctorFullName,
                appointmentDate: new Date(app.start).toISOString().slice(0, 10),
            }));
            callback({ success: true, appointments });
        } catch (error) {
            console.error('[Admin Calendar] Error fetching appointments for calendar:', error);
            callback({ success: false, message: 'Failed to fetch calendar appointments.' });
        }
    });
    // --- NEW: Socket handler to fetch appointments for a specific doctor
    socket.on('doctor:get:calendar-appointments', async ({ doctorUsername, start, end }, callback) => {
        if (socket.data.user?.role !== 'Doctor' || socket.data.user?.username !== doctorUsername) {
            return callback({ success: false, message: 'Access denied.' });
        }
        try {
            const appointments = await fetchDoctorAppointments(doctorUsername, start, end);
            callback({ success: true, appointments });
        } catch (error) {
            console.error('[Doctor Calendar] Error fetching appointments for doctor:', error);
            callback({ success: false, message: 'Failed to fetch doctor appointments.' });
        }
    });
    // --- END NEW ---

    // --- ⭐ REVISED: Use notification helper for real-time sync ---
    socket.on('admin:update:appointment-status', async ({ id, status }, callback) => {
        if (socket.data.user?.role !== 'Admin') {
            return callback({ success: false, message: 'Access denied.' });
        }
        try {
            const [result] = await pool.query('UPDATE appointments SET status = ? WHERE id = ?'.trim(), [status, id]);
            if (result.affectedRows === 0) {
                return callback({ success: false, message: 'Appointment not found.' });
            }

            callback({ success: true, message: 'Appointment status updated.' });
            await logActivity(`Admin '${socket.data.user.username}' updated appointment #${id} status to '${status}'.`);

            const updatedStats = await fetchDashboardStats();
            const sockets = await io.fetchSockets();
            sockets.forEach(sock => {
                if (sock.data.user?.role === 'Admin') {
                    sock.emit('admin:stats:updated', updatedStats);
                }
            });
            
            await notifyAppointmentUpdate(id, {
                patientMessage: `An admin has updated your appointment status to "${status}".`,
                doctorMessage: `An admin has updated an appointment status to "${status}".`
            });
        } catch (error) {
            console.error('[Admin] Error updating appointment status:', error);
            callback({ success: false, message: 'Failed to update appointment status.' });
        }
    });
    
    // --- NEW: Patient cancels their own request ---
    socket.on('patient:cancel-request', async ({ appointmentId, patientUsername }) => {
        const requester = socket.data.user;
        if (!requester || requester.role !== 'Patient' || requester.username !== patientUsername) {
            console.warn(`[Appointment] SECURITY: Unauthorized cancellation attempt by user '${requester?.username}'.`);
            return;
        }

        try {
            const [result] = await pool.query(`UPDATE appointments SET status = 'Cancelled' WHERE id = ? AND patientName = ?`.trim(), [appointmentId, patientUsername]);

            if (result.affectedRows > 0) {
                console.log(`[Appointment] Patient '${patientUsername}' successfully cancelled appointment #${appointmentId}.`);
                await logActivity(`Patient '${patientUsername}' cancelled appointment #${appointmentId}.`);
                io.emit('appointments:refetch');
            } else {
                console.warn(`[Appointment] Failed to cancel appointment #${appointmentId}. It may have already been handled.`);
            }
        } catch (error) {
            console.error(`[Appointment] Error cancelling appointment #${appointmentId}:`, error);
        }
    });

    socket.on('admin:get:patients', async () => {
        if (socket.data.user?.role !== 'Admin') {
            console.warn(`[Admin] Unauthorized access attempt to get patients by user '${socket.data.user?.username}'.`);
            return socket.emit('admin:patients:list', { success: false, message: 'Access denied.' });
        }
        try {
            const [rows] = await pool.query(`SELECT id, username, fullname, email, dob, address, phone FROM users WHERE role = 'Patient' ORDER BY fullname ASC`.trim());
            console.log(`[Admin] Fetched ${rows.length} patients for dashboard.`);
            socket.emit('admin:patients:list', { success: true, patients: rows });
        } catch (error) {
            console.error('[Admin] Error fetching patients:', error);
            socket.emit('admin:patients:list', { success: false, message: 'Failed to fetch patient data.' });
        }
    });

    socket.on('admin:get:doctors', async () => {
        if (socket.data.user?.role !== 'Admin') {
            console.warn(`[Admin] Unauthorized access attempt to get doctors by user '${socket.data.user?.username}'.`);
            return socket.emit('admin:doctors:list', { success: false, message: 'Access denied.' });
        }
        try {
            const [rows] = await pool.query(`SELECT id, username, fullname, specialty, email, dob, address, phone FROM users WHERE role = 'Doctor' ORDER BY fullname ASC`.trim());
            console.log(`[Admin] Fetched ${rows.length} doctors for dashboard.`);
            socket.emit('admin:doctors:list', { success: true, doctors: rows });
        } catch (error) {
            console.error('[Admin] Error fetching doctors:', error);
            socket.emit('admin:doctors:list', { success: false, message: 'Failed to fetch doctor data.' });
        }
    });

    // --- ⭐ FIX: Added activity logging ---
    socket.on('admin:update:user', async (data, callback) => {
        if (socket.data.user?.role !== 'Admin') {
            console.warn(`[Admin] Unauthorized access attempt to update user by user '${socket.data.user?.username}'.`);
            return callback({ success: false, message: 'Access denied.' });
        }

        const { id, fullname, email, specialty, role, dob, address, phone } = data;
        try {
            let sql = '';
            let params = [];
            
            if (role === 'Patient') {
                sql = `UPDATE users SET fullname = ?, email = ?, dob = ?, address = ?, phone = ? WHERE id = ?`.trim();
                params = [fullname, email, dob, address, phone, id];
            } else if (role === 'Doctor') {
                sql = `UPDATE users SET fullname = ?, email = ?, specialty = ?, dob = ?, address = ?, phone = ? WHERE id = ?`.trim();
                params = [fullname, email, specialty, dob, address, phone, id];
            } else {
                return callback({ success: false, message: 'Invalid user role.' });
            }

            await pool.query(sql, params);
            console.log(`[Admin] Successfully updated user with ID: ${id}.`);
            callback({ success: true, message: 'User updated successfully.' });
            io.emit('admin:user-list:updated');
            await logActivity(`Admin '${socket.data.user.username}' updated details for user '${fullname}' (ID: ${id}).`);
        } catch (error) {
            console.error(`[Admin] Error updating user ${id}:`, error);
            callback({ success: false, message: 'Failed to update user.' });
        }
    });

    // --- ⭐ FIX: Added activity logging ---
    socket.on('admin:delete:user', async (data, callback) => {
        if (socket.data.user?.role !== 'Admin') {
            console.warn(`[Admin] Unauthorized access attempt to delete user by user '${socket.data.user?.username}'.`);
            return callback({ success: false, message: 'Access denied.' });
        }

        const { id } = data;
        try {
            const [userResult] = await pool.query(`SELECT username FROM users WHERE id = ?`.trim(), [id]);
            if (userResult.length === 0) {
                return callback({ success: false, message: 'User not found.' });
            }
            const usernameToDelete = userResult[0].username;

            const [result] = await pool.query(`DELETE FROM users WHERE id = ?`.trim(), [id]);
            if (result.affectedRows > 0) {
                console.log(`[Admin] Successfully deleted user with ID: ${id}.`);
                callback({ success: true, message: 'User deleted successfully.' });
                io.emit('admin:user-list:updated');
                await logActivity(`Admin '${socket.data.user.username}' deleted user '${usernameToDelete}' (ID: ${id}).`);
            } else {
                console.warn(`[Admin] Delete user failed: User with ID ${id} not found.`);
                callback({ success: false, message: 'User not found.' });
            }
        } catch (error) {
            console.error(`[Admin] Error deleting user ${id}:`, error);
            callback({ success: false, message: 'Failed to delete user.' });
        }
    });

    socket.on('admin:reset:password', async (data, callback) => {
        if (socket.data.user?.role !== 'Admin') {
            return callback({ success: false, message: 'Access denied.' });
        }
        
        const { id, newPassword } = data;
        if (!newPassword || newPassword.length < 6) {
            return callback({ success: false, message: 'Password must be at least 6 characters long.' });
        }
        
        try {
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
            const sql = `UPDATE users SET password = ? WHERE id = ?`.trim();
            await pool.query(sql, [hashedPassword, id]);
            console.log(`[Admin] Successfully reset password for user ID: ${id}.`);
            callback({ success: true, message: 'Password reset successfully.' });
        } catch (error) {
            console.error(`[Admin] Error resetting password for user ${id}:`, error);
            callback({ success: false, message: 'Failed to reset password.' });
        }
    });

    socket.on('admin:update:username', async (data, callback) => {
        if (socket.data.user?.role !== 'Admin') {
            return callback({ success: false, message: 'Access denied.' });
        }

        const { id, oldUsername, newUsername } = data;

        if (!newUsername) {
            return callback({ success: false, message: 'New username cannot be empty.' });
        }
        
        try {
            const [existingUser] = await pool.query(`SELECT id FROM users WHERE username = ? AND id != ?`.trim(), [newUsername, id]);
            if (existingUser.length > 0) {
                console.log(`[Admin] Update failed: New username '${newUsername}' is already taken.`);
                return callback({ success: false, message: 'This username is already taken.' });
            }

            const connection = await pool.getConnection();
            await connection.beginTransaction();

            try {
                await connection.query(`UPDATE users SET username = ? WHERE id = ?`.trim(), [newUsername, id]);
                await connection.query(`UPDATE appointments SET patientName = ? WHERE patientName = ?`.trim(), [newUsername, oldUsername]);
                await connection.query(`UPDATE appointments SET doctorName = ? WHERE doctorName = ?`.trim(), [newUsername, oldUsername]);
                await connection.query(`UPDATE chat_history SET username = ? WHERE username = ?`.trim(), [newUsername, oldUsername]);
                await connection.query(`UPDATE chat_history SET senderId = ? WHERE senderId = ?`.trim(), [newUsername, oldUsername]);
                await connection.query(`UPDATE chat_history SET receiverId = ? WHERE receiverId = ?`.trim(), [newUsername, oldUsername]);
        
                await connection.commit();
        
                console.log(`[Admin] Successfully changed username from '${oldUsername}' to '${newUsername}' for user ID: ${id}.`);
                callback({ success: true, message: 'Username updated successfully.' });
                io.emit('admin:user-list:updated');
                await logActivity(`Admin '${socket.data.user.username}' changed username from '${oldUsername}' to '${newUsername}' for user ID: ${id}.`);
            } catch (transactionError) {
                await connection.rollback();
                console.error('[Admin] Transaction rolled back for username update:', transactionError);
                callback({ success: false, message: 'Failed to update username due to a server error.' });
            } finally {
                if (connection) {
                    connection.release();
                }
            }
        } catch (error) {
            console.error(`[Admin] Error handling username update for '${oldUsername}':`, error);
            callback({ success: false, message: 'Failed to update username due to a server error.' });
        }
    });
    
    socket.on('user:get-role', async (data, callback) => {
        const { username } = data;
        if (!username) {
            return callback({ success: false, message: 'Username not provided.' });
        }
        try {
            const [rows] = await pool.query('SELECT role FROM users WHERE username = ? LIMIT 1'.trim(), [username]);
            if (rows.length > 0) {
                console.log(`[Sanity Check] Verified role for '${username}' as '${rows[0].role}'.`);
                callback({ success: true, role: rows[0].role });
            } else {
                callback({ success: false, message: 'User not found.' });
            }
        } catch (error) {
            console.error('[User] Database error during get-role:', error);
            callback({ success: false, message: 'An internal server error occurred.' });
        }
    });

    socket.on('user:login', async (data, callback) => {
        const { username, password } = data;
        console.log(`[User] Login attempt for username: ${username}`);

        try {
            const [rows] = await pool.query('SELECT * FROM users WHERE username = ? LIMIT 1'.trim(), [username]);

            if (rows.length === 0) {
                console.log(`[User] Login failed: User '${username}' not found.`);
                return callback({ success: false, message: 'Invalid username or password.' });
            }

            const user = rows[0];
            const isMatch = await bcrypt.compare(password, user.password);

            if (isMatch) {
                console.log(`[User] Login successful for user: '${username}' with role: '${user.role}'.`);
                socket.data.user = { username: user.username, role: user.role, fullName: user.fullname, specialty: user.specialty };
                return callback({
                    success: true,
                    message: 'Login successful.',
                    user: { username: user.username, role: user.role }
                });
            } else {
                console.log(`[User] Login failed: Incorrect password for user '${username}'.`);
                return callback({ success: false, message: 'Invalid username or password.' });
            }
        } catch (error) {
            console.error('[User] Database error during login:', error);
            return callback({ success: false, message: 'An internal server error occurred.' });
        }
    });

    socket.on('user:register', async (data, callback) => {
        const { fullname, email, dob, gender, address, phone, username, password, role, specialty } = data;
        console.log(`[User] Registration attempt for username: ${username}, role: ${role}`);

        try {
            const checkSql = 'SELECT username, email FROM users WHERE username = ? OR email = ?'.trim();
            const [existingUsers] = await pool.query(checkSql, [username, email]);

            if (existingUsers.length > 0) {
                const userExists = existingUsers[0];
                let errorMessage = '';
                if (userExists.username === username) {
                    errorMessage = 'Username already exists. Please choose a different one.';
                } else if (userExists.email === email) {
                    errorMessage = 'Email address is already registered. Please use another.';
                }
                
                console.log(`[User] Registration failed: ${errorMessage}`);
                return callback({ success: false, message: errorMessage });
            }
            
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(password, saltRounds);

            const insertSql = `INSERT INTO users
(fullname, email, dob, gender, address, phone, username, password, role, specialty)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`.trim();
            const params = [fullname, email, dob, gender, address, phone, username, hashedPassword, role, specialty || null];
            
            await pool.query(insertSql, params);
            
            console.log(`[User] Registration successful for username: '${username}'.`);
            await logActivity(`A new ${role}, '${fullname}', has registered with username '${username}'.`);
            return callback({ success: true, message: 'Registration successful! You can now log in.' });

        } catch (error) {
            console.error('[User] Database error during registration:', error);
            
            if (error.code === 'ER_DUP_ENTRY') {
                 if (error.sqlMessage && error.sqlMessage.includes('email')) {
                    return callback({ success: false, message: 'This email is already registered.' });
                 }
                 if (error.sqlMessage && error.sqlMessage.includes('username')) {
                    return callback({ success: false, message: 'This username is already taken.' });
                 }
            }

            return callback({ success: false, message: 'An internal server error occurred during registration.' });
        }
    });
    
    socket.on('user:get-profile', async (data) => {
        const { username } = data;
        try {
            const sql = 'SELECT username, fullname AS fullName, role, specialty, dob, address, email, phone, profilePicture FROM users WHERE username = ? LIMIT 1'.trim();
            const [rows] = await pool.query(sql, [username]);
            
            if (rows.length > 0) {
                socket.emit('user:profile-update', { profile: rows[0] });
            } else {
                console.warn(`[Profile] Profile not found for user: ${username}`);
            }
        } catch (error) {
            console.error('[Profile] Error fetching user profile:', error);
        }
    });

    // ⭐ FIX: This handler is now role-aware to provide filtered lists for patients and doctors.
    socket.on('get:all:appointments', async () => {
        const requester = socket.data.user;
        if (!requester) {
            console.warn(`[Appointments] Unauthorized request for appointments by unauthenticated socket.`);
            return socket.emit('appointments:update', { appointments: [] });
        }

        try {
            let appointments = [];
            console.log(`[Appointments] Fetching for role: ${requester.role}`);
            if (requester.role === 'Admin') {
                // Admin sees everything
                appointments = await loadAllAppointments();
            } else if (requester.role === 'Doctor') {
                // Doctor sees their assigned appointments + pending ones for their specialty
                appointments = await loadAppointmentsForDoctorDashboard(requester.username, requester.specialty);
            } else if (requester.role === 'Patient') {
                 // Patient sees only their active appointments
                 appointments = await loadAppointmentsForPatient(requester.username);
            }
            
            socket.emit('appointments:update', { appointments });

        } catch (error) {
            console.error(`[Socket] Error fetching appointments for ${requester.role} '${requester.username}':`, error);
            socket.emit('appointments:update', { appointments: [] });
        }
    });
    
    socket.on('user:update-profile', async ({ profile }, callback) => {
        const usernameToUpdate = socket.data.user?.username;
        if (!usernameToUpdate) {
            console.error('[User] SECURITY: Profile update failed. User is not authenticated on this socket.');
            if (callback) callback({ success: false, message: 'Authentication error. Please log in again.' });
            return;
        }
        
        const { fullname, email, phone, specialty, profilePicture } = profile;
        const newUsername = profile.username;
        const userRole = socket.data.user?.role;
        
        if (newUsername && newUsername !== usernameToUpdate) {
            try {
                const [existingUser] = await pool.query('SELECT id FROM users WHERE username = ?'.trim(), [newUsername]);
                if (existingUser.length > 0) {
                    console.log(`[User] Update failed: New username '${newUsername}' is already taken.`);
                    return callback({ success: false, message: 'Username is already taken. Please choose another.' });
                }
            } catch (error) {
                console.error('[User] Database error during username check:', error);
                return callback({ success: false, message: 'Failed to update profile due to a server error.' });
            }
        }
        
        let connection;
        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();
        
            let userUpdateSql = `UPDATE users SET fullname = ?, email = ?, phone = ?, profilePicture = ?`.trim();
            const userUpdateParams = [fullname || null, email || null, phone || null, profilePicture || null];
        
            if (userRole === 'Doctor') {
                userUpdateSql += `, specialty = ?`;
                userUpdateParams.push(specialty || null);
            }
        
            if (newUsername && newUsername !== usernameToUpdate) {
                userUpdateSql += ` WHERE username = ?`.trim();
                userUpdateParams.push(newUsername, usernameToUpdate);
            } else {
                userUpdateSql += ` WHERE username = ?`.trim();
                userUpdateParams.push(usernameToUpdate);
            }
        
            await connection.query(userUpdateSql, userUpdateParams);
        
            if (newUsername && newUsername !== usernameToUpdate) {
                await connection.query(`UPDATE appointments SET patientName = ? WHERE patientName = ?`.trim(), [newUsername, usernameToUpdate]);
                await connection.query(`UPDATE appointments SET doctorName = ? WHERE doctorName = ?`.trim(), [newUsername, usernameToUpdate]);
                await connection.query(`UPDATE chat_history SET username = ? WHERE username = ?`.trim(), [newUsername, usernameToUpdate]);
                await connection.query(`UPDATE chat_history SET senderId = ? WHERE senderId = ?`.trim(), [newUsername, usernameToUpdate]);
                await connection.query(`UPDATE chat_history SET receiverId = ? WHERE receiverId = ?`.trim(), [newUsername, usernameToUpdate]);
        
                
                console.log(`[User] Dependent tables updated for username change from '${usernameToUpdate}' to '${newUsername}'.`);
        
                socket.data.user.username = newUsername;
                userSockets.delete(socket.id);
                userSockets.set(socket.id, newUsername);
                if (onlineUsers.has(usernameToUpdate)) {
                    onlineUsers.delete(usernameToUpdate);
                    onlineUsers.add(newUsername);
                }
            }
        
            await connection.commit();
        
            console.log(`[User] Profile for '${usernameToUpdate}' successfully updated. New username is '${newUsername}'.`);
            const [rows] = await pool.query('SELECT username, fullname AS fullName, role, specialty, dob, address, email, phone, profilePicture FROM users WHERE username = ? LIMIT 1'.trim(), [newUsername || usernameToUpdate]);
            
            socket.emit('user:profile-update', { profile: rows[0] });
            if (callback) callback({ success: true, message: "Profile updated successfully!" });
        
        } catch (error) {
            if (connection) {
                try {
                    await connection.rollback();
                    console.log('[User] Transaction rolled back due to an error.');
                } catch (rollbackError) {
                    console.error('[User] CRITICAL: Failed to rollback transaction:', rollbackError);
                }
            }
            console.error(`[User] Database transaction failed for updating profile for ${usernameToUpdate}:`, error);
            if (callback) callback({ success: false, message: 'Failed to update profile due to a server error.' });
        } finally {
            if (connection) {
                connection.release();
            }
        }
    });
    
    socket.on('user:change-password', async ({ username, currentPass, newPass }, callback) => {
        try {
            const [rows] = await pool.query('SELECT password FROM users WHERE username = ?'.trim(), [username]);
            if (rows.length === 0) {
                return callback({ success: false, message: 'User not found.' });
            }
            
            const user = rows[0];
            const isMatch = await bcrypt.compare(currentPass, user.password);

            if (!isMatch) {
                return callback({ success: false, message: 'Invalid current password.' });
            }
            
            const saltRounds = 10;
            const hashedNewPassword = await bcrypt.hash(newPass, saltRounds);
            
            await pool.query('UPDATE users SET password = ? WHERE username = ?'.trim(), [hashedNewPassword, username]);
            callback({ success: true, message: 'Password changed successfully.' });
        } catch (error) {
            console.error('[User] Error changing password:', error);
            callback({ success: false, message: 'Failed to change password.' });
        }
    });

    socket.on('appointment:request', async (data) => {
        const { patientName, specialty, subject, appointmentDate, appointmentTime } = data;
        try {
            const [result] = await pool.query(
                `INSERT INTO appointments (patientName, specialty, subject, appointmentDate, appointmentTime, status, created_at) VALUES (?, ?, ?, ?, ?, 'Pending', NOW())`.trim(),
                [patientName, specialty, subject, appointmentDate, appointmentTime]
            );
            const newAppointmentId = result.insertId;
            console.log(`[Appointment] New request from ${patientName} saved with ID: ${newAppointmentId}`);
            
            await logActivity(`A new appointment requested by '${patientName}' for ${specialty}.`);

            io.emit('appointments:refetch');
            
            const allSockets = await io.fetchSockets();
            allSockets.forEach(sock => {
                if (sock.data.user?.role === 'Doctor' && sock.data.user?.specialty === specialty) {
                    sock.emit('notification:new-request', {
                        message: `New appointment request from ${patientName} for your specialty.`
                    });
                }
            });

        } catch (error) {
            console.error('[Appointment] Error saving new appointment request:', error);
        }
    });

    
    socket.on('appointment:accept', async (data, callback) => {
        const { appointmentId, doctorName } = data;
        try {
            await pool.query(`UPDATE appointments SET status = 'Accepted', doctorName = ? WHERE id = ?`.trim(),
                [doctorName, appointmentId]);
            console.log(`[Appointment] Appointment ${appointmentId} accepted by Dr. ${doctorName}.`);
            
            const [appRows] = await pool.query(`SELECT patientName FROM appointments WHERE id = ?`.trim(), [appointmentId]);
            const patientName = appRows.length > 0 ? appRows[0].patientName : null;
            await logActivity(`Dr. ${doctorName} accepted appointment #${appointmentId} for patient ${patientName}.`);
            
            await notifyAppointmentUpdate(appointmentId, {
                patientMessage: `Your appointment request has been accepted by Dr. ${doctorName}.`
            });
            if (callback) callback({ success: true, message: 'Appointment accepted.' });
        } catch (error) {
            console.error('[Appointment] Error accepting appointment:', error);
            if (callback) callback({ success: false, message: 'Failed to accept appointment.' });
        }
    });
    
    socket.on('doctor:create-room', async ({ appointmentId, doctorName }, callback) => {
        if (socket.data.user?.role !== 'Doctor') {
            console.warn(`[SECURITY] Non-Doctor user '${socket.data.user?.username}' attempted to create a room.`);
            return callback({ success: false, message: 'Only doctors can create consultation rooms.' });
        }
        if (socket.data.user?.username !== doctorName) {
                console.warn(`[SECURITY] User '${socket.data.user?.username}' attempted to create a room for another doctor ('${doctorName}').`);
                return callback({ success: false, message: 'You can only create rooms for your own appointments.' });
        }
        
        console.log(`[Appointment] Received 'doctor:create-room' request for appointment ID: ${appointmentId} from client '${doctorName}'`);
        
        const authToken = crypto.randomBytes(16).toString('hex');
        try {
            const [updateResult] = await pool.query(
                `UPDATE appointments SET authToken = ?, roomCreated = FALSE WHERE id = ? AND doctorName = ?`.trim(),
                [authToken, appointmentId, doctorName]
            );
        
            if (updateResult.affectedRows === 0) {
                console.error(`[Appointment] create-room failed: No rows were updated. The provided doctor ('${doctorName}') might not be the assigned doctor for appointment #${appointmentId}.`);
                return callback({ success: false, message: 'Failed to create room. You may not be the assigned doctor.' });
            }
            
            console.log(`[Appointment] Successfully updated appointment ${appointmentId} with a new auth token.`);
        
            const [updatedAppRows] = await pool.query(`SELECT * FROM appointments WHERE id = ?`.trim(), [appointmentId]);
            const appointment = updatedAppRows[0];
        
            if (!appointment) {
                console.error(`[Appointment] create-room failed: Could not find appointment #${appointmentId} after update.`);
                return callback({ success: false, message: 'Could not find appointment after creating room.' });
            }
        
            const patientName = appointment.patientName;
            const patientRoom = `user_room_${patientName}`;
            
            console.log(`[Appointment] Notifying patient in room '${patientRoom}' that room ${appointment.id} is ready.`);
            io.to(patientRoom).emit('room:ready', { appointment: appointment });

            await notifyAppointmentUpdate(appointmentId);
            
            console.log(`[Appointment] Responding to doctor with redirect URL.`);
            callback({
                success: true,
                redirectUrl: `/call/${appointment.id}?token=${appointment.authToken}`
            });
        
        } catch (error) {
            console.error(`[Appointment] CRITICAL ERROR creating room for appointment ${appointmentId}:`, error);
            callback({ success: false, message: 'A server error occurred while creating the room.' });
        }
    });

    socket.on('appointment:reject', async (data) => {
        const { appointmentId, doctorName } = data;
        try {
            await pool.query(`UPDATE appointments SET status = 'Rejected', doctorName = ? WHERE id = ?`.trim(),
                [doctorName, appointmentId]);
            console.log(`[Appointment] Appointment ${appointmentId} rejected by Dr. ${doctorName}.`);
            
            await logActivity(`Dr. ${doctorName} rejected appointment #${appointmentId}.`);
            await notifyAppointmentUpdate(appointmentId, {
                patientMessage: `Your appointment request has been rejected.`
            });
        } catch (error) {
            console.error('[Appointment] Error rejecting appointment:', error);
        }
    });
    
    socket.on('appointment:reject-with-notes', async (data, callback) => {
        const { appointmentId, doctorName, notes } = data;
        console.log(`[Appointment] Appointment ${appointmentId} rejected with notes by Dr. ${doctorName}.`);
        try {
            await pool.query(`UPDATE appointments SET status = 'Rejected', doctorName = ?, rejectionNotes = ? WHERE id = ?`.trim(),
                [doctorName, notes, appointmentId]);
            
            await notifyAppointmentUpdate(appointmentId, {
                patientMessage: `Your appointment request has been rejected. Reason: ${notes}`
            });

            if (callback) {
                callback({ success: true });
            }
        } catch (error) {
            console.error('[Appointment] Error rejecting appointment with notes:', error);
            if (callback) {
                callback({ success: false, message: 'Failed to reject appointment due to a server error.' });
            }
        }
    });

    socket.on('appointment:reschedule', async (data) => {
        const { appointmentId, newDate, newTime, reason } = data;
        const requester = socket.data.user;

        if (!requester || requester.role !== 'Doctor') {
            return socket.emit('appointment:rescheduled', { success: false, message: 'Authorization failed.' });
        }
        
        console.log(`[Reschedule] Doctor '${requester.username}' proposed new time for Appt ID ${appointmentId}.`);

        try {
            const [appRows] = await pool.query(`SELECT id, patientName, subject, doctorName, status FROM appointments WHERE id = ?`.trim(), [appointmentId]);
            if (appRows.length === 0) {
                return socket.emit('appointment:rescheduled', { success: false, message: 'Appointment not found.' });
            }
            const appointment = appRows[0];
            
            const isOwner = appointment.doctorName === requester.username;
            const isPending = appointment.status === 'Pending';

            if (!isOwner && !isPending) {
                console.warn(`[Reschedule] SECURITY: Doctor '${requester.username}' tried to reschedule appointment ${appointmentId} which belongs to '${appointment.doctorName}' and is not pending.`);
                return socket.emit('appointment:rescheduled', { success: false, message: 'You can only reschedule your own appointments.' });
            }
            
            const doctorToAssign = isPending ? requester.username : appointment.doctorName;

            const updateSql = `UPDATE appointments SET appointmentDate = ?, appointmentTime = ?, status = 'Rescheduled-Pending', notes = ?, doctorName = ? WHERE id = ?`.trim();
            await pool.query(updateSql, [newDate, newTime, reason, doctorToAssign, appointmentId]);

            const patientUsername = appointment.patientName;
            const patientRoom = `user_room_${patientUsername}`;

            const [updatedAppRows] = await pool.query(`SELECT * FROM appointments WHERE id = ?`.trim(), [appointmentId]);
            const updatedAppointment = updatedAppRows[0];
            
            io.to(patientRoom).emit('notification:reschedule-request', {
                message: `Dr. ${requester.fullName} has requested to reschedule your appointment for "${appointment.subject}". Please respond.`,
                appointment: updatedAppointment
            });
            
            console.log(`[Reschedule] Sent reschedule request to patient room '${patientRoom}'.`);

            socket.emit('appointment:rescheduled', { success: true });
            io.emit('appointments:refetch');
        } catch (error) {
            console.error(`[Reschedule] Error processing doctor's reschedule for Appt ID ${appointmentId}:`, error);
            socket.emit('appointment:rescheduled', { success: false, message: 'A server error occurred.' });
        }
    });

    // ⭐ START: NEW HANDLER FOR PATIENT RESCHEDULE PROPOSAL
    socket.on('patient:propose:new-time', async (data) => {
        const { appointmentId, newDate, newTime, patientUsername } = data;
        const requester = socket.data.user;

        if (!requester || requester.role !== 'Patient' || requester.username !== patientUsername) {
            console.warn(`[Reschedule] SECURITY: Unauthorized patient proposal attempt from '${requester?.username}'.`);
            return;
        }

        try {
            const [appRows] = await pool.query('SELECT doctorName, subject FROM appointments WHERE id = ? AND patientName = ?', [appointmentId, patientUsername]);
            if (appRows.length === 0) return; // Appointment not found or doesn't belong to this patient

            const { doctorName, subject } = appRows[0];

            const notes = `Patient ${patientUsername} has proposed a new time: ${newDate} at ${newTime}.`;
            // Revert status to 'Pending' for doctor's review
            await pool.query(
                `UPDATE appointments SET status = 'Pending', notes = ?, appointmentDate = ?, appointmentTime = ? WHERE id = ?`,
                [notes, newDate, newTime, appointmentId]
            );
            
            await logActivity(`Patient '${patientUsername}' proposed a new time for appointment #${appointmentId}.`);
            await notifyAppointmentUpdate(appointmentId, {
                doctorMessage: `Patient ${patientUsername} has proposed a new time for the appointment: "${subject}". Please review.`
            });

        } catch (error) {
            console.error(`[Reschedule] Error processing patient's new time proposal for Appt ID ${appointmentId}:`, error);
        }
    });
    // ⭐ END: NEW HANDLER

    socket.on('patient:accept-reschedule', async ({ appointmentId }) => {
        const requester = socket.data.user;
        if (!requester || requester.role !== 'Patient') return;
        
        console.log(`[Reschedule] Patient '${requester.username}' accepted reschedule for Appt ID ${appointmentId}.`);
        
        try {
            const [appRows] = await pool.query(`SELECT id, doctorName, subject FROM appointments WHERE id = ? AND patientName = ?`.trim(), [appointmentId, requester.username]);
            if (appRows.length === 0) return;
            const appointment = appRows[0];

            await pool.query(`UPDATE appointments SET status = 'Accepted', notes = NULL WHERE id = ?`.trim(), [appointmentId]);
            
            await notifyAppointmentUpdate(appointmentId, {
                doctorMessage: `${requester.fullName} has accepted the new time for the appointment: "${appointment.subject}".`
            });

        } catch(error) {
            console.error(`[Reschedule] Error processing patient acceptance for Appt ID ${appointmentId}:`, error);
        }
    });

    socket.on('patient:reject-reschedule', async ({ appointmentId, patientUsername }) => {
        const requester = socket.data.user;
        if (!requester || requester.role !== 'Patient' || requester.username !== patientUsername) {
            console.warn(`[Reschedule] SECURITY: Unauthorized patient reject attempt from '${requester?.username}'.`);
            return;
        }
        
        console.log(`[Reschedule] Patient '${patientUsername}' rejected reschedule for Appt ID ${appointmentId}.`);
        
        try {
            await pool.query(`UPDATE appointments SET status = 'Rejected', notes = 'Patient rejected proposed reschedule.' WHERE id = ? AND patientName = ?`.trim(), [appointmentId, patientUsername]);
            
            const [appRows] = await pool.query(`SELECT doctorName, subject FROM appointments WHERE id = ?`.trim(), [appointmentId]);
            if (appRows.length > 0) {
                const appointment = appRows[0];
                await notifyAppointmentUpdate(appointmentId, {
                    doctorMessage: `${requester.fullName} has rejected the proposed time for the appointment: "${appointment.subject}".`
                });
            }
        } catch (error) {
            console.error(`[Reschedule] Error processing patient rejection for Appt ID ${appointmentId}:`, error);
        }
    });

    socket.on('appointment:save-notes', async (data, callback) => { // Added callback param
        const { appointmentId, notes, diagnosis } = data;
        try {
            await pool.query(`UPDATE appointments SET notes = ?, status = 'Completed' WHERE id = ?`.trim(), [notes, appointmentId]);
            console.log(`[Appointment] Notes for appointment ${appointmentId} saved and status set to Completed.`);
        
            const [appRows] = await pool.query('SELECT patientName, doctorName FROM appointments WHERE id = ?'.trim(), [appointmentId]);
            if (appRows.length > 0) {
                const { patientName, doctorName } = appRows[0];
        
                if (notes) {
                    const diagnosisMatch = notes.match(/Specific Diagnosis: (.*)/);
                    const specificDiagnosis = diagnosisMatch ? diagnosisMatch[1].trim() : null;
        
                    if (specificDiagnosis) {
                        const historySql = `INSERT INTO medical_history (appointment_id, patient_username, doctor_username, diagnosis, notes) VALUES (?, ?, ?, ?, ?)`.trim();
                        await pool.query(historySql, [appointmentId, patientName, doctorName, specificDiagnosis, notes]);
                        console.log(`[Diagnosis] Saved to medical history for appointment #${appointmentId}. Diagnosis: ${specificDiagnosis}`);
                    }
                }
            }
        
            await notifyAppointmentUpdate(appointmentId);
            await logActivity(`Consultation notes and diagnosis saved for appointment #${appointmentId}.`);
            
            if (callback) callback({ success: true }); // Execute callback
        
        } catch (error) {
            console.error('[Appointment] Error saving notes and diagnosis:', error);
            if (callback) callback({ success: false, message: 'Server error saving notes.' }); // Execute callback on error
        }
    });
    
    socket.on('patient:get-history', async ({ patientUsername }) => {
        const requester = socket.data.user;

        if (!requester) {
            console.warn(`[Patient History] Unauthorized access attempt by unauthenticated socket ${socket.id}.`);
            return socket.emit('patient:history-data', []);
        }

        if (requester.role === 'Patient' && requester.username !== patientUsername) {
            console.warn(`[Patient History] SECURITY: Unauthorized access attempt! Patient '${requester.username}' tried to access history for '${patientUsername}'.`);
            return socket.emit('patient:history-data', []);
        }

        console.log(`[Patient History] Authorized user '${requester.username}' (${requester.role}) requested history for '${patientUsername}'.`);

        try {
            const [rows] = await pool.query(
                `SELECT appointmentDate, notes, rejectionNotes
                    FROM appointments
                    WHERE patientName = ? AND status IN ('Completed', 'Rejected')
                    ORDER BY appointmentDate DESC`.trim(),
                [patientUsername]
            );
            socket.emit('patient:history-data', rows.map(row => ({
                date: new Date(row.appointmentDate).toLocaleDateString(),
                note: row.notes || row.rejectionNotes
            })));
        } catch (error) {
            console.error(`[Patient History] Error fetching history for '${patientUsername}':`, error);
            socket.emit('patient:history-data', []);
        }
    });

    socket.on('doctor:get:patients:chatted:with', async ({ doctorUsername }) => {
        try {
            const patients = await getDoctorPatients(doctorUsername);
            socket.emit('doctor:patients:chatted:with', { patients });
        } catch (error) {
            console.error(`[Messages] Error fetching patient list for doctor '${doctorUsername}':`, error);
            socket.emit('doctor:patients:chatted:with', { patients: [] });
        }
    });

    socket.on('doctor:get:chat:history', async ({ doctorUsername, patientUsername }) => {
        try {
            const chatHistory = await getChatHistoryForDoctor(doctorUsername, patientUsername);
            socket.emit('doctor:chat:history', { patientUsername, chatHistory });
        } catch (error) {
            console.error(`[Messages] Error fetching chat history for patient '${patientUsername}':`, error);
            socket.emit('doctor:chat:history', { patientUsername, chatHistory: [] });
        }
    });

    socket.on('patient:get:chat:history', async ({ patientUsername, doctorUsername }) => {
        try {
            const chatHistory = await getChatHistoryForPatient(patientUsername, doctorUsername);
            socket.emit('patient:chat:history', { chatHistory, patientUsername, doctorUsername });
        } catch (error) {
            console.error(`[Messages] Error fetching chat history for patient '${patientUsername}':`, error);
            socket.emit('patient:chat:history', { chatHistory: [] });
        }
    });

    socket.on('dashboard:send:message', async (data) => {
        const { senderUsername, receiverUsername, message, senderFullName, appointmentId } = data;
        const sender = socket.data.user;

        if (!sender || sender.username !== senderUsername) {
            console.warn(`[Chat] SECURITY VIOLATION: Socket ${socket.id} tried to send message as '${senderUsername}' but is authenticated as '${sender?.username}'.`);
            return;
        }

        // ⭐ FIX: Add a guard clause to ensure appointmentId is present.
        if (!appointmentId) {
            console.error(`[Chat] CRITICAL: Received 'dashboard:send:message' without an appointmentId. Message from '${senderUsername}' not saved.`);
            return; 
        }

        try {
            const messagePayload = {
                username: senderUsername,
                message: message,
                fileUrl: data.fileUrl || null,
                timestamp: new Date().toISOString(),
                senderId: senderUsername,
                receiverId: receiverUsername,
                appointmentId: appointmentId,
                senderName: sender.fullName,
            };

            const allSockets = await io.fetchSockets();
            const senderSocket = allSockets.find(s => s.data.user?.username === senderUsername);
            const receiverSocket = allSockets.find(s => s.data.user?.username === receiverUsername);
            
            if (senderSocket) {
                senderSocket.emit('dashboard:message:received', messagePayload);
            }
            if (receiverSocket) {
                receiverSocket.emit('dashboard:message:received', messagePayload);
            }
            console.log(`[Chat] Instantly relayed message from ${senderUsername} to ${receiverUsername}.`);
            
            await saveChatMessage(appointmentId, messagePayload);
            console.log(`[Chat] Message from ${senderUsername} saved to DB.`);

        } catch (error) {
            console.error(`[Chat] Error sending dashboard message between ${senderUsername} and ${receiverUsername}:`, error);
        }
    });

    socket.on('auth:join-room', async (data) => {
        const { room, token } = data;
        
        const authenticatedUser = socket.data.user;

        if (!authenticatedUser || !authenticatedUser.username || !authenticatedUser.role) {
            console.warn(`[Auth Room] REJECTED: Unauthenticated socket ${socket.id} attempted to join room '${room}'.`);
            return socket.emit('auth:failed', 'Authentication error. Please log in again.');
        }

        console.log(`[Auth Room] Authenticated user '${authenticatedUser.username}' (Role: ${authenticatedUser.role}) attempting to join room '${room}'.`);

        let appointment;
        try {
            const [rows] = await pool.query(`SELECT * FROM appointments WHERE id = ? AND authToken = ?`.trim(), [room, token]);
            if (rows.length === 0) {
                console.warn(`[Auth Room] Auth FAILED for '${authenticatedUser.username}'. Invalid room ID or token.`);
                return socket.emit('auth:failed', 'Invalid room ID or authentication token.');
            }
            appointment = rows[0];
            
            const isRoomActive = appointment.roomCreated;
            if (!isRoomActive) {
                if (authenticatedUser.role !== 'Doctor' || authenticatedUser.username !== appointment.doctorName) {
                    console.warn(`[Auth Room] REJECTED: User '${authenticatedUser.username}' is not the assigned doctor for this new room.`);
                    return socket.emit('auth:failed', 'Only the assigned doctor can start this consultation.');
                }
            } else {
                if (authenticatedUser.role !== 'Patient' || authenticatedUser.username !== appointment.patientName) {
                    console.warn(`[Auth Room] REJECTED: User '${authenticatedUser.username}' is not the assigned patient for this active room.`);
                    return socket.emit('auth:failed', 'Only the assigned patient can join this consultation.');
                }
            }

        } catch (error) {
            console.error('[Auth Room] DB error during authentication:', error);
            return socket.emit('auth:failed', 'An internal server error occurred.');
        }

        console.log(`[Auth Room] Auth SUCCESS for socket ${socket.id}. Verified User: '${authenticatedUser.username}', Role: '${authenticatedUser.role}'.`);

        const socketsInRoomPreJoin = await io.in(room).fetchSockets();
        for (const peerSocket of socketsInRoomPreJoin) {
            if (peerSocket.data.user && peerSocket.data.user.role === authenticatedUser.role) {
                console.warn(`[Auth Room] JOIN REJECTED: A user with role '${authenticatedUser.role}' is already in room '${room}'.`);
                socket.emit('auth:failed', `A ${authenticatedUser.role} is already in this consultation.`);
                return;
            }
        }

        socket.data.user = authenticatedUser;
        usersInRooms.set(socket.id, { username: authenticatedUser.username, room });
        userSockets.set(socket.id, authenticatedUser.username);
        
        socket.join(room);
        console.log(`'${authenticatedUser.username}' (${socket.id}) joined room: ${room}`);

        const socketsInRoomAfterJoin = await io.in(room).fetchSockets();
        const usersPresentInRoom = socketsInRoomAfterJoin
            .filter(s => s.id !== socket.id)
            .map(s => usersInRooms.get(s.id))
            .filter(Boolean);

        if (usersPresentInRoom.length === 0) {
            await pool.query('UPDATE appointments SET roomCreated = TRUE WHERE id = ?'.trim(), [room]);
            console.log(`[Auth Room] First user (${authenticatedUser.username}) in room ${room}. Marking room as active.`);
            
            io.to(socket.id).emit('room:created', {
                room: room,
                user: authenticatedUser
            });

            setTimeout(async () => {
                io.emit('appointments:refetch');
            }, 1000);
        } else {
            const chatHistory = await loadChatHistory(room);

            socket.emit('room:joined', {
                room: room,
                user: authenticatedUser,
                usersInRoom: usersPresentInRoom,
                chatHistory: chatHistory
            });
            socket.to(room).emit('user:joined', { id: socket.id, username: authenticatedUser.username });
        }
    });

    socket.on('webrtc:offer', (data) => {
        socket.to(data.targetSocketId).emit('webrtc:offer', {
            offer: data.offer,
            senderSocketId: socket.id,
            senderUsername: socket.data.user?.username
        });
        console.log(`[WebRTC] Offer from '${socket.data.user?.username}' to '${userSockets.get(data.targetSocketId)}' relayed.`);
    });
    
    socket.on('webrtc:answer', (data) => {
        socket.to(data.targetSocketId).emit('webrtc:answer', {
            answer: data.answer,
            senderSocketId: socket.id,
            senderUsername: socket.data.user?.username
        });
        console.log(`[WebRTC] Answer from '${socket.data.user?.username}' to '${userSockets.get(data.targetSocketId)}' relayed.`);
    });

    socket.on('webrtc:ice-candidate', (data) => {
        socket.to(data.targetSocketId).emit('webrtc:ice-candidate', {
            candidate: data.candidate,
            senderSocketId: socket.id
        });
        console.log(`[WebRTC] ICE candidate from '${socket.data.user?.username}' to '${userSockets.get(data.targetSocketId)}' relayed.`);
    });
    
    socket.on('get:peer:username', ({ peerId }) => {
        const username = userSockets.get(peerId);
        if (username) {
            socket.emit('get:peer:username:response', { peerId, username });
        }
    });

    socket.on('chat:message', (data) => {
        if (!data.room || !data.message) {
            console.error('[Chat] Received invalid chat message payload:', data);
            return;
        }

        const senderUsername = socket.data.user?.username || 'Guest';
        const messagePayload = {
            username: senderUsername,
            message: data.message,
            fileUrl: data.fileUrl || null,
            timestamp: new Date().toISOString(),
            senderId: data.senderId,
            receiverId: data.receiverId,
            appointmentId: data.appointmentId
        };
        
        createOrGetRoomInDb(data.room);

        saveChatMessage(data.room, messagePayload);
        io.to(data.room).emit('chat:message', messagePayload);
    });

    socket.on('chat:typing', (data) => {
        if (data.room && data.username) {
            socket.to(data.room).emit('chat:typing', { username: data.username, isTyping: data.isTyping });
        }
    });

    socket.on('disconnect', async (reason) => {
        console.log(`User disconnected: ${socket.id}. Reason: ${reason}`);

        const disconnectedUserInfo = usersInRooms.get(socket.id);
        if (disconnectedUserInfo) {
            const { username, room } = disconnectedUserInfo;
            usersInRooms.delete(socket.id);
            console.log(`'${username}' (${socket.id}) was in room: ${room}. Notifying peers.`);
            socket.to(room).emit('user:left', { id: socket.id, username: username });
            
            const socketsInRoom = await io.in(room).fetchSockets();
            const roomSize = socketsInRoom.length;

            if (roomSize === 1) {
                const remainingSocket = socketsInRoom[0];
                const remainingUser = usersInRooms.get(remainingSocket.id);
                console.log(`[Server] Only one user left in room ${room}. Remaining user: '${remainingUser?.username}' (${remainingSocket.id})`);
                
                const remainingUserRole = remainingSocket.data.user?.role;
                
                let redirectUrl = '/index.html';
                if (remainingUserRole === 'Doctor') {
                    redirectUrl = '/doctor-dashboard.html';
                } else if (remainingUserRole === 'Patient') {
                    redirectUrl = '/patient-dashboard.html';
                }
                console.log(`[Server] Sending call:end event to ${remainingUserRole} with redirect URL: ${redirectUrl}`);
                
                io.to(remainingSocket.id).emit('call:end', {
                    message: `${username} has ended the consultation.`,
                    redirectUrl: redirectUrl
                });

            } else if (roomSize === 0) {
                console.log(`[Server] All users left room ${room}. Clearing room state.`);
                await pool.query('UPDATE appointments SET roomCreated = FALSE WHERE id = ?'.trim(), [room]);
                io.emit('appointments:refetch');
            }
        }
        
        const username = userSockets.get(socket.id);
        if (username) {
            userSockets.delete(socket.id);
            const userIsStillOnline = Array.from(userSockets.values()).includes(username);
            if (!userIsStillOnline) {
                onlineUsers.delete(username);
                await pool.query('UPDATE users SET isOnline = 0 WHERE username = ?'.trim(), [username]);
                console.log(`[Online Status] User '${username}' is now offline. Total: ${onlineUsers.size}`);
                io.emit('user:status-changed', { username: username, isOnline: false });
            }
        }
    });
});

// --- MODIFICATION: Updated ngrok function to be more reliable ---
async function startNgrok() {
    const port = process.env.PORT || 3000;
    const authtoken = process.env.NGROK_AUTHTOKEN;
    const region = process.env.NGROK_REGION || 'ap';

    if (!authtoken) {
        console.warn('[Ngrok] NGROK_AUTHTOKEN is not configured in your .env file.');
        console.warn('[Ngrok] The application will be available on localhost but not accessible from the internet.');
        return null;
    }

    console.log(`[Ngrok] NGROK_AUTHTOKEN found. Attempting to connect to region: '${region.toUpperCase()}'...`);

    try {
        await ngrok.authtoken(authtoken);
        const url = await ngrok.connect({
            addr: port,
            proto: 'http',
            region: region
        });

        console.log(`[Ngrok] --- SUCCESS ---`);
        console.log(`[Ngrok] Your application is publicly accessible at: ${url}`);
        console.log(`[Ngrok] Use this URL on your mobile device or to share with others.`);
        console.log(`[Ngrok] -----------------`);
        return url;
    } catch (error) {
        console.error('[Ngrok] !!! CRITICAL: Failed to start the ngrok tunnel. !!!');
        console.error(`[Ngrok] Error details: ${error}`);
        console.error('[Ngrok] Common reasons for failure include:');
        console.error('[Ngrok] 1. Your NGROK_AUTHTOKEN in the .env file might be invalid or expired.');
        console.error('[Ngrok] 2. The selected region may not be available on your ngrok plan.');
        console.error('[Ngrok] 3. A firewall on your computer or network is blocking the connection.');
        console.error('[Ngrok] 4. Another ngrok process might already be running.');
        return null;
    }
}

// --- NEW FUNCTION: Main startup logic ---
async function startServer() {
    const PORT = process.env.PORT || 3000;

    try {
        console.log('[Server Startup] Starting server initialization...');

        // 1. Ensure file directories exist
        await fs.mkdir(uploadDir, { recursive: true });
        console.log('Uploads directory ensured.');
        await fs.mkdir(tempUploadDir, { recursive: true });
        console.log('Multer temp_uploads directory ensured.');

        // 2. Test and prepare the database
        await testDbConnection();
        // ⭐ FIX: Corrected startup order. Create tables first, then ensure schema.
        await createUsersTable();
        await createAppointmentsTable();
        await createMedicalHistoryTable();
        await createRoomsTable();
        await createChatHistoryTable();
        await createActivityLogsTable();
        await ensureDatabaseSchema();


        // 3. Start listening for network requests
        server.listen(PORT, async () => {
            const now = new Date();
            console.log(`Server running on port ${PORT}`);
            console.log(`Server started at ${now.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' })} (City of Batac, Ilocos Region, Philippines)`);
            console.log(`Access the application locally at http://localhost:${PORT}`);
            
            // 4. Start ngrok tunnel for public access
            await startNgrok();
        });
    } catch (error) {
        console.error('[Server Startup] !!! CRITICAL: Server failed to start due to an initialization error. !!!');
        console.error(`[Server Startup] Error details:`, error);
        console.error('[Server Startup] Please review the error message above to identify the issue.');
        process.exit(1); // Exit with a non-zero code to indicate failure.
    }
}

startServer();