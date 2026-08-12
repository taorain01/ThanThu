# 🚀 Hướng Dẫn Sử Dụng 9Remote

## 📋 Tổng Quan

**9Remote** là công cụ truy cập từ xa mạnh mẽ giúp bạn điều khiển máy tính từ bất kỳ thiết bị nào có trình duyệt. Không cần cấu hình phức tạp, không cần port forwarding, không cần VPN.

**✨ Tính Năng Chính:**
- 🖥️ Remote Terminal - Truy cập terminal đầy đủ với nhiều session
- 🖱️ Remote Desktop - Điều khiển desktop với chuột và bàn phím
- 📁 File Explorer - Duyệt, chỉnh sửa file và quản lý Git
- 🔒 Bảo Mật Mặc Định - Kết nối mã hóa qua Cloudflare tunnel
- ⚡ Không Cấu Hình - Chỉ một lệnh là khởi động
- 🌍 Hoạt Động Mọi Nơi - Browser, mobile, desktop đều hỗ trợ

---

## ⚙️ Cài Đặt

### Bước 1: Cài đặt 9remote (ĐÃ HOÀN THÀNH ✅)

```bash
npm install -g 9remote
```

**Phiên bản đã cài:** v2.2.6

---

## 🚀 Khởi Động & Lấy Key

### Bước 2: Chạy 9remote

Mở PowerShell hoặc Command Prompt và chạy:

```bash
9remote
```

Hoặc nếu gặp lỗi execution policy trong PowerShell:

```bash
cmd /c "9remote"
```

### Bước 3: Menu TUI sẽ hiện ra

```
╔══════════════════════════════════════════╗
║                                          ║
║            🚀  9Remote v2.2.6            ║
║   Remote terminal access from anywhere   ║
║                                          ║
╚══════════════════════════════════════════╝
 > Open Web UI (background)
    Terminal UI
    Exit
```

**Chọn "Terminal UI"** để vào chế độ terminal và xem QR code.

---

## 📱 Kết Nối Từ Mobile

### Cách 1: Quét QR Code (Khuyên Dùng)

1. **Trên máy tính:** Chạy `9remote` và chọn "Terminal UI"
2. **QR Code sẽ hiện ra** trong terminal
3. **Trên điện thoại:** 
   - Mở trình duyệt và truy cập **https://9remote.cc**
   - HOẶC tải app 9Remote từ:
     - **iOS:** App Store → tìm "9Remote"
     - **Android:** Google Play → tìm "9Remote"
4. **Quét QR code** từ màn hình máy tính
5. **Chấp nhận kết nối** - thiết bị sẽ được ghép nối (pair)
6. **Xong!** Bạn đã có thể truy cập terminal, desktop và file từ điện thoại

### Cách 2: Nhập Key Thủ Công

Nếu không thể quét QR:

1. Trong menu TUI, chọn **"Key"** để xem key
2. Có 2 loại key:
   - **One-Time Key (30 phút):** Dùng cho QR code, hết hạn sau 30 phút
   - **Permanent Key:** Key cố định gắn với máy tính, dùng cho thiết bị đã pair

3. Nhập key vào app/web 9remote trên điện thoại

---

## 🔑 Quản Lý Key & Thiết Bị

### Xem Key Hiện Tại

Trong menu TUI:
- Chọn **"Key"** → **"Show Current Keys"**
- Key sẽ hiển thị dạng:
  - Machine ID: `abc123...`
  - One-Time Key: `xyz789...` (hết hạn sau 30 phút)
  - Permanent Key: `perm456...` (vĩnh viễn)

### Tạo Lại One-Time Key

- Trong menu TUI: **"Key"** → **"Regenerate One-Time Key"**
- QR code mới sẽ được tạo

### Quản Lý Thiết Bị Đã Pair

- **Xem danh sách:** Menu → "Devices" → "List Paired Devices"
- **Chấp nhận thiết bị chờ:** "Approve Pending Device"
- **Xóa thiết bị:** "Remove Device"
- **An toàn:** Chỉ thiết bị bạn chấp nhận mới truy cập được

---

## 🖥️ Sử Dụng Các Tính Năng

### 1. Remote Terminal
- Truy cập terminal đầy đủ từ điện thoại
- Chạy lệnh, xem log, deploy code
- Session không mất khi mất kết nối tạm thời

### 2. Remote Desktop (cần cấu hình thêm trên macOS)

**Trên macOS:**
- Vào **System Settings** → **Privacy & Security**
- Bật quyền:
  - **Screen Recording** → Thêm Terminal/9Remote
  - **Accessibility** → Thêm Terminal/9Remote
- Trong menu TUI: **"Remote Desktop"** → **"Toggle ON"**

**Trên Windows:**
- Remote Desktop hoạt động ngay sau khi bật trong menu

### 3. File Explorer
- Duyệt file trên máy tính từ điện thoại
- Upload/download file
- Chỉnh sửa file trực tiếp với code editor tích hợp

### 4. Local Sites Proxy
- Truy cập localhost từ điện thoại!
- Ví dụ: `localhost:3000` → `https://<tunnel>/proxy/3000/`
- Hoàn hảo để test responsive design trên thiết bị thật

### 5. Git Integration
- Chạy lệnh git với giao diện trực quan
- Commit/push code từ điện thoại
- Xem status, diff, log

---

## 💡 Use Cases Thực Tế

### 1. Code Từ Giường
**Tình huống:** 11 giờ đêm, bạn nhớ ra một bug nhưng laptop ở phòng khác

**Giải pháp:**
1. Mở app 9remote trên điện thoại
2. Quét QR (hoặc dùng session đã lưu)
3. Mở terminal → fix bug → git push
4. Ngủ ngon 😴

### 2. Fix Bug Ở Quán Cafe
**Tình huống:** Production bị down. Bạn chỉ có điện thoại và WiFi quán yếu

**Giải pháp:**
1. Kết nối tới máy nhà/văn phòng qua 9remote
2. Xem log trong terminal
3. Sửa config trong code editor
4. Deploy → giải quyết khủng hoảng

### 3. Deploy Khi Đi Du Lịch
**Tình huống:** Khách hàng cần hotfix. Bạn đang ở bãi biển

**Giải pháp:**
1. Điện thoại → 9remote → máy dev
2. git pull → build → deploy
3. Quay lại bãi biển trong 5 phút 🏖️

---

## 🔧 Lệnh CLI

```bash
# Chế độ TUI (interactive menu với QR code)
9remote

# Chế độ Web UI (mở dashboard tại localhost:2208)
9remote ui
```

---

## 🔒 Bảo Mật

✅ **Pair Device System:** Mỗi thiết bị mới phải được bạn chấp nhận trước khi truy cập

✅ **Không Mở Port:** Dùng Cloudflare tunnel (chỉ kết nối outbound)

✅ **Key Không Lưu Trên Server:** Key chỉ tồn tại trong session, không được lưu trữ

✅ **One-Time Key Hết Hạn:** QR key hết hạn sau 30 phút

✅ **Quản Lý Thiết Bị:** Xem/xóa thiết bị đã pair bất kỳ lúc nào

---

## ❓ Xử Lý Sự Cố

### "Port 2208 already in use"
- Có instance 9Remote khác đang chạy
- **Giải pháp:** Tắt process cũ hoặc dùng port khác:
  ```bash
  PORT=3308 9remote
  ```

### "Cloudflare tunnel failed to start"
- Kiểm tra kết nối internet
- `cloudflared` tự động cài ở lần chạy đầu
- Nếu lỗi, cài thủ công: [Cloudflared Docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/)

### "QR code expired"
- One-time key hết hạn sau 30 phút
- **Giải pháp:** Menu TUI → "Key" → "Regenerate"

### "Can't connect from phone"
- Kiểm tra cả 2 thiết bị có internet
- Thử bắt buộc dùng tunnel mode: Settings → Connection → Tunnel only

### "Remote desktop laggy"
- Giảm resolution trong settings
- Chuyển sang terminal-only nếu không cần desktop
- Dùng LAN mode nếu cùng WiFi (độ trễ thấp nhất)

---

## 🌐 Links & Tài Nguyên

- **Website:** https://9remote.cc
- **Tài Liệu:** https://docs.9remote.cc
- **NPM Package:** https://npmjs.com/package/9remote
- **GitHub:** https://github.com/decolua/9remote
- **Facebook Community:** https://facebook.com/groups/9teamvn

---

## 📊 So Sánh 9Remote vs Các Giải Pháp Khác

| Tính Năng | 9Remote | TeamViewer | Chrome Remote | Termius |
|-----------|---------|------------|---------------|---------|
| Zero Config | ✅ | ✅ | ✅ | ❌ |
| Terminal Access | ✅ | ❌ | ❌ | ✅ |
| Remote Desktop | ✅ | ✅ | ✅ | ❌ |
| File Explorer | ✅ | ✅ | ❌ | ✅ |
| Code Editor | ✅ | ❌ | ❌ | ❌ |
| Mobile Optimized | ✅ | ❌ | ❌ | ✅ |
| Browser-Based | ✅ | ❌ | ✅ | ❌ |
| QR Login | ✅ | ❌ | ❌ | ❌ |
| No Port Forwarding | ✅ | ✅ | ✅ | ❌ |
| No Account Required | ✅ | ❌ | ❌ | ❌ |

**🏆 9Remote: Giải pháp all-in-one với đầy đủ tính năng!**

---

## 🎯 Lưu Ý Quan Trọng

1. **9remote đang trong giai đoạn phát triển** - miễn phí sử dụng, chưa open-source
2. **Nếu dự án đạt đủ ⭐ GitHub stars** → sẽ open-source hoàn toàn (MIT license)
3. **Không thu thập dữ liệu:** Terminal output, files, screen data KHÔNG bao giờ được thu thập
4. **Hoạt động offline/LAN:** Nếu cùng WiFi, traffic sẽ ở local (không qua internet)
5. **Tương thích AI tools:** Hoạt động tốt với Claude Code, Codex, Cursor, OpenClaw

---

## 🚀 Bắt Đầu Ngay

1. **Đã cài xong ✅:** `npm install -g 9remote`
2. **Chạy:** `9remote`
3. **Chọn "Terminal UI"** để xem QR code
4. **Quét QR bằng điện thoại** tại https://9remote.cc
5. **Enjoy coding from anywhere!** 🎉

---

**Built with ❤️ for developers who code from anywhere — bed, beach, or bus.**
