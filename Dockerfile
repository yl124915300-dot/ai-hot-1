FROM node:18-alpine

WORKDIR /app

# 先装依赖（无 lockfile 用 install）
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# 再拷贝源码
COPY public ./public
COPY src ./src

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
