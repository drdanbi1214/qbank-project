from __future__ import annotations

import pathlib
import tempfile
import unittest

from scripts.import_lecture_notes import (
    NoteSection,
    PdfLecture,
    find_duplicate_sections,
    markdown_to_text,
    match_sections,
    parse_markdown,
    parse_schedule,
    resolve_matches,
    safe_pdf_key,
)


class LectureNoteImportTest(unittest.TestCase):
    def test_outer_sections_ignore_numbered_inner_headings(self) -> None:
        source = """# 묶음

## 1. 0518_3교시_박근열_hormone의 측정

- 과목: 내분비 1차
- 날짜: 2026-05-18

### 시험 요점 정리

# 첫 정리
## 1. 내부 소제목
- 내용

---

## 2. 0518_4교시_박근열_hormone의 측정

- 과목: 내분비 1차
- 날짜: 2026-05-18

### 시험 요점 정리

# 둘째 정리
"""
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / "notes.md"
            path.write_text(source, encoding="utf-8")
            sections = parse_markdown(path)

        self.assertEqual(2, len(sections))
        self.assertIn("## 1. 내부 소제목", sections[0].markdown)
        self.assertEqual("내분비 1차", sections[1].course)

    def test_combined_pdf_accepts_multiple_note_sections(self) -> None:
        pdf = PdfLecture(
            pathlib.Path("0518_3,4교시_박근열_Hormone의 측정.pdf"),
            "0518_3,4교시_박근열_Hormone의 측정.pdf",
            parse_schedule("0518_3,4교시_박근열_Hormone의 측정.pdf"),
        )
        sections = [
            self.section(2, "0518_3교시_박근열_hormone의 측정"),
            self.section(3, "0518_4교시_박근열_hormone의 측정"),
        ]
        results = match_sections(sections, [pdf])

        self.assertEqual(["AUTO", "AUTO"], [result.status for result in results])
        self.assertEqual([pdf.filename, pdf.filename], [result.candidate.filename for result in results if result.candidate])

    def test_one_day_difference_requires_review(self) -> None:
        pdf = PdfLecture(
            pathlib.Path("0517_8,9교시_anatomy&histology lab.pdf"),
            "0517_8,9교시_anatomy&histology lab.pdf",
            parse_schedule("0517_8,9교시_anatomy&histology lab.pdf"),
        )
        section = self.section(6, "0518_8,9교시_서윤경_조직학실습")
        result = match_sections([section], [pdf])[0]

        self.assertEqual("REVIEW", result.status)

    def test_professor_name_conflict_requires_review(self) -> None:
        pdf = PdfLecture(
            pathlib.Path("0519_2,3교시_박정환_시상하부와 뇌하수체.pdf"),
            "0519_2,3교시_박정환_시상하부와 뇌하수체.pdf",
            parse_schedule("0519_2,3교시_박정환_시상하부와 뇌하수체.pdf"),
        )
        section = self.section(7, "0519_2,3교시_빅정환_시상하부와 뇌하수체")
        result = match_sections([section], [pdf])[0]

        self.assertEqual("REVIEW", result.status)
        self.assertTrue(result.candidate and result.candidate.professor_conflict)

    def test_generation_failure_is_not_matched(self) -> None:
        section = NoteSection(
            order=39,
            source_key="0602_4교시_이창범_obesity",
            course="내분비 2차",
            lecture_date="2026-06-03",
            markdown="오류가 발생하여 요점 정리 생성에 실패했습니다.",
            start_line=10,
            failed_reason="요점 정리 생성에 실패",
            schedule=parse_schedule("0602_4교시_이창범_obesity"),
        )
        result = match_sections([section], [])[0]
        self.assertEqual("FAILED", result.status)

    def test_professor_before_period_filename_is_parsed(self) -> None:
        schedule = parse_schedule("0602_김용석_2교시_비만증치료의 분자생물학적 접근.pdf")

        self.assertIsNotNone(schedule)
        assert schedule
        self.assertEqual("0602", schedule.month_day)
        self.assertEqual((2,), schedule.periods)
        self.assertEqual("김용석", schedule.professor)
        self.assertEqual("비만증치료의 분자생물학적 접근", schedule.title)

    def test_unrelated_long_title_is_not_automatically_matched(self) -> None:
        pdf = PdfLecture(
            pathlib.Path("0602_3교시_이창범_Obesity.pdf"),
            "0602_3교시_이창범_Obesity.pdf",
            parse_schedule("0602_3교시_이창범_Obesity.pdf"),
        )
        section = self.section(38, "0602_3교시_이창범_지단백 대사 이상과 이상지질 혈증")
        result = match_sections([section], [pdf])[0]

        self.assertEqual("REVIEW", result.status)
        self.assertTrue(result.candidate and result.candidate.title_conflict)

    def test_duplicate_source_key_is_reported_across_courses(self) -> None:
        first = self.section(22, "0529_1교시_문신제_갑상선기능 저하증")
        second = NoteSection(
            order=23,
            source_key=first.source_key,
            course="내분비 2차",
            lecture_date="2026-05-31",
            markdown=first.markdown,
            start_line=20,
            failed_reason=None,
            schedule=first.schedule,
        )

        duplicates = find_duplicate_sections([first, second])

        self.assertEqual([first.source_key], list(duplicates))
        self.assertEqual([22, 23], [item.order for item in duplicates[first.source_key]])

    def test_manifest_can_approve_review_and_skip_unmatched(self) -> None:
        pdf = PdfLecture(
            pathlib.Path("0517_8,9교시_anatomy&histology lab.pdf"),
            "0517_8,9교시_anatomy&histology lab.pdf",
            parse_schedule("0517_8,9교시_anatomy&histology lab.pdf"),
        )
        review = self.section(6, "0518_8,9교시_서윤경_조직학실습")
        unmatched = self.section(23, "0529_1교시_문신제_갑상선기능 저하증")
        results = match_sections([review, unmatched], [pdf])

        resolved, skipped, unresolved = resolve_matches(
            results,
            {
                review.source_key: {"pdf": pdf.filename},
                unmatched.source_key: {"skip": True},
            },
        )

        self.assertEqual([pdf.filename], [item.pdf_filename for item in resolved])
        self.assertEqual([unmatched.source_key], [item.source_key for item in skipped])
        self.assertEqual([], unresolved)

    def test_manifest_can_connect_one_note_to_multiple_pdfs(self) -> None:
        section = self.section(32, "0601_2,3교시_김원준_부신 질환의 내과 치료")
        pdfs = [
            "0601_2교시_김원준_부신질환의 진단과 병태생리.pdf",
            "0601_3교시_김원준_부신 질환의 내과 치료.pdf",
        ]
        result = match_sections([section], [])

        resolved, skipped, unresolved = resolve_matches(
            result,
            {section.source_key: {"pdfs": pdfs}},
        )

        self.assertEqual(pdfs, [item.pdf_filename for item in resolved])
        self.assertEqual([], skipped)
        self.assertEqual([], unresolved)

    def test_markdown_plain_text_and_safe_pdf_key(self) -> None:
        markdown = "# **갑상선** 정리\n\n| 구분 | 내용 |\n| --- | --- |\n| 검사 | `TSH` |"
        plain = markdown_to_text(markdown)

        self.assertIn("갑상선 정리", plain)
        self.assertIn("검사 TSH", plain)
        self.assertNotIn("**", plain)
        self.assertEqual(
            "0518_3_4교시_박근열_Hormone의_측정.pdf",
            safe_pdf_key("0518_3,4교시_박근열_Hormone의 측정.pdf"),
        )

    @staticmethod
    def section(order: int, source_key: str) -> NoteSection:
        schedule = parse_schedule(source_key)
        return NoteSection(
            order=order,
            source_key=source_key,
            course="내분비 1차",
            lecture_date=f"2026-{schedule.month_day[:2]}-{schedule.month_day[2:]}" if schedule else None,
            markdown="# 정리",
            start_line=1,
            failed_reason=None,
            schedule=schedule,
        )


if __name__ == "__main__":
    unittest.main()
