import { useState } from 'react';
import type { ClassroomStudentSession } from '../api';
import {
  LearnerAchievementsDashboard,
  type AchievementSection,
} from '../components/LearnerAchievementsDashboard';

const sections: readonly { id: AchievementSection; title: string }[] = [
  { id: 'overview', title: 'Обзор' },
  { id: 'grades', title: 'Оценки' },
  { id: 'awards', title: 'Награды' },
];

/** Achievements are a separate read-only destination, not a replacement for /learning. */
export function AchievementsPage({
  seat,
  onLearning,
  onOpenProject,
}: {
  readonly seat: ClassroomStudentSession | null;
  readonly onLearning: () => void;
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  const [section, setSection] = useState<AchievementSection>('overview');
  return (
    <main id="main-content" className="portal-content learning-page learner-hub" tabIndex={-1}>
      <header className="learner-hub-header">
        <h1>Мои достижения</h1>
        <p>
          {seat
            ? `Результаты класса «${seat.classroom.title}»`
            : 'Ваши результаты, оценки и награды по доступным классам.'}
        </p>
      </header>
      <nav aria-label="Разделы достижений" className="learner-hub-tabs">
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={section === item.id ? 'page' : undefined}
            onClick={() => setSection(item.id)}
          >
            {item.title}
          </button>
        ))}
      </nav>
      <LearnerAchievementsDashboard
        seat={seat}
        section={section}
        onGrades={() => setSection('grades')}
        onAwards={() => setSection('awards')}
        onLearning={onLearning}
        onOpenProject={onOpenProject}
      />
    </main>
  );
}
