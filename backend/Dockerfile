FROM node:18-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Cloud Run expects port 8080
EXPOSE 8080

# Start the server
CMD ["npm", "start"]