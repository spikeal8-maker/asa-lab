import { spawn } from 'node:child_process';

/** Inspect compressed audio in memory, never trusting browser-reported duration.
 * ffprobe is available inside the API runtime image, with no saved media files.
 * Bounded execution and output prevent malformed media from monopolising CPU/RAM. */
export async function inspectPolzaAudioSeconds(
  bytes: Buffer,
  signal?: AbortSignal,
): Promise<number> {
  if (signal?.aborted) throw new Error('audio_probe_cancelled');

  return new Promise<number>((resolve, reject) => {
    const child = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_packets',
        '-show_entries',
        'packet=pts_time,duration_time',
        '-of',
        'csv=p=0',
        '-i',
        'pipe:0',
      ],
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
    );
    let settled = false;
    let pending = '';
    let processed = 0;
    let outputBytes = 0;
    let packetCount = 0;
    let duration = 0;

    const cleanup = () => {
      clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
    };
    const finish = (error: Error | null, result = duration) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (child.exitCode === null) child.kill('SIGKILL');
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => finish(new Error('audio_probe_cancelled'));
    const deadline = setTimeout(() => finish(new Error('audio_probe_timeout')), 4000);
    deadline.unref();
    signal?.addEventListener('abort', abort, { once: true });

    function takeLine(line: string): void {
      packetCount += 1;
      if (packetCount > 4096) {
        finish(new Error('audio_probe_too_many_packets'));
        return;
      }
      const [position, length] = line.split(',');
      const start = Number(position);
      const seconds = Number(length);
      if (
        position !== undefined &&
        length !== undefined &&
        Number.isFinite(start) &&
        Number.isFinite(seconds) &&
        start >= -2 &&
        seconds >= 0 &&
        start <= 3600
      ) {
        duration = Math.max(duration, start + seconds);
      }
    }

    child.on('error', () => finish(new Error('audio_probe_unavailable')));
    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > 131072) {
        finish(new Error('audio_probe_output_limit'));
        return;
      }
      const rows = (pending + chunk.toString('utf8')).split('\n');
      pending = rows.pop() ?? '';
      if (pending.length > 1000) {
        finish(new Error('audio_probe_output_limit'));
        return;
      }
      for (const line of rows) {
        if (settled) return;
        if (line.trim()) takeLine(line.trim());
        processed++;
      }
    });
    child.on('close', (code) => {
      if (settled) return;
      if (pending.trim()) takeLine(pending.trim());
      if (code !== 0 || processed === 0 || !Number.isFinite(duration) || duration <= 0.05) {
        finish(new Error('audio_probe_invalid'));
        return;
      }
      finish(null);
    });
    child.stdin.on('error', () => {
      // A malformed container may close the probe before stdin has completed.
    });
    child.stdin.end(bytes);
  });
}
