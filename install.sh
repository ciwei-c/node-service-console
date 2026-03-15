#!/bin/bash
#
# Node Service Console — 安装脚本
# 将项目部署到 /opt/node-service-console 并注册为 systemd 服务
#
set -e

APP_NAME="node-service-console"
INSTALL_DIR="/opt/$APP_NAME"
SERVICE_FILE="/etc/systemd/system/$APP_NAME.service"

echo "========================================="
echo "  Node Service Console 安装脚本"
echo "========================================="

# 检查 root 权限
if [ "$(id -u)" -ne 0 ]; then
  echo "错误：请使用 root 用户执行此脚本"
  exit 1
fi

# 检查依赖
for cmd in node npm npx docker; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "错误：未找到 $cmd，请先安装"
    exit 1
  fi
done

echo ""
echo "1) 复制项目文件到 $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"

# 使用 rsync 排除不需要的文件，若无 rsync 则用 cp
if command -v rsync &>/dev/null; then
  rsync -a --delete \
    --exclude='node_modules' \
    --exclude='.git' \
    "$(dirname "$0")/" "$INSTALL_DIR/"
else
  cp -r "$(dirname "$0")/." "$INSTALL_DIR/"
fi

echo "2) 安装后端依赖 ..."
cd "$INSTALL_DIR"
npm install --omit=dev

echo "3) 安装前端依赖并构建 ..."
cd "$INSTALL_DIR/web"
npm install
npm run build
cd "$INSTALL_DIR"

echo "4) 安装 systemd 服务 ..."
cp "$INSTALL_DIR/$APP_NAME.service" "$SERVICE_FILE"

# 重载 systemd 配置
systemctl daemon-reload

# 启用开机自启
systemctl enable "$APP_NAME"

# 启动服务
systemctl start "$APP_NAME"

echo ""
echo "========================================="
echo "  安装完成！"
echo "========================================="
echo ""
echo "常用命令："
echo "  查看状态:  systemctl status $APP_NAME"
echo "  查看日志:  journalctl -u $APP_NAME -f"
echo "  重启服务:  systemctl restart $APP_NAME"
echo "  停止服务:  systemctl stop $APP_NAME"
echo "  禁用自启:  systemctl disable $APP_NAME"
echo ""
echo "服务默认端口: 80，访问路径: /node-service-console"
echo "可在 /etc/node-service-console/config.json 中修改端口"
echo ""
