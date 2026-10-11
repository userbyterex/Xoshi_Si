import asyncio
import pathlib
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import main  # noqa: E402


class BackendTests(unittest.TestCase):
    def test_language_detection(self):
        cases = {
            "¿Qué opinas de las acciones tokenizadas?": "Spanish",
            "Què en penses de les accions tokenitzades?": "Catalan",
            "Que pensez-vous des actions tokenisées ?": "French",
            "Was denkst du über tokenisierte Aktien?": "German",
            "O que você acha das ações tokenizadas?": "Portuguese",
            "Cosa pensi delle azioni tokenizzate?": "Italian",
            "What changes when equities become programmable?": "English",
        }
        for text, expected in cases.items():
            self.assertEqual(main.detect_reply_language(text), expected)

    def test_clean_limits_and_unquotes(self):
        self.assertEqual(main.clean('"hello"'), "hello")
        self.assertEqual(len(main.clean("x" * 300)), 280)

    def test_reply_falls_back_in_detected_language(self):
        request = main.ReplyRequest(tweet="¿Qué opinas de las acciones tokenizadas?", author="alice")
        with patch.object(main, "groq", AsyncMock(return_value=None)), patch.object(main, "gemini", AsyncMock(return_value=None)):
            response = asyncio.run(main.reading_reply(request))
        self.assertEqual(response["reply"], main.FALLBACK_REPLIES["Spanish"])

    def test_instruction_echo_is_rejected(self):
        request = main.ReplyRequest(tweet="What changes when equities are tokenized?", author="alice")
        with patch.object(main, "groq", AsyncMock(return_value="No hashtags; avoid generic marketing.")), patch.object(main, "gemini", AsyncMock(return_value=None)):
            response = asyncio.run(main.reading_reply(request))
        self.assertEqual(response["reply"], main.FALLBACK_REPLIES["English"])

    def test_market_cycle_abstains_when_no_project_passes_checks(self):
        with patch.object(main, "discover_verified_projects", AsyncMock(return_value=[])):
            response = asyncio.run(main.market_cycle(main.MarketRequest()))
        self.assertEqual(response["post"], "")
        self.assertIn("skipped publishing", response["reason"])

    def test_health_reports_without_secret_values(self):
        response = asyncio.run(main.health())
        self.assertTrue(response["ok"])
        self.assertIn("groq", response["providers"])
        self.assertNotIn("GROQ_API_KEY", str(response))


if __name__ == "__main__":
    unittest.main()
