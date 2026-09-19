const express = require('express');
const axios = require('axios');
const app = express();

const FOLDER_ID = '1f1aKEVKqtSM2DVDCTWzOweqO5nIyGUjJ';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; // Add your Google API Key in Render environment variables

app.use(express.static('public'));

// Endpoint to dynamically fetch catalog from Google Drive
app.get('/api/movies', async (req, res) => {
  try {
    // Query Google Drive API for subfolders/files inside your Movies folder
    const response = await axios.get(
      `https://www.googleapis.com/drive/v3/files?q='${FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name,mimeType)&key=${GOOGLE_API_KEY}`
    );
    
    // Map items to video and thumbnail stream links
    const movies = response.data.files.map(file => ({
      id: file.id,
      title: file.name,
      videoUrl: `https://lh3.googleusercontent.com/d/${file.id}`,
      // For Google Drive direct stream links, you can use:
      // https://drive.google.com/uc?export=download&id=FILE_ID
    }));

    res.json(movies);
  } catch (error) {
    console.error('Error fetching Drive files:', error.message);
    res.status(500).json({ error: 'Failed to fetch catalog from Google Drive' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));