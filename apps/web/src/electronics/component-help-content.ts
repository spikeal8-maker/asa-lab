import type { ComponentKind } from '../api';
import type { HelpSection } from './component-information';

export function componentHelpSections(
  kind: ComponentKind,
  catalogDescription: string,
): readonly HelpSection[] {
  const principle: Partial<Record<ComponentKind, string>> = {
    source: 'Источник поддерживает заданную разность потенциалов между своими выводами.',
    resistor: 'Резистор ограничивает ток; ток зависит от напряжения и сопротивления цепи.',
    potentiometer: 'Движок делит полное сопротивление на два связанных плеча.',
    photoresistor: 'Сопротивление чувствительного элемента изменяется вместе с освещённостью.',
    led: 'Светодиод проводит ток в прямом направлении и преобразует часть мощности в свет.',
    diode: 'Диод преимущественно проводит ток в одном направлении.',
    button: 'Кнопка временно соединяет контакты, пока пользователь её удерживает.',
    switch: 'Переключатель соединяет общий контакт с выбранным выводом.',
    piezo: 'Пьезоэлемент преобразует переменный электрический сигнал в механические колебания.',
    transistor: 'Транзистор управляет током одной цепи с помощью сигнала в управляющем выводе.',
    lamp: 'Нить лампы нагревается электрической мощностью и излучает свет.',
    breadboard: 'Группы отверстий внутри макетной платы электрически соединены.',
  };
  const sections: HelpSection[] = [
    { id: 'description', title: 'Описание', text: catalogDescription },
  ];
  if (principle[kind]) {
    sections.push({ id: 'principle', title: 'Принцип работы', text: principle[kind] as string });
  }
  sections.push({
    id: 'connection',
    title: 'Подключение',
    text: 'Подключайте провода к обозначенным выводам компонента. Точные состояния выводов показаны во вкладке технической информации.',
  });
  return sections;
}
