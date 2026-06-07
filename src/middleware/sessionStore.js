const session = require('express-session');

class SQLiteSessionStore extends session.Store {
  constructor(sqlite) {
    super();
    this.db = sqlite;
    // Clean expired sessions every 15 minutes
    setInterval(() => this._cleanup(), 15 * 60 * 1000);
  }

  get(sid, callback) {
    try {
      const row = this.db.prepare('SELECT data, expires FROM sessions WHERE sid = ?').get(sid);
      if (!row) return callback(null, null);
      if (row.expires && row.expires < Date.now()) {
        this.destroy(sid, () => {});
        return callback(null, null);
      }
      callback(null, JSON.parse(row.data));
    } catch (e) {
      callback(e);
    }
  }

  set(sid, sessionData, callback) {
    try {
      const expires = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + 24 * 60 * 60 * 1000;
      this.db.prepare(
        'INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)'
      ).run(sid, JSON.stringify(sessionData), expires);
      callback(null);
    } catch (e) {
      callback(e);
    }
  }

  destroy(sid, callback) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback && callback(null);
    } catch (e) {
      callback && callback(e);
    }
  }

  touch(sid, sessionData, callback) {
    this.set(sid, sessionData, callback);
  }

  _cleanup() {
    try {
      this.db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    } catch (_) {}
  }
}

module.exports = SQLiteSessionStore;
