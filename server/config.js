// server/config.js
import dotenv from 'dotenv';

// Load environment variables once
dotenv.config();

const isTestEnv = process.env.NODE_ENV === 'test';

// Conditionally choose DB name:
const dbName = isTestEnv
  ? 'board_game_prototyping_test'
  : (process.env.DB_NAME || 'board_game_prototyping');

const config = {
  PORT: process.env.PORT || 3000,
  DB_USER: process.env.DB_USER || 'postgres',
  DB_HOST: process.env.DB_HOST || 'db',
  DB_NAME: dbName,
  DB_PASSWORD: process.env.DB_PASSWORD || 'postgrespassword',
  DB_PORT: process.env.DB_PORT || '5432',
  DB_SSL: process.env.DB_SSL === 'true',
  JWT_SECRET: process.env.JWT_SECRET || 'your_jwt_secret',
  NODE_ENV: process.env.NODE_ENV || 'development',
};

export default config;
