---
description: Sau khi sửa code bot Discord (ThanThu), push lên GitHub
---

# Push Bot Discord Lên GitHub

Sau khi hoàn thành sửa code bot Discord ThanThu, **luôn push lên GitHub** để deploy.

## Lưu ý quan trọng

- Máy này dùng **GitHub Desktop**, không cài git vào PATH.
- Git exe nằm bên trong thư mục GitHub Desktop, path thay đổi theo version.
- Dùng lệnh sau để tìm git.exe (chỉ cần 1 lần, sau đó dùng lại biến `$gitExe`):

```powershell
$gitExe = (Get-ChildItem "C:\Users\PC\AppData\Local\GitHubDesktop" -Recurse -Filter "git.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
```

## Các bước

// turbo-all

1. Gán đường dẫn git.exe vào biến:
```powershell
$gitExe = (Get-ChildItem "C:\Users\PC\AppData\Local\GitHubDesktop" -Recurse -Filter "git.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
```

2. Kiểm tra thay đổi:
```powershell
& $gitExe status
```

3. Add tất cả file đã thay đổi:
```powershell
& $gitExe add -A
```

4. Commit với message mô tả ngắn gọn thay đổi:
```powershell
& $gitExe commit -m "<mô tả thay đổi>"
```

5. Push lên GitHub:
```powershell
& $gitExe push
```
