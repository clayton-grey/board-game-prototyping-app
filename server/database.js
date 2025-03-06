// server/database.js
import pkg from "pg";
const { Pool } = pkg;
import config from "./config.js";

const pool = new Pool({
  user: config.DB_USER,
  host: config.DB_HOST,
  database: config.DB_NAME,
  password: config.DB_PASSWORD,
  port: config.DB_PORT,
  ssl: config.DB_SSL ? { rejectUnauthorized: false } : false,
});

export const connectDB = async () => {
  try {
    await pool.query("SELECT 1");
    console.log("Connected to PostgreSQL database");
  } catch (error) {
    console.error("Database connection error:", error);
    process.exit(1);
  }
};

export default pool;
