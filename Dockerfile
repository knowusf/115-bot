# [关键修改] 使用国内镜像代理拉取基础镜像，解决构建卡顿问题
FROM docker.m.daocloud.io/node:18-alpine

# 设置容器内工作目录
WORKDIR /app

# [优化] 如果需要安装 apk 软件，先替换为阿里云源，确保稳定性
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

# 1. 先只复制 package.json，利用 Docker 缓存层机制加速构建
COPY package.json ./

# 2. [关键修改] 确保使用淘宝 NPM 镜像源安装依赖
RUN npm install --production --registry=https://registry.npmmirror.com

# 3. 复制所有源代码到容器中
COPY . .

# 创建数据目录（确保权限正确）
RUN mkdir -p data && chown -R node:node /app

# 暴露端口
EXPOSE 3000

# 切换到非 root 用户运行（安全最佳实践）
USER node

# 启动命令
CMD ["npm", "start"]
