FROM node:20-slim
WORKDIR /app
# 先复制 package.json 和 package-lock.json（如果有），缓存依赖层
COPY package*.json ./
# 生产模式安装依赖，清理缓存
RUN npm ci --only=production --omit=dev && \
    npm cache clean --force
# 再复制全部代码
COPY . .
# 环境变量
ENV NODE_ENV=production
ENV PORT=80
# 暴露端口
EXPOSE 80
# 启动命令
CMD ["node", "server.js"]
