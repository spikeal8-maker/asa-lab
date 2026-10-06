// Temporary #513 diagnostic: one finite CPU contender in the test-runner container.
const end = Date.now() + 30_000;
let iterations = 0;
while (Date.now() < end) {
  for (let index = 0; index < 10_000; index += 1) Math.sqrt(index + iterations);
  iterations += 10_000;
}
console.log(`E2_CPU_PROBE iterations=${iterations}`);
