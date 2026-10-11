const received = new WeakMap<object, string>();
export function noteRequestReceipt(request: object): void {
  received.set(request, new Date().toISOString());
}
export function requestReceivedAt(request: object): string {
  return received.get(request) ?? new Date().toISOString();
}
