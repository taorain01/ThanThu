# OpenClaw Gallery Studio

Ứng dụng Electron cục bộ để duyệt album ảnh OpenClaw, chuyển/đổi số bundle an toàn, chỉnh `SKILL.md` và gửi lệnh vào đúng queue của Bot OpenClaw.

## Chạy ứng dụng

```powershell
npm.cmd install
npm.cmd run reviewer:build
npm.cmd run reviewer:start
```

Chạy giao diện phát triển có hot reload:

```powershell
npm.cmd run reviewer:dev
```

Đóng gói bộ cài Windows:

```powershell
npm.cmd run reviewer:dist
```

## Dữ liệu cục bộ

- Album mặc định: `F:\Hình Ảnh\anhYoutube`.
- Skill mặc định: `C:\Users\<user>\.openclaw\workspace\skills`.
- Settings, backup skill và operation journal nằm trong Electron `userData/reviewer`.
- Bot tạo bearer token bridge trong `Bot OpenClaw/data/reviewer-token.txt`; token không đi vào renderer hoặc log giao diện.

Bot OpenClaw cần chạy để dùng Command Deck. Gallery, Skill Editor và các thao tác file vẫn dùng được khi bot offline.

## Kiểm tra

```powershell
npm.cmd run reviewer:test
npx.cmd tsc -p reviewer\tsconfig.json --noEmit
npm.cmd run reviewer:build
npm.cmd run reviewer:start -- --smoke
```
