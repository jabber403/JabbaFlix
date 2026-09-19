const express = require('express');
const axios = require('axios');
const app = express();

const FOLDER_ID = '1f1aKEVKqtSM2DVDCTWzOweqO5nIyGUjJ'; // Your Drive folder ID
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

app.use(express.static('public'));

app.get('/api/auth/me', (req, res) => {
  res.json({ loggedIn: false });
});

app.get('/api/shows', async (req, res) => {
  if (!GOOGLE_API_KEY) {
    console.error('Missing GOOGLE_API_KEY environment variable.');
    return res.json([]);
  }

  try {
    // Fetch all items inside the folder
    const response = await axios.get(
      `https://www.googleapis.com/drive/v3/files?q='${FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name,mimeType)&key=${GOOGLE_API_KEY}`
    );

    const items = response.data.files || [];
    const movies = [];

    const subfolders = items.filter(item => item.mimeType === 'application/vnd.google-apps.folder');
    const directFiles = items.filter(item => item.mimeType === 'video/mp4' || item.name.endsWith('.mp4'));

    // Mode 1: Handle if .mp4 files are stored directly in this folder
    for (const file of directFiles) {
      const title = file.name.replace(/\.[^/.]+$/, ''); // Remove file extension for title
      const thumbFile = items.find(i => i.mimeType && i.mimeType.startsWith('image/'));

      movies.push({
        id: file.id,
        title: title,
        videoUrl: `https://drive.google.com/uc?export=download&id=${file.id}`,
        thumbnailUrl: thumbFile ? `https://drive.google.com/uc?export=download&id=${thumbFile.id}` : ''
      });
    }

    // Mode 2: Handle if files are nested inside subfolders
    for (const folder of subfolders) {
      const subRes = await axios.get(
        `https://www.googleapis.com/drive/v3/files?q='${folder.id}'+in+parents+and+trashed=false&fields=files(id,name,mimeType)&key=${GOOGLE_API_KEY}`
      );

      const subItems = subRes.data.files || [];
      let videoFile = null;
      let thumbFile = null;

      for (const item of subItems) {
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
    res.json([]);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));