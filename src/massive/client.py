import os
import logging
from typing import Optional, Dict, Any, List, Type, TypeVar
from requests import Session
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from src.massive.models import (
    AggregateResponse,
    DailyGroupedResponse,
    PreviousDayResponse,
    SingleTickerSnapshotResponse,
    FullSnapshotResponse,
    TradesResponse,
    QuotesResponse,
    TickerDetailsResponse,
    TickersResponse,
    MarketStatusResponse,
    MarketHoliday,
    IndicatorResponse,
    MACDResponse,
    PaginatedResponse,
)

logger = logging.getLogger(__name__)

T = TypeVar("T")

BASE_URL = "https://api.massive.com"


class MassiveClient:
    """
    Client for the Massive financial data REST API.

    Handles authentication via Bearer token, connection pooling, and
    exponential-backoff retries on transient failures.

    Usage:
        with MassiveClient() as client:
            resp = client.get_aggregate_bars("AAPL", 1, "day", "2024-01-01", "2024-12-31")

    Environment variables:
        MASSIVE_API_KEY  — API key (required if not passed directly)
        MASSIVE_BASE_URL — Override the default base URL
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        connect_timeout: int = 10,
        read_timeout: int = 30,
        max_retries: int = 3,
    ) -> None:
        """
        Args:
            api_key: Massive API key. Falls back to MASSIVE_API_KEY env var.
            base_url: Override API base URL. Falls back to MASSIVE_BASE_URL env var,
                      then https://api.massive.com.
            connect_timeout: Seconds to wait for connection.
            read_timeout: Seconds to wait for response data.
            max_retries: Max retry attempts on transient failures (429, 5xx).

        Raises:
            ValueError: If no API key is available.
        """
        resolved_key = api_key or os.getenv("MASSIVE_API_KEY", "")
        if not resolved_key:
            raise ValueError(
                "api_key must be provided or MASSIVE_API_KEY environment variable must be set"
            )
        self.api_key = resolved_key
        self.base_url = (base_url or os.getenv("MASSIVE_BASE_URL", BASE_URL)).rstrip("/")
        self.timeout = (connect_timeout, read_timeout)

        self.session = Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {self.api_key}",
                "Accept": "application/json",
            }
        )

        retry_strategy = Retry(
            total=max_retries,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET"],
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)

        logger.info(
            "MassiveClient initialized",
            extra={"base_url": self.base_url, "max_retries": max_retries},
        )

    # ── Internal request helper ───────────────────────────────────────────────

    def _get(
        self,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        model: Optional[Type[T]] = None,
    ) -> Optional[Any]:
        """
        Execute a GET request and optionally parse the response into a model.

        Args:
            path: URL path, e.g. "/v2/aggs/ticker/AAPL/range/1/day/2024-01-01/2024-12-31"
            params: Query string parameters.
            model: Pydantic model class to parse the response into. If None,
                   returns the raw dict.

        Returns:
            Parsed model instance, raw dict, or None on failure.
        """
        url = f"{self.base_url}{path}"
        # Strip None values so they don't appear as "None" strings in the query
        clean_params = {k: v for k, v in (params or {}).items() if v is not None}

        try:
            response = self.session.get(url, params=clean_params, timeout=self.timeout)
        except Exception as exc:
            logger.error("Request exception", extra={"url": url, "error": str(exc)})
            return None

        if response.status_code == 200:
            try:
                data = response.json()
            except ValueError as exc:
                logger.error("Invalid JSON", extra={"url": url, "error": str(exc)})
                return None

            if model is not None:
                return model(**data)
            return data

        if response.status_code == 403:
            logger.error("Forbidden — check API key or plan permissions", extra={"url": url})
        elif response.status_code == 404:
            logger.warning("Not found", extra={"url": url})
        else:
            logger.error(
                "Request failed",
                extra={
                    "url": url,
                    "status_code": response.status_code,
                    "body": response.text[:500],
                },
            )
        return None

    # ── Aggregates ────────────────────────────────────────────────────────────

    def get_aggregate_bars(
        self,
        ticker: str,
        multiplier: int,
        timespan: str,
        from_date: str,
        to_date: str,
        adjusted: bool = True,
        sort: str = "asc",
        limit: int = 5000,
    ) -> Optional[AggregateResponse]:
        """
        Custom OHLCV bars for any ticker.

        Args:
            ticker: Ticker symbol (e.g. "AAPL", "X:BTCUSD").
            multiplier: Timespan multiplier (e.g. 1 for "1 day").
            timespan: "second" | "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year"
            from_date: Start date "YYYY-MM-DD" or millisecond timestamp.
            to_date: End date "YYYY-MM-DD" or millisecond timestamp.
            adjusted: Include split adjustments.
            sort: "asc" (oldest first) or "desc".
            limit: Max bars returned (up to 50,000).
        """
        path = f"/v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from_date}/{to_date}"
        return self._get(
            path,
            params={"adjusted": str(adjusted).lower(), "sort": sort, "limit": limit},
            model=AggregateResponse,
        )

    def get_daily_grouped_bars(
        self,
        date: str,
        locale: str = "us",
        market: str = "stocks",
        adjusted: bool = True,
    ) -> Optional[DailyGroupedResponse]:
        """
        All tickers' OHLCV for a single market day.

        Args:
            date: "YYYY-MM-DD"
            locale: "us" | "global"
            market: "stocks" | "crypto" | "forex" | "otc" | "indices"
            adjusted: Include split adjustments.
        """
        path = f"/v2/aggs/grouped/locale/{locale}/market/{market}/{date}"
        return self._get(
            path, params={"adjusted": str(adjusted).lower()}, model=DailyGroupedResponse
        )

    def get_previous_day_bar(
        self, ticker: str, adjusted: bool = True
    ) -> Optional[PreviousDayResponse]:
        """Previous day's OHLCV for a ticker."""
        path = f"/v2/aggs/ticker/{ticker}/prev"
        return self._get(
            path, params={"adjusted": str(adjusted).lower()}, model=PreviousDayResponse
        )

    # ── Snapshots ─────────────────────────────────────────────────────────────

    def get_ticker_snapshot(self, ticker: str) -> Optional[SingleTickerSnapshotResponse]:
        """Real-time snapshot for a single stock ticker."""
        path = f"/v2/snapshot/locale/us/markets/stocks/tickers/{ticker}"
        return self._get(path, model=SingleTickerSnapshotResponse)

    def get_full_snapshot(
        self, tickers: Optional[List[str]] = None
    ) -> Optional[FullSnapshotResponse]:
        """
        Real-time snapshot for multiple tickers (or all if tickers is None).

        Args:
            tickers: Optional list of ticker symbols to filter by.
        """
        path = "/v2/snapshot/locale/us/markets/stocks/tickers"
        params: Dict[str, Any] = {}
        if tickers:
            params["tickers"] = ",".join(tickers)
        return self._get(path, params=params, model=FullSnapshotResponse)

    # ── Trades & Quotes ───────────────────────────────────────────────────────

    def get_trades(
        self,
        ticker: str,
        timestamp_gte: Optional[str] = None,
        timestamp_lte: Optional[str] = None,
        limit: int = 1000,
        sort: str = "timestamp",
        order: str = "asc",
    ) -> Optional[TradesResponse]:
        """
        Tick-level trade history for a ticker.

        Args:
            ticker: Ticker symbol.
            timestamp_gte: Start timestamp (nanoseconds or "YYYY-MM-DD").
            timestamp_lte: End timestamp.
            limit: Max results (up to 50,000).
            sort: Field to sort by.
            order: "asc" or "desc".
        """
        path = f"/v3/trades/{ticker}"
        return self._get(
            path,
            params={
                "timestamp.gte": timestamp_gte,
                "timestamp.lte": timestamp_lte,
                "limit": limit,
                "sort": sort,
                "order": order,
            },
            model=TradesResponse,
        )

    def get_quotes(
        self,
        ticker: str,
        timestamp_gte: Optional[str] = None,
        timestamp_lte: Optional[str] = None,
        limit: int = 1000,
        sort: str = "timestamp",
        order: str = "asc",
    ) -> Optional[QuotesResponse]:
        """
        NBBO quote history for a ticker.

        Args:
            ticker: Ticker symbol.
            timestamp_gte: Start timestamp (nanoseconds or "YYYY-MM-DD").
            timestamp_lte: End timestamp.
            limit: Max results.
            sort: Field to sort by.
            order: "asc" or "desc".
        """
        path = f"/v3/quotes/{ticker}"
        return self._get(
            path,
            params={
                "timestamp.gte": timestamp_gte,
                "timestamp.lte": timestamp_lte,
                "limit": limit,
                "sort": sort,
                "order": order,
            },
            model=QuotesResponse,
        )

    # ── Reference data ────────────────────────────────────────────────────────

    def get_ticker_details(self, ticker: str) -> Optional[TickerDetailsResponse]:
        """Company / instrument reference data for a ticker."""
        path = f"/v3/reference/tickers/{ticker}"
        return self._get(path, model=TickerDetailsResponse)

    def list_tickers(
        self,
        ticker: Optional[str] = None,
        ticker_type: Optional[str] = None,
        market: Optional[str] = None,
        exchange: Optional[str] = None,
        active: Optional[bool] = None,
        search: Optional[str] = None,
        limit: int = 100,
    ) -> Optional[TickersResponse]:
        """
        List / search reference tickers.

        Args:
            ticker: Exact ticker symbol or prefix.
            ticker_type: "CS" (common stock) | "ETF" | "WARRANT" | etc.
            market: "stocks" | "crypto" | "forex" | "indices".
            exchange: Exchange MIC code.
            active: Filter by active status.
            search: Free-text search.
            limit: Results per page (max 1000).
        """
        path = "/v3/reference/tickers"
        return self._get(
            path,
            params={
                "ticker": ticker,
                "type": ticker_type,
                "market": market,
                "exchange": exchange,
                "active": None if active is None else str(active).lower(),
                "search": search,
                "limit": limit,
            },
            model=TickersResponse,
        )

    # ── Market status ─────────────────────────────────────────────────────────

    def get_market_status(self) -> Optional[MarketStatusResponse]:
        """Current trading session status for all markets."""
        return self._get("/v1/marketstatus/now", model=MarketStatusResponse)

    def get_market_holidays(self) -> Optional[List[MarketHoliday]]:
        """Upcoming market holidays and early-close schedule."""
        data = self._get("/v1/marketstatus/upcoming")
        if data is None:
            return None
        if isinstance(data, list):
            return [MarketHoliday(**item) for item in data]
        return None

    # ── Technical indicators ──────────────────────────────────────────────────

    def _indicator_get(
        self,
        asset_class: str,
        indicator: str,
        ticker: str,
        timespan: str = "day",
        adjusted: bool = True,
        window: Optional[int] = None,
        series_type: str = "close",
        limit: int = 10,
        order: str = "desc",
        model: Optional[Any] = None,
    ) -> Optional[Any]:
        path = f"/v1/indicators/{indicator}/{ticker}"
        params: Dict[str, Any] = {
            "timespan": timespan,
            "adjusted": str(adjusted).lower(),
            "series_type": series_type,
            "limit": limit,
            "order": order,
        }
        if window is not None:
            params["window"] = window
        return self._get(path, params=params, model=model)

    def get_sma(
        self,
        ticker: str,
        timespan: str = "day",
        window: int = 50,
        series_type: str = "close",
        limit: int = 10,
        order: str = "desc",
    ) -> Optional[IndicatorResponse]:
        """Simple Moving Average."""
        return self._indicator_get(
            "stocks", "sma", ticker,
            timespan=timespan, window=window,
            series_type=series_type, limit=limit, order=order,
            model=IndicatorResponse,
        )

    def get_ema(
        self,
        ticker: str,
        timespan: str = "day",
        window: int = 50,
        series_type: str = "close",
        limit: int = 10,
        order: str = "desc",
    ) -> Optional[IndicatorResponse]:
        """Exponential Moving Average."""
        return self._indicator_get(
            "stocks", "ema", ticker,
            timespan=timespan, window=window,
            series_type=series_type, limit=limit, order=order,
            model=IndicatorResponse,
        )

    def get_rsi(
        self,
        ticker: str,
        timespan: str = "day",
        window: int = 14,
        series_type: str = "close",
        limit: int = 10,
        order: str = "desc",
    ) -> Optional[IndicatorResponse]:
        """Relative Strength Index."""
        return self._indicator_get(
            "stocks", "rsi", ticker,
            timespan=timespan, window=window,
            series_type=series_type, limit=limit, order=order,
            model=IndicatorResponse,
        )

    def get_macd(
        self,
        ticker: str,
        timespan: str = "day",
        short_window: int = 12,
        long_window: int = 26,
        signal_window: int = 9,
        series_type: str = "close",
        limit: int = 10,
        order: str = "desc",
    ) -> Optional[MACDResponse]:
        """MACD indicator."""
        path = f"/v1/indicators/macd/{ticker}"
        return self._get(
            path,
            params={
                "timespan": timespan,
                "short_window": short_window,
                "long_window": long_window,
                "signal_window": signal_window,
                "series_type": series_type,
                "limit": limit,
                "order": order,
            },
            model=MACDResponse,
        )

    # ── Pagination helper ─────────────────────────────────────────────────────

    def paginate(self, next_url: str) -> Optional[PaginatedResponse]:
        """
        Follow a next_url cursor returned by any paginated endpoint.

        Args:
            next_url: The `next_url` value from a previous response.

        Returns:
            PaginatedResponse with raw results dict list, or None on failure.
        """
        # next_url is already fully qualified; strip the base to use _get safely
        if next_url.startswith(self.base_url):
            path = next_url[len(self.base_url):]
            return self._get(path, model=PaginatedResponse)
        # Fallback: fetch directly without session params
        try:
            response = self.session.get(next_url, timeout=self.timeout)
            if response.status_code == 200:
                return PaginatedResponse(**response.json())
        except Exception as exc:
            logger.error("Pagination request failed", extra={"url": next_url, "error": str(exc)})
        return None

    # ── Context manager ───────────────────────────────────────────────────────

    def close(self) -> None:
        self.session.close()
        logger.info("MassiveClient session closed")

    def __enter__(self) -> "MassiveClient":
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.close()
