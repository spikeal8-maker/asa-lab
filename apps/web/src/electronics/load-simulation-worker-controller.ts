/** Load the running-simulation capability only after a committed Start. */
export async function loadSimulationWorkerController() {
  return (await import('./live-simulation-worker-controller'))
    .ElectronicsLiveSimulationWorkerController;
}
