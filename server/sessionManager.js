import session from 'express-session';
import pgSession from 'connect-pg-simple';
import pool from './database.js';
import dotenv from 'dotenv';

dotenv.config();

const PgSession = pgSession(session);

const sessionMiddleware = session({
    store: new PgSession({
        pool,
        tableName: 'user_sessions',
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
});

export default sessionMiddleware;