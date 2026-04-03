---
description: Bản đặc tả chuẩn hợp nhất cho Guild War Tactics
---

# Guild War Tactics - Bản Chuẩn Hợp Nhất

> File này là bản chuẩn để implement.
> Nguồn tổng hợp từ `.agents/workflows/tactics-rebuild.md` và bản kế hoạch `.resolved`.
> Giữ nguyên 1 file `web/tactics.html`. Mỗi phase phải test xong rồi mới đi tiếp.

---

## 1. Quyết định chuẩn hóa

### 1.1. Hệ thời gian
- Toàn bộ timeline dùng **giây**.
- `TOTAL_SECONDS = 1800`.
- `mark.time` luôn là seconds.
- Các mốc hệ thống cố định:
  - `1800` = `30:00` = `start`
  - `1500` = `25:00` = `boss_minor`
  - `1200` = `20:00` = `solo`
  - `900` = `15:00` = `boss_major`
  - `0` = `00:00` = `end`
- Helper chuẩn:
  - `formatTime(1770) -> "29:30"`
  - `parseTime("29:30") -> 1770`

### 1.2. Thứ tự triển khai
- Làm theo thứ tự: `Phase 0 -> Phase 2 -> Phase 1 -> Phase 3 -> Phase 4 -> Phase 5`.
- Lý do: Setup + Timeline là nền cho toàn bộ interaction phía sau.

### 1.3. System marks
- 5 mốc `1800 / 1500 / 1200 / 900 / 0` là **system marks**.
- System marks không được xóa và không được đổi `time`.
- Custom marks chỉ được tạo xen giữa các system marks.
- `selectMark()` ở `1500`, `1200`, `900` phải tự bật đúng mode tương ứng.

### 1.4. Mô hình rừng
- Chốt dùng model **dynamic theo event clear**.
- Khi rừng bị clear ở giây `X`, thời điểm respawn là `X - jungle_respawn_seconds`.
- Giá trị mặc định:
  - `sessionData.jungle_respawn_seconds = 300`
- Sub-timeline rừng là dữ liệu **derive từ `jungle_cleared`**, không phải một dãy fixed marks 25/20/15/10/5.
- Leader có thể chỉnh `jungle_respawn_seconds` ở cấp session; khi đổi thì toàn bộ marker rừng phải recalc.

### 1.5. Quy tắc nguồn dữ liệu
- `players[]` và `enemies[]` chỉ chứa người **đang đứng trên map**.
- `tower_guards` chỉ chứa người **đang ở trên trụ**.
- Người trong panel trái được suy ra từ roster gốc trừ đi người đang ở map và đang ở trụ.
- Một người chỉ được tồn tại ở **một nơi duy nhất**:
  - trên map
  - trên trụ
  - trong panel

### 1.6. Quy tắc kiểm tra số lượng
- Validation chuẩn phải check **theo từng phe**, không chỉ tổng 60:
  - `blueMapCount + blueTowerGuardCount === 30`
  - `redMapCount + redTowerGuardCount === 30`
- UI có thể hiển thị thêm tổng `60/60`, nhưng logic block phải tránh case sai lệch `31/29`.
- Mark mới tạo có thể tạm thời thiếu người trong lúc đang chỉnh.
- Chỉ block khi:
  - rời khỏi mark hiện tại
  - hoặc save/publish mark

---

## 2. Canonical State Schema

```js
mark = {
  time: 1770,
  label: "📌 29:30",
  type: "start" | "boss_minor" | "solo" | "boss_major" | "end" | "custom",
  isSystem: false,

  // Units đang đứng trên map
  players: [
    { id, name, role, sub, x, y }
  ],
  enemies: [
    { id, name, role, sub, x, y }
  ],

  // Targeting / combat intent
  targeting: [],

  // State objective chung
  objectives: {
    [objId]: "active" | "destroyed"
  },

  // Guard theo trụ, tối đa 3 người / trụ
  tower_guards: {
    tb1: ["p1", "p2"],
    tb2: ["p3"],
    tb3: [],
    tr1: ["e1", "e2", "e3"],
    tr2: [],
    tr3: []
  },

  // Rừng bị clear lúc nào
  jungle_cleared: {
    d1: 1680,
    d3: 1500
  },

  // Cây
  tree_carriers: {
    ctb: { main: "p1", escorts: ["p2", "p3"] }
  },
  tree_positions: {
    ctb: { x: 12, y: 48 }
  },

  // Boss
  boss_state: {
    boss_minor: { id: "boss1", spawned: true },
    boss_major: { id: "boss2", spawned: true }
  },
  boss_assignments: {
    boss_minor: { blue: ["p1", "p2"], red: ["e1"] },
    boss_major: { blue: [], red: [] }
  },
  boss_conditional: [
    { enemy_count: 5, our_count: 5 }
  ],

  // PVP solo
  pvp_fighters: {
    blue: "p7",
    red: "e4"
  },

  // Notes
  notes_team: {},
  notes_role: {},
  notes_personal: {},

  // Dirty tracking
  _savedHash: null
}
```

### Invariants
- `tower_guards[towerId]` luôn là mảng, kể cả khi có 0 hoặc 1 người.
- `tower_guards` không được chứa ID đang xuất hiện trong `players[]` hoặc `enemies[]`.
- `label` hiển thị được derive từ `time`; không cần feature đặt tên mark riêng.
- `jungle_cleared[objId]` lưu **thời điểm clear**, không lưu thời điểm respawn.
- `pvp_fighters` thay thế `solo_pvp`.

---

## 3. Migration Từ Code Hiện Tại

Hiện `web/tactics.html` vẫn còn model cũ theo phút và một số field cũ. Khi bắt đầu đại tu, normalize dữ liệu theo các rule sau:

1. `TOTAL_MINUTES` -> `TOTAL_SECONDS`.
2. `SYSTEM_EVENTS` đổi từ phút sang seconds.
3. Nếu `mark.time <= 30`, coi là dữ liệu cũ theo phút và convert sang seconds:
   - `30 -> 1800`
   - `25 -> 1500`
   - `20 -> 1200`
   - `15 -> 900`
   - `0 -> 0`
   - mark custom `26 -> 1560`, `29 -> 1740`, v.v.
4. `tower_guards[towerId] = "pid"` cũ phải convert thành `["pid"]`.
5. `solo_pvp` cũ phải convert thành:
   - `pvp_fighters.blue = solo_pvp`
   - `pvp_fighters.red = null`
6. `jungle_cleared` phải normalize sang object `{ [objId]: clearedAtSeconds }`.
7. Backfill field thiếu:
   - `tree_positions`
   - `boss_assignments`
   - `boss_conditional`
   - `pvp_fighters`
8. Hash dirty mới phải tính trên schema đã normalize.

---

## 4. Phase 0 - Setup Trận (30:00)

### Mục tiêu
- Ở mark `1800`, map hiển thị đủ `30 ta + 30 địch`.
- Đây là trạng thái "trước trận", chỉ cho set trụ, không cho drag tự do.

### Cần làm
- Đổi toàn bộ timeline và helper sang seconds.
- Thêm `gamePhase = "setup" | "planning" | "boss" | "pvp"`.
- Thêm `markDirty`, `markSnapshot`.
- Sửa `tower_guards` sang mảng 0-3 người mỗi trụ.
- `renderSetupPhase()`:
  - Xanh: xếp vòng cung quanh ngỗng xanh + cây xanh.
  - Đỏ: mirror phía phải.
  - Role order: DPS trước, Tanker giữa, Healer sau.
  - Dữ liệu lưu vào `marks[0].players[]` và `marks[0].enemies[]`.
- Không cho drag khi `gamePhase === "setup"`.
- Trụ xanh có popup 3 slot dropdown.
- Trụ đỏ auto random 9 địch, chia đều 3 mỗi trụ.
- Hiện nút "Bắt đầu lập chiến thuật" khi ít nhất 1 trụ xanh có người.

### Hành vi nút "Bắt đầu lập chiến thuật"
Khi click:

1. Tạo hoặc chọn mark `1770`.
2. `gamePhase = "planning"`.
3. Chuyển người đang giữ trụ từ map arrays sang `tower_guards`.
4. Xóa 21 người còn lại mỗi bên khỏi map để trả về panel.
5. Giữ nguyên trạng thái 9 người trụ mỗi bên.
6. Chuyển sang mark `29:30`.
7. Ẩn nút start.

### Ghi chú quan trọng
- Mark `1770` mới tạo ra được phép đang thiếu người trên map.
- Chỉ khi user muốn rời mark đó mới bắt đầu enforce validation đủ quân.

### Acceptance
- 60 chấm được render đẹp ở `30:00`.
- Không drag được trong setup.
- Trụ set được 1-3 người.
- Tên guard hiển thị cạnh trụ.
- Click nút start chuyển đúng sang `29:30`.

---

## 5. Phase 2 - Timeline Core

### 5.1. Context menu chuẩn hóa
- Tạo `showContextMenu(e, menuItems)` dùng chung cho:
  - timeline
  - trụ
  - rừng
  - ngỗng
  - cây
  - boss
  - enemy
- Hỗ trợ item thường, separator, submenu, disabled.

### 5.2. Snapshot + inheritance
- Mỗi mark lưu full snapshot theo schema chuẩn ở trên.
- `getInheritedMark(seconds)` phải lấy mark gần nhất có `time >= seconds`.
- `createMarkAt(sec)` clone từ mark đang được nhìn thấy.
- State phải kế thừa đầy đủ:
  - objective destroyed
  - jungle cleared chưa respawn
  - tree carriers / tree positions
  - boss assignments / conditional
  - pvp fighters

### 5.3. Timeline render
- Main timeline hiển thị ticks theo seconds, nhãn lớn mỗi phút, snap theo 30s.
- `renderTimeline()`, `movePlayhead()`, `updatePlayheadInfo()`, `createMarkAt()` đều dùng seconds.
- Custom mark label mặc định là `📌 ${formatTime(time)}`.

### 5.4. Sub-timeline rừng
- Render dưới timeline chính.
- Marker rừng được derive từ:
  - `jungle_cleared[objId]`
  - `sessionData.jungle_respawn_seconds`
- Ví dụ:
  - clear lúc `1680`
  - respawn interval `300`
  - marker respawn ở `1380`
- Leader chuột phải marker rừng để chỉnh interval của session.
- Đổi interval phải recalc toàn bộ markers ngay.

### 5.5. Unsaved changes
- `snapshotHash(mark)` chạy trên state đã normalize.
- Khi load mark hoặc save local mark:
  - cập nhật `markSnapshot`
  - reset `markDirty = false`
- Khi drag/add/remove/change objective/change guard/change boss rule/change tree carrier:
  - set dirty
- Nếu rời mark khi dirty:
  - hiện modal liệt kê thay đổi
  - `Lưu Mark`: cập nhật `marks[idx]` local
  - `Bỏ qua`: discard về snapshot
- Nút header `Save` mới là save ra backend.

### 5.6. Add / delete mark
- Chuột phải timeline track:
  - nhảy playhead tới vị trí click
  - hiện `➕ Thêm Mark tại đây`
  - snap về mốc `30s`
- Xóa mark:
  - chuột phải vào mark hoặc bấm `Del`
  - custom mark mới được xóa
  - system marks không được xóa
  - nếu mark có diff so với inherited/source mark thì cần confirm

### 5.7. Validation trước khi rời mark
- Kiểm tra theo từng phe:
  - xanh đủ 30
  - đỏ đủ 30
- Nếu thiếu:
  - block chuyển mark
  - hiện hint bar nói rõ phe nào đang thiếu bao nhiêu
- Gợi ý UI:
  - `⚠️ Phe xanh còn thiếu 6 người (24/30). Kéo thêm từ panel trái hoặc gán vào trụ.`

### Acceptance
- Tạo mark mới ở `29:30`, `28:30`, v.v. bằng click phải.
- Inheritance đúng state.
- Unsaved warning đúng.
- System marks không xóa được.
- Sub-timeline rừng khớp với thời điểm clear thực tế.

---

## 6. Phase 1 - Icon Interactions

### 6.1. Attack arrow
- Thêm SVG arrow kiểu kiếm vào `#mapTargetingLayer`.
- Khi kéo player gần icon rừng / ngỗng / boss / enemy:
  - nếu khoảng cách < `8%` map thì hiện arrow
  - ra khỏi range thì xóa
- Với enemy target, arrow có thể persistent sau khi drop.

### 6.2. Rừng
- Fix layer bug:
  - `map-players-layer` không được chặn click icon
  - icon rừng cần tương tác được
- Chuột phải:
  - clear bãi này
  - clear tất cả rừng
- Clear:
  - `mark.jungle_cleared[objId] = currentSeconds`
  - icon mờ đi
- Ở các mark sau:
  - nếu chưa tới lúc respawn thì vẫn mờ
  - nếu qua mốc respawn thì sáng lại

### 6.3. Trụ
- Cho kéo người từ guard list ra map.
- Drop ra map:
  - remove khỏi `tower_guards[towerId]`
  - add vào `players[]` hoặc `enemies[]`
- Context menu hủy trụ:
  - trụ này
  - toàn bộ trụ phe ta
  - toàn bộ trụ phe địch
  - tất cả trụ
- Trụ bị hủy sẽ kế thừa destroyed sang mark sau.

### 6.4. Ngỗng
- Kéo player/nhóm gần thì hiện attack arrow.
- Chuột phải:
  - giết ngỗng này
  - giết cả 2 ngỗng
- Khi ngỗng chết:
  - objective thành destroyed
  - kích hoạt logic shield/unlock cho cây tương ứng

### 6.5. Cây
- Điều kiện unlock:
  - ngỗng đối ứng bị hủy
  - hoặc ngỗng phe mình bị hủy trong kịch bản phòng thủ
- Hover:
  - tooltip hiển thị main carrier và escorts
- Chuột phải:
  - panel chọn 1 main + nhiều escort
- Kéo cây:
  - chỉ khi unlocked
  - kéo cả icon cây và người main đi cùng
  - lưu vào `tree_positions`

### 6.6. Enemy
- Kéo player gần enemy thì hiện arrow và lock target.
- `mark.targeting[]` là state nguồn cho các persistent arrow.
- Nếu nhiều enemy tụ gần nhau:
  - hiển thị badge `×N`

### Acceptance
- Rừng clear/respawn đúng.
- Guard kéo ra khỏi trụ hoạt động.
- Ngỗng chết làm cây unlock đúng.
- Enemy targeting giữ được state sau khi tạo mark mới.

---

## 7. Phase 3 - Boss Events

### 7.1. Spawn
- Boss spawn được random 1 lần ở cấp session và giữ cố định:
  - `sessionData.boss_spawn = { minor: "boss1", major: "boss2" }`
- `selectMark(1500)`:
  - `gamePhase = "boss"`
  - bật boss minor theo session
- `selectMark(900)`:
  - `gamePhase = "boss"`
  - bật boss major theo session
- Fix CSS glow boss theo mức sáng dịu hơn.

### 7.2. Assign người đánh boss
- Chuột phải boss:
  - chọn phe ta
  - chọn phe địch
  - mở panel logic "Nếu"
- Dữ liệu lưu:
  - `boss_assignments[bossKey].blue`
  - `boss_assignments[bossKey].red`

### 7.3. Tele layout
- Quy ước góc rõ ràng để tránh mơ hồ:
  - phe ta: nửa bên trái quanh boss
  - phe địch: nửa bên phải quanh boss
- Có thể implement bằng khoảng góc:
  - xanh: `135deg -> 225deg`
  - đỏ: `315deg -> 45deg`
- Radius mặc định khoảng `8%`.
- Sau khi tele:
  - mỗi người có arrow chỉ vào boss
  - animation fade-out -> appear

### 7.4. Logic "Nếu"
- UI bảng rules:
  - `Nếu địch kéo X -> ta kéo Y`
- Dữ liệu:
  - `boss_conditional = [{ enemy_count, our_count }]`
- Hiển thị badge tóm tắt trên icon boss.

### Acceptance
- Boss spawn ổn định giữa các lần switch mark.
- Tele không chồng đội hình sai nửa trái/phải.
- Conditional rules lưu được vào snapshot và kế thừa đúng.

---

## 8. Phase 4 - PVP Solo

### 8.1. Kích hoạt mode
- `selectMark(1200)`:
  - `gamePhase = "pvp"`
  - ẩn icon trụ / rừng / ngỗng / cây / boss
  - hiện sàn đỏ ở giữa map

### 8.2. Layout
- 58 người còn lại xếp vòng tròn lớn.
- 2 fighter đứng ở giữa.
- Phe ta ở nửa trên.
- Phe địch ở nửa dưới.

### 8.3. Chọn fighter
- `pvp_fighters.blue`:
  - leader chọn
  - mặc định là DPS đầu tiên
- `pvp_fighters.red`:
  - random 1 DPS hoặc Tanker
- Chuột phải vào fighter trên sàn để thay người.

### 8.4. Animation
- Người cũ slide out + fade.
- Người mới slide in + glow pulse.

### Acceptance
- Chuyển sang mark `1200` luôn vào đúng mode.
- Lưu/chuyển mark không làm mất fighter đã chọn.

---

## 9. Phase 5 - Polish Và Compatibility

### 9.1. Performance
- Drag dùng `requestAnimationFrame`.
- Batched DOM update khi switch mark.
- Transition `0.3s` cho player/enemy khi đổi mark.

### 9.2. Keyboard
- `Del`: xóa custom mark đang chọn.
- `Ctrl+S`: save backend.
- `Esc`: đóng context menu / modal.

### 9.3. Import / Export / Save
- Phải bao gồm đầy đủ field mới:
  - `tower_guards` dạng array
  - `jungle_cleared` object
  - `tree_carriers`
  - `tree_positions`
  - `boss_assignments`
  - `boss_conditional`
  - `pvp_fighters`
- Save backend phải normalize schema trước khi gửi.

### 9.4. Guest mode
- Guest chỉ xem:
  - không drag
  - không mở context menu chỉnh sửa
  - không save

---

## 10. Chốt Triển Khai

Nếu cần chọn một source of truth duy nhất cho đợt đại tu này thì file này là bản chuẩn.

Các điểm đã được chốt dứt khoát:
- Time luôn là seconds.
- Jungle timeline là dynamic theo clear event.
- `tower_guards` luôn là array 0-3 người.
- `players[]` / `enemies[]` chỉ là unit đang đứng trên map.
- Validation check theo từng phe 30/30.
- System marks gồm `1800`, `1500`, `1200`, `900`, `0`.
- `pvp_fighters` thay `solo_pvp`.
