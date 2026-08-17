# OKX Market Scanner

## Project

**OKX Market Scanner** 是一個可直接部署至 GitHub Pages 的純前端市場行情 Dashboard。

系統顯示 OKX 所有有效的 USDT 永續合約，並透過 OKX Public WebSocket 接收即時行情。

Dashboard 顯示格式：

BTC/USDT.P  
ETH/USDT.P  
SOL/USDT.P

但與 OKX API 溝通時使用正式 Instrument ID：

BTC-USDT-SWAP  
ETH-USDT-SWAP  
SOL-USDT-SWAP


## Version

V0.1


## Features

- 動態同步全部 OKX USDT 永續合約
- 即時價格
- 24H 漲跌 %
- 24H High
- 24H Low
- 24H Volume
- OKX Public WebSocket
- Ping / Pong heartbeat
- 自動 reconnect
- LIVE / STALE 狀態
- 即時搜尋
- 七種排序模式
- 價格上漲 / 下跌閃爍
- DOM 批次更新
- Responsive
- GitHub Pages
- GitHub Actions 自動更新商品清單
- CI 自動測試


## Architecture

```text
OKX Public REST

GET /api/v5/public/instruments
?instType=SWAP

        ↓

GitHub Actions

        ↓

data/instruments.json

        ↓

Dashboard


OKX Public WebSocket

        ↓

tickers

        ↓

Market Store

        ↓

Live Dashboard
