# ---- 基础镜像 ----
FROM node:18-alpine

# ---- 设置工作目录 ----
WORKDIR /app

# ---- 拷贝 package 文件并安装依赖 ----
COPY package*.json ./
RUN npm install --production

# ---- 拷贝代码 ----
COPY . .

# ---- 暴露端口 ----
EXPOSE 8080

# ---- 启动服务（注意：现在是 src/server.js） ----
CMD ["node", "src/server.js"]
