# Hướng dẫn sử dụng Stock Audit App

Tài liệu này mô tả quy trình kiểm hàng từ A→Z dành cho thu ngân / kế toán kho.
Bản local (Stock Audit App.exe trên Windows) và bản web cùng dùng chung quy trình.

---

## 1. Chuẩn bị file tồn kho

File phải đúng mẫu **ma trận size**. Mẫu chuẩn có thể bấm **"Tải file mẫu"** ở thanh công cụ trên cùng để tải `inventory-template.csv`.

5 cột đầu bắt buộc, đúng thứ tự (header chữ thường):

| stt | tên hàng | tác nghiệp | giá | màu |
|-----|----------|-----------|-----|-----|

Từ cột thứ 6 trở đi là các size (S, M, L, XL, …). Có thể có cột `SALE` để ghi % giảm giá. Mỗi ô size là số lượng tồn của biến thể đó.

Định dạng hỗ trợ: **.xlsx, .xlsm, .csv** (UTF-8).

> **Mẹo:** một mã màu có thể xuất hiện ở nhiều dòng (nhiều tác nghiệp). Hệ thống tự gộp.

---

## 2. Đăng nhập

### Lần đầu chạy trên máy admin
1. Mở **Stock Audit App.exe** (hoặc truy cập http://localhost:8020).
2. Màn hình sẽ hiện **"Tạo admin đầu tiên"**.
3. Nhập tên đăng nhập, tên hiển thị, mật khẩu (≥ 8 ký tự) → bấm **Tạo admin**.
4. Hệ thống sẽ tạo file `accounts.xlsx` ở thư mục dữ liệu — đây là file đồng bộ tài khoản giữa các máy.

### Lần đầu chạy trên máy kiểm hàng (không phải admin)
1. Copy file `accounts.xlsx` (do admin gửi) vào đúng thư mục dữ liệu của app.
2. Mở app → đăng nhập bằng tài khoản admin đã cấp.

### Các lần sau
1. Đăng nhập bằng username/password đã cấp.
2. Phiên đăng nhập giữ trong 30 ngày, không cần đăng nhập lại mỗi ngày.

---

## 3. Quản lý tài khoản (chỉ admin)

Bấm **"Tài khoản"** trên thanh công cụ:

- **Thêm user**: nhập username + password + tên hiển thị + role (admin/user).
- **Đặt lại mật khẩu**: cho user đã có.
- **Khóa / mở khóa**: tạm dừng quyền đăng nhập.
- **Xóa**: xóa tài khoản và toàn bộ dữ liệu kiểm hàng của user đó.

Mọi thay đổi sẽ được ghi vào `accounts.xlsx` để các máy khác đồng bộ.

---

## 4. Quy trình kiểm hàng 1 ca

```
┌─ Bước 1 ─┐    ┌─ Bước 2 ─┐    ┌─ Bước 3 ─┐    ┌─ Bước 4 ─┐
│  Import  │──▶ │   Scan   │──▶ │ Đối soát │──▶ │   Xuất   │
│  tồn kho │    │ barcode  │    │chênh lệch│    │ báo cáo  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
```

### Bước 1 — Import tồn kho

1. Vào ô **Bước 1 — Import tồn kho**.
2. Đặt **tên phiên** (ví dụ: "Kiểm hàng ca sáng 2026-05-07").
3. Bấm **"Chọn tập tin"** → chọn file Excel/CSV theo mẫu.
4. Bấm **"Import dữ liệu"**.
5. Đợi đến khi báo `Đã import N biến thể tồn kho theo file chuẩn`.
6. Số liệu hiện ra:
   - **TỔNG DÒNG**: số biến thể trong file.
   - **TỒN KHO**: tổng số lượng cần kiểm.
   - **DÒNG THIẾU**: bằng tổng dòng (vì chưa scan).

> Mỗi user có 1 phiên active duy nhất. Import file mới sẽ đóng phiên cũ.

### Bước 2 — Scan barcode

1. Đặt con trỏ vào ô **Mã scan** (ô đã auto-focus sẵn).
2. Bóp cò máy quét barcode (hoặc nhập tay rồi Enter).
3. Mỗi mã quét hợp lệ phải đủ ≥ 15 ký tự. Hệ thống tự đọc:
   - Vị trí 4–7: **mã màu**
   - Vị trí 8–9: **mã size**
   - Vị trí 10–12: **năm tác nghiệp**
   - Vị trí 13–15: **số tác nghiệp** → ghép thành `năm/số` (ví dụ `1/123`)
4. Mỗi scan trả về một trong các trạng thái:
   - **Khớp** (nền xanh): tăng `Đã scan` của dòng đó +1.
   - **Không khớp** (nền đỏ): không tìm thấy biến thể trong file tồn kho → chuyển vào **"Mã scan không khớp"** để xử lý sau.
5. Số liệu summary cập nhật ngay (ĐÃ SCAN, KHỚP ĐÚNG, DÒNG DƯ, DÒNG THIẾU).

> **Tốc độ:** mỗi scan phản hồi <100ms (chỉ cập nhật 1 dòng + summary, không tải lại toàn bộ bảng).

### Bước 3 — Đối soát chênh lệch

Trong bảng **"Chênh lệch cần xử lý"**, hệ thống chia 3 loại:

| Trạng thái | Ý nghĩa |
|-----------|---------|
| **Khớp** | Đã scan = Tồn |
| **Dư** | Đã scan > Tồn (quét nhầm hoặc hàng không khai báo) |
| **Thiếu** | Đã scan < Tồn (chưa quét đủ hoặc thực sự thiếu) |

Với mỗi dòng chênh lệch, bấm vào dòng và chọn **Lý do** từ danh sách:
- Thiếu hàng thực tế
- Dư hàng thực tế
- Sai màu
- Sai size
- Lệch tác nghiệp
- Hàng chưa cập nhật kho
- Khác

Có thể nhập **ghi chú** kèm theo.

> Bấm **"Xem trước báo cáo"** để hiện đầy đủ chi tiết. Bấm **"Đóng phiên"** khi hoàn tất.

### Bước 4 — Xuất báo cáo

1. Bấm **"Xuất báo cáo"** ở thanh công cụ (góc trên phải).
2. File `bao-cao-chenh-lech-YYYYMMDD-HHMMSS.xlsx` được tải về.
3. Báo cáo chia 3 vùng:
   - **Tóm tắt phiên**: tên phiên, file gốc, thời gian.
   - **Tổng quan**: tổng dòng, tổng tồn, tổng scan, khớp, dư, thiếu.
   - **Chi tiết chênh lệch**: từng dòng có chênh lệch hoặc đã ghi lý do.

Báo cáo đã enrich sẵn **tên màu, chất liệu, kiểu dáng** từ Google Sheet tham chiếu.

---

## 5. Tìm kiếm và phân trang

- **Ô tìm kiếm** (góc trên bảng): lọc theo tên hàng, mã màu, size, tác nghiệp, mã scan.
- **Phân trang**: 20 dòng/trang ở bảng items, 5/trang ở recent scans.
- Bấm `[<<]` `[<]` `[>]` `[>>]` để di chuyển trang.

---

## 6. Xử lý lỗi thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
|-----------|-------------|-----------|
| `File chưa đúng mẫu. 5 cột đầu phải là...` | Header sai | Mở lại file mẫu, copy đúng 5 cột đầu |
| `Mã scan không hợp lệ. Cần ít nhất 15 ký tự` | Barcode lỗi | Quét lại; kiểm tra máy quét đã cấu hình mã 1D đúng |
| `Không khớp file tồn theo màu X, size Y, tác nghiệp Z` | Hàng không có trong file import | Kiểm tra file gốc; nếu đúng là hàng thật thì ghi lý do "Dư hàng thực tế" |
| Scan không phản hồi (>3 giây) | Mạng chậm khi gọi Google Sheet | Lần đầu mỗi giờ chỉ chậm 1 lần; các scan tiếp theo dùng cache (sửa 2026-05-07) |
| `Vui lòng đăng nhập để dùng app` | Hết phiên | Đăng nhập lại |
| `Bản Vercel đã bị khóa dữ liệu` | Đang dùng URL Vercel | Mở Stock Audit App.exe trên máy tính |

---

## 7. Mẹo tăng tốc

- **Auto-focus**: sau mỗi scan, ô mã scan tự focus lại — không cần click.
- **Phím Enter**: nhập tay barcode rồi Enter cũng được (giống bóp cò máy quét).
- **Đóng các tab khác**: trên máy yếu, đóng Chrome / Excel khi quét hàng loạt.
- **File nhỏ trước**: nếu kho có >5000 SKU, chia thành nhiều phiên theo nhóm tác nghiệp để load nhanh hơn.

---

## 8. Lưu trữ dữ liệu

- **Local mode** (mặc định): dữ liệu lưu trong `Documents/StockAuditApp/users/user_<id>.db` (SQLite).
- **FS mode** (Chrome/Edge): dữ liệu lưu trong thư mục bạn tự chọn — file `data.json`.
- **Cloud mode**: chỉ admin nội bộ — dùng Postgres trên Vercel.

Mỗi user có database riêng → không lẫn dữ liệu giữa các tài khoản.

---

## 9. Liên hệ

- Lỗi kỹ thuật: gửi log từ thư mục dữ liệu cho IT.
- Yêu cầu thêm tính năng: ghi vào file `requests.md` trong thư mục project.
