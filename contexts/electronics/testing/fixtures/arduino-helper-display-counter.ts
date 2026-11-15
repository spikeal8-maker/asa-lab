import { RAW_DISPLAY_DIGITS } from './raw-seven-segment.js';
import { MATRIX_SEGMENTS } from './arduino-seven-segment-matrix.js';

/** A real integer counter: 8/98/998/9998 -> 9/99/999/9999 -> zero. */
export function helperDisplayCounterSource(count: 1 | 2 | 3 | 4, helpers = true): string {
  const declarations = Array.from({ length: count }, (_, i) => `int d${i}=${i ? 9 : 8};`).join(
    '\n',
  );
  const segments = (value: string) =>
    MATRIX_SEGMENTS.map((segment, i) => {
      const digits = RAW_DISPLAY_DIGITS.flatMap((pattern, digit) =>
        pattern.includes(segment) ? [digit] : [],
      );
      return `digitalWrite(${2 + i},${digits.map((digit) => `${value}==${digit}`).join('||') || 'LOW'});`;
    }).join('\n');
  let carry = '';
  for (let i = count - 1; i >= 0; i--)
    carry = `if(d${i}>=10){d${i}=0;${i + 1 < count ? `d${i + 1}++;${carry}` : ''}}`;
  const increment = `d0++;${carry}`;
  const scans = Array.from({ length: count }, (_, i) =>
    helpers
      ? `scan(${i},d${count - i - 1});`
      : `for(int p=10;p<${10 + count};p++){digitalWrite(p,LOW);}${segments(`d${count - i - 1}`)}digitalWrite(${10 + i},HIGH);delay(2);digitalWrite(${10 + i},LOW);`,
  ).join('\n');
  return `${declarations}\nunsigned long lastTick=0;
void setup(){for(int p=2;p<${10 + count};p++){pinMode(p,OUTPUT);}lastTick=millis();}
void loop(){${scans}if(millis()-lastTick>=40){${helpers ? 'increment();' : increment}lastTick=millis();}}
${
  helpers
    ? `void segments(int value){${segments('value')}}
void scan(int selector,int value){for(int p=10;p<${10 + count};p++){digitalWrite(p,LOW);}segments(value);digitalWrite(10+selector,HIGH);delay(2);digitalWrite(10+selector,LOW);}
void increment(){${increment}}`
    : ''
}`;
}
