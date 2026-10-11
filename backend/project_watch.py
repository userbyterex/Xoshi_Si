"""Fail-closed discovery of DeFi projects with source-linked, point-in-time checks.

Data source: DeFiLlama public protocol API. Token and rug-pull checks: GoPlus
public APIs. A passing screen is not proof that a project is safe or rug-proof.
"""

import asyncio
import os
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import httpx

DEFILLAMA_PROTOCOLS_URL = "https://api.llama.fi/protocols"
DEFILLAMA_PROTOCOL_URL = "https://defillama.com/protocol/{}"
GOPLUS_BASE_URL = "https://api.gopluslabs.io/api/v1"

# Map only chain labels explicitly screened by the matching provider pair.
CHAIN_IDS = {
    "Ethereum": "1",
    "BSC": "56",
    "Arbitrum": "42161",
    "Polygon": "137",
    "Base": "8453",
    "Optimism": "10",
    "Avalanche": "43114",
    "Fantom": "250",
    "Gnosis": "100",
    "zkSync Era": "324",
    "Linea": "59144",
    "Scroll": "534352",
    "Mantle": "5000",
    "Berachain": "80094",
    "Sonic": "146",
    "Solana": "solana",
}

# These fields must be explicitly returned as clear by GoPlus. Missing or
# unknown values block consideration; a scanner outage never means "safe".
TOKEN_CLEAR_FLAGS = (
    "is_honeypot",
    "is_open_source",
    "is_proxy",
    "is_mintable",
    "is_blacklisted",
    "can_take_back_ownership",
    "owner_change_balance",
    "hidden_owner",
    "selfdestruct",
    "cannot_sell_all",
    "cannot_buy",
    "slippage_modifiable",
    "personal_slippage_modifiable",
    "transfer_pausable",
)
RUG_CLEAR_FLAGS = {
    "privilege_withdraw": "0",
    "withdraw_missing": "0",
    "is_open_source": "1",
    "blacklist": "0",
    "selfdestruct": "0",
    "approval_abuse": "0",
}

MIN_TVL_USD = float(os.getenv("PROJECT_MIN_TVL_USD", "25000000"))
MIN_DEX_LIQUIDITY_USD = float(os.getenv("PROJECT_MIN_DEX_LIQUIDITY_USD", "250000"))
MAX_EVM_CANDIDATES_TO_SCAN = 10
MAX_SOLANA_CANDIDATES_TO_SCAN = 8
MAX_PUBLISHED_CANDIDATES = 3


@dataclass(frozen=True)
class VerifiedProject:
    name: str
    symbol: str
    chain: str
    chain_id: str
    slug: str
    address: str
    category: str
    tvl_usd: float
    change_7d_pct: float
    dex_liquidity_usd: float
    verified_at: str
    sources: dict[str, str]
    security_disclaimer: str = (
        "Point-in-time automated checks found no reported flags; this does not "
        "prove safety or rule out a rug pull."
    )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _finite_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and abs(number) != float("inf") else None


def _flag_is(value: Any, expected: str) -> bool:
    if value is None:
        return False
    return str(value).strip().lower() == expected


def _contract_record(response: Any, address: str) -> dict[str, Any] | None:
    if not isinstance(response, dict) or str(response.get("code")) != "1":
        return None
    result = response.get("result")
    if not isinstance(result, dict):
        return None
    record = result.get(address.lower()) or result.get(address)
    return record if isinstance(record, dict) and record else None


def _protocol_candidate(protocol: Any) -> dict[str, Any] | None:
    if not isinstance(protocol, dict):
        return None

    name = str(protocol.get("name") or "").strip()
    slug = str(protocol.get("slug") or "").strip()
    chain = str(protocol.get("chain") or "").strip()
    address = str(protocol.get("address") or "").strip()
    symbol = str(protocol.get("symbol") or "").strip()
    tvl = _finite_number(protocol.get("tvl"))
    change_7d = _finite_number(protocol.get("change_7d"))
    chain_id = CHAIN_IDS.get(chain)
    if chain == "Solana" and address.startswith("solana:"):
        address = address.split(":", 1)[1]

    # Exclude multichain/unknown chains, missing contracts, malformed upstream
    # data, projects without current TVL, and flat/declining 7-day TVL.
    if not name or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", slug.lower()):
        return None
    if not chain_id:
        return None
    if chain == "Solana":
        valid_address = bool(re.fullmatch(r"[1-9A-HJ-NP-Za-km-z]{32,44}", address))
    else:
        valid_address = bool(re.fullmatch(r"0x[a-fA-F0-9]{40}", address))
    if not valid_address:
        return None
    if not symbol or not re.fullmatch(r"[A-Za-z0-9]{1,16}", symbol):
        return None
    if tvl is None or tvl < MIN_TVL_USD or change_7d is None or change_7d <= 0:
        return None

    return {
        "name": name,
        "slug": slug,
        "chain": chain,
        "chain_id": chain_id,
        "address": address,
        "symbol": symbol.upper(),
        "category": str(protocol.get("category") or "DeFi"),
        "tvl_usd": tvl,
        "change_7d_pct": change_7d,
    }


def _goplus_token_passes(response: Any, address: str) -> tuple[bool, dict[str, Any] | None]:
    record = _contract_record(response, address)
    if not record:
        return False, None

    # Require explicit, source-reported results for the key token-risk signals.
    for field in TOKEN_CLEAR_FLAGS:
        expected = "1" if field == "is_open_source" else "0"
        if not _flag_is(record.get(field), expected):
            return False, None

    # Trading must be observed and both taxes must be known and modest.
    if not _flag_is(record.get("is_in_dex"), "1"):
        return False, None
    buy_tax = _finite_number(record.get("buy_tax"))
    sell_tax = _finite_number(record.get("sell_tax"))
    if buy_tax is None or sell_tax is None or buy_tax > 0.05 or sell_tax > 0.05:
        return False, None

    # Require a reported meaningful pool; unknown liquidity is not treated as safe.
    pools = record.get("dex")
    if not isinstance(pools, list) or not pools:
        return False, None
    liquidity_values = [_finite_number(pool.get("liquidity")) for pool in pools if isinstance(pool, dict)]
    liquidity = sum(value for value in liquidity_values if value is not None)
    if liquidity < MIN_DEX_LIQUIDITY_USD:
        return False, None

    return True, {"dex_liquidity_usd": liquidity}


def _goplus_rug_passes(response: Any, address: str) -> bool:
    if not isinstance(response, dict) or str(response.get("code")) != "1":
        return False
    result = response.get("result")
    if not isinstance(result, dict) or not result:
        return False
    # The documented rug-pull endpoint returns one direct object for a single
    # queried address, while some wrappers expose an address-keyed object.
    record = result.get(address.lower()) or result.get(address)
    if not isinstance(record, dict) or not record:
        record = result if any(field in result for field in RUG_CLEAR_FLAGS) else None
    if not record:
        return False
    # This endpoint is beta. A missing/unknown result is an abstention, not a pass.
    return all(_flag_is(record.get(field), expected) for field, expected in RUG_CLEAR_FLAGS.items())


SOLANA_CLEAR_STATUS_FIELDS = (
    "mintable",
    "freezable",
    "closable",
    "balance_mutable_authority",
    "default_account_state_upgradable",
    "transfer_fee_upgradable",
    "transfer_hook_upgradable",
)


def _goplus_solana_passes(response: Any, mint: str) -> tuple[bool, dict[str, Any] | None]:
    if not isinstance(response, dict) or str(response.get("code")) != "1":
        return False, None
    result = response.get("result")
    record = result.get(mint) if isinstance(result, dict) else None
    if not isinstance(record, dict) or not record:
        return False, None

    for field in SOLANA_CLEAR_STATUS_FIELDS:
        flag = record.get(field)
        if not isinstance(flag, dict) or not _flag_is(flag.get("status"), "0"):
            return False, None
    # Reject custom transfer hooks and any creator explicitly flagged malicious.
    transfer_hook = record.get("transfer_hook")
    if not isinstance(transfer_hook, list) or transfer_hook:
        return False, None
    creators = record.get("creators")
    if not isinstance(creators, list):
        return False, None
    if any(not isinstance(creator, dict) or not _flag_is(creator.get("malicious_address"), "0") for creator in creators):
        return False, None

    pools = record.get("dex")
    if not isinstance(pools, list) or not pools:
        return False, None
    liquidity_values = [_finite_number(pool.get("tvl")) for pool in pools if isinstance(pool, dict)]
    liquidity = sum(value for value in liquidity_values if value is not None)
    if liquidity < MIN_DEX_LIQUIDITY_USD:
        return False, None

    holders = record.get("holders")
    if not isinstance(holders, list) or not holders:
        return False, None
    concentration = [_finite_number(holder.get("percent")) for holder in holders if isinstance(holder, dict)]
    if len(concentration) != len(holders) or any(value is None or value < 0 for value in concentration):
        return False, None
    top_holders_pct = sum(value for value in concentration if value is not None)
    if top_holders_pct == 0:
        return False, None
    if top_holders_pct > 1:
        top_holders_pct /= 100
    if top_holders_pct > 0.50:
        return False, None

    return True, {"dex_liquidity_usd": liquidity}


def _rugcheck_solana_passes(response: Any) -> bool:
    if not isinstance(response, dict):
        return False
    risks = response.get("risks")
    score = _finite_number(response.get("score_normalised"))
    if not isinstance(risks, list) or score is None or score < 0:
        return False
    # RugCheck's schema exposes risk-level labels but not a portable numeric
    # threshold. Accept no findings (or explicit informational notes) only.
    for risk in risks:
        if not isinstance(risk, dict):
            return False
        level = str(risk.get("level") or "").strip().lower()
        if level != "info":
            return False
    return True


def is_recently_mentioned(project: VerifiedProject, recent_posts: list[Any]) -> bool:
    """Do not feature the same project/symbol again if it appeared in recent posts."""
    needles = (project.name.casefold(), f"${project.symbol}".casefold())
    for post in recent_posts:
        if isinstance(post, str):
            text = post
            published_at = ""
        elif isinstance(post, dict):
            text = str(post.get("text") or "")
            published_at = str(post.get("publishedAt") or post.get("published_at") or "")
        else:
            continue
        if published_at:
            try:
                seen = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
                if (datetime.now(timezone.utc) - seen.astimezone(timezone.utc)).days >= 7:
                    continue
            except ValueError:
                continue
        lowered = text.casefold()
        if any(re.search(rf"(?<!\w){re.escape(needle)}(?!\w)", lowered) for needle in needles):
            return True
    return False


async def discover_verified_projects(recent_posts: list[Any] | None = None) -> list[VerifiedProject]:
    """Discover and screen a bounded set. Any unavailable evidence is a no-go."""
    excluded = recent_posts or []
    timeout = httpx.Timeout(15.0, connect=5.0)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            protocols_response = await client.get(DEFILLAMA_PROTOCOLS_URL)
            protocols_response.raise_for_status()
            protocols = protocols_response.json()
            if not isinstance(protocols, list):
                return []

            candidates = [_protocol_candidate(row) for row in protocols]
            viable = [candidate for candidate in candidates if candidate]
            # Rank separately so the larger EVM catalog cannot starve Solana.
            # Deduplicate the same token/mint listed under multiple protocols.
            evm = sorted(
                (item for item in viable if item["chain"] != "Solana"),
                key=lambda item: (item["change_7d_pct"], item["tvl_usd"]),
                reverse=True,
            )
            solana = sorted(
                (item for item in viable if item["chain"] == "Solana"),
                key=lambda item: (item["change_7d_pct"], item["tvl_usd"]),
                reverse=True,
            )

            def unique_limit(items: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
                chosen: list[dict[str, Any]] = []
                seen_addresses: set[str] = set()
                for item in items:
                    key = f"{item['chain']}:{item['address'].lower()}"
                    if key in seen_addresses:
                        continue
                    seen_addresses.add(key)
                    chosen.append(item)
                    if len(chosen) >= limit:
                        break
                return chosen

            evm_shortlist = unique_limit(evm, MAX_EVM_CANDIDATES_TO_SCAN)
            solana_shortlist = unique_limit(solana, MAX_SOLANA_CANDIDATES_TO_SCAN)
            shortlist = evm_shortlist + solana_shortlist
            diagnostics = {"token_screen_pass": 0, "rug_screen_pass": 0}

            semaphore = asyncio.Semaphore(3)

            async def screen(candidate: dict[str, Any]) -> VerifiedProject | None:
                address = candidate["address"]
                chain_id = candidate["chain_id"]
                params = {"contract_addresses": address}
                is_solana = candidate["chain"] == "Solana"
                if is_solana:
                    token_url = f"{GOPLUS_BASE_URL}/solana/token_security"
                    rug_url = f"https://api.rugcheck.xyz/v1/tokens/{address}/report/summary"
                    rug_params = {"cacheOnly": "true"}
                else:
                    token_url = f"{GOPLUS_BASE_URL}/token_security/{chain_id}"
                    rug_url = f"{GOPLUS_BASE_URL}/rugpull_detecting/{chain_id}"
                    rug_params = params

                async with semaphore:
                    try:
                        token_task = client.get(token_url, params=params)
                        rug_task = client.get(rug_url, params=rug_params)
                        token_response, rug_response = await asyncio.gather(token_task, rug_task)
                        token_response.raise_for_status()
                        rug_response.raise_for_status()
                        token_data = token_response.json()
                        rug_data = rug_response.json()
                    except (httpx.HTTPError, ValueError):
                        return None

                if is_solana:
                    passed, liquidity = _goplus_solana_passes(token_data, address)
                    rug_passed = _rugcheck_solana_passes(rug_data)
                else:
                    passed, liquidity = _goplus_token_passes(token_data, address)
                    rug_passed = _goplus_rug_passes(rug_data, address)
                if not passed:
                    return None
                diagnostics["token_screen_pass"] += 1
                if not rug_passed:
                    return None
                diagnostics["rug_screen_pass"] += 1

                slug = candidate["slug"]
                return VerifiedProject(
                    **candidate,
                    dex_liquidity_usd=liquidity["dex_liquidity_usd"],
                    verified_at=datetime.now(timezone.utc).isoformat(),
                    sources={
                        "protocol_metrics": DEFILLAMA_PROTOCOL_URL.format(slug),
                        "token_security": f"{token_url}?{urlencode(params)}",
                        "rug_pull_screen": f"{rug_url}?{urlencode(rug_params)}",
                    },
                )

            screened = await asyncio.gather(*(screen(candidate) for candidate in shortlist))
            verified = [project for project in screened if project and not is_recently_mentioned(project, excluded)]
            verified.sort(key=lambda item: (item.change_7d_pct, item.tvl_usd), reverse=True)
            selected = verified[:MAX_PUBLISHED_CANDIDATES]
            print(
                "Project watch screening: "
                f"catalog={len(protocols)}, eligible_metrics_evm={len(evm)}, "
                f"eligible_metrics_solana={len(solana)}, "
                f"scanned={len(shortlist)}, token_clear={diagnostics['token_screen_pass']}, "
                f"rug_clear={diagnostics['rug_screen_pass']}, publishable={len(selected)}."
            )
            return selected
    except (httpx.HTTPError, ValueError, TypeError):
        # Do not silently fall back to model-generated project names or claims.
        return []


def sanitize_project_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9 .,'&/-]", "", name).strip()[:48]


def x_character_count(text: str) -> int:
    """Estimate X length with its fixed t.co URL length for linked sources."""
    parts = re.split(r"https?://\S+", text)
    urls = re.findall(r"https?://\S+", text)
    return sum(len(part) for part in parts) + 23 * len(urls)


def project_hashtags(category: str, chain: str) -> list[str]:
    """Choose up to three tags only from the source-reported category and chain."""
    normalized = category.casefold()
    if "rwa" in normalized or "real world" in normalized:
        tags = ["#RWA", "#DeFi"]
    elif "stablecoin" in normalized or "stable coin" in normalized:
        tags = ["#Stablecoins", "#DeFi"]
    elif "bridge" in normalized or "cross-chain" in normalized:
        tags = ["#CrossChain", "#DeFi"]
    elif "staking" in normalized:
        tags = ["#Staking", "#DeFi"]
    elif any(term in normalized for term in ("lending", "dex", "derivative", "yield", "defi")):
        tags = ["#DeFi", "#Crypto"]
    else:
        tags = ["#Crypto"]

    chain_tag = {
        "Ethereum": "#Ethereum",
        "Solana": "#Solana",
        "Base": "#Base",
        "Arbitrum": "#Arbitrum",
        "Polygon": "#Polygon",
        "Optimism": "#Optimism",
        "Avalanche": "#Avalanche",
        "BSC": "#BNBChain",
    }.get(chain)
    if chain_tag and chain_tag not in tags:
        tags.append(chain_tag)
    return tags[:3]


def render_project_post(project: VerifiedProject) -> str:
    """Create source-linked copy from only the verified upstream fields."""
    name = sanitize_project_name(project.name)
    if not name:
        return ""
    tvl_m = project.tvl_usd / 1_000_000
    change = project.change_7d_pct
    if tvl_m >= 1000:
        tvl = f"${tvl_m / 1000:.1f}B"
    else:
        tvl = f"${tvl_m:.0f}M"
    hashtags = " ".join(project_hashtags(project.category, project.chain))

    text = (
        f"Bullish watchlist (TVL trend only, not a buy call): {name} ({project.chain}) — DeFiLlama reports "
        f"{tvl} TVL, {change:+.1f}% over 7d. Automated token + rug screens returned "
        f"no flagged checks; neither rules out a rug. Sources: "
        f"{project.sources['protocol_metrics']} {project.sources['token_security']} "
        f"{project.sources['rug_pull_screen']} {hashtags}"
    )
    if x_character_count(text) > 280:
        # Keep all three evidence URLs; shorten prose rather than dropping sources.
        text = (
            f"Bullish TVL-only watchlist (not an endorsement): {name} — {tvl}, {change:+.1f}%/7d. "
            f"Screens: no flags reported; not proof against rugs. Sources: "
            f"{project.sources['protocol_metrics']} {project.sources['token_security']} "
            f"{project.sources['rug_pull_screen']} {hashtags}"
        )
    if x_character_count(text) > 280:
        return ""
    return text
