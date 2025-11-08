# 使用官方 Node 运行时
FROM node:20-alpine

# 工作目录
WORKDIR /app

# 拷贝依赖文件（如有 package.json 可替换下面两行）
COPY package.json package-lock.json* ./
RUN npm ci || npm i

# 拷贝源码
COPY . .

# 暴露端口
EXPOSE 8080

# 启动
CMD ["node", "src/server.js"]
