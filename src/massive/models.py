# mypy: disallow-subclassing-any=False
from pydantic import BaseModel
from typing import Optional, List, Any, Dict


# ── Aggregate / OHLC ─────────────────────────────────────────────────────────

class AggregateBar(BaseModel):
    """Single OHLC bar result."""

    c: float  # close
    h: float  # high
    l: float  # low
    o: float  # open
    v: float  # volume
    vw: Optional[float] = None  # volume-weighted average price
    n: Optional[int] = None  # number of transactions
    t: int  # Unix millisecond timestamp
    otc: Optional[bool] = None


class AggregateResponse(BaseModel):
    """Response from /v2/aggs/ticker/{ticker}/range/... endpoints."""

    ticker: str
    adjusted: Optional[bool] = None
    queryCount: Optional[int] = None
    resultsCount: Optional[int] = None
    status: str
    request_id: str
    results: Optional[List[AggregateBar]] = None
    next_url: Optional[str] = None


class DailyGroupedBar(BaseModel):
    """Bar within a grouped daily response."""

    T: str  # ticker symbol
    c: float
    h: float
    l: float
    o: float
    v: float
    vw: Optional[float] = None
    n: Optional[int] = None
    t: int
    otc: Optional[bool] = None


class DailyGroupedResponse(BaseModel):
    """Response from /v2/aggs/grouped/locale/.../market/.../{date}."""

    adjusted: Optional[bool] = None
    queryCount: Optional[int] = None
    resultsCount: Optional[int] = None
    status: str
    request_id: str
    results: Optional[List[DailyGroupedBar]] = None


class PreviousDayBar(BaseModel):
    """Bar within a previous-day response."""

    T: Optional[str] = None  # ticker (may be absent on some asset classes)
    c: float
    h: float
    l: float
    o: float
    v: float
    vw: Optional[float] = None
    n: Optional[int] = None
    t: int


class PreviousDayResponse(BaseModel):
    """Response from /v2/aggs/ticker/{ticker}/prev."""

    ticker: str
    adjusted: Optional[bool] = None
    queryCount: Optional[int] = None
    resultsCount: Optional[int] = None
    status: str
    request_id: str
    results: Optional[List[PreviousDayBar]] = None


# ── Snapshots ────────────────────────────────────────────────────────────────

class DayBar(BaseModel):
    c: Optional[float] = None
    h: Optional[float] = None
    l: Optional[float] = None
    o: Optional[float] = None
    v: Optional[float] = None
    vw: Optional[float] = None


class LastQuote(BaseModel):
    P: Optional[float] = None  # ask price
    S: Optional[int] = None   # ask size
    p: Optional[float] = None  # bid price
    s: Optional[int] = None   # bid size
    t: Optional[int] = None   # timestamp


class LastTrade(BaseModel):
    c: Optional[List[int]] = None  # conditions
    i: Optional[str] = None        # trade ID
    p: Optional[float] = None      # price
    s: Optional[int] = None        # size
    t: Optional[int] = None        # timestamp
    x: Optional[int] = None        # exchange ID


class TickerSnapshot(BaseModel):
    day: Optional[DayBar] = None
    fmv: Optional[float] = None  # fair market value (Business plan)
    lastQuote: Optional[LastQuote] = None
    lastTrade: Optional[LastTrade] = None
    min: Optional[DayBar] = None
    prevDay: Optional[DayBar] = None
    ticker: Optional[str] = None
    todaysChange: Optional[float] = None
    todaysChangePerc: Optional[float] = None
    updated: Optional[int] = None


class SingleTickerSnapshotResponse(BaseModel):
    """Response from /v2/snapshot/locale/us/markets/stocks/tickers/{ticker}."""

    status: str
    request_id: str
    ticker: Optional[TickerSnapshot] = None


class FullSnapshotResponse(BaseModel):
    """Response from /v2/snapshot/locale/us/markets/stocks/tickers."""

    status: str
    request_id: str
    tickers: Optional[List[TickerSnapshot]] = None
    next_url: Optional[str] = None


# ── Trades ───────────────────────────────────────────────────────────────────

class TradeResult(BaseModel):
    conditions: Optional[List[int]] = None
    correction: Optional[int] = None
    exchange: Optional[int] = None
    id: Optional[str] = None
    participant_timestamp: Optional[int] = None
    price: Optional[float] = None
    sequence_number: Optional[int] = None
    sip_timestamp: Optional[int] = None
    size: Optional[float] = None
    tape: Optional[int] = None
    trf_id: Optional[int] = None
    trf_timestamp: Optional[int] = None


class TradesResponse(BaseModel):
    """Response from /v3/trades/{ticker}."""

    results: Optional[List[TradeResult]] = None
    status: str
    request_id: str
    next_url: Optional[str] = None


# ── Quotes ───────────────────────────────────────────────────────────────────

class QuoteResult(BaseModel):
    ask_exchange: Optional[int] = None
    ask_price: Optional[float] = None
    ask_size: Optional[float] = None
    bid_exchange: Optional[int] = None
    bid_price: Optional[float] = None
    bid_size: Optional[float] = None
    conditions: Optional[List[int]] = None
    indicators: Optional[List[int]] = None
    participant_timestamp: Optional[int] = None
    sequence_number: Optional[int] = None
    sip_timestamp: Optional[int] = None
    tape: Optional[int] = None
    trf_timestamp: Optional[int] = None


class QuotesResponse(BaseModel):
    """Response from /v3/quotes/{ticker}."""

    results: Optional[List[QuoteResult]] = None
    status: str
    request_id: str
    next_url: Optional[str] = None


# ── Reference / Tickers ──────────────────────────────────────────────────────

class Branding(BaseModel):
    icon_url: Optional[str] = None
    logo_url: Optional[str] = None


class TickerAddress(BaseModel):
    address1: Optional[str] = None
    city: Optional[str] = None
    postal_code: Optional[str] = None
    state: Optional[str] = None


class TickerDetails(BaseModel):
    active: Optional[bool] = None
    address: Optional[TickerAddress] = None
    branding: Optional[Branding] = None
    cik: Optional[str] = None
    composite_figi: Optional[str] = None
    currency_name: Optional[str] = None
    description: Optional[str] = None
    homepage_url: Optional[str] = None
    list_date: Optional[str] = None
    locale: Optional[str] = None
    market: Optional[str] = None
    market_cap: Optional[float] = None
    name: Optional[str] = None
    phone_number: Optional[str] = None
    primary_exchange: Optional[str] = None
    round_lot: Optional[int] = None
    share_class_figi: Optional[str] = None
    share_class_shares_outstanding: Optional[float] = None
    sic_code: Optional[str] = None
    sic_description: Optional[str] = None
    ticker: Optional[str] = None
    ticker_root: Optional[str] = None
    total_employees: Optional[int] = None
    type: Optional[str] = None
    weighted_shares_outstanding: Optional[float] = None


class TickerDetailsResponse(BaseModel):
    """Response from /v3/reference/tickers/{ticker}."""

    results: Optional[TickerDetails] = None
    status: str
    request_id: str


class TickerResult(BaseModel):
    active: Optional[bool] = None
    cik: Optional[str] = None
    composite_figi: Optional[str] = None
    currency_name: Optional[str] = None
    last_updated_utc: Optional[str] = None
    locale: Optional[str] = None
    market: Optional[str] = None
    name: Optional[str] = None
    primary_exchange: Optional[str] = None
    share_class_figi: Optional[str] = None
    ticker: Optional[str] = None
    type: Optional[str] = None


class TickersResponse(BaseModel):
    """Response from /v3/reference/tickers."""

    results: Optional[List[TickerResult]] = None
    status: str
    request_id: str
    next_url: Optional[str] = None
    count: Optional[int] = None


# ── Market Status / Holidays ─────────────────────────────────────────────────

class ExchangeStatus(BaseModel):
    nyse: Optional[str] = None
    nasdaq: Optional[str] = None
    otc: Optional[str] = None


class MarketStatusResponse(BaseModel):
    """Response from /v1/marketstatus/now."""

    afterHours: Optional[bool] = None
    currencies: Optional[Dict[str, str]] = None
    earlyHours: Optional[bool] = None
    exchanges: Optional[ExchangeStatus] = None
    market: Optional[str] = None
    serverTime: Optional[str] = None


class MarketHoliday(BaseModel):
    close: Optional[str] = None
    date: Optional[str] = None
    exchange: Optional[str] = None
    name: Optional[str] = None
    open: Optional[str] = None
    status: Optional[str] = None


# ── Technical Indicators ─────────────────────────────────────────────────────

class IndicatorValue(BaseModel):
    timestamp: int
    value: float


class MACDValue(BaseModel):
    histogram: float
    macd: float
    signal: float
    timestamp: int


class IndicatorUnderlying(BaseModel):
    aggregates: Optional[List[AggregateBar]] = None
    url: Optional[str] = None


class IndicatorResults(BaseModel):
    underlying: Optional[IndicatorUnderlying] = None
    values: Optional[List[IndicatorValue]] = None


class MACDResults(BaseModel):
    underlying: Optional[IndicatorUnderlying] = None
    values: Optional[List[MACDValue]] = None


class IndicatorResponse(BaseModel):
    """Response from EMA / RSI / SMA indicator endpoints."""

    results: Optional[IndicatorResults] = None
    status: str
    request_id: str
    next_url: Optional[str] = None


class MACDResponse(BaseModel):
    """Response from MACD indicator endpoint."""

    results: Optional[MACDResults] = None
    status: str
    request_id: str
    next_url: Optional[str] = None


# ── Generic paginated response ────────────────────────────────────────────────

class PaginatedResponse(BaseModel):
    """Fallback for any paginated endpoint not covered by a specific model."""

    results: Optional[List[Dict[str, Any]]] = None
    status: Optional[str] = None
    request_id: Optional[str] = None
    next_url: Optional[str] = None
    count: Optional[int] = None
