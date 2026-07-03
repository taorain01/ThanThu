# Project Rules for Codex

## Encoding and Vietnamese text

- Always read and write every text file in this repository as UTF-8.
- Preserve Vietnamese accents exactly. Do not save files as Windows-1258, ANSI, OEM, or any legacy Windows code page.
- When using PowerShell to write files, explicitly use UTF-8, for example `Set-Content -Encoding utf8` or `Out-File -Encoding utf8`.
- Prefer `apply_patch` for manual edits so file contents are written as UTF-8 and existing unrelated content is preserved.
- Before changing files that contain Vietnamese text, inspect the existing content first and keep the same meaning, spelling, and accents.
- If Vietnamese text appears corrupted, stop and fix the encoding issue instead of rewriting the text from the corrupted version.

## File editing safety

- Do not rewrite whole files unless the requested change requires it.
- Keep changes scoped to the user's request.
- Do not revert user changes unless the user explicitly asks for that.

## Ngôn ngữ giao tiếp

- Luôn giao tiếp, trả lời, giải thích và làm việc với người dùng bằng tiếng Việt.
- Mọi phản hồi trong chat, mô tả thay đổi, tóm tắt công việc và thông báo lỗi đều dùng tiếng Việt.
- Khi viết tài liệu (spec, requirements, design, tasks, README...) ưu tiên dùng tiếng Việt, trừ khi người dùng yêu cầu ngôn ngữ khác.
- Giữ nguyên tên biến, tên hàm, từ khóa kỹ thuật và cú pháp lập trình bằng tiếng Anh theo chuẩn thông thường.

## Luật cứng: Fix xong là push GitHub

- BẮT BUỘC: Mỗi khi sửa/fix code (bất kỳ thay đổi nào tới file trong repo), sau khi hoàn thành và kiểm tra xong thì PHẢI push lên GitHub ngay, không cần hỏi lại.
- Làm theo đúng quy trình trong `.agents/workflows/push-github.md`:
  1. Tìm `git.exe` của GitHub Desktop và gán vào biến `$gitExe`.
  2. `& $gitExe status` để xem thay đổi.
  3. `& $gitExe add -A`.
  4. `& $gitExe commit -m "<mô tả ngắn gọn thay đổi bằng tiếng Việt>"`.
  5. `& $gitExe push`.
- Máy này dùng GitHub Desktop, git không nằm trong PATH, nên luôn dùng biến `$gitExe`.
- Commit message viết bằng tiếng Việt, mô tả ngắn gọn nội dung fix.
- Chỉ bỏ qua bước push khi người dùng nói rõ "đừng push" hoặc "không push".
- Trước khi commit, cảnh báo nếu có file nhạy cảm (ví dụ `.env`) sắp bị đưa lên, trừ khi repo đã cố tình theo dõi các file đó.
