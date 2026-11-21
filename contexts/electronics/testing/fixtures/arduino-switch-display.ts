import { RAW_DISPLAY_DIGITS } from './raw-seven-segment.js';
import { MATRIX_SEGMENTS } from './arduino-seven-segment-matrix.js';

/** Physical one-digit counter with genuine dispatch, functions and Serial. */
export const SWITCH_DISPLAY_SOURCE = `int d0=8;unsigned long lastTick=0;
void setup(){for(int p=2;p<11;p++){pinMode(p,OUTPUT);}Serial.begin(9600);Serial.println(d0);lastTick=millis();}
void loop(){digitalWrite(10,LOW);show(d0);digitalWrite(10,HIGH);delay(2);digitalWrite(10,LOW);if(millis()-lastTick>=40){d0++;if(d0>=10)d0=0;Serial.println(d0);lastTick=millis();}}
void show(int value){switch(value){${RAW_DISPLAY_DIGITS.map(
  (pattern, digit) =>
    `case ${digit}:${MATRIX_SEGMENTS.map(
      (segment, index) =>
        `digitalWrite(${2 + index},${pattern.includes(segment) ? 'HIGH' : 'LOW'});`,
    ).join('')}break;`,
).join(
  '\n',
)}default:${MATRIX_SEGMENTS.map((_, index) => `digitalWrite(${2 + index},LOW);`).join('')}break;}}`;
