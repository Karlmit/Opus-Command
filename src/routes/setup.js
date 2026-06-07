const express = require('express');
const router = express.Router();
const { hasAdminAccount, createAdminAccount } = require('../services/auth.service');

router.get('/status', async (req, res) => {
  const exists = await hasAdminAccount();
  res.json({ setupComplete: exists });
});

router.post('/', async (req, res) => {
  try {
    const exists = await hasAdminAccount();
    if (exists) {
      return res.status(403).json({ error: 'Setup already complete.' });
    }

    const { username, password, confirmPassword } = req.body;

    if (!username || username.trim().length < 1) {
      return res.status(400).json({ error: 'Username is required.' });
    }
    if (!password || password.length < 12) {
      return res.status(400).json({ error: 'Password must be at least 12 characters.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    await createAdminAccount(username.trim(), password);

    const { verifyCredentials } = require('../services/auth.service');
    const user = await verifyCredentials(username.trim(), password);
    req.session.userId = user.id;
    req.session.username = user.username;

    res.json({ success: true });
  } catch (err) {
    console.error('[setup] Error:', err);
    res.status(500).json({ error: 'Setup failed. Please try again.' });
  }
});

module.exports = router;
