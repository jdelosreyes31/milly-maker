"""
Ad-hoc integration test client for the Massive financial data API.

Usage:
    MASSIVE_API_KEY=<key> python tests/massive_test_client.py --action <action> [options]

    Or with a .env file:
        pipenv run python tests/massive_test_client.py --action <action> [options]

Actions:
    last-price          GET last known price for one or more tickers (requires --tickers or --ticker)
    market-status       GET /v1/marketstatus/now
    market-holidays     GET /v1/marketstatus/upcoming
    ticker-details      GET /v3/reference/tickers/{ticker}    (requires --ticker)
    list-tickers        GET /v3/reference/tickers             (optional --ticker, --search, --limit)
    snapshot            GET snapshot for a single ticker      (requires --ticker)
    full-snapshot       GET snapshot for multiple tickers     (optional --tickers, comma-separated)
    agg-bars            GET aggregate OHLCV bars              (requires --ticker, --from, --to; optional --multiplier, --timespan)
    prev-day            GET previous day bar                  (requires --ticker)
    daily-grouped       GET all tickers' bars for a date      (requires --date; optional --market)
    trades              GET tick-level trades                  (requires --ticker; optional --from, --to, --limit)
    quotes              GET NBBO quotes                        (requires --ticker; optional --from, --to, --limit)
    sma                 GET Simple Moving Average             (requires --ticker; optional --window, --timespan, --limit)
    ema                 GET Exponential Moving Average        (requires --ticker; optional --window, --timespan, --limit)
    rsi                 GET Relative Strength Index           (requires --ticker; optional --window, --timespan, --limit)
    macd                GET MACD indicator                    (requires --ticker; optional --timespan, --limit)

Environment variables:
    MASSIVE_API_KEY  — required
    MASSIVE_BASE_URL — optional override (default: https://api.massive.com)

Output:
    Each action writes JSON to output/massive_{action}_{timestamp}.json
"""

import sys
import os
import json
import argparse
from datetime import datetime, timezone
from typing import Any, Dict

from dotenv import load_dotenv
load_dotenv()

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.massive.client import MassiveClient

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "output")


def write_output(filename: str, data: Any) -> str:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    path = os.path.join(OUTPUT_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        if hasattr(data, "model_dump"):
            json.dump(data.model_dump(), f, indent=2, ensure_ascii=False)
        elif isinstance(data, list) and data and hasattr(data[0], "model_dump"):
            json.dump([item.model_dump() for item in data], f, indent=2, ensure_ascii=False)
        else:
            json.dump(data, f, indent=2, ensure_ascii=False, default=str)
    return path


def timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def print_response(label: str, data: Any) -> None:
    print(f"\n{'=' * 60}")
    print(f"  {label}")
    print(f"{'=' * 60}")
    if hasattr(data, "model_dump"):
        dumped = data.model_dump()
        print(json.dumps(dumped, indent=2, default=str))
        print(f"\n  Fields: {list(dumped.keys())}")
    elif isinstance(data, list):
        serialised = [
            item.model_dump() if hasattr(item, "model_dump") else item for item in data
        ]
        print(json.dumps(serialised[:5], indent=2, default=str))
        if len(data) > 5:
            print(f"  ... and {len(data) - 5} more")
    elif data is None:
        print("  (no data returned — check logs for details)")
    else:
        print(data)


def resolve_client() -> MassiveClient:
    api_key = os.getenv("MASSIVE_API_KEY")
    if not api_key:
        print("ERROR: MASSIVE_API_KEY environment variable is not set.")
        print("  Set it directly or add it to a .env file and load it before running.")
        sys.exit(1)
    return MassiveClient(api_key=api_key)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Massive API integration test client",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--action",
        required=True,
        choices=[
            "last-price",
            "market-status",
            "market-holidays",
            "ticker-details",
            "list-tickers",
            "snapshot",
            "full-snapshot",
            "agg-bars",
            "prev-day",
            "daily-grouped",
            "trades",
            "quotes",
            "sma",
            "ema",
            "rsi",
            "macd",
        ],
    )
    parser.add_argument("--ticker", help="Single ticker symbol (e.g. AAPL)")
    parser.add_argument(
        "--tickers", help="Comma-separated ticker symbols for full-snapshot (e.g. AAPL,MSFT,GOOG)"
    )
    parser.add_argument("--from", dest="from_date", help="Start date YYYY-MM-DD")
    parser.add_argument("--to", dest="to_date", help="End date YYYY-MM-DD")
    parser.add_argument("--date", help="Date for daily-grouped YYYY-MM-DD")
    parser.add_argument("--multiplier", type=int, default=1, help="Timespan multiplier (default 1)")
    parser.add_argument(
        "--timespan",
        default="day",
        choices=["second", "minute", "hour", "day", "week", "month", "quarter", "year"],
    )
    parser.add_argument("--market", default="stocks", help="Market for daily-grouped")
    parser.add_argument("--window", type=int, help="Indicator window (e.g. 14 for RSI, 50 for SMA)")
    parser.add_argument("--limit", type=int, default=10, help="Result limit (default 10)")
    parser.add_argument("--search", help="Free-text search for list-tickers")

    args = parser.parse_args()
    slug = timestamp_slug()

    print(f"Action          : {args.action}")
    print(f"Base URL        : {os.getenv('MASSIVE_BASE_URL', 'https://api.massive.com')}")
    print(f"Output dir      : {os.path.abspath(OUTPUT_DIR)}")

    with resolve_client() as client:

        if args.action == "last-price":
            raw = args.tickers or args.ticker
            if not raw:
                print("ERROR: --tickers (or --ticker) is required for last-price")
                sys.exit(1)
            ticker_list = [t.strip() for t in raw.split(",")]
            prices: Dict[str, Any] = {}
            for sym in ticker_list:
                resp = client.get_previous_day_bar(sym)
                if resp and resp.results:
                    bar = resp.results[0]
                    prices[sym] = {"price": bar.c, "open": bar.o, "high": bar.h, "low": bar.l, "volume": bar.v}
                else:
                    prices[sym] = {"price": None}
            print_response(f"Last Known Price — {', '.join(ticker_list)}", prices)
            out = write_output(f"massive_last_price_{slug}.json", prices)

        elif args.action == "market-status":
            data = client.get_market_status()
            print_response("Market Status", data)
            out = write_output(f"massive_market_status_{slug}.json", data)

        elif args.action == "market-holidays":
            data = client.get_market_holidays()
            print_response("Market Holidays", data)
            out = write_output(f"massive_market_holidays_{slug}.json", data)

        elif args.action == "ticker-details":
            if not args.ticker:
                print("ERROR: --ticker is required for ticker-details")
                sys.exit(1)
            data = client.get_ticker_details(args.ticker)
            print_response(f"Ticker Details — {args.ticker}", data)
            out = write_output(f"massive_ticker_details_{args.ticker}_{slug}.json", data)

        elif args.action == "list-tickers":
            data = client.list_tickers(
                ticker=args.ticker, search=args.search, limit=args.limit
            )
            print_response("Tickers", data)
            out = write_output(f"massive_list_tickers_{slug}.json", data)

        elif args.action == "snapshot":
            if not args.ticker:
                print("ERROR: --ticker is required for snapshot")
                sys.exit(1)
            data = client.get_ticker_snapshot(args.ticker)
            print_response(f"Snapshot — {args.ticker}", data)
            out = write_output(f"massive_snapshot_{args.ticker}_{slug}.json", data)

        elif args.action == "full-snapshot":
            tickers = args.tickers.split(",") if args.tickers else None
            data = client.get_full_snapshot(tickers=tickers)
            print_response("Full Snapshot", data)
            out = write_output(f"massive_full_snapshot_{slug}.json", data)

        elif args.action == "agg-bars":
            for required, name in [
                (args.ticker, "--ticker"),
                (args.from_date, "--from"),
                (args.to_date, "--to"),
            ]:
                if not required:
                    print(f"ERROR: {name} is required for agg-bars")
                    sys.exit(1)
            data = client.get_aggregate_bars(
                ticker=args.ticker,
                multiplier=args.multiplier,
                timespan=args.timespan,
                from_date=args.from_date,
                to_date=args.to_date,
                limit=args.limit,
            )
            print_response(f"Aggregate Bars — {args.ticker}", data)
            out = write_output(f"massive_agg_bars_{args.ticker}_{slug}.json", data)

        elif args.action == "prev-day":
            if not args.ticker:
                print("ERROR: --ticker is required for prev-day")
                sys.exit(1)
            data = client.get_previous_day_bar(args.ticker)
            print_response(f"Previous Day Bar — {args.ticker}", data)
            out = write_output(f"massive_prev_day_{args.ticker}_{slug}.json", data)

        elif args.action == "daily-grouped":
            if not args.date:
                print("ERROR: --date is required for daily-grouped")
                sys.exit(1)
            data = client.get_daily_grouped_bars(date=args.date, market=args.market)
            print_response(f"Daily Grouped — {args.date}", data)
            out = write_output(f"massive_daily_grouped_{args.date}_{slug}.json", data)

        elif args.action == "trades":
            if not args.ticker:
                print("ERROR: --ticker is required for trades")
                sys.exit(1)
            data = client.get_trades(
                ticker=args.ticker,
                timestamp_gte=args.from_date,
                timestamp_lte=args.to_date,
                limit=args.limit,
            )
            print_response(f"Trades — {args.ticker}", data)
            out = write_output(f"massive_trades_{args.ticker}_{slug}.json", data)

        elif args.action == "quotes":
            if not args.ticker:
                print("ERROR: --ticker is required for quotes")
                sys.exit(1)
            data = client.get_quotes(
                ticker=args.ticker,
                timestamp_gte=args.from_date,
                timestamp_lte=args.to_date,
                limit=args.limit,
            )
            print_response(f"Quotes — {args.ticker}", data)
            out = write_output(f"massive_quotes_{args.ticker}_{slug}.json", data)

        elif args.action == "sma":
            if not args.ticker:
                print("ERROR: --ticker is required for sma")
                sys.exit(1)
            data = client.get_sma(
                ticker=args.ticker,
                timespan=args.timespan,
                window=args.window or 50,
                limit=args.limit,
            )
            print_response(f"SMA — {args.ticker}", data)
            out = write_output(f"massive_sma_{args.ticker}_{slug}.json", data)

        elif args.action == "ema":
            if not args.ticker:
                print("ERROR: --ticker is required for ema")
                sys.exit(1)
            data = client.get_ema(
                ticker=args.ticker,
                timespan=args.timespan,
                window=args.window or 50,
                limit=args.limit,
            )
            print_response(f"EMA — {args.ticker}", data)
            out = write_output(f"massive_ema_{args.ticker}_{slug}.json", data)

        elif args.action == "rsi":
            if not args.ticker:
                print("ERROR: --ticker is required for rsi")
                sys.exit(1)
            data = client.get_rsi(
                ticker=args.ticker,
                timespan=args.timespan,
                window=args.window or 14,
                limit=args.limit,
            )
            print_response(f"RSI — {args.ticker}", data)
            out = write_output(f"massive_rsi_{args.ticker}_{slug}.json", data)

        elif args.action == "macd":
            if not args.ticker:
                print("ERROR: --ticker is required for macd")
                sys.exit(1)
            data = client.get_macd(
                ticker=args.ticker,
                timespan=args.timespan,
                limit=args.limit,
            )
            print_response(f"MACD — {args.ticker}", data)
            out = write_output(f"massive_macd_{args.ticker}_{slug}.json", data)

        else:
            print(f"ERROR: Unknown action '{args.action}'")
            sys.exit(1)

        print(f"\n  Written → {out}")


if __name__ == "__main__":
    main()
