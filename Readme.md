# 115-bot

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Docker](https://img.shields.io/badge/docker-ready-green.svg)

一个基于 Web 的 **115 网盘自动转存与定时任务管理工具**。
支持 **自动归档、可视化 Cron 编辑器、断点续传、持久化配置** 等功能，让 115 分享转存更智能、更稳定、更自动化。

## ✨ 功能特性

- **Web 可视化界面**
  - 深色 / 浅色主题切换
  - 任务列表、日志、目录浏览一目了然

- **智能自动归档**
  - 任务名称留空时，自动解析分享标题
  - 在目标目录下自动创建同名文件夹
  - 无需手动命名，适合大量批量任务

- **可视化 Cron 定时任务**
  - 内置 Cron 表达式生成器（分/时/日/月/周）
  - 支持周期性监控与自动转存
  - 支持立即运行 / 暂停任务

- **原始链接永久保留**
  - 点击任务名称可跳转到原始 115 分享网址

- **Docker 部署友好**
  - 基于 Alpine 的轻量镜像
  - 支持 amd64 / arm64 多架构

- **数据持久化**
  - 所有任务、账号 Cookie、日志均存储到宿主机
  - 容器重启不会丢失配置

## 🚀 快速开始（Docker Compose）

推荐使用 Docker Compose 进行部署。

### 1. 将项目所有文件下载并存储到本地
### 2. 新建 docker-compose.yml（放在项目根目录）

```yaml
version: "3"
services:
  app:
    image: yourname/115-task-master:latest
    container_name: 115-task-master
    restart: always
    ports:
      - "3115:3000"
    volumes:
      - ./data:/app/data
    environment:
      - TZ=Asia/Shanghai
```

### 2. 启动服务

```bash
docker-compose up -d --build
```

访问：http://localhost:3115


## 📝 使用说明
### 1.注册账户
首次进入时要求配置账户密码，可自定义设置，输入完成后点击注册新账户，接着点击登录即可。

### 2. 登录配置
首次进入后台需填写 115 Cookie（UID/CID/SEID 等）。

### 3. 创建转存任务

1. 输入分享链接和提取码
2. 点击“选择目录”浏览网盘结构
3. 可选：设置 Cron，如 `0 2 * * *`（每天凌晨 2 点）
4. 保存任务即可

### 4. 管理任务

- 查看日志
- 立即运行
- 启用 / 停用
- 编辑任务
- 删除任务
- 点击任务名称跳转源链接

## ⚠️ 免责声明

本项目仅供学习交流，请勿用于非法用途。  
使用本项目造成的后果由使用者自行承担。

## 📄 License

MIT
