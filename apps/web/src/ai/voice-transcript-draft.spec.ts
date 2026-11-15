import { expect, it } from 'vitest';
import { mergeVoiceTranscript } from './voice-transcript-draft';

it('keeps an existing draft and the complete 6000-character transcript separately', () => {
  const draft = 'My unsent question';
  const transcript = 'Р'.repeat(6000);
  expect(mergeVoiceTranscript(draft, transcript)).toEqual({ draft, overflow: transcript });
});

it('appends a transcript only when the whole text fits the composer', () => {
  expect(mergeVoiceTranscript('Question ', 'answer')).toEqual({
    draft: 'Question answer',
    overflow: null,
  });
  expect(mergeVoiceTranscript('a'.repeat(2999), 'b')).toEqual({
    draft: 'a'.repeat(2999),
    overflow: 'b',
  });
});
