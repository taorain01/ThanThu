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
