from app.domain.models import Job
from app.repositories.memory import MemoryRepository
from app.services.grading import FixtureGrader


class FixtureJobProcessor:
    def __init__(
        self,
        repository: MemoryRepository,
        grader: FixtureGrader | None = None,
    ) -> None:
        self._repository = repository
        self._grader = grader or FixtureGrader()

    def process_next(self) -> Job | None:
        job = self._repository.next_queued_job()
        if job is None:
            return None
        job.attempt_count += 1
        questions = self._repository.questions_for_attempt(str(job.subject_id))
        submitted_question_id = job.payload.get("question_id")
        if isinstance(submitted_question_id, str):
            questions = [
                question
                for question in questions
                if str(question.id) == submitted_question_id
            ]
        responses = self._repository.responses_for_attempt(str(job.subject_id))
        results = [
            self._grader.grade(job, question, responses.get(str(question.id)))
            for question in questions
        ]
        self._grader.mark_succeeded(job)
        return self._repository.complete_grading(job, results)
