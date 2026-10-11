# PicUp 部署指南

## SSH 部署方式

项目已从 GitHub Actions 自动部署切换为本地 SSH 手动部署。

### 服务器信息

- **SSH 别名**: `picup`
- **服务器地址**: YOUR_SERVER_IP
- **用户**: root
- **项目目录**: `YOUR_SERVER_APP_DIR`
- **SSH 配置文件**: `~/.ssh/config`

### 部署脚本

#### 1. 完整部署（推送到 GitHub + 服务器部署）

```bash
./deploy/deploy-ssh.sh
```

这个脚本会：
1. 检查本地是否有未提交的更改
2. 推送代码到 GitHub
3. SSH 到服务器
4. 在服务器上拉取最新代码
5. 执行部署脚本（构建 Docker 镜像并重启服务）

#### 2. 快速部署（仅服务器部署）

```bash
./deploy/deploy-quick.sh
```

这个脚本会：
1. SSH 到服务器
2. 在服务器上执行部署脚本

适用于代码已经在服务器上，只需要重新构建和部署的情况。

### 手动部署步骤

如果需要手动操作：

```bash
# 1. 推送代码到 GitHub
git push origin main

# 2. SSH 到服务器
ssh picup

# 3. 进入项目目录
cd YOUR_SERVER_APP_DIR

# 4. 拉取最新代码
git pull origin main

# 5. 执行部署
bash deploy/deploy.sh
```

### 服务器部署脚本说明

`deploy/deploy.sh` 会自动执行以下操作：

1. 构建 Docker 镜像（标签：`picup-app:sha-<git-hash>`）
2. 启动 PostgreSQL 和 Redis 容器
3. 运行数据库迁移
4. 启动 API、Worker 和 Web 服务
5. 健康检查
6. 清理 Nginx 缓存
7. 可选：推送镜像到 ACR 备份

### 查看服务状态

```bash
# SSH 到服务器
ssh picup

# 查看容器状态
docker compose ps

# 查看日志
docker compose logs -f api
docker compose logs -f web
docker compose logs -f worker
```

### 回滚

```bash
# SSH 到服务器
ssh picup
cd YOUR_SERVER_APP_DIR

# 查看 Git 历史
git log --oneline -10

# 回滚到指定提交
git reset --hard <commit-hash>

# 重新部署
bash deploy/deploy.sh
```

### GitHub Actions

GitHub Actions 工作流已禁用自动触发，但保留了手动触发选项：

- 访问 GitHub Actions 页面
- 选择 "CI and Deploy" 工作流
- 点击 "Run workflow" 手动触发

### 注意事项

1. 部署前确保本地代码已提交
2. 部署过程中会短暂中断服务（通常 < 1 分钟）
3. 数据库迁移会自动执行
4. 旧的 Docker 镜像会保留用于回滚
5. 部署失败时可以查看服务器日志排查问题

### 环境变量

服务器上的环境变量配置文件：`YOUR_SERVER_APP_DIR/.env`

如需修改环境变量，直接在服务器上编辑该文件，然后重新部署。

### 故障排查

如果部署失败：

```bash
# 查看详细日志
ssh picup
cd YOUR_SERVER_APP_DIR
docker compose logs --tail=100 api web worker migrate

# 检查容器状态
docker compose ps -a

# 重启特定服务
docker compose restart api
docker compose restart web
docker compose restart worker
```
