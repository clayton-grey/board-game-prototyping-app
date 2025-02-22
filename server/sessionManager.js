// server/sessionManager.js
// Not heavily used in our new refactor, but here’s its final state if you still need session-based HTTP.
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import pool from './database.js';
import config from './config.js';

const PgSession = pgSession(session);

const sessionMiddleware = session({
  store: new PgSession({
    pool,
    tableName: 'user_sessions',
  }),
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24, // 1 day
  },
});

export default sessionMiddleware;
