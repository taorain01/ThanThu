# Spec: Bot Piper TTS Discord

| | |
|---|---|
| **Ngày** | 2026-08-02 |
| **Trạng thái** | Draft |
| **Engine** | Piper TTS (local, free, CPU) |
| **Chế độ** | Đọc live trong voice channel |
| **Tích hợp** | Bot Discord riêng biệt |

---

## 1. Tổng quan

Bot Discord riêng, dùng **Piper TTS** chạy local để đọc text tiếng Việt thành giọng nói, phát trực tiếp trong voice channel. Không cần internet, không cần GPU, không giới hạn ký tự.

## 2. Kiến trúc

```
Discord Text Chat
  ├── ?join           → Bot vào voice channel
  ├── .nội dung       → Piper TTS → WAV → FFmpeg → Opus → Voice Channel
  ├── ?stop           → Dừng đọc
  └── ?leave          → Bot rời voice
```

### 2.1 Pipeline audio

```
Text (.nội dung)
  → sanitize (bỏ emoji, markdown, mention, URL)
  → tách câu
  → từng câu:
       echo text | piper.exe --model vi.onnx --output-raw -   (PCM 22050Hz mono)
       → ffmpeg -f s16le -ar 22050 -ac 1 -i pipe:0 -f opus -b:a 64k pipe:1
       → createAudioResource(stream, { inputType: 'opus' })
       → AudioPlayer → VoiceConnection
  → queue tuần tự (câu sau chờ câu trước xong)
```

## 3. Piper TTS

| Thành phần | Giá trị |
|---|---|
| **Binary** | `piper.exe` (Windows) / `piper` (Linux/macOS) |
| **Model tiếng Việt** | `vi_VN-vivos-low.onnx` + `vi_VN-vivos-low.onnx.json` |
| **Sample rate** | 22050 Hz |
| **Channels** | 1 (mono) |
| **Output** | raw 16-bit signed little-endian PCM (stdout) |

**Command:**
```bash
echo "xin chào" | piper --model vi_VN-vivos-low.onnx --output-raw -
```

**Model tiếng Việt khác (optional):**
- `vi_VN-vivos-medium` — chất lượng tốt hơn, nặng hơn

## 4. Cấu trúc thư mục

```
C:\Bot Discord\Bot Piper TTS\
├── package.json
├── .env
├── .env.example
├── src/
│   ├── index.js           # Entry point, Discord client
│   ├── config.js           # Load .env, validate
│   ├── tts/
│   │   ├── piper.js        # Piper process manager (spawn, pipe text, stream PCM)
│   │   ├── pipeline.js     # Piper → FFmpeg → Opus stream
│   │   ├── sanitizer.js    # Text sanitize + tách câu
│   │   └── queue.js        # Hàng đợi câu, xử lý tuần tự
│   ├── voice/
│   │   ├── manager.js      # Join/leave voice, AudioPlayer lifecycle
│   │   └── connection.js   # VoiceConnection events (disconnect, error, rejoin)
│   └── commands/
│       ├── join.js         # ?join [channel]
│       ├── leave.js        # ?leave
│       ├── stop.js         # ?stop
│       └── help.js         # ?ttshelp
├── models/
│   ├── vi_VN-vivos-low.onnx
│   └── vi_VN-vivos-low.onnx.json
└── scripts/
    └── download-model.ps1  # Tải Piper + model tiếng Việt
```

## 5. Dependencies

```json
{
  "dependencies": {
    "discord.js": "^14.25.1",
    "@discordjs/voice": "^0.19.2",
    "@discordjs/opus": "^0.10.0",
    "ffmpeg-static": "^5.3.0",
    "prism-media": "^1.3.5",
    "sodium-native": "^5.1.0",
    "dotenv": "^17.3.1"
  }
}
```

- **Piper binary**: tải riêng từ GitHub releases (không qua npm)
- **Model**: tải từ Piper voice model registry

## 6. Lệnh Discord

| Lệnh | Mô tả |
|---|---|
| `?join` | Join voice channel người dùng đang ở |
| `?join <#channel>` | Join voice channel cụ thể |
| `?leave` | Rời voice channel |
| `?stop` | Dừng đọc, xóa hàng đợi |
| `?ttshelp` | Hiển thị hướng dẫn |
| `.nội dung` | Đọc text trong voice (prefix `.`) |

## 7. Text Sanitizer

Trước khi gửi vào Piper:

| Bước | Chi tiết |
|---|---|
| Bỏ markdown | `**bold**`, `*italic*`, `~~strike~~`, `__underline__`, `` `code` ``, ```` ```code``` ```` |
| Bỏ emoji | Unicode emoji + Discord custom emoji `<:name:id>` |
| Bỏ mention | `<@id>`, `<#id>`, `<@&id>` |
| Bỏ URL | `http://`, `https://`, `www.` |
| Giữ lại | Chữ tiếng Việt có dấu, số, dấu câu (`.!?,;:`), khoảng trắng, xuống dòng |
| Giới hạn | 200 ký tự/lần đọc (cắt + `...`) |
| Tách câu | Theo `. ! ? , ;` → mỗi câu một queue item |

## 8. Voice Lifecycle

```
?join
  → check quyền Connect + Speak
  → joinVoiceChannel({ selfDeaf: false, selfMute: false })
  → entersState(Ready, 30s)
  → tạo AudioPlayer, subscribe vào connection
  → reply "🎤 Đã vào <channel>"

.đọc
  → check connection sống + user cùng voice channel
  → sanitize + queue
  → process queue tuần tự

Disconnect (kick/mất mạng)
  → destroy connection
  → xóa queue
  → KHÔNG tự rejoin

?leave
  → player.stop()
  → connection.destroy()
  → reply "👋 Đã rời"
```

## 9. Xử lý lỗi & Edge Cases

| Trường hợp | Xử lý |
|---|---|
| Piper crash | Retry 1 lần, skip câu nếu vẫn lỗi |
| FFmpeg không có | Log lỗi rõ ràng, báo admin qua text channel |
| Model thiếu | Báo lỗi lúc startup, chạy lệnh `?ttshelp` để xem trạng thái |
| Voice connection mất | Xóa queue, thông báo text channel |
| Text > 200 ký tự | Cắt + `...` |
| Text rỗng sau sanitize | Bỏ qua im lặng |
| User không cùng voice | Reply "Bạn phải ở cùng voice channel với bot" |
| Bot chưa join | Reply "Bot chưa ở voice, gõ `?join` trước" |
| Rate limit Discord | Queue tự nhiên, không spam |
| Piper đang bận (1 instance) | Queue chờ, không spawn song song |

## 10. .env

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
PREFIX=?
PIPER_EXECUTABLE=C:\piper\piper.exe
PIPER_MODEL_DIR=C:\Bot Discord\Bot Piper TTS\models\
PIPER_DEFAULT_VOICE=vi_VN-vivos-low
TTS_MAX_TEXT_LENGTH=200
TTS_SPEED=1.0
```

## 11. Setup Script `download-model.ps1`

1. Tải Piper binary từ GitHub releases (nếu chưa có) → giải nén vào `C:\piper\`
2. Tải model `vi_VN-vivos-low.onnx` + `.json` vào `models/`
3. Test:
   ```powershell
   echo "xin chào" | & "C:\piper\piper.exe" --model "models\vi_VN-vivos-low.onnx" --output-raw -
   ```

## 12. So sánh với TTS hiện tại (Google TTS)

| Yếu tố | Google TTS (hiện tại) | Piper TTS (mới) |
|---|---|---|
| Engine | Cloud, rate limit | Local, không giới hạn |
| Chi phí | Free (rate limit) | Free, offline |
| Giọng Việt | Tự nhiên | Hơi robot nhưng ổn |
| Internet | Cần | Không cần |
| Độ trễ | 1-3s (network) | 0.5-2s (local) |
| Multi-voice | 1 giọng | Nhiều model, đổi dễ |

## 13. Implementation Plan

### Phase 1: Core
1. Project structure + package.json + .env.example
2. `config.js`
3. `tts/piper.js` — spawn + stream
4. `tts/pipeline.js` — piper → ffmpeg → opus
5. `tts/sanitizer.js`
6. `tts/queue.js`

### Phase 2: Voice
7. `voice/manager.js`
8. `voice/connection.js`

### Phase 3: Commands
9. `commands/join.js`, `leave.js`, `stop.js`, `help.js`
10. Auto-read (`.` prefix) handler

### Phase 4: Polish
11. `index.js` — wire everything
12. `download-model.ps1`
13. Tests (sanitizer, queue, pipeline mock)
14. README
