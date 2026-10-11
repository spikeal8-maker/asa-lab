import { classJoinQrPath } from './class-join-qr-path';

export async function encodeClassJoinQr(url: string): Promise<{ size: number; d: string }> {
  const { default: qr } = await import('qrcode-generator');
  const code = qr(0, 'M');
  code.addData(url);
  code.make();
  return classJoinQrPath(code);
}
