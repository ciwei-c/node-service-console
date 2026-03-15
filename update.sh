#!/bin/bash
#
# Node Service Console — 更新脚本
# 拉取最新代码、重新安装依赖、构建前端、重启服务
#
set -e

APP_NAME="node-service-console"
INSTALL_DIR="/opt/$APP_NAME"

echo "========================================="
echo "  Node Service Console 更新脚本"
echo "========================================="

# 检查 root 权限
if [ "$(id -u)" -ne 0 ]; then
  echo "错误：请使用 root 用户执行此脚本"
  exit 1
fi

cd "$INSTALL_DIR"

echo ""
echo "1) 拉取最新代码 ..."
git pull

echo ""
echo "2) 安装后端依赖 ..."
npm install --omit=dev

echo ""
echo "3) 安装前端依赖并构建 ..."
cd web
npm install
npm run build
cd "$INSTALL_DIR"

echo ""
echo "4) 重启服务 ..."
systemctl restart "$APP_NAME"

echo ""
echo "========================================="
echo "  更新完成！"
echo "========================================="
echo ""
systemctl status "$APP_NAME" --no-pager
echo ""
