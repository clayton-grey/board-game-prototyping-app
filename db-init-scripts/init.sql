-- db-init-scripts/init.sql

-- 1) Create main DB
CREATE DATABASE board_game_prototyping;
\connect board_game_prototyping;

-- Create tables in main DB (example)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password VARCHAR(200) NOT NULL,
  role VARCHAR(50) DEFAULT 'user'
);
CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  owner_id INT REFERENCES users(id),
  name VARCHAR(200),
  description TEXT
);
CREATE TABLE project_versions (
  id SERIAL PRIMARY KEY,
  project_id INT REFERENCES projects(id),
  version_number INT NOT NULL,
  project_data JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2) Create test DB
CREATE DATABASE board_game_prototyping_test;
\connect board_game_prototyping_test;

-- Create the same tables in the test DB
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password VARCHAR(200) NOT NULL,
  role VARCHAR(50) DEFAULT 'user'
);

CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  owner_id INT REFERENCES users(id),
  name VARCHAR(200),
  description TEXT
);

CREATE TABLE project_versions (
  id SERIAL PRIMARY KEY,
  project_id INT REFERENCES projects(id),
  version_number INT NOT NULL,
  project_data JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

/* Example: If you used any ALTER TABLE statements, re-run them here, e.g.:
ALTER TABLE project_versions
  ADD CONSTRAINT project_versions_unique UNIQUE (project_id, version_number);
*/

-- 3) Create the admin role & password
CREATE ROLE admin WITH LOGIN PASSWORD 'test1234';

-- 4) Grant privileges on the test DB to "admin"
GRANT ALL PRIVILEGES ON DATABASE board_game_prototyping_test TO admin;

/*
  5) Grant table-level privileges in the test DB:
     If you want admin to have full read/write on *all* tables in 'public' schema:
*/
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO admin;

/*
  6) Make admin the owner of each table in the test DB (important to avoid "permission denied"):
     If you have many tables, do this for each. Example for users/projects:
*/
ALTER TABLE users OWNER TO admin;
ALTER TABLE projects OWNER TO admin;
ALTER TABLE project_versions OWNER TO admin;

/* Optionally ensure sequences are owned by admin, too: */
ALTER SEQUENCE users_id_seq OWNER TO admin;
ALTER SEQUENCE projects_id_seq OWNER TO admin;
ALTER SEQUENCE project_versions_id_seq OWNER TO admin;

/*
  7) For safety, you can also set default privileges for any future tables in "public" schema:
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO admin;
*/

-- Done
