const express = require('express');
const axios = require('axios');
const app = express();

const FOLDER_ID = '1f1aKEVKqtSM2DVDCTWzOweqO5nIyGUjJ'; // Your main Movies folder ID
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

app.use(express.static('public'));

app.get('/api/shows', async (req, res) => {
  try {
    if (!GOOGLE_API_KEY) {
      console.error('Missing GOOGLE_API_KEY environment variable.');
      return res.status(500).json({ error: 'Server configuration error: Missing API Key' });
    }

    // 1. Get all subfolders inside the main Movies folder
    const foldersRes = await axios.get(
      `https://www.googleapis.com/drive/v3/files?q='${FOLDER_ID}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&fields=files(id,name)&key=${GOOGLE_API_KEY}`
    );

    const subfolders = foldersRes.data.files || [];
    const movies = [];

    // 2. Loop through each movie subfolder to find video and thumbnail files
    for (const folder of subfolders) {
      const filesRes = await axios.get(
        `https://www.googleapis.com/drive/v3/files?q='${folder.id}'+in+parents+and+trashed=false&fields=files(id,name,mimeType)&key=${GOOGLE_API_KEY}`
      );

      const items = filesRes.data.files || [];
      let videoFile = null;
      let thumbFile = null;

      for (const item of items) {
        if (item.mimeType === 'video/mp4' || item.name.endsWith('.mp4')) {
          videoFile = item;
        } else if (item.mimeType && item.mimeType.startsWith('image/')) {
          thumbFile = item;
        }
      }

      if (videoFile) {
        movies.push({
          id: videoFile.id,
          title: folder.name,
          videoUrl: `https://drive.google.com/uc?export=download&id=${videoFile.id}`,
          thumbnailUrl: thumbFile ? `https://drive.google.com/uc?export=download&id=${thumbFile.id}` : ''
        });
      }
    }

    res.json(movies);
  } catch (error) {
    console.error('Error fetching from Google Drive:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch catalog from Google Drive' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));