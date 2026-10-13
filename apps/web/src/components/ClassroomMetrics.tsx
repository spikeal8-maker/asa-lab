import { useEffect, useState } from 'react';
import { observationApi } from '../classroom-observation-api';

export type ClassroomMetricsData = {
  students: number;
  works: number;
  assigned: number;
  submitted: number;
  waiting: number;
  notSubmitted: number;
};
type Summary = {
  items: Array<ClassroomMetricsData & { classroomId: string }>;
  totals: ClassroomMetricsData;
};

// The observation client is supplied by slice C; this helper owns presentation only.
export function useClassroomMetrics(ids: string, revision: unknown, enabled = true) {
  const [state, setState] = useState<{
    identity: string;
    data: Summary | null;
    error: string | null;
    forbidden: boolean;
  }>({ identity: '', data: null, error: null, forbidden: false });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ identity: ids, data: null, error: null, forbidden: false });
    if (!enabled) return;
    void observationApi
      .summary(ids ? ids.split(',') : [])
      .then((result) => {
        if (!active) return;
        setState({
          identity: ids,
          data: result.ok ? result.data : null,
          error: result.ok ? null : result.error.message,
          forbidden: !result.ok && [401, 403].includes(result.status),
        });
      })
      .catch(() => {
        if (active)
          setState({
            identity: ids,
            data: null,
            error: 'Не удалось загрузить показатели.',
            forbidden: false,
          });
      });
    return () => {
      active = false;
    };
  }, [ids, revision, retry, enabled]);
  return {
    data: state.identity === ids ? state.data : null,
    error: state.identity === ids ? state.error : null,
    forbidden: state.identity === ids && state.forbidden,
    retry: () => setRetry((value) => value + 1),
  };
}

export function ClassroomMetrics({
  data,
  classes,
  showClasses = classes !== undefined,
}: {
  data: ClassroomMetricsData | null;
  classes?: number | undefined;
  showClasses?: boolean;
}) {
  const metrics = [
    ...(showClasses ? [{ label: 'Классы', value: classes }] : []),
    { label: 'Ученики', value: data?.students },
    { label: 'Работы', value: data?.works },
    { label: 'Сдано', value: data ? `${data.submitted}/${data.assigned}` : undefined },
    { label: 'Ждут', value: data?.waiting },
    { label: 'Не сдали', value: data?.notSubmitted },
  ];
  return (
    <div className="classroom-metrics" aria-label="Показатели классов" aria-busy={!data}>
      {metrics.map(({ label, value }) => (
        <span
          key={label}
          title={
            label === 'Работы'
              ? 'Проекты учеников, включая архив; без игр и корзины. Повторы учитываются один раз.'
              : undefined
          }
        >
          <strong>{value ?? '—'}</strong>
          <span>{label}</span>
        </span>
      ))}
    </div>
  );
}
