# Script thay thế alert/confirm trong index.html bằng customAlert/customConfirm
# Đọc file gốc
$file = 'c:\ALABASTA\ThanThu\WebBangChien\index.html'
$content = [System.IO.File]::ReadAllText($file)

# 1. Thêm link CSS và JS popup vào <head> (sau dòng <script src="...supabase...">)
$supabaseTag = '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>'
$popupIncludes = @"
$supabaseTag
<link rel="stylesheet" href="./cpopup.css">
<script src="./cpopup.js"></script>
"@
$content = $content.Replace($supabaseTag, $popupIncludes)

# 2. Thay thế alert() -> customAlert()
# Pattern: alert('...') hoặc alert("...")
# Không cần regex phức tạp vì chúng ta biết cấu trúc rõ ràng

# Danh sách replacement cho alert (đơn giản, chỉ thêm await)
$alertPatterns = @(
    # index.html alert patterns
    @("alert('Hệ thống chưa sẵn sàng, vui lòng refresh trang.')", "await customAlert('Hệ thống chưa sẵn sàng, vui lòng refresh trang.')"),
    @("if (error) alert('Lỗi đăng nhập: ' + error.message);", "if (error) { await customAlert('Lỗi đăng nhập: ' + error.message); }"),
    @("if (error) { alert('Lỗi đăng nhập: ' + error.message); return; }", "if (error) { await customAlert('Lỗi đăng nhập: ' + error.message); return; }"),  
    @("if (e2) alert('Lỗi đăng nhập: ' + e2.message);", "if (e2) { await customAlert('Lỗi đăng nhập: ' + e2.message); }"),
    @("alert('❌ Đăng nhập thất bại: ' + (event.data.error || 'Lỗi không xác định'))", "await customAlert('❌ Đăng nhập thất bại: ' + (event.data.error || 'Lỗi không xác định'))"),
    @("alert('❌ Lỗi từ Discord: ' + errorMsg)", "await customAlert('❌ Lỗi từ Discord: ' + errorMsg)"),
    @("alert('Lỗi cập nhật Luôn tham gia: ' + (error.message || error))", "await customAlert('Lỗi cập nhật Luôn tham gia: ' + (error.message || error))"),
    @("alert('Không tìm thấy phiên BC!')", "await customAlert('Không tìm thấy phiên BC!')"),
    @("alert('Bạn đã đăng ký rồi!')", "await customAlert('Bạn đã đăng ký rồi!')"),
    @("alert('Lỗi đăng ký: ' + updateErr.message)", "await customAlert('Lỗi đăng ký: ' + updateErr.message)"),
    @("alert('❌ Trưởng nhóm không thể hủy đăng ký! Hãy nhờ Kỳ Cựu dùng lệnh ?bcend.')", "await customAlert('❌ Trưởng nhóm không thể hủy đăng ký! Hãy nhờ Kỳ Cựu dùng lệnh ?bcend.')"),
    @("alert('Lỗi hủy đăng ký: ' + updateErr.message)", "await customAlert('Lỗi hủy đăng ký: ' + updateErr.message)"),
    @("alert('❌ Chỉ Kỳ Cựu hoặc quản lý mới được tạo session!')", "await customAlert('❌ Chỉ Kỳ Cựu hoặc quản lý mới được tạo session!')"),
    @("alert('Ngày này đã có tab rồi!')", "await customAlert('Ngày này đã có tab rồi!')"),
    @("alert('Lỗi tạo BC: ' + error.message)", "await customAlert('Lỗi tạo BC: ' + error.message)"),
    @("alert('❌ Chỉ Kỳ Cựu hoặc quản lý mới được xóa session Bang Chiến!')", "await customAlert('❌ Chỉ Kỳ Cựu hoặc quản lý mới được xóa session Bang Chiến!')"),
    @("alert('Lỗi xóa: ' + updateErr.message)", "await customAlert('Lỗi xóa: ' + updateErr.message)")
)

foreach ($pair in $alertPatterns) {
    $content = $content.Replace($pair[0], $pair[1])
}

# 3. Thay thế confirm() -> await customConfirm() 
# Pattern chính: if (!confirm('...')) return;  -> if (!(await customConfirm('...'))) return;
$content = $content.Replace(
    "if (!confirm('Bạn muốn hủy đăng ký Bang Chiến?')) return;",
    "if (!(await customConfirm('Bạn muốn hủy đăng ký Bang Chiến?'))) return;"
)

# Pattern: if (!confirm(`Xóa phiên Bang Chiến ${label}?\n\nBot Discord sẽ tự động cập nhật.`)) return;
$content = $content.Replace(
    'if (!confirm(`Xóa phiên Bang Chiến ${label}?\n\nBot Discord sẽ tự động cập nhật.`)) return;',
    'if (!(await customConfirm(`Xóa phiên Bang Chiến ${label}?\n\nBot Discord sẽ tự động cập nhật.`))) return;'
)

# 4. Đổi handler addBcBtn thành async (vì có alert bên trong)
$content = $content.Replace(
    "document.getElementById('addBcBtn').addEventListener('click', () => {",
    "document.getElementById('addBcBtn').addEventListener('click', async () => {"
)

# Ghi file
[System.IO.File]::WriteAllText($file, $content)
Write-Host "✅ Đã xử lý index.html xong!"
Write-Host "Kiểm tra số lượng alert/confirm còn lại..."
$remaining_alert = (Select-String -Path $file -Pattern '\balert\(' -AllMatches).Matches.Count
$remaining_confirm = (Select-String -Path $file -Pattern '\bconfirm\(' -AllMatches).Matches.Count  
Write-Host "alert() còn lại: $remaining_alert"
Write-Host "confirm() còn lại: $remaining_confirm"
