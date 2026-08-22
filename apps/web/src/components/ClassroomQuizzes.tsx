import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type QuestionBankItem, type QuizVersion } from '../api';
import './classroom-quizzes.css';

function prompt(item: QuestionBankItem): string {
  return item.promptBlocks
    .map((block) => block.text ?? '')
    .join(' ')
    .trim();
}

export function ClassroomQuizzes({
  classroomId,
  archived,
}: {
  readonly classroomId: string;
  readonly archived: boolean;
}): JSX.Element {
  const [questions, setQuestions] = useState<QuestionBankItem[]>([]);
  const [quizzes, setQuizzes] = useState<QuizVersion[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [questionText, setQuestionText] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [correctIndex, setCorrectIndex] = useState(0);
  const [quizTitle, setQuizTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [bank, versions] = await Promise.all([api.listQuestionBank(), api.listQuizzes()]);
    if (bank.ok) setQuestions(bank.data.items);
    if (versions.ok) setQuizzes(versions.data.items);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selectedPoints = useMemo(
    () =>
      questions
        .filter((item) => selected.includes(item.versionId))
        .reduce((sum, item) => sum + item.maxPoints, 0),
    [questions, selected],
  );

  async function addQuestion(): Promise<void> {
    const cleanOptions = options.map((value) => value.trim());
    if (!questionText.trim() || cleanOptions.some((value) => !value)) {
      setMessage('Напишите вопрос и оба варианта ответа.');
      return;
    }
    setBusy(true);
    const result = await api.createQuestion({
      type: 'single_choice',
      prompt: questionText.trim(),
      options: cleanOptions.map((label, index) => ({ id: `option-${index + 1}`, label })),
      correctAnswer: `option-${correctIndex + 1}`,
      maxPoints: 1,
      scope: 'school',
    });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    setQuestionText('');
    setOptions(['', '']);
    setCorrectIndex(0);
    setSelected((value) => [...value, result.data.versionId]);
    setMessage('Вопрос сохранён в банке и выбран для теста.');
    await reload();
  }

  async function publishQuiz(): Promise<void> {
    if (!quizTitle.trim() || selected.length === 0) {
      setMessage('Укажите название и выберите хотя бы один вопрос.');
      return;
    }
    setBusy(true);
    const result = await api.createQuiz({
      title: quizTitle.trim(),
      instructions: null,
      questionVersionIds: selected,
      attemptLimit: 1,
      timeLimitMinutes: null,
      passThreshold: 60,
      feedbackReleasePolicy: 'immediate',
    });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    setQuizTitle('');
    setSelected([]);
    setMessage(`Тест опубликован: ${result.data.totalPoints} балл(а).`);
    await reload();
  }

  async function assign(quiz: QuizVersion): Promise<void> {
    setBusy(true);
    const result = await api.assignQuiz(classroomId, quiz.id, null);
    setBusy(false);
    setMessage(
      result.ok
        ? result.data.reused
          ? 'Тест уже был выдан — он снова открыт.'
          : 'Тест выдан классу.'
        : result.error.message,
    );
  }

  return (
    <div className="quiz-authoring">
      <div className="quiz-authoring-intro">
        <div>
          <h2>Тесты и вопросы</h2>
          <p>Вопрос хранится в банке, тест фиксирует версии, результат сразу попадает в журнал.</p>
        </div>
        <span>{questions.length} вопросов</span>
      </div>

      {message ? <p className="quiz-message">{message}</p> : null}

      <div className="quiz-authoring-grid">
        <form
          className="quiz-compact-card"
          onSubmit={(event) => {
            event.preventDefault();
            void addQuestion();
          }}
        >
          <strong>Новый вопрос с одним ответом</strong>
          <label>
            Вопрос
            <textarea
              value={questionText}
              onChange={(event) => setQuestionText(event.target.value)}
            />
          </label>
          {options.map((value, index) => (
            <label className="quiz-option-edit" key={index}>
              <input
                type="radio"
                name="correct-option"
                checked={correctIndex === index}
                onChange={() => setCorrectIndex(index)}
                aria-label={`Правильный вариант ${index + 1}`}
              />
              <input
                value={value}
                placeholder={`Вариант ${index + 1}`}
                onChange={(event) =>
                  setOptions((current) =>
                    current.map((entry, optionIndex) =>
                      optionIndex === index ? event.target.value : entry,
                    ),
                  )
                }
              />
            </label>
          ))}
          <button type="submit" className="btn-secondary" disabled={busy || archived}>
            В банк вопросов
          </button>
        </form>

        <form
          className="quiz-compact-card"
          onSubmit={(event) => {
            event.preventDefault();
            void publishQuiz();
          }}
        >
          <strong>Собрать тест</strong>
          <label>
            Название
            <input value={quizTitle} onChange={(event) => setQuizTitle(event.target.value)} />
          </label>
          <div className="quiz-bank-list">
            {questions.length === 0 ? <p>Сначала добавьте вопрос.</p> : null}
            {questions.map((item) => (
              <label key={item.versionId}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.versionId)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, item.versionId]
                        : current.filter((id) => id !== item.versionId),
                    )
                  }
                />
                <span>{prompt(item)}</span>
                <small>{item.maxPoints} б.</small>
              </label>
            ))}
          </div>
          <button type="submit" className="portal-create-button" disabled={busy || archived}>
            Опубликовать · {selectedPoints} б.
          </button>
        </form>
      </div>

      <div className="quiz-version-list">
        {quizzes.map((quiz) => (
          <article key={quiz.id}>
            <div>
              <strong>{quiz.title}</strong>
              <span>
                {quiz.questionCount} вопр. · {quiz.totalPoints} б. · проходной {quiz.passThreshold}%
              </span>
            </div>
            <button
              className="btn-secondary"
              disabled={busy || archived}
              onClick={() => void assign(quiz)}
            >
              Выдать классу
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
