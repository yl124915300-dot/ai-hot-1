# 使用较新的 Node 20
FROM node:20-alpine AS base
WORKDIR /app

# 复制依赖清单并安装
COPY package*.json ./

# 优先使用 npm ci（有 lock 文件更稳定）
# 如果你的仓库没有 package-lock.json，请换成下一行注释的命令
RUN npm ci --omit=dev
# RUN npm install --omit=dev

# 再拷贝源代码
COPY . .

# 暴露端口
ENV PORT=8080
EXPOSE 8080

# 启动服务
CMD ["npm", "start"]
