#!/bin/bash
# 双击本文件即可启动 市场温度计 / Market Thermometer 组件。
# 组件会在后台运行；启动后这个终端窗口可以直接关掉。
cd "/Users/a27/Tools/info" || exit 1

# 若已在运行则不重复启动
if pgrep -f "electron .*Tools/info" >/dev/null 2>&1; then
  echo "组件已经在运行了。"
  sleep 1
  exit 0
fi

echo "正在启动 市场温度计 / Market Thermometer..."
nohup ./node_modules/.bin/electron . >/tmp/market-thermometer.log 2>&1 &
sleep 2
echo "已启动，可以关闭本窗口。"
exit 0
