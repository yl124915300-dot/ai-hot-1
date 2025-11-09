# 使用 Node 18（自带 fetch），体积小
FROM node:18-alpine

# 工作目录
WORKDIR /app

# 先拷贝依赖声明，安装依赖（利用层缓存）
COPY package*.json ./
RUN npm ci --omit=dev

# 再拷贝源码
COPY public ./public
COPY src ./src

# Render 默认注入 PORT 环境变量，这里用 8080 兜底
ENV PORT=8080

# 暴露端口（仅文档化，在 Render 不强制）
EXPOSE 8080

# 启动
CMD ["npm", "start"]
