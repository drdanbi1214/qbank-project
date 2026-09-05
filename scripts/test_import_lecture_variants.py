from __future__ import annotations

import unittest

from scripts.import_lecture_variants import variant_object_path


class LectureVariantImportTest(unittest.TestCase):
    def test_same_filename_with_different_content_gets_a_different_object_path(self) -> None:
        first = variant_object_path("lecture-id", "후배 필기.pdf", "a" * 64)
        second = variant_object_path("lecture-id", "후배 필기.pdf", "b" * 64)

        self.assertNotEqual(first, second)

    def test_object_path_keeps_lecture_and_content_identity(self) -> None:
        path = variant_object_path("lecture-id", "후배 필기.pdf", "a" * 64)

        self.assertEqual(
            f"variants/lecture-id/{'a' * 64}-후배_필기.pdf",
            path,
        )


if __name__ == "__main__":
    unittest.main()
