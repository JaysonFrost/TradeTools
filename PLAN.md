# Universal Trade Clipper Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a local macOS service that detects Binance/OKX/Bybit spot and futures trades, saves the relevant OBS replay buffer, trims the exact trade window with padding, and stores per-trade video clips with metadata.

**Architecture:** A local Python daemon watches exchange user-data streams, tracks position/order state per exchange/account/symbol, and triggers OBS replay saving when a trade closes. The saved replay file is trimmed with ffmpeg using calculated timestamps and written to a dated clips directory with a JSON sidecar.

**Tech Stack:** Python 3.11+, asyncio, ccxt/ccxt.pro or native exchange websockets, obs-websocket-py/simpleobsws, SQLite, ffmpeg/ffprobe, python-dotenv, launchd for autostart on macOS.

---

## Recommended MVP Scope

Use OBS Replay Buffer first.

Reason:
- Typical trade duration is up to 10 minutes.
- Replay Buffer set to 20–30 minutes is enough.
- Much simpler than permanent segmented recording.
- Can later add continuous recording if needed.

Initial exchanges:
- Binance spot
- Binance USD-M futures
- Bybit spot
- Bybit futures
- OKX spot
- OKX swap/futures

Initial trade model:
- A trade starts when exposure for a symbol changes from zero to non-zero.
- A trade ends when exposure returns to zero.
- For spot, track inventory delta or filled buy/sell pairs.
- For futures, track position size.
- Partial entries/exits are stored as executions inside the same trade.

Default OBS settings:
- Replay Buffer: 30 minutes
- Padding before entry: 3 seconds
- Padding after exit: 5 seconds

Output example:

`/Users/igorarnautov/TradeClips/clips/2026-05-13/2026-05-13_03-49-21_BINANCE_FUTURES_BTCUSDT_LONG.mp4`

Sidecar:

`/Users/igorarnautov/TradeClips/clips/2026-05-13/2026-05-13_03-49-21_BINANCE_FUTURES_BTCUSDT_LONG.json`

---

## Project Layout

Create:

```text
/Users/igorarnautov/TradeClipper/
  .env
  pyproject.toml
  README.md
  src/trade_clipper/
    __init__.py
    main.py
    config.py
    db.py
    models.py
    obs_client.py
    video.py
    trade_state.py
    exchanges/
      __init__.py
      base.py
      binance.py
      bybit.py
      okx.py
  tests/
    test_trade_state.py
    test_video_timing.py
```

Runtime data:

```text
/Users/igorarnautov/TradeClips/
  db.sqlite
  clips/
  obs_replays/
  logs/
```

---

## Task 1: Install system dependencies

**Objective:** Ensure OBS websocket and ffmpeg are available.

**Files:** None

**Commands:**

```bash
brew install ffmpeg python@3.11
```

Verify:

```bash
ffmpeg -version
ffprobe -version
python3.11 --version
```

Expected:
- ffmpeg prints version.
- ffprobe prints version.
- Python is 3.11+.

OBS requirements:
- OBS 28+ has built-in websocket.
- Enable: Tools → WebSocket Server Settings.
- Port: `4455`.
- Set a password.
- Enable Replay Buffer in OBS settings.
- Set replay buffer to 1800 seconds / 30 minutes.
- Set replay save folder to `/Users/igorarnautov/TradeClips/obs_replays`.

---

## Task 2: Create Python project skeleton

**Objective:** Create the local service package.

**Files:**
- Create: `/Users/igorarnautov/TradeClipper/pyproject.toml`
- Create: `/Users/igorarnautov/TradeClipper/src/trade_clipper/__init__.py`
- Create: `/Users/igorarnautov/TradeClipper/src/trade_clipper/main.py`

**pyproject.toml:**

```toml
[project]
name = "trade-clipper"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "python-dotenv>=1.0.1",
  "pydantic>=2.7.0",
  "aiosqlite>=0.20.0",
  "simpleobsws>=1.4.2",
  "websockets>=12.0",
  "aiohttp>=3.9.0",
  "ccxt>=4.4.0"
]

[project.scripts]
trade-clipper = "trade_clipper.main:main"
```

**main.py initial:**

```python
def main():
    print("trade-clipper ready")

if __name__ == "__main__":
    main()
```

Verify:

```bash
cd /Users/igorarnautov/TradeClipper
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e .
trade-clipper
```

Expected:

```text
trade-clipper ready
```

---

## Task 3: Add configuration

**Objective:** Load OBS, output, padding, and exchange API config from `.env`.

**Files:**
- Create: `/Users/igorarnautov/TradeClipper/.env`
- Create: `/Users/igorarnautov/TradeClipper/src/trade_clipper/config.py`

**.env template:**

```bash
TRADECLIPPER_DATA_DIR=/Users/igorarnautov/TradeClips
TRADECLIPPER_OBS_HOST=127.0.0.1
TRADECLIPPER_OBS_PORT=4455
TRADECLIPPER_OBS_PASSWORD=change_me
TRADECLIPPER_PADDING_BEFORE_SECONDS=3
TRADECLIPPER_PADDING_AFTER_SECONDS=5
TRADECLIPPER_REPLAY_BUFFER_SECONDS=1800

BINANCE_API_KEY=
BINANCE_API_SECRET=
BYBIT_API_KEY=
BYBIT_API_SECRET=
OKX_API_KEY=
OKX_API_SECRET=
OKX_API_PASSPHRASE=
```

**config.py:**

```python
from pathlib import Path
from pydantic import BaseModel
from dotenv import load_dotenv
import os

class Settings(BaseModel):
    data_dir: Path
    obs_host: str
    obs_port: int
    obs_password: str
    padding_before_seconds: int
    padding_after_seconds: int
    replay_buffer_seconds: int
    binance_api_key: str | None = None
    binance_api_secret: str | None = None
    bybit_api_key: str | None = None
    bybit_api_secret: str | None = None
    okx_api_key: str | None = None
    okx_api_secret: str | None = None
    okx_api_passphrase: str | None = None


def load_settings() -> Settings:
    load_dotenv()
    return Settings(
        data_dir=Path(os.environ.get("TRADECLIPPER_DATA_DIR", "/Users/igorarnautov/TradeClips")),
        obs_host=os.environ.get("TRADECLIPPER_OBS_HOST", "127.0.0.1"),
        obs_port=int(os.environ.get("TRADECLIPPER_OBS_PORT", "4455")),
        obs_password=os.environ.get("TRADECLIPPER_OBS_PASSWORD", ""),
        padding_before_seconds=int(os.environ.get("TRADECLIPPER_PADDING_BEFORE_SECONDS", "3")),
        padding_after_seconds=int(os.environ.get("TRADECLIPPER_PADDING_AFTER_SECONDS", "5")),
        replay_buffer_seconds=int(os.environ.get("TRADECLIPPER_REPLAY_BUFFER_SECONDS", "1800")),
        binance_api_key=os.environ.get("BINANCE_API_KEY") or None,
        binance_api_secret=os.environ.get("BINANCE_API_SECRET") or None,
        bybit_api_key=os.environ.get("BYBIT_API_KEY") or None,
        bybit_api_secret=os.environ.get("BYBIT_API_SECRET") or None,
        okx_api_key=os.environ.get("OKX_API_KEY") or None,
        okx_api_secret=os.environ.get("OKX_API_SECRET") or None,
        okx_api_passphrase=os.environ.get("OKX_API_PASSPHRASE") or None,
    )
```

Verify:

```bash
python -c "from trade_clipper.config import load_settings; print(load_settings().data_dir)"
```

Expected:

```text
/Users/igorarnautov/TradeClips
```

---

## Task 4: Add trade state engine

**Objective:** Detect open/close lifecycle from position/exposure changes.

**Files:**
- Create: `/Users/igorarnautov/TradeClipper/src/trade_clipper/models.py`
- Create: `/Users/igorarnautov/TradeClipper/src/trade_clipper/trade_state.py`
- Create: `/Users/igorarnautov/TradeClipper/tests/test_trade_state.py`

**Core rules:**
- zero → non-zero = open trade
- non-zero → non-zero = update current trade
- non-zero → zero = close trade
- side is LONG when exposure > 0, SHORT when exposure < 0

**Test cases:**
- futures long opens and closes
- futures short opens and closes
- partial scale-in remains same trade
- partial scale-out remains same trade
- full close emits closed trade event

Verification:

```bash
pytest tests/test_trade_state.py -v
```

Expected:

```text
5 passed
```

---

## Task 5: Add OBS client

**Objective:** Connect to OBS websocket and trigger replay buffer save.

**Files:**
- Create: `/Users/igorarnautov/TradeClipper/src/trade_clipper/obs_client.py`

**Functions:**
- `connect()`
- `ensure_replay_buffer_active()`
- `save_replay_buffer()`
- `find_newest_replay_file(after_timestamp)`

Verification:

```bash
python -m trade_clipper.obs_client
```

Expected:
- OBS connection succeeds.
- Replay buffer save is triggered.
- New file appears in `/Users/igorarnautov/TradeClips/obs_replays`.

---

## Task 6: Add video trimming

**Objective:** Calculate trim offsets and call ffmpeg.

**Files:**
- Create: `/Users/igorarnautov/TradeClipper/src/trade_clipper/video.py`
- Create: `/Users/igorarnautov/TradeClipper/tests/test_video_timing.py`

**Formula:**

```text
replay_end_time = timestamp when OBS replay file was saved
replay_start_time = replay_end_time - replay_duration_seconds
clip_start_offset = trade_entry_time - replay_start_time - padding_before
clip_end_offset = trade_exit_time - replay_start_time + padding_after
```

Clamp:
- `clip_start_offset >= 0`
- `clip_end_offset <= replay_duration_seconds`

ffmpeg command:

```bash
ffmpeg -y -ss START -to END -i INPUT -c copy OUTPUT
```

Fallback for frame-accurate cuts:

```bash
ffmpeg -y -ss START -to END -i INPUT -c:v libx264 -c:a aac OUTPUT
```

Verification:

```bash
pytest tests/test_video_timing.py -v
```

Expected:

```text
all tests passed
```

---

## Task 7: Add SQLite persistence

**Objective:** Store trades, executions, clips, and processing state.

**Files:**
- Create: `/Users/igorarnautov/TradeClipper/src/trade_clipper/db.py`

**Tables:**
- trades
- executions
- clips
- exchange_events

**Why:**
- avoids losing active trade state after restart;
- supports debugging;
- enables later dashboard/search.

Verification:

```bash
python -m trade_clipper.db init
sqlite3 /Users/igorarnautov/TradeClips/db.sqlite '.tables'
```

Expected:

```text
clips exchange_events executions trades
```

---

## Task 8: Add Binance adapter

**Objective:** Watch Binance spot and futures account updates.

**Files:**
- Create: `/Users/igorarnautov/TradeClipper/src/trade_clipper/exchanges/base.py`
- Create: `/Users/igorarnautov/TradeClipper/src/trade_clipper/exchanges/binance.py`

**Recommended:**
- Use Binance user data stream.
- Futures: position/account update events are source of truth.
- Spot: execution reports plus balances/inventory for configured symbols.

API key permissions:
- read-only/account data;
- no withdrawal;
- no trading unless absolutely needed, but it should not be needed.

Verification:

```bash
trade-clipper --exchange binance --dry-run
```

Expected:
- connects to Binance;
- prints account/position updates;
- no OBS actions in dry-run.

---

## Task 9: Add Bybit adapter

**Objective:** Watch Bybit spot and futures account updates.

**Files:**
- Create: `/Users/igorarnautov/TradeClipper/src/trade_clipper/exchanges/bybit.py`

Use Bybit private websocket streams:
- position
- execution
- order

Verification:

```bash
trade-clipper --exchange bybit --dry-run
```

Expected:
- connects to Bybit;
- prints position/execution updates;
- no OBS actions in dry-run.

---

## Task 10: Add OKX adapter

**Objective:** Watch OKX spot and swap/futures account updates.

**Files:**
- Create: `/Users/igorarnautov/TradeClipper/src/trade_clipper/exchanges/okx.py`

Use OKX private websocket channels:
- positions
- orders
- account

Credentials require:
- API key
- secret
- passphrase

Verification:

```bash
trade-clipper --exchange okx --dry-run
```

Expected:
- connects to OKX;
- prints account/position/order updates;
- no OBS actions in dry-run.

---

## Task 11: Wire close-trade event to clip creation

**Objective:** When a trade closes, save OBS replay and trim final clip.

**Files:**
- Modify: `/Users/igorarnautov/TradeClipper/src/trade_clipper/main.py`

Flow:

```text
closed_trade_event
  -> obs.save_replay_buffer()
  -> wait for new replay file
  -> ffprobe duration
  -> calculate offsets
  -> ffmpeg trim
  -> write JSON sidecar
  -> insert clip row in SQLite
```

Verification:

```bash
trade-clipper --dry-run-simulated-trade
```

Expected:
- simulated trade opens;
- simulated trade closes;
- OBS saves replay;
- final clipped file appears in `/Users/igorarnautov/TradeClips/clips/YYYY-MM-DD/`.

---

## Task 12: Add launchd autostart

**Objective:** Run trade-clipper automatically on Mac login.

**Files:**
- Create: `/Users/igorarnautov/Library/LaunchAgents/com.igor.tradeclipper.plist`

Expected command:

```bash
/Users/igorarnautov/TradeClipper/.venv/bin/trade-clipper
```

Logs:

```text
/Users/igorarnautov/TradeClips/logs/stdout.log
/Users/igorarnautov/TradeClips/logs/stderr.log
```

Commands:

```bash
launchctl load ~/Library/LaunchAgents/com.igor.tradeclipper.plist
launchctl start com.igor.tradeclipper
launchctl list | grep tradeclipper
```

---

## Implementation Notes

### Replay Buffer size

Since trades are usually up to 10 minutes, use 30 minutes replay buffer. This gives enough margin for:
- API delays;
- manual close delays;
- clock/timestamp offset;
- clip padding;
- OBS write latency.

### Exchange timestamps

Prefer exchange event timestamps for entry/exit. Also store local receive timestamp. If exchange timestamp is missing or suspicious, fallback to local timestamp.

### Multiple accounts/exchanges

Trade key should include:

```text
exchange + market_type + account_label + symbol
```

Example:

```text
binance:futures:main:BTCUSDT
okx:swap:main:BTC-USDT-SWAP
bybit:spot:main:ETHUSDT
```

### Filename format

```text
YYYY-MM-DD_HH-MM-SS_EXCHANGE_MARKET_SYMBOL_SIDE.mp4
```

Examples:

```text
2026-05-13_03-49-21_BINANCE_FUTURES_BTCUSDT_LONG.mp4
2026-05-13_04-12-03_OKX_SWAP_BTC-USDT-SWAP_SHORT.mp4
2026-05-13_05-01-44_BYBIT_SPOT_ETHUSDT_LONG.mp4
```

### API safety

Use read-only keys when possible:
- no withdrawals;
- no trading permissions;
- IP whitelist if exchange supports it.

### Later improvements

- Telegram notification after clip is ready.
- Web dashboard to browse clips.
- Import clip metadata into Obsidian/trading journal.
- Add screenshot thumbnail.
- Continuous recording mode for trades longer than Replay Buffer.
- Per-symbol whitelist.
- Manual hotkey to mark interesting moments during trade.
