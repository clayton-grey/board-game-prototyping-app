// server/config.js
import dotenv from 'dotenv';

// Load environment variables once
dotenv.config();

const config = {
  PORT: process.env.PORT || 3000,
  DB_USER: process.env.DB_USER,
  DB_HOST: process.env.DB_HOST,
  DB_NAME: process.env.DB_NAME,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_PORT: process.env.DB_PORT,
  DB_SSL: process.env.DB_SSL === 'true',
  SESSION_SECRET: process.env.SESSION_SECRET,
  JWT_SECRET: process.env.JWT_SECRET,
  NODE_ENV: process.env.NODE_ENV || 'development',
};

export default config;
