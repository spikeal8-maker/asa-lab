// Temporary #510 measurement: one finite contender, unchanged product physics.
const started = Date.now();
const usage = process.cpuUsage();
const end = started + 90_000;
let iterations = 0;
let checksum = 0;
console.log(
  JSON.stringify({ kind: 'cadence-cpu-start', pid: process.pid, started, durationMs: 90_000 }),
);
while (Date.now() < end) {
  for (let index = 0; index < 10_000; index += 1) checksum += Math.sqrt(index + iterations);
  iterations += 10_000;
}
console.log(
  JSON.stringify({
    kind: 'cadence-cpu-end',
    pid: process.pid,
    wallMs: Date.now() - started,
    cpu: process.cpuUsage(usage),
    iterations,
    checksum,
  }),
);
