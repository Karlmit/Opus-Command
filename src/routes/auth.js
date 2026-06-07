const express = require('express');
const router = express.Router();
const { loginLimiter } = require('../middleware/rateLimit');
const { verifyCredentials, hasAdminAccount, changePassword } = require('../services/auth.service');
const { requireAuth } = require('../middleware/auth');

router.get('/me', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({ loggedIn: true, username: req.session.username, userId: req.session.userId });
  }
  res.json({ loggedIn: false });
});

router.get('/csrf-token', (req, res) => {
  res.json({ csrfToken: req.session.csrfToken || '' });
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const setupComplete = await hasAdminAccount();
    if (!setupComplete) {
      return res.status(403).json({ error: 'Setup not complete.' });
    }

    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Incorrect username or password.' });
    }

    const user = await verifyCredentials(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Incorrect username or password.' });
    }

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Session error.' });
      req.session.userId = user.id;
      req.session.username = user.username;
      res.json({ success: true });
    });
  } catch (err) {
    console.error('[auth] Login error:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed.' });
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (!newPassword || newPassword.length < 12) {
      return res.status(400).json({ error: 'New password must be at least 12 characters.' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }
    const result = await changePassword(req.session.userId, currentPassword, newPassword);
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Password change failed.' });
  }
});

module.exports = router;
