# BingX Market Scanner

## Project

**BingX Market Scanner** 是一個可直接部署到 GitHub Pages 的純前端市場行情 Dashboard。它顯示 BingX 全部有效 USDT-M 永續合約，並以 BingX 公開 WebSocket 接收即時 24 小時 ticker。

畫面使用 `BTC/USDT.P` 這類 TradingView 風格名稱；所有 BingX REST 與 WebSocket 請求仍使用原始 `BTC-USDT` symbol。

## Version

V0.1

## Features

- 動態載入全部有效 BingX USDT-M 永續合約
- 即時價格、24H 漲跌、最高價、最低價與成交量
- GZIP WebSocket 訊息解壓與 Ping/Pong 心跳
- 可設定的多連線訂閱池與節流訂閱
- 1、2、4、8、15 秒自動重連 backoff，重連後自動恢復訂閱
- 即時搜尋與七種排序方式
- 每個商品獨立 LIVE／STALE 狀態
- 批次更新變動列，不隨每筆 ticker 重建整張表格
- 桌面與手機 Responsive 深色交易終端介面
- 使用相對路徑，可直接部署於 repository GitHub Pages

## Architecture

```text
BingX REST
    → GitHub Actions（每 6 小時）
    → data/contracts.json

BingX WebSocket
    → Browser GZIP 解壓與 Ping/Pong
    → Market Store
    → Live Quotes Dashboard
```

合約清單由 `scripts/update-contracts.py` 在 GitHub Actions 執行。即時行情直接由瀏覽器連到 BingX 公開 WebSocket，不經過任何自建伺服器。

## Setup

目前 BingX contract market endpoint 可在不提供 API 金鑰的情況下讀取，因此預設 workflow 不需要 Secrets。

若 BingX 日後要求簽名，或你的環境需要使用簽名請求，可在 repository 前往：

**Settings → Secrets and variables → Actions → New repository secret**

設定以下兩個 Secrets：

- `BINGX_API_KEY`
- `BINGX_SECRET_KEY`

兩個值必須同時設定。同步腳本會自動改用 HMAC SHA256 簽名請求。這一版只需要市場資料讀取能力，不需要 Trade 或 Withdraw 權限。

## GitHub Actions

手動更新商品清單：

1. 開啟 repository 的 **Actions**。
2. 選擇 **Update BingX Contracts**。
3. 按下 **Run workflow**。

Workflow 也會每 6 小時執行一次；只有 `data/contracts.json` 有變更時才會建立 commit。

## GitHub Pages

1. 前往 **Settings → Pages**。
2. 在 **Build and deployment** 將 Source 設為 **Deploy from a branch**。
3. Branch 選擇 **main**，資料夾選擇 **/(root)**。
4. 儲存後即可從 `https://stun0019.github.io/bingx-market-scanner/` 開啟。

專案不需要 `npm install`、build command 或後端服務。

## Local Preview

ES Modules 與 JSON 載入需要透過 HTTP 服務，請勿直接以 `file://` 開啟。可在 repository 根目錄執行：

```bash
python -m http.server 8000
```

然後瀏覽 `http://localhost:8000/`。

## Security

- API Key 與 Secret 只能存在 GitHub Actions Secrets。
- 前端 HTML、JavaScript、JSON、console 與 README 不包含任何真實 Secret。
- 不要把 API Key 放入 localStorage 或任何瀏覽器端設定。
- WebSocket 僅訂閱公開市場行情，不連接帳戶資料。

## Scope

V0.1 僅提供 Market Data Dashboard／Market Scanner。

本版本不包含交易策略、技術指標、LONG／SHORT 訊號、下單、帳戶餘額、持倉、槓桿、止盈或止損功能。

## Data Source

- [BingX API Docs](https://bingx-api.github.io/docs/)
- WebSocket endpoint: `wss://open-api-swap.bingx.com/swap-market`
