# Spec: Tối ưu tốc độ Bot OpenClaw

| | |
|---|---|
| **Ngày** | 2026-08-08 |
| **Trạng thái** | Draft |
| **Phạm vi** | `Bot OpenClaw` |
| **OpenClaw mục tiêu** | `2026.7.1-2` |
| **Ưu tiên** | Giảm độ trễ của bridge mà không làm mất khả năng recovery |

---

## 1. Bối cảnh

Bot hiện đã có các cơ chế đúng đắn về thứ tự session, durable task, recovery, chống gửi trùng và cập nhật tiến độ. Mục tiêu của đợt này là làm cho phản hồi và trạng thái xuất hiện nhanh hơn, đồng thời giảm tải CPU, ổ đĩa và Gateway khi nhiều job chạy lâu.

Tối ưu phải phân biệt hai loại độ trễ:

1. **Độ trễ do bridge kiểm soát được**: nhận Discord, chuẩn bị request, queue, lưu state, đọc transcript, đồng bộ task và gửi Discord.
2. **Độ trễ bên ngoài bridge**: model suy luận, provider rate limit, tool chạy lâu, điều khiển desktop và tạo media.

Spec chỉ cam kết giảm loại thứ nhất. Thời gian model/tool vẫn được đo để chẩn đoán nhưng không được báo cáo như lỗi hiệu năng của bot.

## 2. Baseline hiện tại

Số liệu được lấy từ dữ liệu cục bộ ngày 2026-08-08. Đây là baseline định hướng; trước khi triển khai phải bổ sung telemetry theo từng chặng để có phép đo chính xác hơn.

| Chỉ số | Kết quả quan sát |
|---|---:|
| Job có trong `data/jobs.json` | 401 |
| Kích thước `data/jobs.json` | 2.278.605 byte |
| Clone toàn bộ state trong bộ nhớ | trung bình khoảng 6,7 ms/lần |
| Serialize pretty JSON toàn bộ state | trung bình khoảng 5,2 ms/lần, chưa tính ghi đĩa |
| Task snapshot qua Admin HTTP RPC | 30 mẫu; p50 3.140 ms, p95 3.917 ms |
| Task snapshot fallback CLI | 3 mẫu; khoảng 11 giây |
| Queue wait, 260 job có log | p50 14 ms; p95 427 giây |
| Time-to-first-delta, 235 job có log | p50 37,5 giây; p95 385 giây |

Nhận định:

- Queue gần như không tạo overhead khi session rảnh; p95 cao chủ yếu do yêu cầu cùng session phải chờ job trước hoàn tất.
- `JobStore` đang clone và ghi lại toàn bộ file sau gần như mọi offset, event, task hoặc artifact. Đây là write amplification lớn nhất trong bridge.
- Mỗi session monitor mở/stat/đọc transcript theo chu kỳ 750 ms. `waitForSessionResponse` cũng polling riêng theo chu kỳ 750 ms.
- Task snapshot đã dùng chung toàn bot nhưng Admin HTTP RPC vẫn mất khoảng 3 giây mỗi lần; fallback CLI mất khoảng 11 giây.
- Status update có thể đọc lại `sessions.json` và quét ngược transcript để lấy context usage trước mỗi lần edit Discord.
- Startup đang chờ dọn media, sửa mojibake, quét model backend, recovery job và quét tin nhắn cũ trước khi nhận tin mới.

## 3. Mục tiêu

### 3.1 SLO của bridge

Các SLO dưới đây áp dụng trên máy hiện tại, khi Discord và Gateway loopback hoạt động bình thường:

| Chỉ số | Mục tiêu |
|---|---:|
| Discord nhận tin chữ → bắt đầu HTTP request tới Gateway, session rảnh | p95 ≤ 250 ms |
| Gateway phát event → bot xử lý event | p95 ≤ 500 ms |
| Task thay đổi → state trong bot được cập nhật | p95 ≤ 500 ms khi WebSocket khỏe |
| Task thay đổi → state trong bot được cập nhật khi fallback | p95 ≤ 3 giây |
| First delta → lần cập nhật status đầu tiên được xếp gửi | ≤ 150 ms |
| First delta → Discord nhận status/preview đầu tiên | p95 ≤ 1,2 giây, không tính Discord rate limit |
| Event thường làm block handler vì persistence | p95 ≤ 20 ms |
| Bot Discord online → cho phép xử lý tin nhắn mới | ≤ 3 giây sau sự kiện `ready` |

### 3.2 Mục tiêu tính đúng

- Giữ nguyên thứ tự tuần tự trong cùng session.
- Không tự tăng concurrency cho job dùng chung desktop, chuột, bàn phím hoặc browser profile.
- Không gửi trùng response, artifact hoặc ảnh xem trước sau reconnect/restart.
- Không đánh dấu job terminal khi task state chưa được xác minh.
- Không làm yếu kiểm tra loopback, token, media allowlist hoặc quyền Discord.
- Khi đường nhanh lỗi, bot tự quay về cơ chế polling/recovery hiện tại.

## 4. Ngoài phạm vi

- Không tối ưu tốc độ suy luận của model hoặc thời gian chạy tool bên trong OpenClaw.
- Không thay model mặc định chỉ để benchmark đẹp hơn.
- Không bỏ durable task, transcript recovery hoặc delivery ledger.
- Không chuyển toàn bộ bot sang database ngoài ở giai đoạn này.
- Không tăng `OPENCLAW_MAX_CONCURRENT_SESSIONS` tự động.

## 5. Kiến trúc đích

```text
Discord message
  → validate + tạo job trong bộ nhớ
  → queue theo session
  → chuẩn bị attachment song song khi an toàn
  → OpenClaw Chat Completions stream
       ├── delta → preview/status coalescer → Discord
       └── Gateway WebSocket events
            ├── agent / session.tool → activity + response nhanh
            └── task → durable-task state nhanh

Persistence
  → per-job state + write-behind 250 ms
  → critical transition flush ngay
  → atomic rename

Fallback
  → Admin HTTP RPC reconcile
  → JSONL transcript tail/recovery
  → CLI task query có backoff
```

Nguyên tắc chính: **event-driven là đường chạy thường; polling chỉ dùng để reconcile và recovery**.

## 6. Yêu cầu chức năng

### 6.1 P0 — Telemetry theo từng chặng

Thêm telemetry dùng `performance.now()` cho duration và `Date.now()` cho mốc lưu bền vững.

Mỗi job cần ghi tối thiểu các mốc:

- `discordReceivedAt`
- `jobCreatedAt`
- `queueStartedAt`
- `attachmentsReadyAt`
- `gatewayRequestStartedAt`
- `gatewayHeadersAt`
- `firstDeltaAt`
- `firstGatewayEventAt`
- `responseSendStartedAt`
- `responseSentAt`
- `terminalAt`

Log hoàn tất phải tách riêng:

- `bridgeSubmitMs`: Discord nhận → bắt đầu request Gateway.
- `queueWaitMs`: tạo job → queue bắt đầu.
- `attachmentPrepareMs`.
- `gatewayFirstByteMs`.
- `firstDeltaMs`.
- `firstEventDispatchMs`.
- `discordDeliveryMs`: bắt đầu gửi → Discord xác nhận.
- `endToEndMs`.

Yêu cầu thêm:

- Không log prompt, token, API key, file content hoặc transcript thô.
- Có script `scripts/perf-report.js` đọc log và xuất count/p50/p95/max theo ngày, model và loại request.
- Mọi benchmark sau tối ưu phải so cùng loại request và cùng model.

### 6.2 P0 — Giảm write amplification của `JobStore`

Chuyển từ một file chứa toàn bộ job sang schema v2:

```text
data/
├── jobs-index.json
└── jobs/
    ├── <job-id>.json
    └── ...
```

`jobs-index.json` chỉ giữ metadata cần cho `listJobs`, `latestJob`, recovery startup và lệnh `. openclaw jobs`. Chi tiết event, session, task, artifact và delivery ledger nằm trong file riêng của từng job.

Quy tắc ghi:

- Mutation cập nhật state trong bộ nhớ ngay.
- Offset, activity, task progress và preview được gộp theo job trong cửa sổ mặc định 250 ms.
- Chỉ có tối đa một write đang chạy cho mỗi job.
- Ghi file tạm UTF-8 rồi atomic rename như hiện tại.
- Các transition quan trọng phải flush ngay: tạo job, `stopping`, `responseSent`, artifact `delivered`, mọi trạng thái terminal và shutdown.
- Shutdown chờ toàn bộ write chain hoàn tất trước khi đóng process.
- Nếu crash trong cửa sổ write-behind, transcript/task reconciliation phải khôi phục được event chưa flush mà không gửi trùng.

Migration:

1. Đọc schema v1 hiện tại.
2. Tạo toàn bộ file v2 vào thư mục tạm.
3. Validate lại số job và các trường recovery quan trọng.
4. Atomic rename sang vị trí chính thức.
5. Giữ `jobs.json.v1.bak` cho tới khi bot khởi động thành công ít nhất một lần với v2.
6. Không tự xóa backup trong cùng bản phát hành.

### 6.3 P0 — Gateway WebSocket event client

Dùng `GatewayClient` từ public export `openclaw/plugin-sdk/gateway-runtime` của bản OpenClaw đang cài. Không tự viết lại protocol/device auth nếu client chính thức có thể dùng được.

Client chạy persistent trên loopback và:

- Kết nối role `operator` với scope tối thiểu cần thiết.
- Nhận event `task`, `agent`, `session.tool`.
- Lấy snapshot `tasks.list` một lần sau connect/reconnect.
- Áp dụng `task.action = upserted|deleted`; nếu nhận `restored`, seq gap hoặc payload không hợp lệ thì refetch.
- Theo dõi `seq`; khi `onGap` xảy ra phải đánh dấu degraded và reconcile ngay.
- Reconnect dùng backoff của client chính thức.
- Feature-detect `hello-ok.features.events` và `features.methods`; không giả định mọi bản OpenClaw đều có cùng surface.

Đường task mới:

```text
Gateway task event
  → normalize task summary
  → cập nhật snapshot trong bộ nhớ
  → chỉ notify các job/session liên quan
  → ghi gộp state
```

Admin HTTP RPC vẫn được giữ để:

- Bootstrap khi WebSocket chưa sẵn sàng.
- Reconcile định kỳ 30–60 giây.
- Fallback khi WebSocket lỗi, thiếu feature hoặc pairing chưa hoàn tất.
- Thực hiện `tasks.cancel` nếu đường WebSocket không dùng được.

CLI chỉ là fallback cuối cùng và phải có circuit breaker để không spawn process liên tục.

### 6.4 P0 — Event-driven transcript/activity

`agent` và `session.tool` trở thành nguồn realtime chính cho activity, tool progress và final response. JSONL vẫn là nguồn recovery bền vững.

Yêu cầu:

- Chuẩn hóa Gateway event về cùng cấu trúc mà `JobSupervisor.handleEvent` đang nhận.
- Lọc theo `sessionKey` của root session và mọi child session đã biết.
- De-duplicate giữa Gateway event và JSONL bằng khóa ổn định gồm session, loại event, timestamp/run id và hash nội dung đã sanitize.
- Final response vẫn đi qua `ResponseDeliveryGate`.
- `MEDIA:` vẫn phải qua canonical path, signature, size, allowlist và delivery ledger hiện tại.
- Khi WebSocket khỏe, transcript monitor không polling 750 ms liên tục.
- Khi WebSocket mất kết nối, bật fallback tail với chu kỳ mặc định 2 giây.
- Sau reconnect, poll JSONL một lần từ offset đã lưu để bù event bị thiếu rồi quay lại event mode.

Không xóa code JSONL trong bản đầu tiên. Chỉ hạ nó từ đường realtime xuống đường recovery.

### 6.5 P0 — Startup không chặn nhận tin mới

Tách startup thành hai lớp.

**Critical startup:**

- Load config/state/job index/cursor.
- Đăng nhập Discord.
- Khởi tạo queue, delivery gate và Gateway event client.
- Cho phép nhận tin nhắn mới.

**Background maintenance:**

- Cleanup outbox cũ.
- Sửa thư mục mojibake.
- Quét toàn bộ profile/model backend.
- Reconcile job cũ và tin nhắn Discord bị lỡ.

Quy tắc:

- Recovery job cũ vẫn phải giữ đúng thứ tự session với tin mới.
- Nếu session có job recovery chưa enqueue xong, tin mới của session đó được giữ trong queue session; session khác không bị chặn.
- Provider sync dùng cache/profile khai báo trước; quét `/models` chạy nền và cập nhật catalog sau.
- Mỗi maintenance task có timeout, log duration và không được làm process thoát nếu lỗi không nghiêm trọng.

### 6.6 P1 — Status/Discord coalescing thích ứng

Giữ số request Discord thấp nhưng làm phản hồi đầu tiên nhanh hơn:

- Event đầu tiên có ý nghĩa của job được schedule sau 100 ms.
- First delta được schedule sau 100 ms.
- Các delta tiếp theo coalesce theo `OPENCLAW_STREAM_UPDATE_MS`, mặc định đề xuất 1.000 ms.
- Activity thường coalesce 750–1.000 ms.
- Terminal, blocker, stop-confirmed và artifact-ready cập nhật ngay.
- Tính hash của payload embed; không gọi Discord edit nếu nội dung không đổi.
- Nếu Discord trả rate limit, dùng retry-after thật thay vì retry cố định.

Context usage:

- Cache theo session tối thiểu 3 giây.
- Gateway/session event cập nhật cache nếu payload có usage chính xác.
- Quét ngược transcript chỉ chạy khi cache hết hạn và không có request đọc cùng session đang chạy.
- Status edit không chờ context scan; được phép dùng cache gần nhất rồi refresh ở lần edit sau.

### 6.7 P1 — Retry nhanh theo loại lỗi

Thay backoff cố định 15/45 giây bằng policy theo lỗi, vẫn bảo đảm không chạy trùng tool:

| Loại lỗi | Policy đề xuất |
|---|---|
| `rate_limited` có `Retry-After` | Tôn trọng server, thêm jitter nhỏ |
| `network` trước khi Gateway nhận request | 1 giây, 3 giây, 10 giây |
| `unavailable`/503 | 2 giây, 8 giây, 20 giây |
| `stream_error` đã được Gateway rollback rõ ràng | 2 giây, 8 giây |
| `stream_interrupted` không chắc run đã dừng | Không retry request gốc; chờ transcript/Gateway event |
| `non_deliverable_terminal_turn` | Giữ nudge riêng, không chạy lại prompt gốc |

Mỗi lần retry phải:

- Dừng ngay nếu response gate đã delivery.
- Dừng ngay nếu signal abort.
- Ghi rõ thời gian chờ thực tế và nguồn quyết định.
- Không retry lỗi schema/tool payload không có tính tạm thời.

### 6.8 P1 — Queue visibility, không phá tính tuần tự

- Giữ một active request trên mỗi `sessionKey`.
- Giữ concurrency giữa các session theo config hiện tại.
- Ghi `queueBlockedByJobId` và `queuePosition` để phân biệt bot chậm với session đang bận.
- Khi job trước chuyển sang background nhưng vẫn giữ khóa session vì durable task, status phải nói rõ nguyên nhân.
- Không giải phóng khóa chỉ để giảm số queue wait nếu có nguy cơ đảo thứ tự hội thoại.

## 7. Cấu hình mới

| Biến | Mặc định đề xuất | Ý nghĩa |
|---|---:|---|
| `OPENCLAW_GATEWAY_EVENTS_ENABLED` | `true` | Bật đường event WebSocket |
| `OPENCLAW_GATEWAY_RECONCILE_MS` | `60000` | Full task reconcile khi WebSocket khỏe |
| `OPENCLAW_JOB_WRITE_BEHIND_MS` | `250` | Cửa sổ gộp ghi state thường |
| `OPENCLAW_TRANSCRIPT_FALLBACK_POLL_MS` | `2000` | Poll JSONL khi event stream lỗi |
| `OPENCLAW_CONTEXT_USAGE_CACHE_MS` | `3000` | TTL cache context usage |
| `OPENCLAW_FIRST_STATUS_DELAY_MS` | `100` | Delay cho status đầu tiên |

Mọi biến số phải được validate min/max trong `config.js` và có test.

## 8. File dự kiến thay đổi

| File | Thay đổi |
|---|---|
| `src/index.js` | Startup hai lớp, telemetry, status coalescing, wiring event client |
| `src/job-store.js` | Schema v2 per-job, migration, write-behind, critical flush |
| `src/job-supervisor.js` | Nhận event push, giảm write theo offset/event, reconcile theo job liên quan |
| `src/openclaw-task-client.js` | Adapter WebSocket/HTTP/CLI, circuit breaker |
| `src/session-activity.js` | Event mode chính, JSONL fallback tail |
| `src/response-recovery.js` | Tái sử dụng tailer thay vì polling độc lập |
| `src/session-context.js` | Cache + single-flight |
| `src/config.js` | Config mới và feature flags |
| `src/gateway-event-client.js` | Client event mới |
| `src/performance-metrics.js` | Mốc thời gian và structured metrics |
| `scripts/perf-report.js` | Báo cáo p50/p95/max |
| `test/*` | Unit, integration, migration và benchmark regression |

Tên file có thể điều chỉnh khi triển khai, nhưng ranh giới trách nhiệm phải được giữ.

## 9. Kiểm thử

### 9.1 Unit test

- Write-behind gộp 100 mutation thành số lần ghi tối thiểu.
- Critical transition bỏ qua debounce và được flush trước khi resolve.
- Hai job ghi song song không chặn nhau; cùng job vẫn tuần tự.
- Migration v1 → v2 giữ đủ job, task, artifact, offset và delivery ledger.
- Task event `upserted`, `deleted`, `restored`, payload lỗi và seq gap.
- De-duplicate cùng event đến từ WebSocket và JSONL.
- Context cache TTL và single-flight.
- Adaptive debounce gửi first event nhanh, không spam delta tiếp theo.
- Retry policy không retry `stream_interrupted` hoặc lỗi không tạm thời.

### 9.2 Integration test

- Fake Gateway WebSocket phát `agent`, `session.tool`, `task`, disconnect và reconnect.
- WebSocket lỗi → Admin HTTP RPC takeover → WebSocket hồi phục.
- Restart giữa lúc response/artifact đang delivery không gửi trùng.
- Job có nhiều child session vẫn theo dõi đủ event.
- Discord rate limit giả lập dùng đúng retry-after.
- Startup có maintenance chậm 30 giây nhưng tin mới vẫn được enqueue trong SLO.

### 9.3 Performance regression test

Fixture tối thiểu tương đương baseline 401 job/2,28 MB:

- 1.000 activity/offset mutation liên tiếp.
- 50 job thuộc 10 session.
- 20 task event burst trong 1 giây.
- 100 stream delta trong 10 giây.

Ngưỡng pass:

- Event handler p95 ≤ 20 ms trên fixture.
- Không có lần serialize toàn bộ lịch sử job khi chỉ một job thay đổi.
- First event được schedule ≤ 150 ms.
- Số Discord edit tuân theo coalescing và không vượt số payload khác nhau cần thiết.

## 10. Rollout

### Giai đoạn A — Đo trước

- Thêm telemetry và perf report, chưa đổi hành vi.
- Thu ít nhất 20 request chữ và 5 request có media.

### Giai đoạn B — Storage + startup

- Bật schema v2 và write-behind.
- Giữ backup v1.
- Theo dõi lỗi recovery, thời gian ghi và event-loop lag trong 24 giờ.

### Giai đoạn C — Gateway events shadow mode

- Nhận WebSocket event nhưng chưa dùng để delivery.
- So sánh event với JSONL/task snapshot và log mismatch theo hash, không log nội dung.

### Giai đoạn D — Gateway events primary

- Dùng event cho realtime.
- JSONL/RPC chuyển thành fallback/reconcile.
- Có thể tắt nhanh bằng `OPENCLAW_GATEWAY_EVENTS_ENABLED=false`.

### Giai đoạn E — Adaptive status/retry

- Giảm debounce và backoff theo loại lỗi.
- So sánh số Discord API call/job trước và sau.

## 11. Rủi ro và giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Gateway event đổi schema theo phiên bản | Feature detection, normalizer riêng, HTTP/JSONL fallback |
| WebSocket pairing/auth lỗi | Dùng client chính thức, log hướng dẫn rõ, không tắt fallback |
| Write-behind mất event cuối khi crash | Critical flush, reconcile transcript/task, delivery gate idempotent |
| Event đến trùng từ hai nguồn | Stable dedupe key và delivery ledger |
| Discord rate limit do preview nhanh | Payload hash, coalescing, retry-after |
| Startup recovery tranh queue với tin mới | Queue theo session; recovery chỉ chặn đúng session liên quan |
| Backoff retry quá nhanh làm nặng provider | Phân loại lỗi, jitter, Retry-After và giới hạn attempts |
| Migration state lỗi | Viết vào thư mục tạm, validate, atomic switch, giữ backup v1 |

## 12. Definition of Done

- Telemetry chứng minh các SLO bridge đạt trên ít nhất 20 request chữ khi session rảnh.
- Task update realtime không còn phụ thuộc poll 2 giây trong trạng thái WebSocket khỏe.
- JSONL không còn bị poll 750 ms cho mọi session khi event stream khỏe.
- Một activity thường không ghi lại toàn bộ lịch sử 401 job.
- Bot nhận được tin mới trong khi maintenance startup chạy nền.
- Toàn bộ test hiện tại và test mới pass.
- Test restart/recovery không gửi trùng response hoặc artifact.
- README và `.env.example` mô tả config mới, fallback và cách rollback.

## 13. Thứ tự triển khai đề xuất

1. Telemetry + perf report.
2. `JobStore` v2 + write-behind + migration.
3. Startup hai lớp và context usage cache.
4. Gateway WebSocket shadow mode.
5. Gateway event primary + JSONL/RPC fallback.
6. Adaptive Discord coalescing.
7. Retry policy theo loại lỗi.
8. Benchmark, soak test, cập nhật tài liệu và rollout.
