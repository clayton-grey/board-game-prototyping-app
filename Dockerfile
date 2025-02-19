FROM node:16

WORKDIR /app

# Copy package.json and install dependencies inside Docker
COPY package.json package-lock.json ./

# Remove node_modules, package-lock.json, force fresh install, and verify bcryptjs installation
RUN rm -rf node_modules package-lock.json && npm install --force --legacy-peer-deps && npm list bcryptjs || npm install bcryptjs

# Copy the rest of the application files
COPY . .

# Ensure environment variables are loaded
ENV NODE_ENV=production

# Wait for PostgreSQL to be ready before starting the app
CMD ["sh", "-c", "sleep 5 && npm run dev"]

EXPOSE 3000
