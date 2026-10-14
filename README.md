# long AI — Chat cá nhân tại http://localhost:3012/

Phiên bản đã đổi giao diện từ Longdragon AI thành **long AI**, xóa các dòng quảng bá nhà cung cấp trên giao diện và chuyển cổng web sang **3012**. Giao diện HTML/CSS/JavaScript; máy chủ Node.js >= 20. **Không cần npm install.**

> **Lưu ý:** Đổi tên giao diện không thay đổi công nghệ AI bên dưới. Máy chủ **vẫn gọi Gemini API của Google**. Thông tin này được giữ rõ trong tài liệu để bạn có thể cấu hình API key và hiểu nơi yêu cầu được xử lý. `localhost` là địa chỉ chỉ truy cập từ máy tính đang chạy server, không phải tên miền công khai trên Render.

## 1. Cách chạy trên Windows

1. Cài Node.js 20 trở lên (LTS): https://nodejs.org/
2. Giải nén tệp ZIP và mở thư mục `long-ai`.
3. Nhấp đúp `run-windows.bat`.
4. Nếu chưa có file `.env`, chương trình sẽ tạo từ `.env.example` và mở bằng Notepad. Điền Gemini API key của **bạn** vào dòng `GEMINI_API_KEY=...`, lưu bằng Ctrl+S và đóng Notepad.
5. Trình duyệt mở **http://localhost:3012/**. Giữ cửa sổ CMD đang chạy để server tiếp tục hoạt động.

Lấy API key tại https://aistudio.google.com/api-keys (kiểm tra quyền truy cập model và hạn mức Free Tier/chi phí của dự án).

## 2. Chạy trên macOS/Linux

```bash
chmod +x run-mac-linux.sh
./run-mac-linux.sh
```

Nếu chưa có `.env`, script sẽ tạo `.env` rồi dừng để bạn điền key. Sau đó chạy lại script và mở **http://localhost:3012/**.

## 3. Chạy thủ công và cấu hình

```bash
node server.js
```

Mẫu `.env`:

```env
GEMINI_API_KEY=API_KEY_CUA_BAN
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_SEARCH_MODEL=gemini-2.5-flash-lite
PORT=3012
```

Đây là **tên biến cấu hình API**, không phải nhãn quảng bá trên website; không tùy ý xóa hoặc đổi tên `GEMINI_API_KEY`. Các model có thể không được cấp quyền cho mọi tài khoản/khu vực. Tùy chọn **Tìm web** yêu cầu model hỗ trợ Google Search grounding. Nếu bị lỗi 403/404, hãy tắt tìm web hoặc cấu hình model được phép sử dụng.

Lưu ý: `.env` có sẵn **không tự bị ghi đè** bởi bản ZIP mới. Nếu đang nâng cấp dự án cũ, hãy sửa thủ công `PORT=3012` trong `.env`, rồi khởi động lại server. Các biến môi trường hệ thống (nếu có) được ưu tiên hơn `.env`.

## 4. Những gì đã thay đổi

- Tên trang, sidebar, logo chữ, dòng giới thiệu, nhãn câu trả lời, thông báo trên giao diện: **long AI**.
- Xóa dòng “POWERED BY GEMINI”, “Powered by Google Gemini API” và khung gợi ý quảng bá trong sidebar.
- Thông báo lỗi trên giao diện dùng ngôn ngữ trung tính, vẫn có hướng dẫn tìm lỗi thực tế.
- Địa chỉ mặc định, lệnh mở trang Windows, file cấu hình mẫu: **http://localhost:3012/**.
- Giữ chức năng chat, tìm web, lịch sử hội thoại và theme. **Giữ nguyên khóa localStorage cũ để không mất lịch sử trình duyệt.**

## 5. Sự cố thường gặp

- Nếu truy cập `localhost:3012` không được, xem CMD đã chạy chưa và cổng 3012 có đang bị ứng dụng khác sử dụng không.
- Nếu báo chưa có API key, mở `.env`, điền `GEMINI_API_KEY` hợp lệ và khởi động lại server.
- Kiểm tra server: http://localhost:3012/api/health — `configured: true` chỉ có nghĩa là server đã đọc key, không xác nhận key được nhà cung cấp chấp nhận.
- Lỗi 429 là giới hạn API; chờ hoặc xem lại quota tại https://ai.google.dev/gemini-api/docs/pricing.

## 6. Bảo mật

- Website mặc định chỉ lắng nghe trên `127.0.0.1`, không công khai ra Internet.
- Không chia sẻ `.env` hoặc API key trên GitHub hay chat.
- Nội dung chat được gửi đến nhà cung cấp API để xử lý, dù giao diện được đổi thành long AI.
- Để triển khai trên Render/Internet, cần cấu hình host và các biện pháp xác thực, quản lý chi phí và bảo mật phù hợp; `localhost` không phải tên miền triển khai công khai.
