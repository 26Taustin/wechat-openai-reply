FROM node:20-slim

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 先清理缓存 + 用淘宝镜像加速 + 生产安装
RUN npm config set registry https://registry.npmmirror.com && \
    npm install --production --no-audit --no-fund --prefer-offline && \
    npm cache clean --force

# 复制代码
COPY . .

ENV NODE_ENV=production
ENV PORT=80

EXPOSE 80

CMD ["node", "server.js"]
