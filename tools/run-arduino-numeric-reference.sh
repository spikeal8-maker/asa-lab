#!/usr/bin/env bash
# Optional reference evidence, NOT the normal browser runtime or its compiler.
# Run in an isolated Linux container with the repository mounted read-only.
set -euo pipefail
task_dir="$(mktemp -d)"
cd "$task_dir"
apt-get update -qq
apt-get install -y -qq --no-install-recommends ca-certificates curl bzip2 gdb-avr simavr >/dev/null
curl --fail --silent --show-error --location https://downloads.arduino.cc/cores/staging/avr-1.8.6.tar.bz2 -o core.tar.bz2
curl --fail --silent --show-error --location https://downloads.arduino.cc/tools/avr-gcc-7.3.0-atmel3.6.1-arduino7-x86_64-pc-linux-gnu.tar.bz2 -o gcc.tar.bz2
printf '%s\n' 'ff1d17274b5a952f172074bd36c3924336baefded0232e10982f8999c2f7c3b6  core.tar.bz2' 'bd8c37f6952a2130ac9ee32c53f6a660feb79bee8353c8e289eb60fdcefed91e  gcc.tar.bz2' | sha256sum --check
mkdir core gcc
tar -xjf core.tar.bz2 -C core --strip-components=1
tar -xjf gcc.tar.bz2 -C gcc --strip-components=1
gcc/bin/avr-g++ --version | head -n 1
dpkg-query --show simavr gdb-avr
gcc/bin/avr-g++ -mmcu=atmega328p -DF_CPU=16000000L -DARDUINO=10819 -DARDUINO_AVR_UNO -DARDUINO_ARCH_AVR -std=gnu++11 -Os -g -ffunction-sections -fdata-sections -Wl,--gc-sections -fno-exceptions -Icore/cores/arduino -Icore/variants/standard /work/contexts/electronics/testing/fixtures/arduino-uno-numeric-reference.cpp core/cores/arduino/WMath.cpp -o reference.elf
simavr -m atmega328p -f 16000000 -g reference.elf &
simulator_pid=$!
trap 'kill "$simulator_pid" 2>/dev/null || true' EXIT
reference_output="$(timeout 30 avr-gdb -batch reference.elf -ex 'target remote :1234' -ex 'break reference_done' -ex continue -ex 'print integers' -ex 'print fractions')"
printf '%s\n' "$reference_output"
[[ "$reference_output" == *'$1 = {2, 2, 0, 1, 127, -2, -1, 1, 0, 256, -1, -1, 1, 0, 1, 1}'* ]]
[[ "$reference_output" == *'$2 = {2, 2.5, 16777216}'* ]]
printf '%s\n' 'Uno numeric reference: PASS (16 integer + 3 floating observations)'
