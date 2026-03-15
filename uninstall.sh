#!/bin/bash
#
# Node Service Console — 卸载脚本
#
set -e

APP_NAME="node-service-console"
INSTALL_DIR="/opt/$APP_NAME"
SERVICE_FILE="/etc/systemd/system/$APP_NAME.service"

if [ "$(id -u)" -ne 0 ]; then
  echo "错误：请使用 root 用户或 sudo 执行此脚本"
  exit 1
fi

echo "停止并禁用服务 ..."
systemctl stop "$APP_NAME" 2>/dev/null || true
systemctl disable "$APP_NAME" 2>/dev/null || true

echo "删除 systemd 服务文件 ..."
rm -f "$SERVICE_FILE"
systemctl daemon-reload

echo "删除安装目录 ..."
rm -rf "$INSTALL_DIR"

echo ""
echo "卸载完成。"
echo "注意：配置文件 /etc/node-service-console/ 和数据文件 /var/lib/node-service-console/ 已保留。"
echo "如需彻底删除，请手动执行："
echo "  rm -rf /etc/node-service-console /var/lib/node-service-console"
echo ""
