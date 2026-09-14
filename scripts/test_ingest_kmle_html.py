from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from scripts.ingest_kmle import (
    allowed_allen_image_url,
    explanation_blocks,
    html_blocks,
    source_exam_metadata,
)


class AllenSourceMetadataTests(unittest.TestCase):
    def test_structured_exam_metadata_is_preserved(self) -> None:
        self.assertEqual(source_exam_metadata({
            "code": "임종평23-2",
            "sourceLabel": "임종평23-2 2교시, 43번",
            "sourceExam": "임종평23-2",
            "sourceSession": 2,
            "sourceQuestionNumber": 43,
        }), {
            "allen_exam": "임종평23-2",
            "allen_session": 2,
            "allen_question_number": 43,
            "allen_label": "임종평23-2 2교시, 43번",
        })

    def test_legacy_json_falls_back_to_code(self) -> None:
        self.assertEqual(source_exam_metadata({"code": "MD23"}), {
            "allen_exam": "MD23",
            "allen_session": None,
            "allen_question_number": None,
            "allen_label": None,
        })


class AllenImageUrlTests(unittest.TestCase):
    def test_media_and_path_style_s3_urls_are_allowed(self) -> None:
        for url in (
            "https://media.allenslibrary.com/problem/119186/2A_71_q_1.png",
            "https://dev.media.allenslibrary.com/problems/111047/7FpdSCKvQB9Y4Lualn93s.webp",
            "https://s3.ap-northeast-2.amazonaws.com/media.allenslibrary.com/problem/119186/2A_71_q_1.png",
        ):
            self.assertEqual(allowed_allen_image_url(url), url)

    def test_other_hosts_buckets_and_dot_segments_are_rejected(self) -> None:
        for url in (
            "https://example.com/problem/1.png",
            "https://s3.ap-northeast-2.amazonaws.com/other-bucket/problem/1.png",
            "https://s3.ap-northeast-2.amazonaws.com/media.allenslibrary.com/../other-bucket/1.png",
            "file:///etc/passwd",
        ):
            with self.assertRaises(ValueError):
                allowed_allen_image_url(url)


class AllenHtmlParserTests(unittest.TestCase):
    def test_data_only_allen_table_keeps_first_row_and_cell_line_breaks(self) -> None:
        blocks = html_blocks("""
          <table>
            <tbody>
              <tr><td>CC</td><td>F/76, 복부덩이(3m, LUQ)</td></tr>
              <tr><td>Hx</td><td></td></tr>
              <tr><td>S/Sx</td><td><p>LUQ 통증, 등 통증</p><p>V/S 110/70 80 18 36.2</p></td></tr>
            </tbody>
          </table>
        """)

        self.assertEqual(blocks, [{
            "type": "table",
            "headers": [],
            "rows": [
                ["CC", "F/76, 복부덩이(3m, LUQ)"],
                ["Hx", ""],
                ["S/Sx", "LUQ 통증, 등 통증\nV/S 110/70 80 18 36.2"],
            ],
        }])

    def test_real_header_row_is_separated_from_body(self) -> None:
        blocks = html_blocks("""
          <table>
            <tr><th>항목</th><th>값</th></tr>
            <tr><td>Lab</td><td>GGT↑<br>CA 19-9↑</td></tr>
          </table>
        """)

        self.assertEqual(blocks[0]["headers"], ["항목", "값"])
        self.assertEqual(blocks[0]["rows"], [["Lab", "GGT↑\nCA 19-9↑"]])

    def test_allen_item_result_row_is_recognized_as_a_header(self) -> None:
        blocks = html_blocks("""
          <table>
            <tr><td>항목</td><td>결과</td></tr>
            <tr><td>영상소견</td><td>CT: central mass</td></tr>
          </table>
        """)

        self.assertEqual(blocks[0]["headers"], ["항목", "결과"])
        self.assertEqual(blocks[0]["rows"], [["영상소견", "CT: central mass"]])

    def test_legacy_table_text_is_replaced_at_its_original_position(self) -> None:
        blocks = explanation_blocks({
            "explanationHtml": (
                "<h4>출제 Point</h4><p>항목</p><p>결과</p>"
                "<p>영상</p><p>CT</p><p>PET</p><h4>해설</h4><p>정답 설명</p>"
            ),
            "explanationAssetsHtml": (
                "<table><tr><td>항목</td><td>결과</td></tr>"
                "<tr><td>영상</td><td>CT<br>PET</td></tr></table>"
            ),
        })

        self.assertEqual([block["type"] for block in blocks], ["text", "table", "text", "text"])
        self.assertEqual(blocks[1]["rows"], [["영상", "CT\nPET"]])


if __name__ == "__main__":
    unittest.main()
