// TEST_ONLY actual DedicatedWorker entry. No Module/Model/Data crosses this boundary.
import {
  runBrowserRealm,
  validateIdentity,
  assertAcknowledgement,
  terminalReceipt,
  failureRecord,
  failureError,
} from './mujoco-portability-runtime.mjs';
import { demand, PortabilityError } from './mujoco-portability-sampler.mjs';

export function installDedicatedWorker(scope) {
  let state = 'CREATED',
    pending = null,
    fatal = null;
  const resources = {
    listenersCreated: 1,
    listenersRemoved: 0,
    packetsTransferred: 0,
    senderBuffersDetached: 0,
    maxInflight: 0,
    disposed: false,
  };
  const send = (envelope, bytes, onDispatched) =>
    new Promise((resolve, reject) => {
      if (fatal) {
        reject(fatal);
        return;
      }
      try {
        demand(pending === null && state === 'RUNNING', 'WORKER_INFLIGHT');
        pending = { envelope, resolve, reject };
        resources.maxInflight = Math.max(resources.maxInflight, 1);
        if (bytes) {
          demand(
            bytes instanceof Uint8Array &&
              bytes.byteOffset === 0 &&
              bytes.buffer.byteLength === bytes.byteLength,
            'WORKER_OWNED_PACKET',
          );
          const buffer = bytes.buffer;
          scope.postMessage({ kind: 'event', envelope, buffer }, [buffer]);
          onDispatched?.();
          resources.packetsTransferred += 1;
          demand(buffer.byteLength === 0, 'WORKER_TRANSFER_NOT_DETACHED');
          resources.senderBuffersDetached += 1;
        } else {
          scope.postMessage({ kind: 'event', envelope });
          onDispatched?.();
        }
      } catch (error) {
        pending = null;
        reject(error);
      }
    });
  const fail = (error) => {
    fatal = error instanceof Error ? error : new PortabilityError(String(error));
    if (pending) {
      const current = pending;
      pending = null;
      current.reject(fatal);
    }
    if (state === 'CREATED') {
      state = 'ERROR';
      resources.listenersRemoved += 1;
      resources.disposed = true; // Admission never started; no native owner exists.
      scope.onmessage = null;
      scope.postMessage({
        kind: 'worker-failed',
        error: String(fatal),
        failure: failureRecord(fatal, 'worker_start'),
        resources,
      });
      scope.close();
    }
  };
  scope.onmessage = (event) => {
    const message = event.data;
    try {
      if (message?.kind === 'ack') {
        demand(pending !== null && state === 'RUNNING', 'WORKER_UNEXPECTED_ACK');
        assertAcknowledgement(pending.envelope, message.ack);
        const current = pending;
        pending = null;
        current.resolve(message.ack);
        return;
      }
      if (message?.kind === 'fatal') {
        fail(
          message.failure
            ? failureError(message.failure)
            : new PortabilityError('WORKER_HOST_FAILURE', { reason: String(message.reason) }),
        );
        return;
      }
      demand(message?.kind === 'start' && state === 'CREATED', 'WORKER_START_PROTOCOL');
      validateIdentity(message.config?.identity);
      demand(message.config.identity.realm === 'dedicated-worker', 'WORKER_REALM_IDENTITY');
      state = 'RUNNING';
      runBrowserRealm(message.config, send).then(
        (result) => {
          state = 'STOPPING';
          resources.disposed =
            result.counters.liveModels === 0 &&
            result.counters.liveData === 0 &&
            result.counters.liveWarningCopies === 0;
          resources.listenersRemoved += 1;
          scope.onmessage = null;
          scope.postMessage({
            kind: 'worker-disposed',
            result: terminalReceipt(result, { logs: result.logs, resources }),
          });
          state = 'DISPOSED';
          scope.close();
        },
        (error) => {
          state = 'ERROR';
          resources.listenersRemoved += 1;
          scope.onmessage = null;
          scope.postMessage({
            kind: 'worker-failed',
            error: String(error),
            failure: failureRecord(error, 'worker_realm_rejection'),
            resources,
          });
          scope.close();
        },
      );
    } catch (error) {
      fail(error);
    }
  };
  return { resources, state: () => state };
}

if (
  typeof globalThis.WorkerGlobalScope === 'function' &&
  globalThis instanceof globalThis.WorkerGlobalScope
) {
  installDedicatedWorker(globalThis);
}
