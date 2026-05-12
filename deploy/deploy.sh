#!/bin/bash
# PicUp 一键部署脚本
# 用法：bash deploy/deploy.sh
#
# 前置条件：
#   1. 服务器已安装 Docker + Docker Compose
#   2. .env 文件已按生产环境配置
#   3. 宝塔 Nginx 已配置反代（见 deploy/nginx.conf）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "=========================================="
echo "  PicUp 部署脚本"
echo "=========================================="

# ---------- 前置检查 ----------
echo ""
echo "[1/6] 检查环境..."

if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装，请先安装 Docker"
    exit 1
fi

if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose 未安装，请先安装 Docker Compose V2"
    exit 1
fi

if [ ! -f .env ]; then
    echo "❌ .env 文件不存在"
    echo "   请复制 .env.production.example 为 .env 并修改配置："
    echo "   cp .env.production.example .env"
    exit 1
fi

echo "✅ 环境检查通过"

# ---------- 检查关键配置 ----------
echo ""
echo "[2/6] 检查 .env 关键配置..."

source <(grep -v '^#' .env | grep '=')

if [ "${APP_ENV:-}" != "production" ]; then
    echo "⚠️  警告：APP_ENV=${APP_ENV:-未设置}，建议设为 production"
fi

if [ "${JWT_SECRET:-change-me}" = "change-me" ]; then
    echo "⚠️  警告：JWT_SECRET 使用默认值，请修改为随机字符串"
fi

if [ "${COOKIE_SECRET:-change-me}" = "change-me" ]; then
    echo "⚠️  警告：COOKIE_SECRET 使用默认值，请修改为随机字符串"
fi

NEXT_URL="${NEXT_PUBLIC_API_BASE_URL:-}"
if [ -n "$NEXT_URL" ]; then
    echo "❌ 错误：NEXT_PUBLIC_API_BASE_URL 不为空（当前值：$NEXT_URL）"
    echo "   这会导致前端请求指向错误地址！必须留空。"
    exit 1
fi

echo "✅ 配置检查通过"

# ---------- 创建存储目录 ----------
echo ""
echo "[3/6] 创建存储目录..."
mkdir -p storage/inputs storage/outputs
echo "✅ 存储目录就绪"

# ---------- 构建镜像 ----------
echo ""
echo "[4/6] 构建 Docker 镜像（首次可能需要几分钟）..."
docker compose build
echo "✅ 镜像构建完成"

# ---------- 启动服务 ----------
echo ""
echo "[5/6] 启动服务..."
docker compose up -d
echo "✅ 服务已启动"

# ---------- 健康检查 ----------
echo ""
echo "[6/6] 等待服务就绪..."
sleep 5

MAX_RETRIES=30
RETRY=0
while [ $RETRY -lt $MAX_RETRIES ]; do
    if curl -sf http://127.0.0.1:4000/api/health > /dev/null 2>&1; then
        echo "✅ API 服务健康"
        break
    fi
    RETRY=$((RETRY + 1))
    echo "   等待 API 就绪... ($RETRY/$MAX_RETRIES)"
    sleep 2
done

if [ $RETRY -eq $MAX_RETRIES ]; then
    echo "⚠️  API 健康检查超时，请手动检查："
    echo "   docker compose logs api"
fi

# ---------- 完成 ----------
echo ""
echo "=========================================="
echo "  ✅ 部署完成！"
echo "=========================================="
echo ""
echo "  容器状态："
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo "  验证命令："
echo "    curl http://127.0.0.1:4000/api/health"
echo "    curl -I http://127.0.0.1:3000"
echo ""
echo "  查看日志："
echo "    docker compose logs -f web"
echo "    docker compose logs -f api"
echo "    docker compose logs -f worker"
echo ""
echo "  确保宝塔 Nginx 已配置反代："
echo "    参考 deploy/nginx.conf"
echo ""
