import json
import unittest
from pathlib import Path

from build_program import parse_day


SOURCE = {"day": "Monday", "date": "2026-08-24", "index": 1}


class ProgramParserTests(unittest.TestCase):
    def test_preserves_session_and_paper_fields(self):
        text = """
MoM00  Plenary Session, Auditorium\tAdd to My Program
Good Old Fashioned Engineering Can Close the Data Gap
Chair: Example, Ada\tExample University
08:30-09:30, Paper MoM00.1\tAdd to My Program
An Example Paper Title
Researcher, Robin\tResearch Institute
"""
        day = parse_day(text, SOURCE, validate=False)
        session = day["sessions"][0]
        paper = session["papers"][0]
        self.assertEqual(session["code"], "MoM00")
        self.assertEqual(session["title"], "Good Old Fashioned Engineering Can Close the Data Gap")
        self.assertEqual(session["room"], "Auditorium")
        self.assertEqual(session["chairs"][0]["name"], "Example, Ada")
        self.assertEqual(paper["code"], "MoM00.1")
        self.assertEqual(paper["authors"][0]["affiliation"], "Research Institute")

    def test_generated_snapshot_has_all_days_and_unique_paper_codes(self):
        program_path = Path(__file__).resolve().parents[1] / "data" / "program.json"
        program = json.loads(program_path.read_text(encoding="utf-8"))
        self.assertEqual(program["schemaVersion"], 2)
        self.assertEqual(len(program["days"]), 5)
        paper_codes = [
            paper["code"]
            for day in program["days"]
            for session in day["sessions"]
            for paper in session["papers"]
        ]
        self.assertEqual(len(paper_codes), len(set(paper_codes)))
        self.assertGreater(len(paper_codes), 3000)

    def test_keeps_program_items_without_papers(self):
        text = """
MoC11  Tutorial Session, Room 201\tAdd to My Program
Back-To-Basics Tutorial
Chair: Example, Ada\tExample University
MoC12  Forum, Room 205\tAdd to My Program
IFAC Technical Board Evolutions
Chair: Example, Grace\tAnother University
MoC13  Regular Session, Room 211\tAdd to My Program
Model Predictive Control
15:30-15:50, Paper MoC13.1\tAdd to My Program
An Example Paper
Researcher, Robin\tResearch Institute
"""
        day = parse_day(text, SOURCE, validate=False)
        self.assertEqual(len(day["sessions"]), 3)
        self.assertEqual(day["sessions"][0]["start"], "15:30")
        self.assertEqual(day["sessions"][1]["type"], "Forum")


if __name__ == "__main__":
    unittest.main()
