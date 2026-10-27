import {
  binaryValue,
  convertValue,
  numericValue,
  zeroValue,
  type ArduinoValue,
} from './arduino-values.js';

// Pinned logical compatibility: ArduinoCore-avr 1.8.6 cores/arduino/WMath.cpp
// and avr-libc avr-libc-2_0_0-release libc/stdlib/random.c (not AVR cycle timing).
// https://github.com/arduino/ArduinoCore-avr/blob/1.8.6/cores/arduino/WMath.cpp
// https://github.com/avrdudes/avr-libc/blob/avr-libc-2_0_0-release/libc/stdlib/random.c
// Recurrence adapted from avr-libc's Berkeley implementation:
/*!
 * Copyright (c) 1990, 1993
 * The Regents of the University of California. All rights reserved.
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 * 3. Neither the name of the University nor the names of its contributors may
 *    be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE REGENTS AND CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE REGENTS OR CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
interface RandomContext {
  randomState?: number | undefined;
  readonly validateOnly?: boolean;
}

export function valid(value: unknown): boolean {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 0xffffffff)
  );
}

export function seed(state: RandomContext, seed: ArduinoValue): void {
  const value = convertValue(seed, 'unsigned long', state.validateOnly).value;
  if (!state.validateOnly && value !== 0) state.randomState = value;
}

export function draw(state: RandomContext, args: readonly ArduinoValue[]): ArduinoValue {
  const bounds = args.map((arg) => convertValue(arg, 'long', state.validateOnly));
  if (state.validateOnly) return zeroValue('long');
  const low = bounds.length === 2 ? bounds[0]! : zeroValue('long');
  const high = bounds.at(-1);
  if (bounds.length === 2 && low.value >= high!.value) return low;
  const width = high ? binaryValue('-', high, low) : undefined;
  if (width?.value === 0) return low;
  // AVR's unsigned-long context is read through signed long before division.
  let x = (state.randomState ?? 1) | 0;
  if (x === 0) x = 123459876;
  const hi = Math.trunc(x / 127773);
  x = 16807 * (x % 127773) - 2836 * hi;
  if (x < 0) x += 2147483647;
  state.randomState = x >>> 0;
  const value = numericValue('long', state.randomState % 2147483648);
  return width ? binaryValue('+', binaryValue('%', value, width), low) : value;
}
