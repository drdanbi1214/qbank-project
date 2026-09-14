from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from verify_kmle_ingest import normalized_timestamp


class NormalizeTimestampTests(unittest.TestCase):
    def test_z_and_utc_offset_are_equal(self) -> None:
        self.assertEqual(
            normalized_timestamp("2026-09-14T06:51:45.040Z"),
            normalized_timestamp("2026-09-14T06:51:45.04+00:00"),
        )

    def test_different_instants_are_not_equal(self) -> None:
        self.assertNotEqual(
            normalized_timestamp("2026-09-14T06:51:45.040Z"),
            normalized_timestamp("2026-09-14T06:51:45.041Z"),
        )


if __name__ == "__main__":
    unittest.main()
