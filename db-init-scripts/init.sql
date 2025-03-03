-- db-init-scripts/init.sql

-- 1) Create main DB
CREATE DATABASE board_game_prototyping;
\connect board_game_prototyping;

-- Create tables in main DB
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

/* 
   IMPORTANT: Grant ownership & privileges in the main DB 
   so that "admin" can SELECT/INSERT/UPDATE these tables.
*/
CREATE ROLE admin WITH LOGIN PASSWORD 'test1234';
GRANT ALL PRIVILEGES ON DATABASE board_game_prototyping TO admin;

ALTER TABLE users OWNER TO admin;
ALTER TABLE projects OWNER TO admin;
ALTER TABLE project_versions OWNER TO admin;

ALTER SEQUENCE users_id_seq OWNER TO admin;
ALTER SEQUENCE projects_id_seq OWNER TO admin;
ALTER SEQUENCE project_versions_id_seq OWNER TO admin;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO admin;
/* 
   Optionally ensure future tables are also covered:
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO admin;
*/


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

/*
   Grant ownership & privileges in the test DB for 'admin' as well.
*/
GRANT ALL PRIVILEGES ON DATABASE board_game_prototyping_test TO admin;

ALTER TABLE users OWNER TO admin;
ALTER TABLE projects OWNER TO admin;
ALTER TABLE project_versions OWNER TO admin;

ALTER SEQUENCE users_id_seq OWNER TO admin;
ALTER SEQUENCE projects_id_seq OWNER TO admin;
ALTER SEQUENCE project_versions_id_seq OWNER TO admin;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO admin;
