const express = require('express');
const { runConversation } = process.env.GEMINI_API_KEY
  ? require('../lib/gemini')
  : require('../lib/anthropic');

const router = express.Router();

router.post('/', async (req, res) => {
  const { messages, currentRoutine } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array requerido' });
  }

  try {
    const result = await runConversation(messages, currentRoutine || null);
    res.json(result); // { text, routine }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

module.exports = router;
