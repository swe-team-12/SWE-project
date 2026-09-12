FROM node:24-alpine
WORKDIR /workspace
COPY package.json package-lock.json* ./
COPY apps/client/package.json apps/client/package.json
COPY packages/api-client/package.json packages/api-client/package.json
RUN npm ci
COPY apps/client apps/client
COPY packages/api-client packages/api-client
EXPOSE 8081 19000 19001
CMD ["npm", "--workspace", "@biletflow/client", "run", "web", "--", "--port", "8081"]
