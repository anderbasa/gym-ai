require('dotenv').config();
const express = require('express');
const path = require('path');
const { loadDataset } = require('./lib/exercises');
const chatRouter = require('./routes/chat');

loadDataset();

const app = express();
app.use(express.json({ limit: '15mb' })); // las fotos en base64 pueden pesar

app.use('/exercise-media/images', express.static(path.join(__dirname, '../data/images')));
app.use('/exercise-media/videos', express.static(path.join(__dirname, '../data/videos')));
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/chat', chatRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`gym-ai escuchando en http://localhost:${PORT}`);
});
