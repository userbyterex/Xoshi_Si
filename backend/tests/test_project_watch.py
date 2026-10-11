import sys
import pathlib
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import project_watch as watch  # noqa: E402


ADDRESS = "0x" + "a" * 40
SOLANA_MINT = "So11111111111111111111111111111111111111112"


def token_payload(**updates):
    token = {
        "is_honeypot": "0",
        "is_open_source": "1",
        "is_proxy": "0",
        "is_mintable": "0",
        "is_blacklisted": "0",
        "can_take_back_ownership": "0",
        "owner_change_balance": "0",
        "hidden_owner": "0",
        "selfdestruct": "0",
        "cannot_sell_all": "0",
        "cannot_buy": "0",
        "slippage_modifiable": "0",
        "personal_slippage_modifiable": "0",
        "transfer_pausable": "0",
        "is_in_dex": "1",
        "buy_tax": "0.01",
        "sell_tax": "0.01",
        "dex": [{"liquidity": "1000000"}],
    }
    token.update(updates)
    return {"code": 1, "result": {ADDRESS: token}}


def rug_payload(**updates):
    rug = {
        "privilege_withdraw": 0,
        "withdraw_missing": 0,
        "is_open_source": 1,
        "blacklist": 0,
        "selfdestruct": 0,
        "approval_abuse": 0,
    }
    rug.update(updates)
    return {"code": 1, "result": rug}


def solana_token_payload(**updates):
    token = {
        "mintable": {"status": "0", "authority": []},
        "freezable": {"status": "0", "authority": []},
        "closable": {"status": "0", "authority": []},
        "balance_mutable_authority": {"status": "0", "authority": []},
        "default_account_state_upgradable": {"status": "0", "authority": []},
        "transfer_fee_upgradable": {"status": "0", "authority": []},
        "transfer_hook_upgradable": {"status": "0", "authority": []},
        "transfer_hook": [],
        "creators": [],
        "dex": [{"tvl": "1000000"}],
        "holders": [{"percent": "0.10"}, {"percent": "0.15"}],
    }
    token.update(updates)
    return {"code": 1, "result": {SOLANA_MINT: token}}


class ProjectWatchTests(unittest.TestCase):
    def test_protocol_candidate_requires_supported_single_chain_and_positive_tvl_change(self):
        base = {
            "name": "Example Protocol",
            "slug": "example-protocol",
            "symbol": "EX",
            "chain": "Ethereum",
            "address": ADDRESS,
            "tvl": 50_000_000,
            "change_7d": 4.2,
            "category": "Lending",
        }
        self.assertEqual(watch._protocol_candidate(base)["chain_id"], "1")
        self.assertIsNone(watch._protocol_candidate({**base, "chain": "Multi-Chain"}))
        solana = watch._protocol_candidate({**base, "chain": "Solana", "address": f"solana:{SOLANA_MINT}"})
        self.assertEqual(solana["chain_id"], "solana")
        self.assertEqual(solana["address"], SOLANA_MINT)
        self.assertIsNone(watch._protocol_candidate({**base, "chain": "Solana", "address": "0-invalid"}))
        self.assertIsNone(watch._protocol_candidate({**base, "change_7d": -1}))
        self.assertIsNone(watch._protocol_candidate({**base, "tvl": 1000}))

    def test_token_screen_passes_only_explicit_clear_flags(self):
        passed, details = watch._goplus_token_passes(token_payload(), ADDRESS)
        self.assertTrue(passed)
        self.assertEqual(details["dex_liquidity_usd"], 1_000_000)
        self.assertFalse(watch._goplus_token_passes(token_payload(is_honeypot="1"), ADDRESS)[0])
        self.assertFalse(watch._goplus_token_passes(token_payload(is_mintable="1"), ADDRESS)[0])
        self.assertFalse(watch._goplus_token_passes(token_payload(sell_tax=""), ADDRESS)[0])
        self.assertFalse(watch._goplus_token_passes(token_payload(cannot_sell_all=None), ADDRESS)[0])
        self.assertFalse(watch._goplus_token_passes({"code": 2, "result": {}}, ADDRESS)[0])

    def test_rug_screen_requires_all_clear_results(self):
        self.assertTrue(watch._goplus_rug_passes(rug_payload(), ADDRESS))
        self.assertFalse(watch._goplus_rug_passes(rug_payload(privilege_withdraw=1), ADDRESS))
        self.assertFalse(watch._goplus_rug_passes({"code": 1, "result": {}}, ADDRESS))
        self.assertFalse(watch._goplus_rug_passes({"code": 2, "result": {}}, ADDRESS))

    def test_solana_requires_clear_authorities_liquidity_holders_and_rugcheck(self):
        passed, details = watch._goplus_solana_passes(solana_token_payload(), SOLANA_MINT)
        self.assertTrue(passed)
        self.assertEqual(details["dex_liquidity_usd"], 1_000_000)
        self.assertFalse(watch._goplus_solana_passes(solana_token_payload(mintable={"status": "1"}), SOLANA_MINT)[0])
        self.assertFalse(watch._goplus_solana_passes(solana_token_payload(transfer_hook=[{"address": "x"}]), SOLANA_MINT)[0])
        self.assertFalse(watch._goplus_solana_passes(solana_token_payload(holders=[{"percent": "0.7"}]), SOLANA_MINT)[0])
        self.assertTrue(watch._rugcheck_solana_passes({"risks": [], "score_normalised": 1}))
        self.assertTrue(watch._rugcheck_solana_passes({"risks": [{"level": "info"}], "score_normalised": 1}))
        self.assertFalse(watch._rugcheck_solana_passes({"risks": [{"level": "danger"}], "score_normalised": 1}))
        self.assertFalse(watch._rugcheck_solana_passes({"risks": [], "score_normalised": None}))

    def test_source_linked_post_disclaims_risk_and_fits_limit(self):
        project = watch.VerifiedProject(
            name="Example Protocol",
            symbol="EX",
            chain="Ethereum",
            chain_id="1",
            slug="example-protocol",
            address=ADDRESS,
            category="Lending",
            tvl_usd=125_000_000,
            change_7d_pct=4.2,
            dex_liquidity_usd=1_000_000,
            verified_at=datetime.now(timezone.utc).isoformat(),
            sources={
                "protocol_metrics": "https://defillama.com/protocol/example-protocol",
                "token_security": f"https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses={ADDRESS}",
                "rug_pull_screen": f"https://api.gopluslabs.io/api/v1/rugpull_detecting/1?contract_addresses={ADDRESS}",
            },
        )
        post = watch.render_project_post(project)
        self.assertTrue(post)
        self.assertIn("not a buy call", post)
        self.assertIn("neither rules out a rug", post)
        self.assertIn(project.sources["protocol_metrics"], post)
        self.assertIn(project.sources["token_security"], post)
        self.assertIn(project.sources["rug_pull_screen"], post)
        self.assertLessEqual(watch.x_character_count(post), 280)

    def test_solana_post_links_goplus_and_cached_rugcheck_report(self):
        project = watch.VerifiedProject(
            name="Solana Example",
            symbol="SE",
            chain="Solana",
            chain_id="solana",
            slug="solana-example",
            address=SOLANA_MINT,
            category="DeFi",
            tvl_usd=75_000_000,
            change_7d_pct=2.5,
            dex_liquidity_usd=1_000_000,
            verified_at=datetime.now(timezone.utc).isoformat(),
            sources={
                "protocol_metrics": "https://defillama.com/protocol/solana-example",
                "token_security": f"https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses={SOLANA_MINT}",
                "rug_pull_screen": f"https://api.rugcheck.xyz/v1/tokens/{SOLANA_MINT}/report/summary?cacheOnly=true",
            },
        )
        post = watch.render_project_post(project)
        self.assertIn(project.sources["protocol_metrics"], post)
        self.assertIn(project.sources["token_security"], post)
        self.assertIn(project.sources["rug_pull_screen"], post)
        self.assertLessEqual(watch.x_character_count(post), 280)

    def test_recent_project_is_not_repeated(self):
        project = watch.VerifiedProject(
            name="Example Protocol",
            symbol="EX",
            chain="Ethereum",
            chain_id="1",
            slug="example-protocol",
            address=ADDRESS,
            category="Lending",
            tvl_usd=50_000_000,
            change_7d_pct=1.0,
            dex_liquidity_usd=1_000_000,
            verified_at=datetime.now(timezone.utc).isoformat(),
            sources={},
        )
        recent = {
            "text": "Watchlist: Example Protocol had rising TVL",
            "publishedAt": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
        }
        old = {**recent, "publishedAt": (datetime.now(timezone.utc) - timedelta(days=9)).isoformat()}
        self.assertTrue(watch.is_recently_mentioned(project, [recent]))
        self.assertFalse(watch.is_recently_mentioned(project, [old]))


if __name__ == "__main__":
    unittest.main()
