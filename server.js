const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Uses process.env.STORAGE_DIR if on Render persistent disk, else falls back to local Movies directory
const MOVIES_DIR = process.env.STORAGE_DIR 
  ? path.join(process.env.STORAGE_DIR, 'Movies') 
  : path.join(__dirname, 'Movies');

if (!fs.existsSync(MOVIES_DIR)) {
  fs.mkdirSync(MOVIES_DIR, { recursive: true });
}

// Database Setup
const dbPath = process.env.STORAGE_DIR ? path.join(process.env.STORAGE_DIR, 'jabbaflix.db') : './jabbaflix.db';
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS watch_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      show_title TEXT NOT NULL,
      episode_filename TEXT NOT NULL,
      episode_title TEXT NOT NULL,
      current_time REAL NOT NULL,
      duration REAL NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, show_title, episode_filename) ON CONFLICT REPLACE,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      show_title TEXT NOT NULL,
      is_favorite INTEGER DEFAULT 0,
      in_watchlist INTEGER DEFAULT 0,
      reaction INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, show_title) ON CONFLICT REPLACE,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/thumbnails', express.static(MOVIES_DIR));

app.use(session({
  secret: process.env.SESSION_SECRET || 'jabbaflix-indie-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// Video Streaming Helper
function streamVideoFile(req, res, filePath) {
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
}

// AUTH ROUTES
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hashedPassword], function(err) {
      if (err) return res.status(400).json({ error: 'Username already exists' });
      req.session.user = { id: this.lastID, username };
      res.json({ success: true, user: req.session.user });
    });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (err || !user) return res.status(400).json({ error: 'Invalid credentials' });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(400).json({ error: 'Invalid credentials' });

    req.session.user = { id: user.id, username: user.username };
    res.json({ success: true, user: req.session.user });
  });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// PROGRESS & INTERACTIONS
app.post('/api/progress', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });

  const { showTitle, episodeFileName, episodeTitle, currentTime, duration } = req.body;
  db.run(`
    INSERT INTO watch_progress (user_id, show_title, episode_filename, episode_title, current_time, duration, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [req.session.user.id, showTitle, episodeFileName, episodeTitle, currentTime, duration], (err) => {
    if (err) return res.status(500).json({ error: 'Failed to save progress' });
    res.json({ success: true });
  });
});

app.get('/api/progress', (req, res) => {
  if (!req.session.user) return res.json([]);
  db.all(`
    SELECT * FROM watch_progress 
    WHERE user_id = ? AND (duration - current_time) > 10 AND current_time > 5
    ORDER BY updated_at DESC LIMIT 10
  `, [req.session.user.id], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows || []);
  });
});

app.get('/api/interactions/:showTitle', (req, res) => {
  const showTitle = req.params.showTitle;
  db.get(`SELECT COUNT(*) as count FROM user_interactions WHERE show_title = ? AND reaction = 1`, [showTitle], (err, likesRow) => {
    db.get(`SELECT COUNT(*) as count FROM user_interactions WHERE show_title = ? AND reaction = -1`, [showTitle], (err, dislikesRow) => {
      const likes = likesRow ? likesRow.count : 0;
      const dislikes = dislikesRow ? dislikesRow.count : 0;

      if (req.session.user) {
        db.get(`SELECT is_favorite, in_watchlist, reaction FROM user_interactions WHERE user_id = ? AND show_title = ?`, [req.session.user.id, showTitle], (err, userRow) => {
          res.json({ likes, dislikes, userState: userRow || { is_favorite: 0, in_watchlist: 0, reaction: 0 } });
        });
      } else {
        res.json({ likes, dislikes, userState: { is_favorite: 0, in_watchlist: 0, reaction: 0 } });
      }
    });
  });
});

app.post('/api/interactions/toggle', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Log in required' });
  const { showTitle, action } = req.body;
  const userId = req.session.user.id;

  db.get(`SELECT * FROM user_interactions WHERE user_id = ? AND show_title = ?`, [userId, showTitle], (err, row) => {
    let current = row || { is_favorite: 0, in_watchlist: 0, reaction: 0 };

    if (action === 'favorite') current.is_favorite = current.is_favorite ? 0 : 1;
    else if (action === 'watchlist') current.in_watchlist = current.in_watchlist ? 0 : 1;
    else if (action === 'like') current.reaction = current.reaction === 1 ? 0 : 1;
    else if (action === 'dislike') current.reaction = current.reaction === -1 ? 0 : -1;

    db.run(`
      INSERT INTO user_interactions (user_id, show_title, is_favorite, in_watchlist, reaction, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [userId, showTitle, current.is_favorite, current.in_watchlist, current.reaction], (err) => {
      if (err) return res.status(500).json({ error: 'Database update failed' });
      res.json({ success: true, userState: current });
    });
  });
});

// FETCH MOVIES & SHOWS FROM MOVIES FOLDER
app.get('/api/shows', (req, res) => {
  fs.readdir(MOVIES_DIR, { withFileTypes: true }, (err, entries) => {
    if (err) return res.status(500).json({ error: 'Failed to read media library' });

    const videoExts = ['.mp4', '.mkv', '.webm', '.mov'];
    const imageExts = ['.png', '.jpg', '.jpeg', '.webp'];
    const shows = [];

    entries.forEach(entry => {
      if (entry.isDirectory()) {
        const folderName = entry.name;
        const folderPath = path.join(MOVIES_DIR, folderName);
        const folderFiles = fs.readdirSync(folderPath);

        const thumbFile = folderFiles.find(file => 
          imageExts.includes(path.extname(file).toLowerCase()) && 
          path.parse(file).name.toLowerCase() === 'thumbnail'
        ) || folderFiles.find(file => imageExts.includes(path.extname(file).toLowerCase()));

        const thumbnailUrl = thumbFile 
          ? `/thumbnails/${encodeURIComponent(folderName)}/${encodeURIComponent(thumbFile)}`
          : 'https://via.placeholder.com/400x225/181c24/00e5ff?text=Indie+Film';

        const episodes = folderFiles
          .filter(file => videoExts.includes(path.extname(file).toLowerCase()))
          .map((file, idx) => ({
            id: idx + 1,
            title: path.parse(file).name.replace(/[_-]/g, ' ').toUpperCase(),
            fileName: file,
            streamUrl: `/api/stream/show/${encodeURIComponent(folderName)}/${encodeURIComponent(file)}`
          }));

        if (episodes.length > 0) {
          shows.push({
            id: folderName.toLowerCase().replace(/\s+/g, '-'),
            title: folderName,
            thumbnail: thumbnailUrl,
            episodes: episodes
          });
        }
      }
    });

    res.json(shows);
  });
});

app.get('/api/stream/show/:folder/:filename', (req, res) => {
  streamVideoFile(req, res, path.join(MOVIES_DIR, req.params.folder, req.params.filename));
});

app.listen(PORT, () => {
  console.log(`Server live on port ${PORT}`);
});