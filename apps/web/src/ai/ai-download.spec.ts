import { describe, expect, it } from 'vitest';
import { codeDownloadFormat } from './ai-download';

describe('local code download filenames', () => {
  it.each([
    ['html', 'index.html'],
    ['python', 'code.py'],
    ['javascript', 'code.js'],
    ['json', 'code.json'],
    ['csv', 'code.csv'],
    ['cpp', 'code.cpp'],
    ['../../evil.exe', 'code.txt'],
    ['unknown', 'code.txt'],
    ['constructor', 'code.txt'],
    ['__proto__', 'code.txt'],
  ])('%s uses a bounded known extension', (language, name) => {
    expect(codeDownloadFormat(language, 'example').name).toBe(name);
  });
  it('recognizes a complete unlabelled HTML document but not an HTML fragment', () => {
    expect(codeDownloadFormat('', '<!doctype html><html></html>').name).toBe('index.html');
    expect(codeDownloadFormat('', '<button>Run</button>').name).toBe('code.txt');
  });
});
