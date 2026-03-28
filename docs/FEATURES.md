# Antigravity Mobile — Feature Guide

> **Cập nhật:** 2026-03-28

---

## 🔒 HTTPS qua Tailscale

### URL truy cập

| Giao thức | URL | Port |
|-----------|-----|------|
| HTTP (local) | `http://localhost:3333` | 3333 |
| HTTPS (Tailscale) | `https://macmini.tail445515.ts.net:3334` | 3334 |

### Ưu điểm HTTPS
- **Clipboard API** hoạt động đầy đủ trên iOS Safari
- Kết nối an toàn qua Tailscale VPN
- WebSocket cũng chạy trên wss:// (ổn định hơn)

### Gia hạn cert (Tailscale cert có hạn 90 ngày)

```bash
# Chạy khi cert sắp hết hạn
tailscale cert \
  --cert-file certs/macmini.crt \
  --key-file  certs/macmini.key \
  macmini.tail445515.ts.net

# Restart service
launchctl stop com.antigravity.mobile-bridge
launchctl start com.antigravity.mobile-bridge
```

---

## 📋 Nút Paste (Dán từ clipboard)

Nút **📋** nằm trong input area, giữa nút `+` (batch) và textarea.

### Hành vi theo nền tảng

| Nền tảng | Hành vi |
|----------|---------|
| Desktop Chrome/Firefox | ✅ Paste thẳng vào ô chat (1 click) |
| iOS Safari qua HTTPS | ✅ iOS hiện popup xác nhận "Paste" → tap để cho phép (2 tap, bắt buộc của iOS) |
| iOS Safari qua HTTP | ⚠️ Focus vào textarea + toast hướng dẫn dùng long-press |

> **Lưu ý iOS:** Popup "Paste" là **yêu cầu bắt buộc của Apple** (iOS 16+), không thể bypass ngay cả với HTTPS. Đây không phải lỗi — đây là security feature.

---

## ⌨️ Phím tắt gửi tin nhắn

| Phím | Hành vi |
|------|---------|
| `Enter` | Xuống dòng (newline) |
| `Ctrl+Enter` *(Windows/Linux)* | Gửi tin nhắn |
| `Cmd+Enter` *(Mac)* | Gửi tin nhắn |

---

## 🔧 API Test Endpoints

Dùng để verify tính năng bằng `curl` mà không cần browser:

```bash
BASE=https://macmini.tail445515.ts.net:3334

# Danh sách endpoints
curl $BASE/api/test

# Test tất cả cùng lúc
curl $BASE/api/test/all

# Test file resolution theo tên
curl "$BASE/api/test/quick-find?name=ChatPanel.tsx"

# Test workspace
curl $BASE/api/test/workspace

# Test chat snapshot (cần IDE mở)
curl $BASE/api/test/chat-snapshot

# Test inject input validation (không gửi tới IDE)
curl -X POST $BASE/api/test/inject-dry-run \
     -H "Content-Type: application/json" \
     -d '{"text":"hello test"}'
```

---

## 🪟 Mở file trong tab mới

Khi AI chat trả về file reference (ví dụ: `src/components/Button.tsx`):
- Bấm vào **tên file** hoặc nút **Open** → mở file trong tab mới của trình duyệt
- Với code file: đồng thời gửi lệnh mở trong IDE (nếu IDE đang kết nối)

---

## 🔄 Quản lý service

```bash
# Khởi động
launchctl start com.antigravity.mobile-bridge

# Dừng
launchctl stop com.antigravity.mobile-bridge

# Restart
launchctl stop com.antigravity.mobile-bridge && sleep 2 && launchctl start com.antigravity.mobile-bridge

# Kiểm tra health
curl http://localhost:3333/api/health
curl https://macmini.tail445515.ts.net:3334/api/health

# Xem log
tail -f ~/Library/Logs/com.antigravity.mobile-bridge.log
```
