---
description: Gửi file HTML (hoặc bất kỳ file nào) lên Discord qua Webhook để xem nhanh trên điện thoại
---

# Workflow: Gửi file lên Discord (GuiDiscord)

## Thông tin
- **Webhook URL**: `https://discord.com/api/webhooks/1483188114213306439/gRQCcD-DbpB0Li4ZpBjq5WvQ6mT-mV3rqIS3kOcXK-AO3Zb3xtM9fp7QZykofHRjR7CD`
- **Giới hạn file**: 25MB
- **Script path**: `App/Script/send_to_discord.py` (hoặc tạo mới từ code bên dưới)

## Các bước thực hiện

### 1. Đảm bảo script tồn tại
Nếu chưa có file `send_to_discord.py`, tạo file mới tại `App/Script/send_to_discord.py` với nội dung sau:

```python
"""
Script gửi file/tin nhắn lên Discord qua Webhook.
Dùng urllib (built-in), có SSL bypass cho mạng bị chặn.

Cách dùng:
    Gửi file:  python send_to_discord.py <file> [tin_nhắn]
    Gửi text:  python send_to_discord.py --text "nội dung"
"""

import sys
import os
import json
import uuid
import ssl
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

# --- CẤU HÌNH ---
WEBHOOK_URL = "https://discord.com/api/webhooks/1483188914381652043/BhtIiKz2XEFrgVCnnM_tO5SnJ9r3pv-IlT4746Y7POT3Mgb_aApX3Wxin-QnRNSmvJ2g"
TIMEOUT = 30

# SSL bypass cho mạng có proxy/firewall
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE


def _tao_multipart(fields, files):
    """Tạo multipart/form-data body."""
    boundary = uuid.uuid4().hex
    body = b""
    for key, value in fields.items():
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode()
        body += f"{value}\r\n".encode()
    for key, (filename, filedata) in files.items():
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{key}"; filename="{filename}"\r\n'.encode()
        body += b"Content-Type: application/octet-stream\r\n\r\n"
        body += filedata
        body += b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def gui_tin_nhan(noi_dung):
    """Gửi tin nhắn text lên Discord."""
    data = json.dumps({"content": noi_dung}).encode("utf-8")
    req = Request(WEBHOOK_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        urlopen(req, timeout=TIMEOUT, context=SSL_CTX)
        print("✅ Đã gửi tin nhắn thành công!")
        return True
    except HTTPError as e:
        print(f"❌ Lỗi HTTP {e.code}: {e.read().decode()}")
    except URLError as e:
        print(f"❌ Lỗi kết nối: {e.reason}")
    return False


def gui_file(file_path, noi_dung=""):
    """Gửi file lên Discord qua webhook."""
    if not os.path.exists(file_path):
        print(f"❌ Không tìm thấy file: {file_path}")
        return False
    file_size = os.path.getsize(file_path)
    if file_size > 25 * 1024 * 1024:
        print(f"❌ File quá lớn ({file_size / 1024 / 1024:.1f}MB). Giới hạn 25MB.")
        return False

    ten_file = os.path.basename(file_path)
    if not noi_dung:
        noi_dung = f"📎 **{ten_file}** ({file_size / 1024:.1f} KB)"

    try:
        with open(file_path, "rb") as f:
            file_data = f.read()
        body, content_type = _tao_multipart({"content": noi_dung}, {"file": (ten_file, file_data)})
        req = Request(WEBHOOK_URL, data=body, method="POST")
        req.add_header("Content-Type", content_type)
        urlopen(req, timeout=TIMEOUT, context=SSL_CTX)
        print(f"✅ Đã gửi thành công: {ten_file}")
        return True
    except HTTPError as e:
        print(f"❌ Lỗi HTTP {e.code}: {e.read().decode()}")
    except URLError as e:
        print(f"❌ Lỗi kết nối: {e.reason}")
    return False


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Cách dùng:")
        print("  Gửi file:  python send_to_discord.py <file> [tin_nhắn]")
        print("  Gửi text:  python send_to_discord.py --text \"nội dung\"")
        sys.exit(1)

    if sys.argv[1] == "--text":
        gui_tin_nhan(" ".join(sys.argv[2:]))
    else:
        gui_file(sys.argv[1], " ".join(sys.argv[2:]) if len(sys.argv) > 2 else "")
```

### 2. Gửi file HTML (hoặc bất kỳ file nào)
// turbo
```
python "App/Script/send_to_discord.py" "<đường_dẫn_tuyệt_đối_file>"
```

### 3. Gửi file với tin nhắn kèm theo
// turbo
```
python "App/Script/send_to_discord.py" "<đường_dẫn_file>" "📊 Mô tả nội dung file"
```

### 4. Gửi chỉ tin nhắn text (không file)
// turbo
```
python "App/Script/send_to_discord.py" --text "nội dung tin nhắn"
```

## Khi tạo HTML mới cho báo cáo
File HTML gửi qua Discord nên có định dạng **mobile-friendly**:
- Viewport: `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
- Font size tối thiểu 16px, padding/margin hợp lý
- Nên dùng dark mode để dễ đọc trên điện thoại
- User sẽ tải file về và mở trong trình duyệt điện thoại

## Xử lý lỗi kết nối
Nếu POST bị treo/timeout:
1. Kiểm tra firewall/antivirus có chặn outgoing POST
2. Thử tắt proxy/VPN
3. Chạy test từ PowerShell bình thường (ngoài VS Code)