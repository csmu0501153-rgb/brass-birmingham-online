# Brass: Birmingham 線上多人版（伺服器權威）

Fork 自 [npow/brass-birmingham](https://github.com/npow/brass-birmingham)（原本只支援同一台電腦輪流玩），改成每位朋友用自己的私人連結連線遊玩。

- **規則與狀態都在伺服器（Node.js）上**：伺服器直接載入原本的 `js/gameData.js`、`gameState.js`、`gameLogic.js`、`aiPlayer.js`（規則程式沒有改）。
- **每個人只會收到「公開資訊＋自己的手牌」**：對手手牌和抽牌堆只會以 `{type:"hidden"}` 佔位（只透露張數）。遊戲一開始蓋著放的棄牌伺服器會直接丟掉，從不傳送。
- 伺服器會檢查行動是否輪到該玩家、是否合法，不合法就拒絕並回復狀態。AI 座位由伺服器代為行動。
- 介面預設為繁體中文，右下角可切換 English，選擇會存在 localStorage。

## 本機執行
```bash
npm install
npm start            # http://localhost:3000
npm test             # 伺服器整合測試（不需要瀏覽器）
```
環境變數：`PORT`（預設 3000）、`DATA_DIR`（存檔資料夾，預設 `./data`）、`AI_DELAY_MS`（AI 每步的延遲，預設 1200）、`SAVE_INTERVAL_MS`（定期存檔間隔，預設 30000）。

## 玩法
1. 打開網站首頁，選擇人數（2–4），並設定每個座位是「真人玩家」還是 AI（簡單／普通／困難），然後按「建立房間」。
2. 畫面會列出每位真人玩家的**私人連結**。請**只**把各自的連結傳給對應的朋友，不要分享給其他人（拿到連結的人就能操作該座位，也看得到那份手牌）。也請保存好你自己的連結。
3. 斷線或重新整理後會自動用同一個連結重新連線。

## 部署到 Render（免費 Web Service）
1. 把這個資料夾推到 GitHub repo（例如 `brass-birmingham-online`）。
2. 註冊或登入 https://render.com（可用 GitHub 登入），按 **New → Web Service**，選擇該 repo。
3. 設定：
   - **Runtime**：Node
   - **Build Command**：`npm install`
   - **Start Command**：`npm start`
   - **Instance Type**：Free
   - **Health Check Path**：`/health`
   - 不用自己設定 `PORT`，Render 會自動提供。
4. 部署完成後打開 `https://<你的服務>.onrender.com/` 建立房間。

### 免費方案的限制（重要）
- 服務 15 分鐘沒有流量就會休眠，下次連線約需 1 分鐘喚醒（Render 會先顯示載入頁）。
- 遊戲進行中，WebSocket 的 ping（每 30 秒）和遊戲訊息都算流量，一般不會在玩到一半時休眠。
- **存檔是盡力而為**：伺服器在每次行動後和每 30 秒會把房間存成 `data/room-<id>.json`，啟動時再載入。但 Render 免費方案的硬碟是**暫存的**，休眠、重啟或重新部署時檔案可能被清空，房間就會消失，連結也會失效。打完一局再休眠一般沒問題；想要可靠保存就需要外部資料庫或付費磁碟（本版未實作）。

## 檔案
- `server/index.js`：HTTP（提供前端靜態檔＋`POST /api/rooms`＋`/health`）和 WebSocket（`/ws`）
- `server/rooms.js`：房間、規則檢查、AI、每位玩家看到的畫面資料、JSON 存檔
- `server/engine.js`：用 Node 的 `vm` 載入原本的規則檔
- `js/main.js`：建立房間的畫面、WebSocket 連線與自動重連
- `js/uiManager.js`：改成依伺服器送來的狀態繪製畫面；多步驟選擇在前端完成後，一次送出完整行動
- `js/i18n.js`：中英切換
- `test/run-tests.js`：整合測試（`npm test`）
- `test/dom-smoke.js`：jsdom 冒煙測試（需要另外安裝 jsdom）
