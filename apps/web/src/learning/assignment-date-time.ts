/** Use the explicitly displayed browser IANA zone, never the server zone.
 * Gaps/repeated wall-clock times require choosing an unambiguous local time. */
export function assignmentDateTime(
  value: string,
): { ok: true; instant: string | null; timeZone: string } | { ok: false; message: string } {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!value) return { ok: true, instant: null, timeZone };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    return { ok: false, message: 'Укажите дату и время срока.' };
  const date = new Date(value);
  const wall = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (!Number.isFinite(date.getTime()) || wall(date) !== value)
    return {
      ok: false,
      message: 'Такого местного времени нет из-за перевода часов. Выберите другое время.',
    };
  for (let delta = -180; delta <= 180; delta += 15)
    if (delta !== 0 && wall(new Date(date.getTime() + delta * 60000)) === value)
      return {
        ok: false,
        message:
          'Это местное время повторяется при переводе часов. Выберите время вне повторяющегося интервала.',
      };
  return { ok: true, instant: date.toISOString(), timeZone };
}
