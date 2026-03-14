# Hướng dẫn cài đặt — Antigravity Mobile Bridge

## Yêu cầu

- **macOS** (Apple Silicon hoặc Intel)
- **Node.js** ≥ 18 (`brew install node`)
- **Antigravity IDE** đã cài tại `/Applications/Antigravity.app`

## Cài đặt nhanh (5 phút)

```bash
# 1. Clone repo
git clone https://github.com/ductho0409/antigravity-ide-mobile.git
cd antigravity-ide-mobile

# 2. Cài dependencies + build
cd client && npm install && cd ..
cd server && npm install && cd ..
npm run build

# 3. Cài service (tự chạy khi đăng nhập)
bash scripts/install-service.sh
```

## ⚠️ Bước quan trọng: Mở Antigravity IDE với CDP

Server cần kết nối CDP (Chrome DevTools Protocol) tới IDE. Bạn **phải** mở Antigravity IDE với flag remote debugging:

```bash
/Applications/Antigravity.app/Contents/MacOS/Electron --remote-debugging-port=9223
```

> **Lưu ý**: Port mặc định trong config là `9223`. Nếu bạn dùng port khác, sửa trong `data/config.json` → `devices[0].cdpPort`.

## Cấu hình CDP Port

Mặc định, server quét port `9223` cho Antigravity IDE. Nếu cần đổi:

```bash
# Sửa file config
nano data/config.json
```

Tìm và sửa:
```json
"devices": [
  {
    "name": "Default",
    "cdpPort": 9223,
    "active": true
  }
]
```

## Quản lý Service

```bash
# Xem trạng thái
curl http://localhost:3333/api/health

# Xem logs
tail -f logs/server.log
tail -f logs/server.error.log

# Restart
launchctl unload ~/Library/LaunchAgents/com.antigravity.mobile-bridge.plist
launchctl load   ~/Library/LaunchAgents/com.antigravity.mobile-bridge.plist

# Gỡ cài đặt
bash scripts/uninstall-service.sh
```

## Truy cập từ điện thoại

1. Đảm bảo điện thoại và máy Mac cùng mạng WiFi
2. Tìm IP LAN của Mac: `ifconfig | grep "inet " | grep -v 127.0.0.1`
3. Truy cập: `http://<IP_LAN>:3333`

## Bảo mật (tùy chọn)

Đặt PIN qua biến môi trường:

```bash
MOBILE_PIN=1234 npm run dev
```

Hoặc qua Admin panel: `http://localhost:3333/admin`

## Khắc phục sự cố

| Vấn đề | Giải pháp |
|--------|-----------|
| `No Active Chat` | Mở Cascade panel trong IDE |
| `NO WINDOW` | IDE chưa mở với `--remote-debugging-port=9223` |
| CDP kết nối nhầm Chrome | Đổi `cdpPort` sang `9223` (port `9222` thường dùng bởi Chrome) |
| Service không start | Kiểm tra `cat logs/server.error.log` |
| `Operation not permitted` | macOS chặn bash — install script đã xử lý bằng cách gọi node trực tiếp |
