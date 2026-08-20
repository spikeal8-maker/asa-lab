import { useCallback, useEffect, useState, type JSX } from 'react';
import { api, visibilityLabel, type Course, type CourseItem, type LibraryAssignment } from '../api';
import { colleagueWord } from '../plural';
import { ShareDialog } from './ShareDialog';
import './courses-panel.css';

/**
 * Курсы преподавателя.
 *
 * Задание — единица работы, курс — единица преподавания: «Электроника, первый
 * год» это не двадцать разрозненных заданий, а порядок, в котором их проходят.
 * Курс поэтому не папка: папка отвечает «куда я это положил», курс — «что за
 * чем идёт и что отдаётся целиком».
 *
 * Курс собирается из заданий банка, а не заводит свои: одно и то же задание
 * стоит и в первом году, и в кружке, и правится в одном месте.
 */
export function CoursesPanel({
  assignments,
  onChanged,
}: {
  readonly assignments: readonly LibraryAssignment[];
  readonly onChanged: () => void;
}): JSX.Element {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [items, setItems] = useState<CourseItem[] | null>(null);
  const [sharing, setSharing] = useState<Course | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState('');

  const reload = useCallback(async () => {
    const result = await api.listCourses();
    setCourses(result.ok ? result.data.items : []);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadItems = useCallback(async (courseId: string) => {
    const result = await api.courseItems(courseId);
    setItems(result.ok ? result.data.items : []);
  }, []);

  useEffect(() => {
    if (openId) void loadItems(openId);
    else setItems(null);
  }, [openId, loadItems]);

  async function act(
    run: () => Promise<{ ok: boolean; error?: { message: string } }>,
    done: string,
  ): Promise<void> {
    const result = await run();
    if (!result.ok) {
      setError(result.error?.message ?? 'Не получилось.');
      return;
    }
    setError(null);
    setNotice(done);
    await reload();
    if (openId) await loadItems(openId);
    onChanged();
  }

  const open = courses?.find((course) => course.id === openId) ?? null;

  if (open) {
    const inCourse = new Set((items ?? []).map((item) => item.id));
    const available = assignments.filter(
      (entry) => !inCourse.has(entry.id) && entry.archivedAt === null,
    );
    return (
      <section className="courses-panel">
        <button type="button" className="classroom-back" onClick={() => setOpenId(null)}>
          ← Все курсы
        </button>
        <header className="course-detail-head">
          <div>
            <h2>{open.title}</h2>
            {open.summary ? <p>{open.summary}</p> : null}
            <p className="course-meta">
              {open.itemCount === 0 ? 'Пока пустой' : `Заданий: ${open.itemCount}`} ·{' '}
              {visibilityLabel(open.visibility)}
              {open.sharedWith > 0
                ? ` · открыт ${open.sharedWith} ${colleagueWord(open.sharedWith)}`
                : ''}
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={() => setSharing(open)}>
            Кому видно
          </button>
        </header>

        {notice ? (
          <p className="notice-success" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        {/* Порядок — это и есть курс: не список заданий, а «что за чем». */}
        {items === null ? (
          <p role="status">Загружаем…</p>
        ) : items.length === 0 ? (
          <p className="account-hint">
            Курс пока пустой. Добавьте задания из банка — они останутся и там, курс лишь задаёт
            порядок.
          </p>
        ) : (
          <ol className="course-items" data-testid="course-items">
            {items.map((item, index) => (
              <li key={item.id}>
                <span className="course-step">{index + 1}</span>
                {item.sampleImage ? (
                  <img src={item.sampleImage} alt="" width={56} height={56} />
                ) : (
                  <span className="course-no-sample" aria-hidden="true" />
                )}
                <span className="course-item-copy">
                  <strong>{item.title}</strong>
                  {item.goal ? <small>{item.goal}</small> : null}
                </span>
                <span className="course-item-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={index === 0}
                    aria-label={`Выше: ${item.title}`}
                    onClick={() =>
                      void act(() => api.moveCourseItem(open.id, item.id, -1), 'Порядок изменён.')
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={index === items.length - 1}
                    aria-label={`Ниже: ${item.title}`}
                    onClick={() =>
                      void act(() => api.moveCourseItem(open.id, item.id, 1), 'Порядок изменён.')
                    }
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="assignment-remove"
                    onClick={() =>
                      void act(
                        () => api.setCourseItem(open.id, item.id, false),
                        'Задание убрано из курса. В банке оно осталось.',
                      )
                    }
                  >
                    Убрать
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="course-add">
          <label htmlFor="course-add-pick">Добавить задание из банка</label>
          <div>
            <select
              id="course-add-pick"
              value={pick}
              onChange={(event) => setPick(event.target.value)}
            >
              <option value="">Выберите задание…</option>
              {available.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="portal-create-button"
              disabled={!pick}
              onClick={() => {
                const id = pick;
                setPick('');
                void act(() => api.setCourseItem(open.id, id, true), 'Задание добавлено в курс.');
              }}
            >
              Добавить
            </button>
          </div>
        </div>

        {sharing ? (
          <ShareDialog
            kind="course"
            subjectId={sharing.id}
            title={sharing.title}
            visibility={sharing.visibility}
            onClose={() => setSharing(null)}
            onChanged={() => void reload()}
          />
        ) : null}
      </section>
    );
  }

  return (
    <section className="courses-panel">
      <div className="courses-head">
        <p>
          Курс — это порядок, в котором проходят задания. Задания берутся из банка и остаются в нём:
          одно и то же задание может стоять в нескольких курсах.
        </p>
        <button
          type="button"
          className="portal-create-button"
          onClick={() => {
            const title = window.prompt('Название курса', 'Электроника, первый год');
            if (!title || !title.trim()) return;
            void act(
              () => api.saveCourse(null, { title: title.trim(), summary: null }),
              `Курс «${title.trim()}» создан.`,
            );
          }}
        >
          Новый курс
        </button>
      </div>

      {notice ? (
        <p className="notice-success" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {courses === null ? (
        <p role="status">Загружаем курсы…</p>
      ) : courses.length === 0 ? (
        <div className="classroom-roster-empty">
          <h3>Курсов пока нет</h3>
          <p>
            Соберите первый — это набор заданий в том порядке, в котором вы их даёте. Курс можно
            открыть коллегам или всей платформе целиком.
          </p>
        </div>
      ) : (
        <ul className="courses-list" data-testid="courses-list">
          {courses.map((course) => (
            <li key={course.id}>
              <div className="course-copy">
                <strong>
                  {course.title}
                  {course.copiedFromCourseId ? <em>взят из каталога</em> : null}
                  <em className={`is-visibility is-${course.visibility}`}>
                    {visibilityLabel(course.visibility)}
                  </em>
                </strong>
                {course.summary ? <span>{course.summary}</span> : null}
                <span className="course-meta">
                  {course.itemCount === 0 ? 'Пока пустой' : `Заданий: ${course.itemCount}`}
                  {course.sharedWith > 0
                    ? ` · открыт ${course.sharedWith} ${colleagueWord(course.sharedWith)}`
                    : ''}
                </span>
              </div>
              <div className="course-actions">
                <button
                  type="button"
                  className="portal-create-button"
                  onClick={() => setOpenId(course.id)}
                >
                  Открыть
                </button>
                <button type="button" className="btn-secondary" onClick={() => setSharing(course)}>
                  Кому видно
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    const title = window.prompt('Название курса', course.title);
                    if (!title || !title.trim()) return;
                    void act(
                      () =>
                        api.saveCourse(course.id, { title: title.trim(), summary: course.summary }),
                      'Курс переименован.',
                    );
                  }}
                >
                  Переименовать
                </button>
                <button
                  type="button"
                  className="assignment-remove"
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Удалить курс «${course.title}»? Задания останутся в банке — исчезнет только порядок.`,
                      )
                    )
                      return;
                    void act(() => api.deleteCourse(course.id), `Курс «${course.title}» удалён.`);
                  }}
                >
                  Удалить
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {sharing ? (
        <ShareDialog
          kind="course"
          subjectId={sharing.id}
          title={sharing.title}
          visibility={sharing.visibility}
          onClose={() => setSharing(null)}
          onChanged={() => void reload()}
        />
      ) : null}
    </section>
  );
}
