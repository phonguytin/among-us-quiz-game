# Phần việc của Phong

Nhánh `codex/phong-tasks` thực hiện ba yêu cầu trong `phong.docx`: mở nhiệm vụ bằng Solve, trả lời câu hỏi và Report khi gần xác. Giữ nguyên backend của nhóm. Các vị trí nhiệm vụ và câu hỏi hiện là dữ liệu tích hợp mẫu, chưa phải bộ dữ liệu chính thức của từng phòng.

## Chạy trên máy

Cần Node.js và npm. Từ thư mục repo, cài dependency:

```powershell
cd backend
npm ci
cd ../frontend
npm ci
Copy-Item .env.example .env
```

Mở một terminal trong `backend`:

```powershell
npm run dev
```

Mở terminal thứ hai trong `frontend`:

```powershell
npm run dev-nolog
```

Truy cập `http://localhost:8080`. Backend mặc định chạy cổng 3000; `.env.example` đã cấu hình proxy và `VITE_QUIZ_MODE=demo`. Nếu đổi cổng backend, chỉnh `VITE_PROXY_TARGET` rồi khởi động lại Vite. Không commit các file `.env` riêng.

## Tự kiểm tra ba chức năng

1. Mở ít nhất hai tab tại `http://localhost:8080`; có thể dùng Duplicate tab. Mỗi trang tự tạo ID nhân vật riêng, kể cả khi trình duyệt sao chép `sessionStorage` từ tab gốc. Đặt tên khác nhau cho từng tab, ví dụ Phong1 đến Phong5, và chọn các màu khác nhau hoặc bỏ chọn màu. Chỉ tab đầu bấm Create Room; các tab còn lại bấm vào cùng mã phòng trong danh sách. Chờ tất cả vào phòng rồi host mới bấm Start Game, vì phòng đã bắt đầu sẽ không nhận người mới. Tải lại trang bắt đầu một phiên nhân vật mới.
2. Dùng W/A/S/D di chuyển. Đi từ vị trí xuất phát về phía bên phải Cafeteria, đến gần ô nhỏ có viền vàng tại tọa độ map `(672, 153)`. Trong phạm vi 42 đơn vị sẽ thấy Solve; đi xa hơn thì nút ẩn. Điểm mẫu thứ hai ở Weapons `(750, 116)`.
3. Bấm Solve: khung nền đen, chữ trắng “nhiệm vụ”, nút × bên trái, nhãn “Dữ liệu mẫu”. Nhân vật dừng di chuyển, nhưng trận đấu của các người chơi khác vẫn tiếp tục. Bấm × hoặc Escape để đóng và di chuyển lại.
4. Câu 1 là trắc nghiệm: thử Submit khi chưa chọn, thử chọn Imposter để nhận kết quả sai, rồi chọn Crewmate để nhận kết quả đúng. Câu 2 là điền khuyết, nhập `5` rồi Submit. Câu đã đúng được đánh dấu ✓, khóa gửi lặp trong lần mở khung đó. Đóng và mở lại sẽ bắt đầu lại bài mẫu; chưa ghi tiến độ nhiệm vụ lên backend hoặc thay đổi điều kiện thắng.
5. Để kiểm tra Report, dùng ít nhất **bốn nhân vật** trong cùng phòng. Backend hiện có thể kết thúc trận ngay sau một lần hạ người nếu số người còn sống quá ít. Cho imposter hạ một crewmate, đợi hoạt ảnh kết thúc. Nhân vật còn sống đến trong phạm vi 60 đơn vị từ xác sẽ thấy Report; đi xa thì ẩn. Bấm Report, mở F12 → Console, tìm `[Report] thành công` với `{ result: true, roomId, reporterId, bodyId }`. Xác đó chỉ được báo một lần trên mỗi client. Report trong phạm vi bài này chỉ log kết quả, không tự mở cuộc họp hoặc gửi sự kiện lên server.
6. Khi đang mở nhiệm vụ, cho người khác bắt đầu cuộc họp: khung nhiệm vụ phải đóng và các nút tương tác ẩn. Nhân vật bị hạ hoặc kết thúc trận cũng đóng khung và hủy yêu cầu đang chờ.

Khung câu hỏi có vùng cuộn cho nội dung dài, hỗ trợ chuột/bàn phím và tự co theo màn hình. Không thiết kế lại giao diện câu hỏi theo phần việc riêng của thành viên khác.

## Chế độ mẫu và hợp đồng API để ghép nhóm

Mặc định `VITE_QUIZ_MODE=demo`: service sử dụng fixture cục bộ cho cả câu hỏi và chấm đúng/sai. Đáp án mẫu ở frontend nhằm kiểm thử; không dùng làm cơ chế chấm điểm chính thức. Chế độ này không gửi HTTP request chấm bài lên backend.

Khi thành viên phụ trách backend đã triển khai API, đổi `.env` thành `VITE_QUIZ_MODE=api` và khởi động lại Vite. Khi API gặp lỗi sẽ hiển thị lỗi, không tự chuyển sang dữ liệu mẫu. Đây là **hợp đồng đề xuất**, cần thống nhất với nhóm trước khi tích hợp:

```http
GET /quiz/questions?roomId=ROOM_ID&taskId=cafeteria-terminal
```

```json
{
  "questions": [
    {
      "id": "question-1",
      "type": "multiple-choice",
      "prompt": "Nội dung câu hỏi",
      "options": [
        { "id": "a", "text": "Đáp án A" },
        { "id": "b", "text": "Đáp án B" }
      ]
    },
    { "id": "question-2", "type": "text", "prompt": "Nội dung điền khuyết" }
  ]
}
```

ID câu hỏi và ID lựa chọn dùng chuỗi và không trùng nhau trong cùng danh sách. Frontend không cần nhận đáp án đúng. Với trắc nghiệm, `answer` là ID lựa chọn; với điền khuyết, `answer` là chuỗi người chơi nhập, đã bỏ khoảng trắng hai đầu.

```http
POST /quiz/answers
Content-Type: application/json
```

```json
{
  "roomId": "ROOM_ID",
  "taskId": "cafeteria-terminal",
  "questionId": "question-1",
  "answer": "a"
}
```

Phản hồi:

```json
{ "result": true }
```

`result` bắt buộc là boolean `true` hoặc `false`, không phải chuỗi. Service có timeout 10 giây và hủy request khi đóng khung. Proxy `/quiz` đã được thêm vào cấu hình Vite phát triển; khi triển khai production cần cấu hình reverse proxy tương ứng hoặc đặt `VITE_BACKEND_URL` lúc build. Backend hiện tại của repo chưa có các endpoint `/quiz` này.

## Các điểm ghép mã

- `frontend/src/game/config/taskZones.js`: hai vị trí nhiệm vụ tạm, kích thước viền và bán kính tương tác. Thay bằng dữ liệu vị trí do thành viên làm map cung cấp; không cần chỉnh bản đồ/va chạm để thử phần này.
- `frontend/src/game/utils/TaskController.js`: phát hiện khoảng cách, mở/đóng nhiệm vụ, theo dõi xác, xử lý Report và dọn listener khi rời scene.
- `frontend/src/components/TaskInteraction.jsx`: nút Solve/Report và kết nối React với Phaser qua EventBus.
- `frontend/src/components/TaskPanel.jsx`: chọn/nhập đáp án, Submit, phản hồi và hủy yêu cầu.
- `frontend/src/services/questions.js`: cấu hình service theo môi trường; `questionService.js` chứa HTTP contract và kiểm tra dữ liệu; `demoQuestions.js` chứa fixture mẫu.
- `Game.js`: nối sự kiện hạ người với việc đăng ký xác; sửa tên frame hoạt ảnh theo atlas hiện có. `BaseGameScene.js` chặn di chuyển trong lúc mở nhiệm vụ và đăng ký cleanup khi scene shutdown. Không sửa cơ chế sabotage, vote, thắng/thua hoặc dữ liệu backend.

Icon Solve được bổ sung dưới dạng SVG tại `frontend/public/assets/icons/solve.svg`; Report dùng `reportBtn.png` có sẵn. Chưa làm toàn bộ viền vàng trên map; chỉ có hai điểm mẫu để thử phần tương tác.

## Kiểm tra mã

Trong `frontend`:

```powershell
npm test
npm run build-nolog
```

Các test kiểm tra khoảng cách và trạng thái nhân vật/xác, cả hai kiểu câu hỏi mẫu, request thực tế của service ở chế độ API, phản hồi boolean, lỗi HTTP/mạng/dữ liệu và hủy request. Kiểm thử trình duyệt đã thực hiện trên game cục bộ cho Solve, đóng/mở và di chuyển lại, đáp án trống/sai/đúng, điền khuyết, Report khi đến gần/ra xa và khi cuộc họp ngắt nhiệm vụ.
